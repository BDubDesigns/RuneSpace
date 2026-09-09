/**
 * Account-level news read-through rules (issue #156).
 *
 * Pure, framework-free rules — no UI, no persistence. The canonical "newest
 * published Update" instant is resolved elsewhere (the repository-authored
 * Updates source, issue #154); this module only knows how to compare that
 * instant against a stored read-through boundary and how to advance that
 * boundary safely.
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

/**
 * Resolve the next read-through boundary for an acknowledgement.
 *
 * Always advances to the newest published Update's instant at the moment of
 * acknowledgement — never the wall clock, so a delayed request can never mark
 * a not-yet-published Update as read. Takes the later of the current boundary
 * and that instant so the write is monotonic and idempotent: acknowledging
 * twice, or acknowledging out of order, can never move the boundary backward.
 */
export function resolveNewsReadThroughAt(current: Date | null, latestPublishedAt: string): Date {
  const latest = new Date(Date.parse(latestPublishedAt));
  if (current === null) return latest;
  return current.getTime() >= latest.getTime() ? current : latest;
}
