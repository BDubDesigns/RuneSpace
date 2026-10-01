import { and, asc, eq, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activeActions,
  characters,
  playerAccounts,
  playerTradeClaims,
  playerTradeRequests,
  playerTradeSessions,
  type Character,
  type PlayerTradeRequest,
  type PlayerTradeSession,
} from "@/db/rune-space";
import {
  decideTradeRequestBudget,
  effectiveTradeRequestStatus,
  effectiveTradeSessionStatus,
  isRepeatedTradeRequester,
  tradeRequestExpiresAt,
  tradeRequestWindowStart,
  tradeSessionExpiresAt,
  type TradeRequestStatus,
  type TradeSessionStatus,
} from "@/game/domain/player-trade";
import type {
  IncomingTradeRequestView,
  TradeCommandResult,
  TradeRefusalReason,
  TradeRequestChange,
  TradeRequestView,
  TradeSessionChange,
  TradeSessionView,
  TradeStateView,
} from "@/game/schemas/player-trade";
import type { CharacterTarget } from "@/game/schemas/whispers";
import type { DatabaseTransaction } from "@/server/action-resolution";
import {
  loadAccountGameplayAccess,
  requireGameplayAccess,
  requirePlayableOwnedCharacter,
} from "@/server/gameplay-access";
import { requireTradeRequestInitiationAllowed } from "@/server/moderation-sanctions";
import { OwnershipError } from "@/server/ownership";
import { blockBetween } from "@/server/player-blocks";
import { publishRealtimeEvent } from "@/server/realtime";
import { resolveCharacterTarget } from "@/server/social-targets";

/**
 * Same-location player trade requests and exclusive sessions (issue #266).
 *
 * The browser names the acting character and a target or id; everything else
 * is proved here against the database, inside one transaction per command:
 *
 * - Creation locks the requester's row and then a per-account advisory lock,
 *   so every tab, device, and character of one account shares one serialized
 *   request budget, and one character's two tabs cannot both pass the
 *   one-outgoing-request check. The partial unique index on pending requests
 *   is the persistence backstop.
 * - Acceptance locks both characters' rows in id order (the same order every
 *   acceptance uses, so competing acceptances serialize instead of
 *   deadlocking), then the request row, revalidates everything, and claims
 *   both characters. `player_trade_claims` is keyed by character, so no
 *   character can hold two claims whatever races. Holding both rows is also
 *   what serializes acceptance with the gameplay gate
 *   (`server/player-trade-gate.ts`).
 * - Cancel, Decline, and session Cancel lock only the request or session row.
 *
 * Lock order is always characters, then request/session rows (several in id
 * order), then claims. Realtime prompts publish only after commit.
 *
 * Expiry and movement are derived from stored facts and the request clock
 * (`game/domain/player-trade.ts`); the derived outcome is written down when it
 * matters — before a requester's slot or a character's claim is reused, and at
 * acceptance — never by a job, and never by a read.
 */

type Tx = DatabaseTransaction;

/** Names the trade-request creation lock; the second key is the account. */
const TRADE_REQUEST_LOCK_NAMESPACE = 266;

const REFUSAL_COPY = {
  unavailable: "That character can't take a trade request right now.",
  requestUnavailable: "That trade request is no longer available.",
  sessionUnavailable: "That trade is no longer available.",
  alreadyRequesting: "You already have a trade request waiting. Cancel it to send another.",
  busy: "Finish what you're doing before trading.",
  inTrade: "You're already in a trade.",
  alreadyAccepted: "That trade request was already accepted.",
} as const;

type RequestEvent = {
  requestId: string;
  change: TradeRequestChange;
  characterIds: [string, string];
};
type SessionEvent = {
  sessionId: string;
  change: TradeSessionChange;
  characterIds: [string, string];
};

/** Prompts collected inside a transaction and published only after it commits. */
class TradeEvents {
  readonly requests: RequestEvent[] = [];
  readonly sessions: SessionEvent[] = [];

  request(
    row: Pick<PlayerTradeRequest, "id" | "requesterCharacterId" | "recipientCharacterId">,
    change: TradeRequestChange,
  ) {
    this.requests.push({
      requestId: row.id,
      change,
      characterIds: [row.requesterCharacterId, row.recipientCharacterId],
    });
  }

