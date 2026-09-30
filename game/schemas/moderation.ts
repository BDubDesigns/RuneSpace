import { z } from "zod";
import {
  APPEAL_OUTCOMES,
  APPEAL_POLICY,
  CASE_NOTE_MAX_LENGTH,
  MODERATION_CASE_STATUSES,
  MODERATION_RULE_CATEGORIES,
  SANCTION_DURATION_KEYS,
  SANCTION_KINDS,
  type AppealOutcome,
  type ModerationCaseStatus,
  type ModerationRuleCategory,
  type PrivilegedAccessKind,
  type SanctionDuration,
  type SanctionKind,
  type SanctionState,
} from "@/game/domain/moderation";
import type { ReportReason } from "@/game/domain/social-safety";

/**
 * Moderation request and view contracts (issue #248).
 *
 * Operator requests name a case, sanction, or appeal by id; the operator's own
 * identity always comes from the server session. Player views carry only what
 * a sanctioned player may see: never a reporter, a moderator, an internal
 * note, a signal count, or anything that would help evade enforcement.
 */

// Loose text bounds: the domain normalizer refuses overlong text clearly.
const NoteText = z.string().max(CASE_NOTE_MAX_LENGTH * 4);
const AppealText = z.string().max(APPEAL_POLICY.bodyMaxLength * 4);

export const ModerationCaseStatusSchema = z.enum(MODERATION_CASE_STATUSES);
export const SanctionKindSchema = z.enum(SANCTION_KINDS);
export const ModerationRuleCategorySchema = z.enum(MODERATION_RULE_CATEGORIES);
export const SanctionDurationSchema = z.enum(
  SANCTION_DURATION_KEYS as [SanctionDuration, ...SanctionDuration[]],
);
export const AppealOutcomeSchema = z.enum(APPEAL_OUTCOMES);

/** `active` is Open + Reviewed; `appeals` is every case with an undecided appeal. */
export const ModerationQueueFilterSchema = z.union([
  z.literal("active"),
  z.literal("appeals"),
  ModerationCaseStatusSchema,
]);
export type ModerationQueueFilter = z.infer<typeof ModerationQueueFilterSchema>;

export const OpenModerationCaseRequestSchema = z.object({
  /** The inspected character; the case is about its whole account. */
  characterId: z.string().uuid(),
  reason: NoteText,
});

export const SetCaseStatusRequestSchema = z.object({
  caseId: z.string().uuid(),
  status: ModerationCaseStatusSchema,
});

export const AddCaseNoteRequestSchema = z.object({
  caseId: z.string().uuid(),
  body: NoteText,
});

export const RetainedChatRequestSchema = z.object({
  caseId: z.string().uuid(),
  /** The report whose incident the window is centred on. */
  reportId: z.string().uuid(),
});

export const IssueSanctionRequestSchema = z
  .object({
    caseId: z.string().uuid(),
    kind: SanctionKindSchema,
    ruleCategory: ModerationRuleCategorySchema,
    duration: SanctionDurationSchema.nullable(),
  })
  .refine((value) => (value.kind === "warning") === (value.duration === null), {
    message: "A warning has no duration; other sanctions need one.",
  });

export const ChangeSanctionDurationRequestSchema = z.object({
  sanctionId: z.string().uuid(),
  duration: SanctionDurationSchema,
});

export const ReverseSanctionRequestSchema = z.object({
  sanctionId: z.string().uuid(),
});

export const DecideAppealRequestSchema = z
  .object({
    appealId: z.string().uuid(),
    outcome: AppealOutcomeSchema,
    /** Required for `modified`: the sanction's new duration. */
    duration: SanctionDurationSchema.nullable().default(null),
    note: NoteText.optional(),
  })
  .refine((value) => (value.outcome === "modified") === (value.duration !== null), {
    message: "Modify needs a new duration; Uphold and Reverse take none.",
  });

export const SubmitAppealRequestSchema = z.object({
  sanctionId: z.string().uuid(),
  body: AppealText,
});

// ---------------------------------------------------------------------------
// Player-facing views
// ---------------------------------------------------------------------------

export type AppealStatusView =
  | { status: "none" }
  | { status: "pending"; submittedAt: string }
  | { status: "decided"; submittedAt: string; decidedAt: string; outcome: AppealOutcome };

/**
 * What a sanctioned player is told about one sanction: the rule, the access
 * affected, the duration, the case reference, and how to appeal.
 */
export type SanctionNoticeView = {
  sanctionId: string;
  caseReference: string;
  kind: SanctionKind;
  kindLabel: string;
  ruleCategory: ModerationRuleCategory;
  ruleLabel: string;
  /** The published rules this notice cites. */
  rulesHref: string;
  accessAffected: string;
  durationLabel: string;
  startsAt: string;
  /** Null for a warning or a permanent sanction. */
  endsAt: string | null;
  state: SanctionState;
  /** In effect now, or a recent warning: worth surfacing outside the notices page. */
  current: boolean;
  appealable: boolean;
  appeal: AppealStatusView;
};

