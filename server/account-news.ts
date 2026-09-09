import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerAccounts, type PlayerAccount } from "@/db/rune-space";
import { getLatestPublishedUpdate } from "@/features/public-site/public-updates";
import { isNewsUnread, resolveNewsReadThroughAt } from "@/game/domain/news";
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
 * Acknowledge news for the authenticated account: advance the read-through
 * boundary to the newest published Update's instant as resolved server-side
 * at this moment — never the caller's wall clock or any client-supplied
 * value. The write is monotonic (see `resolveNewsReadThroughAt`), so a
 * repeated or out-of-order acknowledgement can never move the boundary
 * backward and race-mark a not-yet-published Update as read.
 */
export async function acknowledgeNews(userId: string): Promise<void> {
  const account = await requirePlayerAccount(userId);
  const latest = getLatestPublishedUpdate();
  const nextReadThroughAt = resolveNewsReadThroughAt(account.newsReadThroughAt, latest.publishedAt);

  await db
    .update(playerAccounts)
    .set({ newsReadThroughAt: nextReadThroughAt })
    .where(eq(playerAccounts.id, account.id));
}
