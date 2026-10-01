import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
  activeActions,
  cargoHoldItemInstances,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
  playerAccounts,
  playerTradeClaims,
  playerTradeOfferItems,
  playerTradeOfferStacks,
  playerTradeRequests,
  playerTradeSessions,
  type Character,
  type PlayerTradeRequest,
  type PlayerTradeSession,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import {
  decideTradeRequestBudget,
  effectiveTradeRequestStatus,
  effectiveTradeSessionStatus,
  hasTradeConsent,
  isRepeatedTradeRequester,
  isValidCreditOffer,
  isValidStackQuantity,
  NO_TRADE_CONSENT,
  otherTradeSide,
  sideConfirmed,
  sideReady,
  tradeOfferPhase,
  tradeRequestExpiresAt,
  tradeRequestWindowStart,
  tradeSessionExpiresAt,
  type TradeConsent,
  type TradeRequestStatus,
  type TradeSessionStatus,
  type TradeSide,
} from "@/game/domain/player-trade";
import {
  isEmptyTradeOffer,
  planTradeSettlement,
  type SettledTradeOffer,
  type TradeOfferContent,
  type TradeSettlementFailure,
  type TradeSettlementSide,
} from "@/game/domain/player-trade-settlement";
import { levelFromXp } from "@/game/domain/progression";
import type {
  EndedTradeView,
  IncomingTradeRequestView,
  TradeCommandResult,
  TradeExchangeLines,
  TradeOfferView,
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
import { applyCarriedStackDiff } from "@/server/carried-inventory";
import { OwnershipError } from "@/server/ownership";
import { blockBetween } from "@/server/player-blocks";
import { findTradeAudit, insertTradeAudit } from "@/server/player-trade-audit";
import { loadPlaySnapshot } from "@/server/play-state";
import { publishRealtimeEvent } from "@/server/realtime";
import { resolveCharacterTarget } from "@/server/social-targets";

/**
 * Same-location player trade requests and exclusive sessions (issue #266),
 * and each accepted session's offers, consent, and settlement (#267).
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
 * - Offer commands (#267) lock both participants' rows in id order, then the
 *   session row, which serializes every edit, Ready, Change Offer, Confirm,
 *   and Cancel on one session. The second Confirm settles inside that same
 *   transaction; see "Offers, consent, and settlement" below.
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

/** Spent request rows one creation deletes at most. */
const TRADE_REQUEST_PRUNE_BATCH = 100;

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

/**
 * Trade commands lock character rows `FOR NO KEY UPDATE`: it still conflicts
 * with the gameplay boundary's `FOR UPDATE` and with other trade commands, so
 * the gate stays serialized with acceptance, but it does not block the
 * foreign-key `KEY SHARE` checks another trade's inserts take on the same
 * rows, which would otherwise deadlock crossed requests.
 */
async function lockCharacter(tx: Tx, characterId: string): Promise<Character | undefined> {
  const [row] = await tx
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .for("no key update");
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
      .for("no key update");
    if (!requester) throw new OwnershipError("Character not found", 404);
    await lockAccountTradeRequests(tx, accountId);

    await settleExpiredClaims(tx, [requester.id], now, events);
    await settleOutgoingRequest(tx, requester.id, now, events);

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

    // The ledger only needs the rolling window; anything older is spent. An
    // accepted request stays: it is the durable link to its session. A
    // bounded batch that skips locked rows, so concurrent creations never
    // wait on — or deadlock with — each other.
    const spent = tx
      .select({ id: playerTradeRequests.id })
      .from(playerTradeRequests)
      .where(
        and(
          lte(playerTradeRequests.createdAt, windowStart),
          inArray(playerTradeRequests.status, ["canceled", "declined", "expired", "invalidated"]),
        ),
      )
      .limit(TRADE_REQUEST_PRUNE_BATCH)
      .for("update", { skipLocked: true });
    await tx.delete(playerTradeRequests).where(inArray(playerTradeRequests.id, spent));

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

/**
 * Whether another participant's account may still play: a requester's
 * suspension voids its request, and a counterpart's voids a settlement.
 */
async function accountMayPlay(tx: Tx, playerAccountId: string): Promise<boolean> {
  const [owner] = await tx
    .select({ userId: playerAccounts.userId })
    .from(playerAccounts)
    .where(eq(playerAccounts.id, playerAccountId));
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

    // Every request row this acceptance may write — this one, the
    // recipient's own outgoing request, and any other pending request either
    // participant is part of — locked in one statement in id order, so
    // acceptances of disjoint pairs that share requests cannot deadlock.
    const participants = [requester.id, recipient.id];
    const requestRows = await tx
      .select()
      .from(playerTradeRequests)
      .where(
        or(
          eq(playerTradeRequests.id, requestId),
          and(
            eq(playerTradeRequests.status, "pending"),
            or(
              inArray(playerTradeRequests.requesterCharacterId, participants),
              inArray(playerTradeRequests.recipientCharacterId, participants),
            ),
          ),
        ),
      )
      .orderBy(asc(playerTradeRequests.id))
      .for("update");
    const request = requestRows.find((row) => row.id === requestId);
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
      !(await accountMayPlay(tx, request.requesterPlayerAccountId))
    ) {
      return invalidate("invalidated");
    }
    const block = await blockBetween(accountId, request.requesterPlayerAccountId, tx);
    if (block.iBlockedThem || block.theyBlockedMe) return invalidate("invalidated");

    const pendingOthers = requestRows.filter(
      (row) => row.id !== request.id && row.status === "pending",
    );
    // The recipient's own outgoing request is released first.
    for (const outgoing of pendingOthers.filter(
      (row) => row.requesterCharacterId === recipient.id,
    )) {
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
    for (const other of pendingOthers.filter((row) => row.requesterCharacterId !== recipient.id)) {
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
 * characters are released. Idempotent: a session that already ended — a
 * committed trade included — stays as it ended, so a Cancel that loses the
 * race to the final Confirm is inert.
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

// --- Offers, consent, and settlement (#267) --------------------------------
//
// An accepted session's two offers are offer state, never escrow: nothing
// leaves either character until the second Confirm settles. Every offer
// command runs through `runOfferCommand`, which proves the acting character is
// a participant, locks both characters and then the session row, writes down
// an inactivity expiry it finds, and applies the command only to the exact
// current `offer_version`. A refused command writes nothing. A valid edit
// advances the version and clears both participants' Ready and Confirm; Ready
// and Confirm never change the version. The final Confirm re-proves the whole
// trade against both characters' rows, held under lock, and either commits
// every transfer and the audit row together or moves nothing and returns the
// session to compose on a new version.

const OFFER_COPY = {
  stale: "That trade changed. Check the latest offers and try again.",
  frozen: "You're both Ready, so the offers are locked. Choose Change Offer to edit them.",
  notReady: "You both need to be Ready on these offers before confirming.",
  empty: "Add something to the trade first. Either of you can offer Credits or items.",
  credits: "You can offer whole Credits, up to what you have.",
  stackItem: "You can only offer stackable items you're carrying.",
  stackQuantity: "You can offer a whole quantity, up to what you're carrying.",
  stackRemove: "Your offer doesn't have that many of that item.",
  uniqueItem:
    "You can only offer an item in your carried Inventory. Unequip it or take it out of the Cargo Hold first.",
  uniqueAlready: "That item is already in your offer.",
  uniqueRemove: "That item isn't in your offer.",
} as const;

type OfferContext = {
  tx: Tx;
  now: Date;
  events: TradeEvents;
  character: Character;
  counterpart: Character;
  session: PlayerTradeSession;
  side: TradeSide;
};

function sideOf(session: PlayerTradeSession, characterId: string): TradeSide {
  return session.requesterCharacterId === characterId ? "requester" : "recipient";
}

function consentOf(session: PlayerTradeSession): TradeConsent {
  return {
    requesterReady: session.requesterReady,
    recipientReady: session.recipientReady,
    requesterConfirmed: session.requesterConfirmed,
    recipientConfirmed: session.recipientConfirmed,
  };
}

const READY_COLUMN = { requester: "requesterReady", recipient: "recipientReady" } as const;
const CONFIRMED_COLUMN = {
  requester: "requesterConfirmed",
  recipient: "recipientConfirmed",
} as const;
const CREDITS_COLUMN = { requester: "requesterCredits", recipient: "recipientCredits" } as const;

async function okOffer(context: OfferContext): Promise<TradeCommandResult> {
  return { status: "ok", state: await readTradeState(context.tx, context.character, context.now) };
}

/**
 * The refreshed activity instant. A command whose clock was read before it
 * waited on the locks never moves the deadline backwards.
 */
function activityAt(context: OfferContext): Date {
  return new Date(Math.max(context.session.lastActivityAt.getTime(), context.now.getTime()));
}

/** Record one participant's consent without touching the offers or their version. */
async function recordConsent(
  context: OfferContext,
  column: (typeof READY_COLUMN)[TradeSide] | (typeof CONFIRMED_COLUMN)[TradeSide],
): Promise<TradeCommandResult> {
  await context.tx
    .update(playerTradeSessions)
    .set({ [column]: true, lastActivityAt: activityAt(context) })
    .where(eq(playerTradeSessions.id, context.session.id));
  context.events.session(context.session, "updated");
  return okOffer(context);
}

/**
 * Advance the offer version and clear all consent: the one write every offer
 * change, Change Offer, and failed settlement share, so no consent can survive
 * onto offers it was not given for.
 */
async function advanceOffer(
  context: OfferContext,
  credits?: { side: TradeSide; credits: number },
  refusal?: SettlementRefusal,
): Promise<void> {
  await context.tx
    .update(playerTradeSessions)
    .set({
      ...(credits ? { [CREDITS_COLUMN[credits.side]]: credits.credits } : {}),
      offerVersion: context.session.offerVersion + 1,
      ...NO_TRADE_CONSENT,
      // Only a refused settlement leaves a reason; every other change clears it.
      settlementRefusal: refusal?.reason ?? null,
      settlementRefusalSide: refusal?.side ?? null,
      lastActivityAt: activityAt(context),
    })
    .where(eq(playerTradeSessions.id, context.session.id));
  context.events.session(context.session, "updated");
}

async function runOfferCommand(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  now: Date,
  command: (context: OfferContext) => Promise<TradeCommandResult>,
  options: { answersCompleted?: boolean } = {},
): Promise<TradeCommandResult> {
  const events = new TradeEvents();
  const result = await db.transaction(async (tx): Promise<TradeCommandResult> => {
    const accountId = await requireGameplayAccess(tx, userId);
    // Unlocked peek, only to learn whose rows to lock. Participants never
    // change, and the account must match the side the character is on, so a
    // nonparticipant or a wrong-account character learns nothing here.
    const [peek] = await tx
      .select({
        requesterCharacterId: playerTradeSessions.requesterCharacterId,
        recipientCharacterId: playerTradeSessions.recipientCharacterId,
      })
      .from(playerTradeSessions)
      .where(
        and(
          eq(playerTradeSessions.id, sessionId),
          or(
            and(
              eq(playerTradeSessions.requesterCharacterId, characterId),
              eq(playerTradeSessions.requesterPlayerAccountId, accountId),
            ),
            and(
              eq(playerTradeSessions.recipientCharacterId, characterId),
              eq(playerTradeSessions.recipientPlayerAccountId, accountId),
            ),
          ),
        ),
      );
    if (!peek) {
      await ownedCharacter(tx, characterId, accountId);
      return refused("unavailable", REFUSAL_COPY.sessionUnavailable);
    }

    const locked = new Map<string, Character>();
    for (const id of [peek.requesterCharacterId, peek.recipientCharacterId].sort()) {
      const row = await lockCharacter(tx, id);
      if (row) locked.set(id, row);
    }
    const character = locked.get(characterId);
    if (!character || character.playerAccountId !== accountId) {
      throw new OwnershipError("Character not found", 404);
    }
    const counterpart = locked.get(
      characterId === peek.requesterCharacterId
        ? peek.recipientCharacterId
        : peek.requesterCharacterId,
    );
    const [session] = await tx
      .select()
      .from(playerTradeSessions)
      .where(eq(playerTradeSessions.id, sessionId))
      .for("update");
    if (!session || !counterpart) return refused("unavailable", REFUSAL_COPY.sessionUnavailable);

    if (session.status === "completed" && options.answersCompleted) {
      // A repeated or lost-response Confirm: the trade it asked for is done.
      return {
        status: "ok",
        state: await readTradeState(tx, character, now),
        completed: { tradeId: session.id, completedAt: session.endedAt!.toISOString() },
      };
    }
    // Every other command against an ended session is inert.
    if (session.status !== "active") {
      return refused("unavailable", REFUSAL_COPY.sessionUnavailable);
    }
    if (
      effectiveTradeSessionStatus(
        { status: "active", lastActivityAt: session.lastActivityAt },
        now,
      ) === "expired"
    ) {
      await endSession(
        tx,
        session,
        "expired",
        tradeSessionExpiresAt(session.lastActivityAt),
        null,
        events,
      );
      return refused("unavailable", REFUSAL_COPY.sessionUnavailable);
    }
    if (offerVersion !== session.offerVersion) return refused("stale_offer", OFFER_COPY.stale);

    return command({
      tx,
      now,
      events,
      character,
      counterpart,
      session,
      side: sideOf(session, character.id),
    });
  });
  events.publish();
  return result;
}

/** Offer edits apply only while composing; a frozen review needs Change Offer first. */
function refuseUnlessComposing(context: OfferContext): TradeCommandResult | undefined {
  return tradeOfferPhase(consentOf(context.session)) === "review"
    ? refused("offer_frozen", OFFER_COPY.frozen)
    : undefined;
}

async function offeredStackLine(context: OfferContext, itemId: string) {
  const [line] = await context.tx
    .select()
    .from(playerTradeOfferStacks)
    .where(
      and(
        eq(playerTradeOfferStacks.sessionId, context.session.id),
        eq(playerTradeOfferStacks.characterId, context.character.id),
        eq(playerTradeOfferStacks.itemId, itemId),
      ),
    );
  return line;
}

function stackLineWhere(context: OfferContext, itemId: string) {
  return and(
    eq(playerTradeOfferStacks.sessionId, context.session.id),
    eq(playerTradeOfferStacks.characterId, context.character.id),
    eq(playerTradeOfferStacks.itemId, itemId),
  );
}

/** Set the acting character's own Credit offer, up to its current balance. */
export async function setTradeOfferCredits(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  credits: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    // Setting the amount already offered is no edit at all: the version,
    // both participants' consent, and the activity clock stay as they are.
    if (credits === context.session[CREDITS_COLUMN[context.side]]) return okOffer(context);
    const frozen = refuseUnlessComposing(context);
    if (frozen) return frozen;
    if (!isValidCreditOffer(credits, context.character.credits)) {
      return refused("invalid_offer", OFFER_COPY.credits);
    }
    await advanceOffer(context, { side: context.side, credits });
    return okOffer(context);
  });
}

/** Add a quantity of one carried stack item to the acting character's own offer. */
export async function addTradeOfferStack(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  itemId: string,
  quantity: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    const frozen = refuseUnlessComposing(context);
    if (frozen) return frozen;
    if (getItemDefinition(itemId)?.kind !== "stack") {
      return refused("invalid_offer", OFFER_COPY.stackItem);
    }
    if (!isValidStackQuantity(quantity)) {
      return refused("invalid_offer", OFFER_COPY.stackQuantity);
    }
    const [carried] = await context.tx
      .select({ quantity: sql<number>`coalesce(sum(${inventoryStacks.quantity}), 0)::int` })
      .from(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, context.character.id),
          eq(inventoryStacks.itemId, itemId),
        ),
      );
    const line = await offeredStackLine(context, itemId);
    const offered = (line?.quantity ?? 0) + quantity;
    if (offered > (carried?.quantity ?? 0)) {
      return refused("invalid_offer", OFFER_COPY.stackQuantity);
    }
    if (line) {
      await context.tx
        .update(playerTradeOfferStacks)
        .set({ quantity: offered })
        .where(stackLineWhere(context, itemId));
    } else {
      await context.tx.insert(playerTradeOfferStacks).values({
        sessionId: context.session.id,
        characterId: context.character.id,
        itemId,
        quantity: offered,
      });
    }
    await advanceOffer(context);
    return okOffer(context);
  });
}

