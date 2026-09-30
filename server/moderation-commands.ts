import { db } from "@/db";
import type {
  AppealOutcome,
  ModerationCaseStatus,
  ModerationRuleCategory,
  SanctionDuration,
  SanctionKind,
} from "@/game/domain/moderation";
import type {
  ModerationCaseView,
  ModerationQueueFilter,
  ModerationQueueView,
  PrivilegedAccessEntry,
  RetainedChatView,
} from "@/game/schemas/moderation";
import { requireAdmin } from "@/server/admin-auth";
import {
  addModerationCaseNoteAs,
  changeSanctionDurationAs,
  decideAppealAs,
  issueSanctionAs,
  openModerationCaseAs,
  readAccountModerationHistoryAs,
  readModerationCaseAs,
  readModerationQueueAs,
  readPrivilegedAccessLogAs,
  readRetainedPublicChatAs,
  readRetainedWhispersAs,
  reverseSanctionAs,
  setModerationCaseStatusAs,
  type AccountModerationHistory,
  type ModerationMutation,
} from "@/server/moderation-seams";
import { publishSanctionsChanged } from "@/server/moderation-sanctions";

export { ModerationCommandError } from "@/server/moderation-seams";

/**
 * The PRODUCTION moderation surface (issue #248). Every export authenticates
 * the request with `requireAdmin(headers)` before touching anything, so the
 * operator identity recorded in every audit row is always the server-derived
 * Better Auth admin — never a browser-supplied value. An ordinary player gets
 * the 403 `AdminError` and no data, and no audit row names them as an actor.
 *
 * Each call is one transaction: an audited read records its privileged-access
 * row and reads in the same transaction; a mutation commits its change and
 * its operator-audit row together, then (after commit) prompts the sanctioned
 * account's open tabs to re-read their notices.
 */

function afterCommit(result: ModerationMutation) {
  if (result.noticesChanged) {
    publishSanctionsChanged(result.subjectPlayerAccountId, result.gameplayAccessChanged);
  }
  return { changed: result.changed, caseId: result.caseId };
}

export type ModerationMutationResult = { changed: boolean; caseId: string };

export async function loadModerationQueue(
  headers: Headers,
  filter: ModerationQueueFilter,
): Promise<ModerationQueueView> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readModerationQueueAs(tx, admin.id, filter));
}

export async function loadModerationCase(
  headers: Headers,
  caseId: string,
  now: Date = new Date(),
): Promise<ModerationCaseView> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readModerationCaseAs(tx, admin.id, caseId, now));
}

export async function loadRetainedPublicChat(
  headers: Headers,
  caseId: string,
  reportId: string,
): Promise<RetainedChatView> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readRetainedPublicChatAs(tx, admin.id, caseId, reportId));
}

export async function loadRetainedWhispers(
  headers: Headers,
  caseId: string,
  reportId: string,
): Promise<RetainedChatView> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readRetainedWhispersAs(tx, admin.id, caseId, reportId));
}

export async function loadAccountModerationHistory(
  headers: Headers,
  characterId: string,
): Promise<AccountModerationHistory> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readAccountModerationHistoryAs(tx, admin.id, characterId));
}

export async function loadPrivilegedAccessLogView(
  headers: Headers,
  limit: number = 200,
): Promise<PrivilegedAccessEntry[]> {
  const admin = await requireAdmin(headers);
  return db.transaction((tx) => readPrivilegedAccessLogAs(tx, admin.id, limit));
}

export async function openModerationCase(
  headers: Headers,
  characterId: string,
  reason: string,
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(
    await db.transaction((tx) => openModerationCaseAs(tx, admin.id, characterId, reason, now)),
  );
}

export async function setModerationCaseStatus(
  headers: Headers,
  caseId: string,
  status: ModerationCaseStatus,
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(
    await db.transaction((tx) => setModerationCaseStatusAs(tx, admin.id, caseId, status, now)),
  );
}

export async function addModerationCaseNote(
  headers: Headers,
  caseId: string,
  body: string,
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(
    await db.transaction((tx) => addModerationCaseNoteAs(tx, admin.id, caseId, body, now)),
  );
}

export async function issueSanction(
  headers: Headers,
  request: {
    caseId: string;
    kind: SanctionKind;
    ruleCategory: ModerationRuleCategory;
    duration: SanctionDuration | null;
  },
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(await db.transaction((tx) => issueSanctionAs(tx, admin.id, request, now)));
}

export async function changeSanctionDuration(
  headers: Headers,
  sanctionId: string,
  duration: SanctionDuration,
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(
    await db.transaction((tx) => changeSanctionDurationAs(tx, admin.id, sanctionId, duration, now)),
  );
}

export async function reverseSanction(
  headers: Headers,
  sanctionId: string,
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(
    await db.transaction((tx) => reverseSanctionAs(tx, admin.id, sanctionId, now)),
  );
}

export async function decideAppeal(
  headers: Headers,
  request: {
    appealId: string;
    outcome: AppealOutcome;
    duration: SanctionDuration | null;
    note?: string;
  },
  now: Date = new Date(),
): Promise<ModerationMutationResult> {
  const admin = await requireAdmin(headers);
  return afterCommit(await db.transaction((tx) => decideAppealAs(tx, admin.id, request, now)));
}
