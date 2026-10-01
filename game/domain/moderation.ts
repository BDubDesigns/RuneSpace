import { chatMessageLength, toPlainText } from "./chat";

/**
 * Moderation rules (issue #248): case lifecycle, sanctions, their effects,
 * appeals, and what a sanctioned player is told. Framework-free and
 * deterministic; `server/moderation-*.ts` enforce them, and the Operator
 * Console and player notices only present them.
 *
 * Human judgement is the authority. Nothing here scores a player, reads a
 * threshold, or sanctions anyone automatically: every sanction is an explicit
 * operator action on a moderation case, and every effect is derived from the
 * persisted sanction and the request's clock, never cached.
 */

/** Open → Reviewed → Actioned or Dismissed, with operator notes throughout. */
export const MODERATION_CASE_STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
export type ModerationCaseStatus = (typeof MODERATION_CASE_STATUSES)[number];

/**
 * Statuses that still await an outcome. An account has at most one such case
 * at a time; a new report joins it, and a report after the case closes opens
 * a new one.
 */
export const ACTIVE_CASE_STATUSES = [
  "open",
  "reviewed",
] as const satisfies readonly ModerationCaseStatus[];

export function isActiveCaseStatus(status: ModerationCaseStatus): boolean {
  return (ACTIVE_CASE_STATUSES as readonly ModerationCaseStatus[]).includes(status);
}

export const MODERATION_CASE_STATUS_LABEL: Record<ModerationCaseStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

/** The player-facing case reference, e.g. `MOD-00042`. */
export function moderationCaseReference(caseNumber: number): string {
  return `MOD-${String(caseNumber).padStart(5, "0")}`;
}

/**
 * The conduct rule a sanction cites. Each maps to a section of the published
 * Chat & Community Rules, so a notice can say exactly which rule it means.
 */
export const MODERATION_RULE_CATEGORIES = [
  "identity_hate",
  "harassment",
  "threats_private_info",
  "sexual_content",
  "scams_spam",
  "moderation_abuse",
  "block_or_sanction_evasion",
  "offensive_name",
] as const;
export type ModerationRuleCategory = (typeof MODERATION_RULE_CATEGORIES)[number];

export const MODERATION_RULE_LABEL: Record<ModerationRuleCategory, string> = {
  identity_hate: "Targeting people for who they are",
  harassment: "Harassment",
  threats_private_info: "Threats or sharing private information",
  sexual_content: "Sexual harassment or exploitative content",
  scams_spam: "Scams, impersonation, or spam",
  moderation_abuse: "Abusing reports or moderation",
  block_or_sanction_evasion: "Evading a block or a moderation sanction",
  offensive_name: "Offensive name or profile",
};

export const SANCTION_KINDS = ["warning", "social_restriction", "suspension"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export const SANCTION_KIND_LABEL: Record<SanctionKind, string> = {
  warning: "Warning",
  social_restriction: "Social restriction",
  suspension: "Account suspension",
};

/**
 * What each kind takes away while it is in effect, in the player's words.
 * Only shipped features are named.
 */
export const SANCTION_ACCESS_AFFECTED: Record<SanctionKind, string> = {
  warning: "Nothing is restricted. This is a warning on your account.",
  // Starting a player trade request is refused by
  // `requireTradeRequestInitiationAllowed` (#266); players can start one from a
  // profile since #268. Accepting someone else's request stays allowed.
  social_restriction:
    "You can't send General, Trade, or Whisper messages, post promoted Trade ads, or start a trade with another player. You can still play, read public chat, and accept a trade someone else starts.",
  suspension: "You can't enter RuneSpace gameplay on any character on this account.",
};

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Duration presets for social restrictions and suspensions. `null` is permanent. */
export const SANCTION_DURATIONS = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
  "1y": 365 * DAY_MS,
  permanent: null,
} as const satisfies Record<string, number | null>;
export type SanctionDuration = keyof typeof SANCTION_DURATIONS;
export const SANCTION_DURATION_KEYS = Object.keys(SANCTION_DURATIONS) as SanctionDuration[];

export const SANCTION_DURATION_LABEL: Record<SanctionDuration, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  permanent: "Permanent",
};

/**
 * When a sanction issued at `startsAt` with `duration` ends. A warning has no
 * duration and never ends because it never restricts anything.
 */
export function sanctionEndsAt(
  kind: SanctionKind,
  startsAt: Date,
  duration: SanctionDuration | null,
): Date | null {
  if (kind === "warning") return null;
  if (duration === null) throw new Error("A social restriction or suspension needs a duration");
  const ms = SANCTION_DURATIONS[duration];
  return ms === null ? null : new Date(startsAt.getTime() + ms);
}

