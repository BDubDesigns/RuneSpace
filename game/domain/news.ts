/**
 * Account-level news read-through rules (issue #156).
 *
 * Pure, framework-free rules — no UI, no persistence. The canonical "newest
 * published Update" instant is resolved elsewhere (the repository-authored
 * Updates source, issue #154); this module only knows how to compare that
 * instant against a stored read-through boundary.
 *
 * Advancing the stored boundary is intentionally NOT a pure/application-level
 * computation: `server/account-news.ts` enforces the monotonic "never regress"
 * rule as a single atomic conditional `UPDATE` at the database boundary, so a
 * read-then-write race between overlapping requests can never move the
 * boundary backward.
 *
 * Deliberately narrow: one read-through boundary, no per-Update state.
 */

/**
 * An account has unread news when the newest published Update's instant is
 * strictly after the account's read-through boundary. A `null` boundary means
 * "never acknowledged" and is always unread.
 */
export function isNewsUnread(latestPublishedAt: string, readThroughAt: Date | null): boolean {
  if (readThroughAt === null) return true;
  return Date.parse(latestPublishedAt) > readThroughAt.getTime();
}