  session(
    row: Pick<PlayerTradeSession, "id" | "requesterCharacterId" | "recipientCharacterId">,
    change: TradeSessionChange,
  ) {
    this.sessions.push({
      sessionId: row.id,
      change,
      characterIds: [row.requesterCharacterId, row.recipientCharacterId],
    });
  }

  publish() {
    for (const event of this.requests) {
      for (const characterId of event.characterIds) {
        publishRealtimeEvent({ kind: "character", characterId }, "trade.request", {
          requestId: event.requestId,
          change: event.change,
        });
      }
    }
    for (const event of this.sessions) {
      for (const characterId of event.characterIds) {
        publishRealtimeEvent({ kind: "character", characterId }, "trade.session", {
          sessionId: event.sessionId,
          change: event.change,
        });
      }
    }
  }
}

function refused(
  reason: TradeRefusalReason,
  error: string,
  retryAfterMs?: number,
): Extract<TradeCommandResult, { status: "refused" }> {
  return retryAfterMs === undefined
    ? { status: "refused", reason, error }
    : { status: "refused", reason, error, retryAfterMs };
}

async function lockAccountTradeRequests(tx: Tx, accountId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${TRADE_REQUEST_LOCK_NAMESPACE}, hashtext(${accountId}))`,
  );
}

async function lockCharacter(tx: Tx, characterId: string): Promise<Character | undefined> {
  const [row] = await tx
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .for("update");
  return row;
}

async function isBusy(tx: Tx, characterId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: activeActions.characterId })
    .from(activeActions)
    .where(eq(activeActions.characterId, characterId));
  return rows.length > 0;
}

async function hasClaim(tx: Tx, characterId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: playerTradeClaims.characterId })
    .from(playerTradeClaims)
    .where(eq(playerTradeClaims.characterId, characterId));
  return rows.length > 0;
}

const requesterRow = alias(characters, "trade_requester");
const recipientRow = alias(characters, "trade_recipient");

function requestFacts(row: PlayerTradeRequest) {
  return {
    status: row.status as TradeRequestStatus,
    locationId: row.locationId,
    expiresAt: row.expiresAt,
  };
}

/** The authoritative end instant to record for a derived request outcome. */
function resolvedAtFor(row: PlayerTradeRequest, status: TradeRequestStatus, now: Date): Date {
  return status === "expired" && row.expiresAt < now ? row.expiresAt : now;
}

/**
 * Write down the derived outcome of a character's own stored-pending request
 * (expired, or invalidated by movement) so its one outgoing slot is free. The
 * caller holds the character's row lock.
 */
async function settleOutgoingRequest(
  tx: Tx,
  requesterCharacterId: string,
  now: Date,
  events: TradeEvents,
) {
  const rows = await tx
    .select({
      request: playerTradeRequests,
      requesterLocationId: requesterRow.currentLocationId,
      recipientLocationId: recipientRow.currentLocationId,
    })
    .from(playerTradeRequests)
    .innerJoin(requesterRow, eq(requesterRow.id, playerTradeRequests.requesterCharacterId))
    .innerJoin(recipientRow, eq(recipientRow.id, playerTradeRequests.recipientCharacterId))
    .where(
      and(
        eq(playerTradeRequests.requesterCharacterId, requesterCharacterId),
        eq(playerTradeRequests.status, "pending"),
      ),
    )
    .for("update", { of: playerTradeRequests });
  for (const { request, requesterLocationId, recipientLocationId } of rows) {
    const effective = effectiveTradeRequestStatus(
      requestFacts(request),
      { requesterLocationId, recipientLocationId },
      now,
    );
    if (effective === "pending") continue;
    await tx
      .update(playerTradeRequests)
      .set({ status: effective, resolvedAt: resolvedAtFor(request, effective, now) })
      .where(eq(playerTradeRequests.id, request.id));
    events.request(request, effective as TradeRequestChange);
  }
}

/** End one session and release both claims. The caller holds the session row lock. */
async function endSession(
  tx: Tx,
  session: PlayerTradeSession,
  status: Exclude<TradeSessionStatus, "active">,
  endedAt: Date,
  endedByCharacterId: string | null,
  events: TradeEvents,
) {
  await tx
    .update(playerTradeSessions)
    .set({ status, endedAt, endedByCharacterId })
    .where(eq(playerTradeSessions.id, session.id));
  await tx.delete(playerTradeClaims).where(eq(playerTradeClaims.sessionId, session.id));
  events.session(session, status);
}

/**
 * Write down the inactivity expiry of any session these characters still
 * claim, so their claims are free. The caller holds the characters' row locks.
 */
async function settleExpiredClaims(
  tx: Tx,
  characterIds: readonly string[],
  now: Date,
  events: TradeEvents,
) {
  const claimed = tx
    .select({ id: playerTradeClaims.sessionId })
    .from(playerTradeClaims)
    .where(inArray(playerTradeClaims.characterId, [...characterIds]));
  const sessions = await tx
    .select()
    .from(playerTradeSessions)
    .where(inArray(playerTradeSessions.id, claimed))
    .orderBy(asc(playerTradeSessions.id))
    .for("update");
  for (const session of sessions) {
    if (session.status !== "active") continue;
    const effective = effectiveTradeSessionStatus(
      { status: "active", lastActivityAt: session.lastActivityAt },
      now,
    );
    if (effective === "active") continue;
    await endSession(
      tx,
      session,
      "expired",
      tradeSessionExpiresAt(session.lastActivityAt),
      null,
      events,
    );
  }
}

/**
 * Create a trade request from the acting character to a character at the same
 * World Location. Every refusal returns before anything is written that a
 * later request could observe, so a refused attempt never spends the budget
 * and never notifies anyone.
 */
export async function createTradeRequest(
  userId: string,
  characterId: string,
  target: CharacterTarget,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  const events = new TradeEvents();
  const result = await db.transaction(async (tx): Promise<TradeCommandResult> => {
    const accountId = await requireGameplayAccess(tx, userId);
    const [requester] = await tx
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.playerAccountId, accountId)))
      .for("update");
    if (!requester) throw new OwnershipError("Character not found", 404);
    await lockAccountTradeRequests(tx, accountId);

    await settleOutgoingRequest(tx, requester.id, now, events);
    await settleExpiredClaims(tx, [requester.id], now, events);

    const recipient = await resolveCharacterTarget(target, requester, { executor: tx });
    if (
      !recipient ||
      recipient.id === requester.id ||
      recipient.currentLocationId !== requester.currentLocationId
    ) {
      return refused("unavailable", REFUSAL_COPY.unavailable);
    }
    if (await hasClaim(tx, requester.id)) return refused("in_trade", REFUSAL_COPY.inTrade);
    if (await isBusy(tx, requester.id)) return refused("busy", REFUSAL_COPY.busy);
    const block = await blockBetween(accountId, recipient.playerAccountId, tx);
    if (block.iBlockedThem) {
      return refused(
        "blocked_by_you",
        `You blocked ${recipient.displayName}. Unblock them to trade.`,
      );
    }
    // Never disclosed: reads exactly like any other unavailable target.
    if (block.theyBlockedMe) return refused("unavailable", REFUSAL_COPY.unavailable);
    const initiation = await requireTradeRequestInitiationAllowed(tx, accountId, now);
    if (!initiation.allowed) return refused("socially_restricted", initiation.error);

    const [pending] = await tx
      .select({ id: playerTradeRequests.id })
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.requesterCharacterId, requester.id),
          eq(playerTradeRequests.status, "pending"),
        ),
      );
    if (pending) return refused("already_requesting", REFUSAL_COPY.alreadyRequesting);

    const windowStart = tradeRequestWindowStart(now);
    const recent = await tx
      .select({ createdAt: playerTradeRequests.createdAt })
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.requesterPlayerAccountId, accountId),
          gt(playerTradeRequests.createdAt, windowStart),
        ),
      );
    const budget = decideTradeRequestBudget(
      recent.map((row) => row.createdAt),
      now,
    );
    if (!budget.allowed) {
      const seconds = Math.max(1, Math.ceil(budget.retryAfterMs / 1000));
      return refused(
        "rate_limited",
        `You've sent a lot of trade requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
        budget.retryAfterMs,
      );
    }

    // The ledger only needs the rolling window; anything older is spent.
    await tx
      .delete(playerTradeRequests)
      .where(
        and(
          lte(playerTradeRequests.createdAt, windowStart),
          ne(playerTradeRequests.status, "pending"),
        ),
      );

    const [created] = await tx
      .insert(playerTradeRequests)
      .values({
        requesterCharacterId: requester.id,
        requesterPlayerAccountId: accountId,
        recipientCharacterId: recipient.id,
        recipientPlayerAccountId: recipient.playerAccountId,
        locationId: requester.currentLocationId,
        createdAt: now,
        expiresAt: tradeRequestExpiresAt(now),
      })
      .returning();
    events.request(created!, "created");
    return { status: "ok", state: await readTradeState(tx, requester, now) };
  });
  events.publish();
  return result;
}