/** The persisted facts one sanction's state is derived from. */
export type SanctionFacts = {
  kind: SanctionKind;
  startsAt: Date;
  /** Null for a warning or a permanent sanction. */
  endsAt: Date | null;
  /** Set when an operator reversed it (directly or by appeal). */
  reversedAt: Date | null;
};

export type SanctionState = "in_effect" | "expired" | "reversed" | "recorded";

/**
 * A sanction's state at `now`. A sanction takes effect when it is issued. A
 * warning is `recorded` (it never restricts); a reversal wins over
 * everything; an ended sanction is `expired` from its exact end instant.
 */
export function sanctionState(sanction: SanctionFacts, now: Date): SanctionState {
  if (sanction.reversedAt !== null) return "reversed";
  if (sanction.kind === "warning") return "recorded";
  if (sanction.endsAt !== null && now.getTime() >= sanction.endsAt.getTime()) return "expired";
  return "in_effect";
}

/** Whether any of an account's sanctions of `kind` is in effect at `now`. */
export function hasSanctionInEffect(
  sanctions: readonly SanctionFacts[],
  kind: Exclude<SanctionKind, "warning">,
  now: Date,
): boolean {
  return sanctions.some((s) => s.kind === kind && sanctionState(s, now) === "in_effect");
}

/**
 * A player can appeal a sanction once, while it still stands: in effect, or a
 * warning that has not been reversed.
 */
export function isSanctionAppealable(sanction: SanctionFacts, now: Date): boolean {
  const state = sanctionState(sanction, now);
  return state === "in_effect" || state === "recorded";
}

/**
 * How long a warning stays surfaced outside the notices page (the Characters
 * banner and the Chat/Social notice card). It never restricts anything.
 */
export const WARNING_NOTICE_WINDOW_MS = 30 * DAY_MS;

/**
 * Whether a notice is worth surfacing beyond the notices page: a sanction in
 * effect now, or an unreversed warning issued within the notice window.
 */
export function isSanctionNoticeCurrent(sanction: SanctionFacts, now: Date): boolean {
  const state = sanctionState(sanction, now);
  if (state === "in_effect") return true;
  return (
    state === "recorded" && now.getTime() - sanction.startsAt.getTime() < WARNING_NOTICE_WINDOW_MS
  );
}

/** How a sanction's duration reads to the sanctioned player. */
export function sanctionDurationLabel(
  kind: SanctionKind,
  duration: SanctionDuration | null,
): string {
  if (kind === "warning" || duration === null) return "No time limit — a warning restricts nothing";
  return SANCTION_DURATION_LABEL[duration];
}

export const APPEAL_POLICY = {
  /** The player's explanation, counted in code points. */
  bodyMaxLength: 1_000,
} as const;

export const APPEAL_OUTCOMES = ["upheld", "modified", "reversed"] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

export const APPEAL_OUTCOME_LABEL: Record<AppealOutcome, string> = {
  upheld: "Upheld",
  modified: "Modified",
  reversed: "Reversed",
};

/** The operator's internal note on a case, counted in code points. */
export const CASE_NOTE_MAX_LENGTH = 2_000;

/**
 * Privileged views of sensitive safety data. Every one writes an immutable
 * access-audit row before any data is returned, even when nothing is changed.
 */
export const PRIVILEGED_ACCESS_KINDS = [
  "case_queue",
  "case_detail",
  "retained_public_chat",
  "retained_whispers",
  "account_moderation_history",
  "privileged_access_log",
] as const;
export type PrivilegedAccessKind = (typeof PRIVILEGED_ACCESS_KINDS)[number];

export const PRIVILEGED_ACCESS_LABEL: Record<PrivilegedAccessKind, string> = {
  case_queue: "Moderation queue (report summaries)",
  case_detail: "Case detail (reports, preserved evidence, safety signals)",
  retained_public_chat: "Retained General/Trade chat",
  retained_whispers: "Retained Whispers",
  account_moderation_history: "Account moderation history",
  privileged_access_log: "Privileged access log",
};

/**
 * How far around an incident an operator may load retained chat for a case:
 * the reported account's public messages in this window, or the Whispers
 * between the case's two accounts. Never an unbounded history.
 */
export const RETAINED_CHAT_WINDOW_MS = 24 * HOUR_MS;
export const RETAINED_CHAT_MAX_MESSAGES = 100;

/** The review-context window for "recent" reports and blocks. */
export const SAFETY_SIGNAL_WINDOW_MS = 30 * DAY_MS;

/** Trim and bound a free-text field; blank or overlong is refused, never cut. */
export function normalizeModerationText(
  text: string,
  maxLength: number,
): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  const trimmed = toPlainText(text);
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (chatMessageLength(trimmed) > maxLength) return { ok: false, reason: "too_long" };
  return { ok: true, text: trimmed };
}
