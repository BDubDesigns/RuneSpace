import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db } from "@/db";
import {
  characters,
  playerTradeClaims,
  playerTradeRequests,
  playerTradeSessions,
} from "@/db/rune-space";
import {
  effectiveTradeRequestStatus,
  effectiveTradeSessionStatus,
  tradeSessionExpiresAt,
  type TradeRequestStatus,
  type TradeSessionStatus,
} from "@/game/domain/player-trade";
import { OwnershipError } from "@/server/ownership";

/**
 * The accepted-trade command gate (issue #266).
 *
 * A character is trade-engaged while it holds an effectively pending outgoing
 * request (sending one holds the requester idle) or a claim on an effectively
 * active session. A trade-engaged character may not run ordinary gameplay
 * commands. The one place that asks is the shared owned-character lock
 * boundary (`server/action-resolution.ts`): it checks right after locking the
 * character row, so the check is serialized with acceptance, which holds both
 * participants' rows while it claims them. Every player gameplay command
 * enters that boundary, so the gate is deny-by-default; only reads and
 * presentation-only dismissals opt out, by name, and
 * `tests/unit/player-trade-gate.test.ts` keeps that list exact. The one
 * Credit-spending command outside it, a promoted Trade ad, asks here directly.
 *
 * A character that is no longer engaged has its lapsed request or idle-expired
 * session written down before its command runs (`assertNotTradeEngaged`).
 *
 * An incoming request never engages its recipient. Refusal is an
 * `OwnershipError` (409) so every existing gameplay handler already returns
 * its message, exactly like the gameplay-access refusal.
 */

export type TradeEngagement = "pending_request" | "session";

const ENGAGED_MESSAGES: Record<TradeEngagement, string> = {
  pending_request: "You're waiting on a trade request. Cancel it to do something else.",
  session: "You're in a trade. Finish or cancel it first.",
};

export class TradeEngagedError extends OwnershipError {
  constructor(readonly engagement: TradeEngagement) {
    super(ENGAGED_MESSAGES[engagement], 409);
    this.name = "TradeEngagedError";
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "select">;

const requesterRow = alias(characters, "trade_gate_requester");
const recipientRow = alias(characters, "trade_gate_recipient");

/** Whether, and how, a character is trade-engaged at `now`. */
export async function findTradeEngagement(
  executor: Executor,
  characterId: string,
  now: Date,
): Promise<TradeEngagement | null> {
  return (await inspectTradeEngagement(executor, characterId, now)).engagement;
}

async function inspectTradeEngagement(
  executor: Executor,
  characterId: string,
  now: Date,
): Promise<{
  engagement: TradeEngagement | null;
  /** A stored-pending outgoing request that is effectively over. */
  lapsed?: { id: string; status: TradeRequestStatus; resolvedAt: Date };
  /** A still-claimed session that has passed its inactivity expiry (#267). */
  idleSessionId?: string;
}> {
  const [claim] = await executor
    .select({
      sessionId: playerTradeSessions.id,
      status: playerTradeSessions.status,
      lastActivityAt: playerTradeSessions.lastActivityAt,
    })
    .from(playerTradeClaims)
    .innerJoin(playerTradeSessions, eq(playerTradeSessions.id, playerTradeClaims.sessionId))
    .where(eq(playerTradeClaims.characterId, characterId));
  if (
    claim &&
    effectiveTradeSessionStatus(
      { status: claim.status as TradeSessionStatus, lastActivityAt: claim.lastActivityAt },
      now,
    ) === "active"
  ) {
    return { engagement: "session" };
  }
  // An expired session releases the character; the caller writes it down.
  const idle = claim ? { idleSessionId: claim.sessionId } : {};

  // At most one row: one pending outgoing request per character.
  const [outgoing] = await executor
    .select({
      id: playerTradeRequests.id,
      status: playerTradeRequests.status,
      locationId: playerTradeRequests.locationId,
      expiresAt: playerTradeRequests.expiresAt,
      requesterLocationId: requesterRow.currentLocationId,
      recipientLocationId: recipientRow.currentLocationId,
    })
    .from(playerTradeRequests)
    .innerJoin(requesterRow, eq(requesterRow.id, playerTradeRequests.requesterCharacterId))
    .innerJoin(recipientRow, eq(recipientRow.id, playerTradeRequests.recipientCharacterId))
    .where(
      and(
        eq(playerTradeRequests.requesterCharacterId, characterId),
        eq(playerTradeRequests.status, "pending"),
      ),
    );
  if (!outgoing) return { engagement: null, ...idle };
  const effective = effectiveTradeRequestStatus(
    {
      status: outgoing.status as TradeRequestStatus,
      locationId: outgoing.locationId,
      expiresAt: outgoing.expiresAt,
    },
    outgoing,
    now,
  );
  if (effective === "pending") return { engagement: "pending_request" };
  return {
    engagement: null,
    ...idle,
    lapsed: {
      id: outgoing.id,
      status: effective,
      resolvedAt: effective === "expired" && outgoing.expiresAt < now ? outgoing.expiresAt : now,
    },
  };
}

/**
 * Refuse a trade-engaged character. The caller must already hold the
 * character's row lock, so acceptance cannot claim it between this check and
 * the command's own writes.
 *
 * A released requester's lapsed request is written down here, before its
 * command runs: an invalidation by movement is derived from current
 * locations, so without this a recipient who left and came back inside the
 * 20 seconds would revive a request whose requester had meanwhile started
 * something. Recording it under the requester's lock makes it final. It is
 * written silently; the recipient's reads already treat it as over.
 *
 * An idle-expired session is written down the same way (#267), so the
 * release is final before the released character changes anything: a final
 * Confirm that was already waiting on these locks, with a clock read before
 * the deadline, finds the session `expired` instead of settling against
 * Credits or items this command is about to change. The session row is
 * locked after the character row — the order every trade command uses — and
 * the expiry rechecked under it.
 */
export async function assertNotTradeEngaged(
  tx: Pick<Transaction, "select" | "update" | "delete">,
  characterId: string,
  now: Date,
): Promise<void> {
  const { engagement, lapsed, idleSessionId } = await inspectTradeEngagement(tx, characterId, now);
  if (engagement) throw new TradeEngagedError(engagement);
  if (idleSessionId) {
    const [session] = await tx
      .select()
      .from(playerTradeSessions)
      .where(eq(playerTradeSessions.id, idleSessionId))
      .for("update");
    if (
      session?.status === "active" &&
      effectiveTradeSessionStatus(
        { status: "active", lastActivityAt: session.lastActivityAt },
        now,
      ) === "expired"
    ) {
      await tx
        .update(playerTradeSessions)
        .set({
          status: "expired",
          endedAt: tradeSessionExpiresAt(session.lastActivityAt),
          endedByCharacterId: null,
        })
        .where(eq(playerTradeSessions.id, session.id));
      await tx.delete(playerTradeClaims).where(eq(playerTradeClaims.sessionId, session.id));
    }
  }
  if (lapsed) {
    await tx
      .update(playerTradeRequests)
      .set({ status: lapsed.status, resolvedAt: lapsed.resolvedAt })
      .where(and(eq(playerTradeRequests.id, lapsed.id), eq(playerTradeRequests.status, "pending")));
  }
}
