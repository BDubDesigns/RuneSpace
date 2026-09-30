import { APPEAL_OUTCOME_LABEL } from "@/game/domain/moderation";
import type { AppealStatusView, SanctionNoticeView } from "@/game/schemas/moderation";

/**
 * Player-facing wording for a sanction notice (issue #248). Pure presentation
 * over the server's `SanctionNoticeView`: it never decides whether a notice is
 * current, appealable, or in effect — the view already says so.
 *
 * Dates are formatted in UTC with the zone named, so a server render and the
 * browser agree and a player in any time zone reads the same instant.
 */

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Oct 5, 2026, 14:03 UTC". */
export function formatNoticeInstant(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

/** "Social restriction · MOD-00042". */
export function noticeTitle(notice: Pick<SanctionNoticeView, "kindLabel" | "caseReference">) {
  return `${notice.kindLabel} · ${notice.caseReference}`;
}

/** Where the notice stands, in words. */
export function noticeStateLabel(state: SanctionNoticeView["state"]): string {
  switch (state) {
    case "in_effect":
      return "In effect";
    case "expired":
      return "Ended";
    case "reversed":
      return "Reversed";
    case "recorded":
      return "Warning on record";
  }
}

/**
 * When it ends. A warning never ends and a permanent sanction has no end, so
 * only a timed sanction names an instant ("Ends …", or "Ended …" once past).
 */
export function noticeEndsLabel(notice: SanctionNoticeView): string | null {
  if (notice.kind === "warning") return null;
  if (notice.endsAt === null) return "Permanent";
  return `${notice.state === "in_effect" ? "Ends" : "Ended"} ${formatNoticeInstant(notice.endsAt)}`;
}

/** The appeal's status line. */
export function appealStatusLabel(appeal: AppealStatusView): string {
  switch (appeal.status) {
    case "none":
      return "Not appealed";
    case "pending":
      return `Appeal submitted ${formatNoticeInstant(appeal.submittedAt)} — under review`;
    case "decided":
      return `Appeal decided: ${APPEAL_OUTCOME_LABEL[appeal.outcome]}`;
  }
}

/** Why a notice with no appeal on it cannot be appealed, in the player's words. */
export function unappealableReason(state: SanctionNoticeView["state"]): string {
  return state === "reversed"
    ? "This notice was reversed, so there's nothing to appeal."
    : "This notice has ended, so it can't be appealed any more.";
}

/** Whether a notice restricts sending chat (presentation only; the server enforces). */
export function isSocialRestriction(notice: Pick<SanctionNoticeView, "kind" | "current">) {
  return notice.kind === "social_restriction" && notice.current;
}

/** The edge colour a notice carries: danger for a restriction, amber for a warning. */
export function noticeEdgeColor(kind: SanctionNoticeView["kind"]): string {
  return kind === "warning" ? "var(--rs-accent-mining)" : "var(--rs-accent-danger)";
}
