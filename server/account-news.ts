import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { playerAccounts, type PlayerAccount } from "@/db/rune-space";
import { getLatestPublishedUpdate } from "@/features/public-site/public-updates";
import { isNewsUnread } from "@/game/domain/news";
import { requirePlayerAccount } from "@/server/ownership";

/**
 * Account-level news read-through boundary (issue #156).
 *
 * The account/player boundary (`player_accounts.news_read_through_at`) is the
 * single authoritative read-through value; the canonical newest-published
 * instant always comes from the repository-authored Updates source (issue
 * #154), never a second notification table. There is intentionally no
 * per-Update or per-character state here.
 */

/** Project whether the authenticated account currently has unread news. */
export function getAccountNewsUnread(playerAccount: PlayerAccount): boolean {
  const latest = getLatestPublishedUpdate();
  return isNewsUnread(latest.publishedAt, playerAccount.newsReadThroughAt);
}

/**
 * Atomically advance one account's read-through boundary to at least
 * `candidate`, entirely inside a single conditional `UPDATE`. This is the
 * actual enforcement of the monotonic "never regress" rule: two concurrent or
 * out-of-order writes (for example from overlapping old/new deployments) can
 * never race a stale, older candidate over a newer one, because PostgreSQL
 * serializes concurrent `UPDATE`s to the same row and each write only takes
 * effect when the row's current stored value is still behind the candidate it
 * is about to write. There is no read-then-write step in application code for
 * this to race around.
 */
export async function advanceNewsReadThroughAt(
  playerAccountId: string,
  candidate: Date,
): Promise<void> {
  await db
    .update(playerAccounts)
    .set({ newsReadThroughAt: candidate })
    .where(
      and(
        eq(playerAccounts.id, playerAccountId),
        or(
          isNull(playerAccounts.newsReadThroughAt),
          lt(playerAccounts.newsReadThroughAt, candidate),
        ),
      ),
    );
}

/**
 * Acknowledge news for the authenticated account: advance the read-through
 * boundary to the newest published Update's instant as resolved server-side
 * at this moment — never the caller's wall clock or any client-supplied
 * value.
 */
export async function acknowledgeNews(userId: string): Promise<void> {
  const account = await requirePlayerAccount(userId);
  const latest = getLatestPublishedUpdate();
  await advanceNewsReadThroughAt(account.id, new Date(latest.publishedAt));
}