/** Take a quantity of one stack item back out of the acting character's own offer. */
export async function removeTradeOfferStack(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  itemId: string,
  quantity: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    const frozen = refuseUnlessComposing(context);
    if (frozen) return frozen;
    if (!isValidStackQuantity(quantity)) {
      return refused("invalid_offer", OFFER_COPY.stackQuantity);
    }
    const line = await offeredStackLine(context, itemId);
    if (!line || quantity > line.quantity) {
      return refused("invalid_offer", OFFER_COPY.stackRemove);
    }
    if (quantity === line.quantity) {
      await context.tx.delete(playerTradeOfferStacks).where(stackLineWhere(context, itemId));
    } else {
      await context.tx
        .update(playerTradeOfferStacks)
        .set({ quantity: line.quantity - quantity })
        .where(stackLineWhere(context, itemId));
    }
    await advanceOffer(context);
    return okOffer(context);
  });
}

/**
 * Add one of the acting character's unique item instances to its own offer.
 * Only an instance it owns, carries, and has not equipped or stored in the
 * Cargo Hold; the id is a request, never proof.
 */
export async function addTradeOfferItem(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    const frozen = refuseUnlessComposing(context);
    if (frozen) return frozen;
    const { tx } = context;
    const owned = and(
      eq(itemInstances.characterId, context.character.id),
      eq(itemInstances.id, itemInstanceId),
    );
    const [[instance], [equipped], [stored], [offered]] = await Promise.all([
      tx.select().from(itemInstances).where(owned),
      tx
        .select({ id: equippedItems.itemInstanceId })
        .from(equippedItems)
        .where(
          and(
            eq(equippedItems.characterId, context.character.id),
            eq(equippedItems.itemInstanceId, itemInstanceId),
          ),
        ),
      tx
        .select({ id: cargoHoldItemInstances.itemInstanceId })
        .from(cargoHoldItemInstances)
        .where(
          and(
            eq(cargoHoldItemInstances.characterId, context.character.id),
            eq(cargoHoldItemInstances.itemInstanceId, itemInstanceId),
          ),
        ),
      tx
        .select({ id: playerTradeOfferItems.itemInstanceId })
        .from(playerTradeOfferItems)
        .where(
          and(
            eq(playerTradeOfferItems.sessionId, context.session.id),
            eq(playerTradeOfferItems.itemInstanceId, itemInstanceId),
          ),
        ),
    ]);
    if (!instance || equipped || stored || getItemDefinition(instance.itemId)?.kind !== "unique") {
      return refused("invalid_offer", OFFER_COPY.uniqueItem);
    }
    if (offered) return refused("invalid_offer", OFFER_COPY.uniqueAlready);
    await tx.insert(playerTradeOfferItems).values({
      sessionId: context.session.id,
      characterId: context.character.id,
      itemInstanceId,
    });
    await advanceOffer(context);
    return okOffer(context);
  });
}

