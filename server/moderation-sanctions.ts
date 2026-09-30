import { and, eq, isNull } from "drizzle-orm";
import { moderationSanctions, type ModerationSanction } from "@/db/rune-space";
import {
  hasSanctionInEffect,
  type SanctionFacts,
  type SanctionKind,
} from "@/game/domain/moderation";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { getRealtimeFanout, publishRealtimeEvent } from "@/server/realtime";

/**
 * Sanction enforcement seams (issue #248). Sanctions are account-wide: they
 * are stored against the player account, so every character of the account
 * is covered and switching characters never evades one.
 *
 * - An account suspension is enforced by the gameplay-access rule
 *   (`server/gameplay-access.ts` loads it; `decideGameplayAccess` refuses it),
 *   so every gameplay command, read, and realtime stream refuses it.
 * - A social restriction is enforced here, at the two outbound-contact seams:
 *   `beginChatSend` (General, Trade, promoted Trade ads, and Whispers all
 *   start there) and `requireTradeRequestInitiationAllowed`, the seam #225's
 *   trade-request command calls before creating a request. Reading public
 *   chat, reporting, blocking, and accepting a trade someone else offers stay
 *   available.
 *
 * Whether a sanction is in effect is derived from the stored facts and the
 * request's clock on every check (`sanctionState`), never cached, so expiry
 * and reversal apply on the very next request.
 */

type Executor = Pick<DatabaseTransaction, "select">;

export const SOCIALLY_RESTRICTED_MESSAGE =
  "Your account has a social restriction, so you can't send messages right now. Your moderation notice has the details and how to appeal.";

const TRADE_RESTRICTED_MESSAGE =
  "Your account has a social restriction, so you can't start trades right now. Your moderation notice has the details and how to appeal.";

function toFacts(row: ModerationSanction): SanctionFacts {
  return {
    kind: row.kind as SanctionKind,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reversedAt: row.reversedAt,
  };
}

/** The account's unreversed sanctions of one kind. */
async function unreversedSanctions(
  executor: Executor,
  playerAccountId: string,
  kind: Exclude<SanctionKind, "warning">,
): Promise<ModerationSanction[]> {
  return executor
    .select()
    .from(moderationSanctions)
    .where(
      and(
        eq(moderationSanctions.playerAccountId, playerAccountId),
        eq(moderationSanctions.kind, kind),
        isNull(moderationSanctions.reversedAt),
      ),
    );
}

/** Whether a social restriction is in effect for the account at `now`. */
export async function isSociallyRestricted(
  executor: Executor,
  playerAccountId: string,
  now: Date,
): Promise<boolean> {
  const rows = await unreversedSanctions(executor, playerAccountId, "social_restriction");
  return hasSanctionInEffect(rows.map(toFacts), "social_restriction", now);
}

export type TradeRequestInitiationDecision =
  | { allowed: true }
  | { allowed: false; reason: "socially_restricted"; error: string };

/**
 * The trade-request initiation seam for #225. A socially restricted account
 * may not START a trade request; accepting one another player sends is not
 * gated here (a suspension already refuses every gameplay command). #225's
 * request command calls this inside its transaction, alongside the Block seam
 * (`isBlockedBetween`).
 */
export async function requireTradeRequestInitiationAllowed(
  executor: Executor,
  playerAccountId: string,
  now: Date = new Date(),
): Promise<TradeRequestInitiationDecision> {
  if (await isSociallyRestricted(executor, playerAccountId, now)) {
    return { allowed: false, reason: "socially_restricted", error: TRADE_RESTRICTED_MESSAGE };
  }
  return { allowed: true };
}

/**
 * After a sanction change commits: every open tab of the account re-reads its
 * moderation notices, and when gameplay access may have changed, its streams
 * close so each reconnect re-runs authorization (a suspended account's
 * reconnect is refused and the tab returns to Characters).
 */
export function publishSanctionsChanged(playerAccountId: string, gameplayAccessChanged: boolean) {
  publishRealtimeEvent({ kind: "account", playerAccountId }, "moderation.notices", {});
  if (gameplayAccessChanged) {
    getRealtimeFanout().close({ kind: "account", playerAccountId }, "lifetime");
  }
}