/**
 * The requester withdraws its own request. Idempotent; available at any time
 * while the request has not been accepted.
 */
export async function cancelTradeRequest(
  userId: string,
  characterId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return respondToRequest(userId, characterId, requestId, "requester", now);
}

/** The recipient declines one request; other requests are untouched. Idempotent. */
export async function declineTradeRequest(
  userId: string,
  characterId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return respondToRequest(userId, characterId, requestId, "recipient", now);
}

async function respondToRequest(
  userId: string,
  characterId: string,
  requestId: string,
  side: "requester" | "recipient",
  now: Date,
): Promise<TradeCommandResult> {
  const events = new TradeEvents();
  const result = await db.transaction(async (tx): Promise<TradeCommandResult> => {
    const accountId = await requireGameplayAccess(tx, userId);
    const character = await ownedCharacter(tx, characterId, accountId);
    const [row] = await tx
      .select({
        request: playerTradeRequests,
        requesterLocationId: requesterRow.currentLocationId,
        recipientLocationId: recipientRow.currentLocationId,
      })
      .from(playerTradeRequests)
      .innerJoin(requesterRow, eq(requesterRow.id, playerTradeRequests.requesterCharacterId))
      .innerJoin(recipientRow, eq(recipientRow.id, playerTradeRequests.recipientCharacterId))
      .where(
        and(
          eq(playerTradeRequests.id, requestId),
          side === "requester"
            ? and(
                eq(playerTradeRequests.requesterCharacterId, character.id),
                eq(playerTradeRequests.requesterPlayerAccountId, accountId),
              )
            : and(
                eq(playerTradeRequests.recipientCharacterId, character.id),
                eq(playerTradeRequests.recipientPlayerAccountId, accountId),
              ),
        ),
      )
      .for("update", { of: playerTradeRequests });
    // A foreign, guessed, or pruned id reads exactly like a vanished request.
    if (!row) return refused("unavailable", REFUSAL_COPY.requestUnavailable);
    const { request } = row;
    const outcome: TradeRequestStatus = side === "requester" ? "canceled" : "declined";

    if (request.status === "pending") {
      const effective = effectiveTradeRequestStatus(requestFacts(request), row, now);
      const status = effective === "pending" ? outcome : effective;
      await tx
        .update(playerTradeRequests)
        .set({ status, resolvedAt: resolvedAtFor(request, status, now) })
        .where(eq(playerTradeRequests.id, request.id));
      events.request(request, status as TradeRequestChange);
    } else if (request.status === "accepted") {
      return refused("already_accepted", REFUSAL_COPY.alreadyAccepted);
    }
    // Any other terminal outcome: the request is already over, which is all a
    // Cancel or Decline asks for.
    return { status: "ok", state: await readTradeState(tx, character, now) };
  });
  events.publish();
  return result;
}