/** Take one unique item instance back out of the acting character's own offer. */
export async function removeTradeOfferItem(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    const frozen = refuseUnlessComposing(context);
    if (frozen) return frozen;
    const removed = await context.tx
      .delete(playerTradeOfferItems)
      .where(
        and(
          eq(playerTradeOfferItems.sessionId, context.session.id),
          eq(playerTradeOfferItems.characterId, context.character.id),
          eq(playerTradeOfferItems.itemInstanceId, itemInstanceId),
        ),
      )
      .returning({ id: playerTradeOfferItems.itemInstanceId });
    if (removed.length === 0) return refused("invalid_offer", OFFER_COPY.uniqueRemove);
    await advanceOffer(context);
    return okOffer(context);
  });
}

/**
 * The acting participant is Ready on the current offers. When both are, the
 * offers freeze into the review both saw. Repeating it changes nothing.
 */
export async function readyTradeOffer(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    if (sideReady(consentOf(context.session), context.side)) return okOffer(context);
    // Nothing either way is not a trade. Every edit clears Ready, so a review
    // can never be frozen on two empty offers; settlement re-checks anyway.
    const offers = await loadOfferContent(context.tx, context.session);
    if (isEmptyTradeOffer(offers.requester) && isEmptyTradeOffer(offers.recipient)) {
      return refused("empty_trade", OFFER_COPY.empty);
    }
    return recordConsent(context, READY_COLUMN[context.side]);
  });
}

