import { chatMessageLength, toPlainText } from "./chat";

/**
 * Player safety rules (issue #247): Block and Report. Framework-free and
 * deterministic; `server/player-blocks.ts` and `server/player-reports.ts`
 * enforce them and the browser only presents them.
 *
 * Block and Report are interpretable safety signals for human review (#248).
 * Nothing here scores a player, counts toward a threshold, or sanctions anyone.
 */

/** Why a player is reporting a message or another player. */
export const REPORT_REASONS = [
  "harassment_hate",
  "threats",
  "spam_scam",
  "sexual_inappropriate",
  "offensive_name_profile",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  harassment_hate: "Harassment or hate",
  threats: "Threats",
  spam_scam: "Spam or scam",
  sexual_inappropriate: "Sexual or inappropriate",
  offensive_name_profile: "Offensive name or profile",
  other: "Other",
};

export const REPORT_POLICY = {
  /** The optional note, counted in code points like a chat message. */
  noteMaxLength: 280,
  /**
   * A message report's preserved context: up to this many messages before and
   * after the reported one, in its own channel or Whisper conversation only.
   */
  contextBefore: 10,
  contextAfter: 10,
} as const;

export type ReportNoteRefusal = "note_too_long";

/**
 * Trim the optional note: blank becomes no note, and an overlong note is
 * refused rather than silently cut.
 */
export function normalizeReportNote(
  note: string | undefined,
): { ok: true; note: string | null } | { ok: false; reason: ReportNoteRefusal } {
  const trimmed = toPlainText(note ?? "");
  if (trimmed.length === 0) return { ok: true, note: null };
  if (chatMessageLength(trimmed) > REPORT_POLICY.noteMaxLength) {
    return { ok: false, reason: "note_too_long" };
  }
  return { ok: true, note: trimmed };
}