async function ownedCharacter(tx: Tx, characterId: string, accountId: string): Promise<Character> {
  const [row] = await tx
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.playerAccountId, accountId)));
  if (!row) throw new OwnershipError("Character not found", 404);
  return row;
}

/** Whether the requester's account may still play; its suspension voids the request. */
async function requesterMayPlay(tx: Tx, requesterAccountId: string): Promise<boolean> {
  const [owner] = await tx
    .select({ userId: playerAccounts.userId })
    .from(playerAccounts)
    .where(eq(playerAccounts.id, requesterAccountId));
  if (!owner) return false;
  const access = await loadAccountGameplayAccess(tx, owner.userId);
  return access.decision.allowed;
}

/**
 * The recipient accepts a request: in one transaction, both characters are
 * revalidated and claimed for one new session, the recipient's own outgoing
 * request is canceled, and every other pending request involving either
 * participant is invalidated so its requester is released. Repeating an
 * Accept that already succeeded returns the same session.
 */
export async function acceptTradeRequest(
  userId: string,
  characterId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  const events = new TradeEvents();
  const result = await db.transaction(async (tx): Promise<TradeCommandResult> => {
    const accountId = await requireGameplayAccess(tx, userId);
    // Unlocked peek, only to learn whose rows to lock; everything is
    // re-read after the locks are held.
    const [peek] = await tx
      .select({ requesterCharacterId: playerTradeRequests.requesterCharacterId })
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.id, requestId),
          eq(playerTradeRequests.recipientCharacterId, characterId),
          eq(playerTradeRequests.recipientPlayerAccountId, accountId),
        ),
      );
    if (!peek) {
      await ownedCharacter(tx, characterId, accountId);
      return refused("unavailable", REFUSAL_COPY.requestUnavailable);
    }

    const locked = new Map<string, Character>();
    for (const id of [peek.requesterCharacterId, characterId].sort()) {
      const row = await lockCharacter(tx, id);
      if (row) locked.set(id, row);
    }
    const recipient = locked.get(characterId);
    const requester = locked.get(peek.requesterCharacterId);
    if (!recipient || recipient.playerAccountId !== accountId) {
      throw new OwnershipError("Character not found", 404);
    }
    if (!requester) return refused("unavailable", REFUSAL_COPY.requestUnavailable);

    await settleExpiredClaims(tx, [requester.id, recipient.id], now, events);

    const [request] = await tx
      .select()
      .from(playerTradeRequests)
      .where(eq(playerTradeRequests.id, requestId))
      .for("update");
    if (!request) return refused("unavailable", REFUSAL_COPY.requestUnavailable);
    if (request.status === "accepted") {
      // A retried Accept: the session it began is the answer, if still open.
      return { status: "ok", state: await readTradeState(tx, recipient, now) };
    }
    if (request.status !== "pending") {
      return refused("unavailable", REFUSAL_COPY.requestUnavailable);
    }

    const invalidate = async (status: "expired" | "invalidated") => {
      await tx
        .update(playerTradeRequests)
        .set({ status, resolvedAt: resolvedAtFor(request, status, now) })
        .where(eq(playerTradeRequests.id, request.id));
      events.request(request, status);
      return refused("unavailable", REFUSAL_COPY.requestUnavailable);
    };

    const effective = effectiveTradeRequestStatus(
      requestFacts(request),
      {
        requesterLocationId: requester.currentLocationId,
        recipientLocationId: recipient.currentLocationId,
      },
      now,
    );
    if (effective === "expired" || effective === "invalidated") return invalidate(effective);

    // The recipient's own state: refuse, but leave the request open so they
    // can finish up and accept before it expires.
    if (await hasClaim(tx, recipient.id)) return refused("in_trade", REFUSAL_COPY.inTrade);
    if (await isBusy(tx, recipient.id)) return refused("busy", REFUSAL_COPY.busy);

    // Anything that voids the request itself. A Block in either direction is
    // never disclosed: it reads like any other vanished request.
    if (
      (await hasClaim(tx, requester.id)) ||
      (await isBusy(tx, requester.id)) ||
      !(await requesterMayPlay(tx, request.requesterPlayerAccountId))
    ) {
      return invalidate("invalidated");
    }
    const block = await blockBetween(accountId, request.requesterPlayerAccountId, tx);
    if (block.iBlockedThem || block.theyBlockedMe) return invalidate("invalidated");

    // The recipient's own outgoing request is released first.
    const ownOutgoing = await tx
      .select()
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.requesterCharacterId, recipient.id),
          eq(playerTradeRequests.status, "pending"),
        ),
      )
      .orderBy(asc(playerTradeRequests.id))
      .for("update");
    for (const outgoing of ownOutgoing) {
      await tx
        .update(playerTradeRequests)
        .set({ status: "canceled", resolvedAt: now })
        .where(eq(playerTradeRequests.id, outgoing.id));
      events.request(outgoing, "canceled");
    }

    const [session] = await tx
      .insert(playerTradeSessions)
      .values({
        requesterCharacterId: requester.id,
        requesterPlayerAccountId: request.requesterPlayerAccountId,
        recipientCharacterId: recipient.id,
        recipientPlayerAccountId: accountId,
        locationId: request.locationId,
        createdAt: now,
        lastActivityAt: now,
      })
      .returning();
    // The primary key on `character_id` makes a second claim impossible.
    await tx.insert(playerTradeClaims).values([
      { characterId: requester.id, sessionId: session!.id },
      { characterId: recipient.id, sessionId: session!.id },
    ]);
    await tx
      .update(playerTradeRequests)
      .set({ status: "accepted", resolvedAt: now, sessionId: session!.id })
      .where(eq(playerTradeRequests.id, request.id));
    events.request(request, "accepted");
    events.session(session!, "started");

    // Every other request either participant is part of can no longer begin
    // a trade; release their requesters now rather than at expiry.
    const participants = [requester.id, recipient.id];
    const others = await tx
      .select()
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.status, "pending"),
          or(
            inArray(playerTradeRequests.requesterCharacterId, participants),
            inArray(playerTradeRequests.recipientCharacterId, participants),
          ),
        ),
      )
      .orderBy(asc(playerTradeRequests.id))
      .for("update");
    for (const other of others) {
      await tx
        .update(playerTradeRequests)
        .set({ status: "invalidated", resolvedAt: now })
        .where(eq(playerTradeRequests.id, other.id));
      events.request(other, "invalidated");
    }

    return { status: "ok", state: await readTradeState(tx, recipient, now) };
  });
  events.publish();
  return result;
}