/**
 * Change Offer: leave Ready or the frozen review and return to composing. It
 * advances the version and clears both participants' Ready and Confirm, so
 * any consent given before it is spent. With no consent to clear, nothing
 * changes.
 */
export async function changeTradeOffer(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(userId, characterId, sessionId, offerVersion, now, async (context) => {
    if (!hasTradeConsent(consentOf(context.session))) return okOffer(context);
    await advanceOffer(context);
    return okOffer(context);
  });
}

/**
 * Confirm the frozen review. The first Confirm moves nothing and waits; the
 * second settles the trade in this transaction. A repeated Confirm — a double
 * click, a retry, a lost response — either changes nothing or answers with the
 * trade that already completed; it can never settle twice, because settlement
 * marks the session `completed` under the same session-row lock it checked.
 */
export async function confirmTrade(
  userId: string,
  characterId: string,
  sessionId: string,
  offerVersion: number,
  now: Date = new Date(),
): Promise<TradeCommandResult> {
  return runOfferCommand(
    userId,
    characterId,
    sessionId,
    offerVersion,
    now,
    async (context) => {
      const consent = consentOf(context.session);
      if (tradeOfferPhase(consent) !== "review") return refused("not_ready", OFFER_COPY.notReady);
      if (sideConfirmed(consent, context.side)) return okOffer(context);
      if (!sideConfirmed(consent, otherTradeSide(context.side))) {
        return recordConsent(context, CONFIRMED_COLUMN[context.side]);
      }
      return settleTrade(context);
    },
    { answersCompleted: true },
  );
}

