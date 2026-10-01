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
}> {
  const [claim] = await executor
    .select({
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
  if (!outgoing) return { engagement: null };
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
 */
export async function assertNotTradeEngaged(
  tx: Pick<Transaction, "select" | "update">,
  characterId: string,
  now: Date,
): Promise<void> {
  const { engagement, lapsed } = await inspectTradeEngagement(tx, characterId, now);
  if (engagement) throw new TradeEngagedError(engagement);
  if (lapsed) {
    await tx
      .update(playerTradeRequests)
      .set({ status: lapsed.status, resolvedAt: lapsed.resolvedAt })
      .where(and(eq(playerTradeRequests.id, lapsed.id), eq(playerTradeRequests.status, "pending")));
  }
}