export type SanctionNoticesView = { notices: SanctionNoticeView[] };

export type SubmitAppealResult = { status: "submitted"; notice: SanctionNoticeView } | { error: string };

// ---------------------------------------------------------------------------
// Operator views
// ---------------------------------------------------------------------------

export type ModerationAccountIdentity = {
  playerAccountId: string;
  /** The account's public Player name, when it has one. */
  playerName: string | null;
  characters: { characterId: string; name: string; slot: number; createdAt: string }[];
};

export type ModerationQueueEntry = {
  caseId: string;
  reference: string;
  status: ModerationCaseStatus;
  openedBy: "report" | "operator";
  subject: ModerationAccountIdentity;
  reportCount: number;
  reasons: ReportReason[];
  latestReportAt: string | null;
  pendingAppeals: number;
  createdAt: string;
  updatedAt: string;
};

export type ModerationQueueView = {
  filter: ModerationQueueFilter;
  counts: Record<ModerationCaseStatus, number>;
  /** Cases with at least one undecided appeal. */
  pendingAppealCases: number;
  entries: ModerationQueueEntry[];
};

export type PreservedMessageView = {
  id: string;
  channel: string;
  conversationId: string | null;
  senderPlayerAccountId: string;
  senderCharacterId: string;
  senderCharacterName: string;
  body: string;
  promoted: boolean;
  sentAt: string;
};

export type CaseReportView = {
  reportId: string;
  kind: "message" | "player";
  reason: ReportReason;
  note: string | null;
  createdAt: string;
  channel: string | null;
  reporter: {
    playerAccountId: string;
    playerName: string | null;
    characterId: string;
    characterName: string;
  };
  reported: { characterId: string; nameAtReport: string };
  /** Whether the reporter's account blocks the case subject's account now. */
  reporterBlocksSubject: boolean;
  /** Message reports only: the exact message and its preserved context. */
  evidence: {
    message: PreservedMessageView;
    before: PreservedMessageView[];
    after: PreservedMessageView[];
  } | null;
};

export type CaseSanctionView = {
  sanctionId: string;
  kind: SanctionKind;
  ruleCategory: ModerationRuleCategory;
  duration: SanctionDuration | null;
  startsAt: string;
  endsAt: string | null;
  state: SanctionState;
  issuedByAdminUserId: string;
  reversedAt: string | null;
  reversedByAdminUserId: string | null;
  appeal: {
    appealId: string;
    body: string;
    submittedAt: string;
    outcome: AppealOutcome | null;
    decidedAt: string | null;
    decidedByAdminUserId: string | null;
    decisionNote: string | null;
  } | null;
};

export type CaseAuditEntry = {
  id: string;
  adminUserId: string;
  operation: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ModerationCaseView = {
  caseId: string;
  reference: string;
  status: ModerationCaseStatus;
  openedBy: "report" | "operator";
  openedByAdminUserId: string | null;
  openingReason: string | null;
  createdAt: string;
  updatedAt: string;
  subject: ModerationAccountIdentity;
  /** Newest first. */
  reports: CaseReportView[];
  /** Interpretable counts over the review window — never a score. */
  signals: {
    windowDays: number;
    reportsInWindow: number;
    independentReportersInWindow: number;
    /** Distinct accounts that block the subject now. */
    blockedByAccountsNow: number;
    /** Distinct accounts that blocked the subject during the window. */
    independentBlockersInWindow: number;
    /** The subject's other cases, newest first. */
    otherCases: { caseId: string; reference: string; status: ModerationCaseStatus; createdAt: string; reportCount: number }[];
  };
  /** Every name the subject's characters have been seen under in this case, and now. */
  nameHistory: { characterId: string; currentName: string | null; seenAs: string[] }[];
  notes: { noteId: string; adminUserId: string; body: string; createdAt: string }[];
  sanctions: CaseSanctionView[];
  audit: CaseAuditEntry[];
};

export type RetainedChatView = {
  kind: "public" | "whispers";
  /** The window the operator loaded, centred on the report. */
  from: string;
  to: string;
  truncated: boolean;
  messages: PreservedMessageView[];
};

export type PrivilegedAccessEntry = {
  id: string;
  adminUserId: string;
  kind: PrivilegedAccessKind;
  caseId: string | null;
  caseReference: string | null;
  targetPlayerAccountId: string | null;
  targetCharacterId: string | null;
  context: Record<string, unknown>;
  createdAt: string;
};

export type ModerationCommandResult<View> = { changed: boolean; view: View } | { error: string };

// Register the moderation-notice invalidation on the shared realtime registry.
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    /**
     * A sanction on the viewer's account was issued, changed, reversed, or
     * decided on appeal: every tab of the account re-reads its notices. Sent
     * only to the sanctioned account, and it carries nothing.
     */
    "moderation.notices": Record<string, never>;
  }
}