/** Both offers exactly as stored for this session. */
async function loadOfferContent(
  reader: Reader,
  session: PlayerTradeSession,
): Promise<Record<TradeSide, TradeOfferContent>> {
  const [stacks, items] = await Promise.all([
    reader
      .select()
      .from(playerTradeOfferStacks)
      .where(eq(playerTradeOfferStacks.sessionId, session.id))
      .orderBy(asc(playerTradeOfferStacks.itemId)),
    reader
      .select()
      .from(playerTradeOfferItems)
      .where(eq(playerTradeOfferItems.sessionId, session.id))
      .orderBy(asc(playerTradeOfferItems.itemInstanceId)),
  ]);
  const offer = (side: TradeSide, characterId: string, credits: number): TradeOfferContent => ({
    credits,
    stacks: stacks
      .filter((line) => line.characterId === characterId)
      .map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    itemInstanceIds: items
      .filter((line) => line.characterId === characterId)
      .map((line) => line.itemInstanceId),
  });
  return {
    requester: offer("requester", session.requesterCharacterId, session.requesterCredits),
    recipient: offer("recipient", session.recipientCharacterId, session.recipientCredits),
  };
}

/** Both offers with each unique instance's current facts, for the participants. */
async function readOfferViews(
  reader: Reader,
  session: PlayerTradeSession,
): Promise<Record<TradeSide, TradeOfferView>> {
  const content = await loadOfferContent(reader, session);
  const instanceIds = [...content.requester.itemInstanceIds, ...content.recipient.itemInstanceIds];
  const instances = instanceIds.length
    ? await reader
        .select({
          id: itemInstances.id,
          characterId: itemInstances.characterId,
          itemId: itemInstances.itemId,
          currentCharge: itemInstances.currentCharge,
        })
        .from(itemInstances)
        .where(inArray(itemInstances.id, instanceIds))
    : [];
  const consent = consentOf(session);
  const view = (side: TradeSide, characterId: string): TradeOfferView => ({
    credits: content[side].credits,
    stacks: [...content[side].stacks],
    // An instance that is somehow no longer its offerer's is not shown as
    // offered; settlement would refuse it anyway.
    items: content[side].itemInstanceIds.flatMap((id) => {
      const instance = instances.find(
        (candidate) => candidate.id === id && candidate.characterId === characterId,
      );
      return instance
        ? [{ itemInstanceId: id, itemId: instance.itemId, currentCharge: instance.currentCharge }]
        : [];
    }),
    ready: sideReady(consent, side),
    confirmed: sideConfirmed(consent, side),
  });
  return {
    requester: view("requester", session.requesterCharacterId),
    recipient: view("recipient", session.recipientCharacterId),
  };
}