/**
 * Either participant cancels the session before commit. Nothing moves; both
 * characters are released. Idempotent: a session that already ended stays as
 * it ended.
 */
export async function cancelTradeSession(
  userId: string,
  characterId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  const events = new TradeEvents();
  const result = await db.transaction(async (tx): Promise<TradeCommandResult> => {
    const accountId = await requireGameplayAccess(tx, userId);
    const character = await ownedCharacter(tx, characterId, accountId);
    const [session] = await tx
      .select()
      .from(playerTradeSessions)
      .where(
        and(
          eq(playerTradeSessions.id, sessionId),
          or(
            and(
              eq(playerTradeSessions.requesterCharacterId, character.id),
              eq(playerTradeSessions.requesterPlayerAccountId, accountId),
            ),
            and(
              eq(playerTradeSessions.recipientCharacterId, character.id),
              eq(playerTradeSessions.recipientPlayerAccountId, accountId),
            ),
          ),
        ),
      )
      .for("update");
    // A nonparticipant's or guessed id reads exactly like a missing session.
    if (!session) return refused("unavailable", REFUSAL_COPY.sessionUnavailable);
    if (session.status === "active") {
      const effective = effectiveTradeSessionStatus(
        { status: "active", lastActivityAt: session.lastActivityAt },
        now,
      );
      if (effective === "expired") {
        await endSession(
          tx,
          session,
          "expired",
          tradeSessionExpiresAt(session.lastActivityAt),
          null,
          events,
        );
      } else {
        await endSession(tx, session, "canceled", now, character.id, events);
      }
    }
    return { status: "ok", state: await readTradeState(tx, character, now) };
  });
  events.publish();
  return result;
}

