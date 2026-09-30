import type { SanctionNoticeView } from "@/game/schemas/moderation";

/**
 * Which moderation notices this device has already shown the player (#248).
 *
 * A current notice stays pinned in Chat/Social for as long as it applies, but
 * it lights the launcher only until the player has opened Chat/Social and
 * seen it. That is presentation, not moderation state, so it lives on the
 * device rather than in a server table: a reload keeps it, and another device
 * simply shows the notice as new once. Durable Whisper unread is a separate
 * attention source and is never affected.
 *
 * A notice is keyed by its sanction and its end, so a notice whose duration
 * changes asks for attention again. Storage may be unavailable (private
 * browsing, quota); then acknowledgement lasts for this page only.
 */

const STORAGE_KEY = "runespace.moderation-notices-seen";
/** Plenty for any real account; old keys fall off the front. */
const MAX_REMEMBERED = 50;

export function noticeAcknowledgementKey(
  notice: Pick<SanctionNoticeView, "sanctionId" | "endsAt">,
): string {
  return `${notice.sanctionId}@${notice.endsAt ?? "none"}`;
}

export function readAcknowledgedNotices(): Set<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/** Remember `keys` as seen on this device; returns the updated set. */
export function acknowledgeNotices(
  seen: ReadonlySet<string>,
  keys: readonly string[],
): Set<string> {
  const next = new Set(seen);
  for (const key of keys) {
    next.delete(key);
    next.add(key);
  }
  const remembered = [...next].slice(-MAX_REMEMBERED);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    // Unavailable storage: the acknowledgement still holds for this page.
  }
  return new Set(remembered);
}