const SETTLEMENT_REFUSALS: Record<
  TradeSettlementFailure,
  { reason: SettlementRefusalReason; yours: string; theirs: (name: string) => string }
> = {
  credits: {
    reason: "credit_limit",
    yours: "This trade would leave you with more Credits than a character can hold.",
    theirs: (name) => `This trade would leave ${name} with more Credits than a character can hold.`,
  },
  offer_unavailable: {
    reason: "offer_unavailable",
    yours: "Something in your offer is no longer yours to give as offered.",
    theirs: (name) => `Something in ${name}'s offer is no longer theirs to give as offered.`,
  },
  slots: {
    reason: "inventory_full",
    yours: "Your Inventory wouldn't have room for this trade.",
    theirs: (name) => `${name}'s Inventory wouldn't have room for this trade.`,
  },
  mass: {
    reason: "too_heavy",
    yours: "This trade would leave you carrying too much.",
    theirs: (name) => `This trade would leave ${name} carrying too much.`,
  },
  last_cutter: {
    reason: "last_cutter",
    yours: "This trade would leave you without a usable Mining Cutter.",
    theirs: (name) => `This trade would leave ${name} without a usable Mining Cutter.`,
  },
};

const NOTHING_MOVED = "Nothing moved. Adjust the offers and Ready again.";

/** The settlement refusals the session records, and whose side each was. */
type SettlementRefusalReason = Extract<
  TradeRefusalReason,
  | "offer_unavailable"
  | "inventory_full"
  | "too_heavy"
  | "last_cutter"
  | "credit_limit"
  | "ineligible"
  | "empty_trade"
>;
type SettlementRefusal = { reason: SettlementRefusalReason; side: TradeSide | null };

const INELIGIBLE_COPY = "You both need to still be here and free to trade.";

/**
 * A recorded settlement refusal in one participant's words (#268): the same
 * copy the refused Confirm returned, from that participant's side, so the
 * first confirmer learns what to correct as well as the second.
 */
function settlementRefusalMessage(
  session: PlayerTradeSession,
  viewerSide: TradeSide,
  counterpartName: string,
): { reason: SettlementRefusalReason; message: string } | undefined {
  const reason = session.settlementRefusal as SettlementRefusalReason | null;
  if (!reason) return undefined;
  let text: string;
  if (reason === "ineligible") text = INELIGIBLE_COPY;
  else if (reason === "empty_trade") text = OFFER_COPY.empty;
  else {
    const copy = Object.values(SETTLEMENT_REFUSALS).find((entry) => entry.reason === reason)!;
    text = session.settlementRefusalSide === viewerSide ? copy.yours : copy.theirs(counterpartName);
  }
  return { reason, message: `${text} ${NOTHING_MOVED}` };
}

/**
 * A final Confirm that cannot settle: nothing moves, consent is cleared, and
 * the session returns to compose on a new version, so the players can correct
 * the offers and no earlier Ready or Confirm can apply to them. The reason is
 * recorded on the session for both participants until the next offer change.
 */
async function refuseSettlement(
  context: OfferContext,
  refusal: SettlementRefusal,
  error: string,
): Promise<TradeCommandResult> {
  await advanceOffer(context, undefined, refusal);
  return refused(refusal.reason, `${error} ${NOTHING_MOVED}`);
}