/**
 * The acting character's trade state: its effectively pending outgoing
 * request, the effectively pending requests it has received, and its active
 * session. A pure read; derived expiry is reported, never written, here.
 */
export async function getTradeState(
  userId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<TradeStateView> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  return readTradeState(db, character, now);
}

type Reader = Pick<Tx, "select">;

function requestView(
  request: PlayerTradeRequest,
  counterpart: { id: string; displayName: string },
): TradeRequestView {
  return {
    id: request.id,
    counterpart: { characterId: counterpart.id, name: counterpart.displayName },
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  };
}

async function readTradeState(
  reader: Reader,
  character: Character,
  now: Date,
): Promise<TradeStateView> {
  const requestRows = await reader
    .select({
      request: playerTradeRequests,
      requester: { id: requesterRow.id, displayName: requesterRow.displayName },
      requesterLocationId: requesterRow.currentLocationId,
      recipient: { id: recipientRow.id, displayName: recipientRow.displayName },
      recipientLocationId: recipientRow.currentLocationId,
    })
    .from(playerTradeRequests)
    .innerJoin(requesterRow, eq(requesterRow.id, playerTradeRequests.requesterCharacterId))
    .innerJoin(recipientRow, eq(recipientRow.id, playerTradeRequests.recipientCharacterId))
    .where(
      and(
        eq(playerTradeRequests.status, "pending"),
        or(
          eq(playerTradeRequests.requesterCharacterId, character.id),
          eq(playerTradeRequests.recipientCharacterId, character.id),
        ),
      ),
    )
    .orderBy(asc(playerTradeRequests.createdAt), asc(playerTradeRequests.id));
  const live = requestRows.filter(
    (row) => effectiveTradeRequestStatus(requestFacts(row.request), row, now) === "pending",
  );

  const outgoingRow = live.find((row) => row.request.requesterCharacterId === character.id);
  const incomingRows = live.filter((row) => row.request.recipientCharacterId === character.id);

  // A Block in either direction hides the request from its recipient; it can
  // never be accepted, and it simply runs out for the requester.
  const senderAccounts = [
    ...new Set(incomingRows.map((row) => row.request.requesterPlayerAccountId)),
  ];
  const blocked = new Set<string>();
  const repeated = new Set<string>();
  for (const senderAccountId of senderAccounts) {
    const block = await blockBetween(character.playerAccountId, senderAccountId, reader);
    if (block.iBlockedThem || block.theyBlockedMe) blocked.add(senderAccountId);
    const [count] = await reader
      .select({ count: sql<number>`count(*)::int` })
      .from(playerTradeRequests)
      .where(
        and(
          eq(playerTradeRequests.requesterPlayerAccountId, senderAccountId),
          eq(playerTradeRequests.recipientPlayerAccountId, character.playerAccountId),
          gt(playerTradeRequests.createdAt, tradeRequestWindowStart(now)),
          lte(playerTradeRequests.createdAt, now),
        ),
      );
    if (isRepeatedTradeRequester(count?.count ?? 0)) repeated.add(senderAccountId);
  }
  const incoming: IncomingTradeRequestView[] = incomingRows
    .filter((row) => !blocked.has(row.request.requesterPlayerAccountId))
    .map((row) => ({
      ...requestView(row.request, row.requester),
      blockProminent: repeated.has(row.request.requesterPlayerAccountId),
    }));

  const [claim] = await reader
    .select({ session: playerTradeSessions })
    .from(playerTradeClaims)
    .innerJoin(playerTradeSessions, eq(playerTradeSessions.id, playerTradeClaims.sessionId))
    .where(eq(playerTradeClaims.characterId, character.id));
  let session: TradeSessionView | null = null;
  if (
    claim &&
    effectiveTradeSessionStatus(
      {
        status: claim.session.status as TradeSessionStatus,
        lastActivityAt: claim.session.lastActivityAt,
      },
      now,
    ) === "active"
  ) {
    const counterpartId =
      claim.session.requesterCharacterId === character.id
        ? claim.session.recipientCharacterId
        : claim.session.requesterCharacterId;
    const [counterpart] = await reader
      .select({ id: characters.id, displayName: characters.displayName })
      .from(characters)
      .where(eq(characters.id, counterpartId));
    session = {
      id: claim.session.id,
      counterpart: {
        characterId: counterpartId,
        name: counterpart?.displayName ?? "",
      },
      startedAt: claim.session.createdAt.toISOString(),
      expiresAt: tradeSessionExpiresAt(claim.session.lastActivityAt).toISOString(),
    };
  }

  return {
    outgoing: outgoingRow ? requestView(outgoingRow.request, outgoingRow.recipient) : null,
    incoming,
    session,
  };
}