function settlementSide(
  character: Character,
  snapshot: Awaited<ReturnType<typeof loadPlaySnapshot>>,
): TradeSettlementSide {
  const balance = getEffectiveGameBalance();
  const miningXp = snapshot.xpRows.find((xp) => xp.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const carried = new Set(snapshot.carriedInstances.map((instance) => instance.id));
  return {
    characterId: character.id,
    credits: character.credits,
    miningLevel: levelFromXp(miningXp, standardSkillLevelThresholds(balance)),
    stacks: snapshot.stacks,
    instances: snapshot.allItemInstances,
    assignments: snapshot.equipmentLoadout.assignments,
    cargoInstanceIds: new Set(
      snapshot.allItemInstances
        .filter((instance) => !carried.has(instance.id))
        .map((instance) => instance.id),
    ),
  };
}

/**
 * The final Confirm's commit. Runs under both characters' row locks and the
 * session row lock, re-proves the whole trade against current authoritative
 * state, and then — all in this one transaction — moves the Credits, the
 * stacks, and each unique instance (same id, same mutable state), marks the
 * session `completed`, releases both claims, and writes the one audit row.
 * Any failure before the writes moves nothing; any failure during them,
 * the audit insert included, rolls every write back.
 */
async function settleTrade(context: OfferContext): Promise<TradeCommandResult> {
  const { tx, session, now } = context;
  const participants: Record<TradeSide, Character> =
    context.side === "requester"
      ? { requester: context.character, recipient: context.counterpart }
      : { requester: context.counterpart, recipient: context.character };
  const { requester, recipient } = participants;

  const blocked =
    requester.playerAccountId !== recipient.playerAccountId &&
    Object.values(
      await blockBetween(requester.playerAccountId, recipient.playerAccountId, tx),
    ).some(Boolean);
  if (
    requester.currentLocationId !== session.locationId ||
    recipient.currentLocationId !== session.locationId ||
    (await isBusy(tx, requester.id)) ||
    (await isBusy(tx, recipient.id)) ||
    !(await accountMayPlay(tx, context.counterpart.playerAccountId)) ||
    blocked
  ) {
    return refuseSettlement(context, { reason: "ineligible", side: null }, INELIGIBLE_COPY);
  }

  // Inventory rows lock in character-id order, after both character rows.
  const snapshots = new Map<string, Awaited<ReturnType<typeof loadPlaySnapshot>>>();
  for (const id of [requester.id, recipient.id].sort()) {
    snapshots.set(id, await loadPlaySnapshot(tx, id));
  }
  const plan = planTradeSettlement(
    {
      requester: settlementSide(requester, snapshots.get(requester.id)!),
      recipient: settlementSide(recipient, snapshots.get(recipient.id)!),
    },
    await loadOfferContent(tx, session),
    getEffectiveGameBalance(),
  );
  if (!plan.ok && plan.reason === "empty") {
    return refuseSettlement(context, { reason: "empty_trade", side: null }, OFFER_COPY.empty);
  }
  if (!plan.ok) {
    const copy = SETTLEMENT_REFUSALS[plan.reason];
    return refuseSettlement(
      context,
      { reason: copy.reason, side: plan.side },
      plan.side === context.side ? copy.yours : copy.theirs(context.counterpart.displayName),
    );
  }

  for (const side of ["requester", "recipient"] as const) {
    const settlement = plan.sides[side];
    await tx
      .update(characters)
      .set({ credits: settlement.creditsAfter })
      .where(eq(characters.id, settlement.characterId));
    await applyCarriedStackDiff(tx, {
      characterId: settlement.characterId,
      diff: settlement.stacks,
      now,
    });
  }
  for (const side of ["requester", "recipient"] as const) {
    const giver = participants[side];
    const receiver = participants[otherTradeSide(side)];
    const ids = plan.offers[side].items.map((item) => item.itemInstanceId);
    if (ids.length === 0) continue;
    // Only the owner changes: the row, its id, and its charge travel intact.
    const moved = await tx
      .update(itemInstances)
      .set({ characterId: receiver.id, updatedAt: now })
      .where(and(eq(itemInstances.characterId, giver.id), inArray(itemInstances.id, ids)))
      .returning({ id: itemInstances.id });
    if (moved.length !== ids.length) {
      throw new Error("A traded item instance changed hands outside the settlement lock");
    }
  }

  await tx
    .update(playerTradeSessions)
    .set({
      status: "completed",
      endedAt: now,
      endedByCharacterId: null,
      requesterConfirmed: true,
      recipientConfirmed: true,
      settlementRefusal: null,
      settlementRefusalSide: null,
      lastActivityAt: now,
    })
    .where(eq(playerTradeSessions.id, session.id));
  await tx.delete(playerTradeClaims).where(eq(playerTradeClaims.sessionId, session.id));
  await insertTradeAudit(tx, {
    tradeId: session.id,
    committedAt: now,
    locationId: session.locationId,
    requester: {
      playerAccountId: session.requesterPlayerAccountId,
      characterId: requester.id,
      offer: plan.offers.requester,
    },
    recipient: {
      playerAccountId: session.recipientPlayerAccountId,
      characterId: recipient.id,
      offer: plan.offers.recipient,
    },
  });
  context.events.session(session, "completed");

  const [character] = await tx
    .select()
    .from(characters)
    .where(eq(characters.id, context.character.id));
  return {
    status: "ok",
    state: await readTradeState(tx, character!, now),
    completed: { tradeId: session.id, completedAt: now.toISOString() },
  };
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
    counterpart: { characterId: counterpart.id, name: counterpart.displayName, playerName: null },
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
    const side = sideOf(claim.session, character.id);
    const offers = await readOfferViews(reader, claim.session);
    session = {
      id: claim.session.id,
      counterpart: {
        characterId: counterpartId,
        name: counterpart?.displayName ?? "",
        playerName: null,
      },
      startedAt: claim.session.createdAt.toISOString(),
      expiresAt: tradeSessionExpiresAt(claim.session.lastActivityAt).toISOString(),
      offerVersion: claim.session.offerVersion,
      phase: tradeOfferPhase(consentOf(claim.session)),
      yours: offers[side],
      theirs: offers[otherTradeSide(side)],
    };
    const refusal = settlementRefusalMessage(claim.session, side, counterpart?.displayName ?? "");
    if (refusal) session.settlementRefusal = refusal;
  }

  const state: TradeStateView = {
    outgoing: outgoingRow ? requestView(outgoingRow.request, outgoingRow.recipient) : null,
    incoming,
    session,
    ended: session ? null : await readEndedTrade(reader, character, now),
  };
  await attachPlayerNames(reader, state);
  return state;
}

/**
 * Fill in every counterpart's public Player name (#268) in one read: the name
 * Nearby Players and the profile already show for that character.
 */
async function attachPlayerNames(reader: Reader, state: TradeStateView) {
  const counterparts = [
    state.outgoing?.counterpart,
    ...state.incoming.map((request) => request.counterpart),
    state.session?.counterpart,
    state.ended?.counterpart,
  ].filter((counterpart) => counterpart !== undefined);
  if (counterparts.length === 0) return;
  const rows = await reader
    .select({ id: characters.id, playerName: user.displayUsername })
    .from(characters)
    .innerJoin(playerAccounts, eq(playerAccounts.id, characters.playerAccountId))
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .where(
      inArray(
        characters.id,
        counterparts.map((counterpart) => counterpart.characterId),
      ),
    );
  const names = new Map(rows.map((row) => [row.id, row.playerName]));
  for (const counterpart of counterparts) {
    counterpart.playerName = names.get(counterpart.characterId) ?? null;
  }
}

/**
 * The character's most recent session, if it has ended (#268): how it ended,
 * and for a completed trade exactly what moved, from the trade's audit row —
 * the committed snapshot. A stored `active` session past its inactivity
 * expiry reads as expired, the same derivation every other check uses.
 */
async function readEndedTrade(
  reader: Reader,
  character: Character,
  now: Date,
): Promise<EndedTradeView | null> {
  const [latest] = await reader
    .select()
    .from(playerTradeSessions)
    .where(
      or(
        eq(playerTradeSessions.requesterCharacterId, character.id),
        eq(playerTradeSessions.recipientCharacterId, character.id),
      ),
    )
    .orderBy(desc(playerTradeSessions.createdAt), desc(playerTradeSessions.id))
    .limit(1);
  if (!latest) return null;
  const status = effectiveTradeSessionStatus(
    { status: latest.status as TradeSessionStatus, lastActivityAt: latest.lastActivityAt },
    now,
  );
  if (status === "active") return null;
  const side = sideOf(latest, character.id);
  const counterpartId =
    side === "requester" ? latest.recipientCharacterId : latest.requesterCharacterId;
  const [counterpart] = await reader
    .select({ id: characters.id, displayName: characters.displayName })
    .from(characters)
    .where(eq(characters.id, counterpartId));
  const endedAt =
    latest.status === "active"
      ? tradeSessionExpiresAt(latest.lastActivityAt)
      : (latest.endedAt ?? latest.lastActivityAt);
  let exchange: EndedTradeView["exchange"];
  const audit = status === "completed" ? await findTradeAudit(latest.id, reader) : undefined;
  if (audit) {
    const [mine, theirs] =
      side === "requester"
        ? [audit.requester, audit.recipient]
        : [audit.recipient, audit.requester];
    const ids = [...mine.offer.items, ...theirs.offer.items].map((item) => item.itemInstanceId);
    const held = ids.length
      ? await reader
          .select({
            id: itemInstances.id,
            characterId: itemInstances.characterId,
            currentCharge: itemInstances.currentCharge,
          })
          .from(itemInstances)
          .where(inArray(itemInstances.id, ids))
      : [];
    // An item's state is shown only while the character that received it in
    // this trade still holds it: never the state of something since passed on.
    const lines = (offer: SettledTradeOffer, receiverId: string): TradeExchangeLines => ({
      credits: offer.credits,
      stacks: offer.stacks.map((stack) => ({ ...stack })),
      items: offer.items.map((item) => {
        const holding = held.find(
          (row) => row.id === item.itemInstanceId && row.characterId === receiverId,
        );
        return holding ? { ...item, currentCharge: holding.currentCharge } : { ...item };
      }),
    });
    exchange = {
      gave: lines(mine.offer, counterpartId),
      received: lines(theirs.offer, character.id),
    };
  }
  return {
    id: latest.id,
    counterpart: {
      characterId: counterpartId,
      name: counterpart?.displayName ?? "",
      playerName: null,
    },
    outcome: status,
    endedAt: endedAt.toISOString(),
    canceledByYou: status === "canceled" && latest.endedByCharacterId === character.id,
    ...(exchange ? { exchange } : {}),
  };
}
