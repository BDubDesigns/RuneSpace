import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  max,
  sql,
} from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
  characters,
  chatMessages,
  moderationAppeals,
  moderationCaseNotes,
  moderationCases,
  moderationSanctions,
  playerAccounts,
  playerBlockEvents,
  playerBlocks,
  playerReports,
  whisperParticipants,
  type ModerationCase,
  type ModerationSanction,
} from "@/db/rune-space";
import {
  ACTIVE_CASE_STATUSES,
  CASE_NOTE_MAX_LENGTH,
  MODERATION_CASE_STATUSES,
  moderationCaseReference,
  normalizeModerationText,
  RETAINED_CHAT_MAX_MESSAGES,
  RETAINED_CHAT_WINDOW_MS,
  SAFETY_SIGNAL_WINDOW_MS,
  sanctionEndsAt,
  sanctionState,
  type AppealOutcome,
  type ModerationCaseStatus,
  type ModerationRuleCategory,
  type SanctionDuration,
  type SanctionKind,
} from "@/game/domain/moderation";
import type { ReportReason } from "@/game/domain/social-safety";
import type {
  CaseReportView,
  CaseSanctionView,
  ModerationAccountIdentity,
  ModerationCaseView,
  ModerationQueueEntry,
  ModerationQueueFilter,
  ModerationQueueView,
  PreservedMessageView,
  PrivilegedAccessEntry,
  RetainedChatView,
} from "@/game/schemas/moderation";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadModerationCaseAuditLog, recordOperatorAudit } from "@/server/admin-audit";
import { lockAccountChatSends } from "@/server/chat-send-lock";
import { loadPrivilegedAccessLog, recordPrivilegedAccess } from "@/server/privileged-access";
import type { MessageReportEvidence, ReportedMessageSnapshot } from "@/server/player-reports";

/**
 * INTERNAL moderation seams (issue #248). Not a production entrypoint.
 *
 * Every function takes an already-authorized admin user id and runs inside
 * the caller's transaction. The production surface is
 * `server/moderation-commands.ts`, which calls `requireAdmin(headers)` first
 * and derives that id from the Better Auth session; the seams are exported
 * only so integration tests can drive them against a real database.
 *
 * Reads: every view of sensitive safety data writes its privileged-access row
 * (`recordPrivilegedAccess`) BEFORE any sensitive data is read, in the same
 * transaction, so an audit failure returns nothing. Only a case's existence is
 * checked first, and that reveals nothing.
 *
 * Mutations: every successful change writes exactly one `operator_audit_logs`
 * row (two when an appeal decision also changes its sanction) with the case
 * id, atomically with the change. No-ops write nothing.
 */

type Tx = DatabaseTransaction;

export class ModerationCommandError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ModerationCommandError";
  }
}

/** What a committed mutation changed, so the caller can publish after commit. */
export type ModerationMutation = {
  changed: boolean;
  caseId: string;
  subjectPlayerAccountId: string;
  /** The subject's notices changed (a sanction or appeal decision). */
  noticesChanged: boolean;
  /** The subject's gameplay access may have changed (a suspension moved). */
  gameplayAccessChanged: boolean;
};

const QUEUE_LIMIT = 100;

function iso(date: Date): string {
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Shared loaders (no authorization, no audit — callers audit first)
// ---------------------------------------------------------------------------

async function requireCase(tx: Tx, caseId: string, lock = false): Promise<ModerationCase> {
  const query = tx.select().from(moderationCases).where(eq(moderationCases.id, caseId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new ModerationCommandError("Moderation case not found.", 404);
  return row;
}

async function accountIdentities(
  tx: Tx,
  accountIds: readonly string[],
): Promise<Map<string, ModerationAccountIdentity>> {
  const ids = [...new Set(accountIds)];
  const identities = new Map<string, ModerationAccountIdentity>();
  if (ids.length === 0) return identities;
  const accounts = await tx
    .select({ id: playerAccounts.id, playerName: user.displayUsername })
    .from(playerAccounts)
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .where(inArray(playerAccounts.id, ids));
  for (const account of accounts) {
    identities.set(account.id, {
      playerAccountId: account.id,
      playerName: account.playerName,
      characters: [],
    });
  }
  const rows = await tx
    .select()
    .from(characters)
    .where(inArray(characters.playerAccountId, ids))
    .orderBy(asc(characters.slot));
  for (const row of rows) {
    identities.get(row.playerAccountId)?.characters.push({
      characterId: row.id,
      name: row.displayName,
      slot: row.slot,
      createdAt: iso(row.createdAt),
    });
  }
  return identities;
}

function identityOf(
  identities: Map<string, ModerationAccountIdentity>,
  playerAccountId: string,
): ModerationAccountIdentity {
  return identities.get(playerAccountId) ?? { playerAccountId, playerName: null, characters: [] };
}

function preserved(snapshot: ReportedMessageSnapshot): PreservedMessageView {
  return {
    id: snapshot.id,
    channel: snapshot.channel,
    conversationId: snapshot.conversationId,
    senderPlayerAccountId: snapshot.senderPlayerAccountId,
    senderCharacterId: snapshot.senderCharacterId,
    senderCharacterName: snapshot.senderCharacterName,
    body: snapshot.body,
    promoted: snapshot.promoted,
    sentAt: snapshot.sentAt,
  };
}

function sanctionView(
  sanction: ModerationSanction,
  appeal: typeof moderationAppeals.$inferSelect | undefined,
  now: Date,
): CaseSanctionView {
  return {
    sanctionId: sanction.id,
    kind: sanction.kind as SanctionKind,
    ruleCategory: sanction.ruleCategory as ModerationRuleCategory,
    duration: sanction.duration as SanctionDuration | null,
    startsAt: iso(sanction.startsAt),
    endsAt: sanction.endsAt ? iso(sanction.endsAt) : null,
    state: sanctionState(
      {
        kind: sanction.kind as SanctionKind,
        startsAt: sanction.startsAt,
        endsAt: sanction.endsAt,
        reversedAt: sanction.reversedAt,
      },
      now,
    ),
    issuedByAdminUserId: sanction.issuedByAdminUserId,
    reversedAt: sanction.reversedAt ? iso(sanction.reversedAt) : null,
    reversedByAdminUserId: sanction.reversedByAdminUserId,
    appeal: appeal
      ? {
          appealId: appeal.id,
          body: appeal.body,
          submittedAt: iso(appeal.submittedAt),
          outcome: appeal.outcome as AppealOutcome | null,
          decidedAt: appeal.decidedAt ? iso(appeal.decidedAt) : null,
          decidedByAdminUserId: appeal.decidedByAdminUserId,
          decisionNote: appeal.decisionNote,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Audited reads
// ---------------------------------------------------------------------------

/**
 * `moderation_cases.id`, table-qualified. Drizzle renders a column of a
 * single-table select unqualified, so inside a correlated subquery a bare
 * `"id"` would bind to the subquery's own table instead of the case.
 */
const caseIdColumn = sql`${moderationCases}.${sql.identifier("id")}`;

/** How many reports a case holds, as a correlated subquery. */
const caseReportCount = sql<number>`(select count(*) from ${playerReports} where ${playerReports}.${sql.identifier("case_id")} = ${caseIdColumn})`;

function queueWhere(filter: ModerationQueueFilter) {
  if (filter === "active") return inArray(moderationCases.status, [...ACTIVE_CASE_STATUSES]);
  if (filter === "appeals") {
    return sql`exists (select 1 from ${moderationAppeals} where ${moderationAppeals}.${sql.identifier("case_id")} = ${caseIdColumn} and ${moderationAppeals}.${sql.identifier("outcome")} is null)`;
  }
  return eq(moderationCases.status, filter);
}

/** The moderation queue: case summaries, including report reasons. */
export async function readModerationQueueAs(
  tx: Tx,
  adminUserId: string,
  filter: ModerationQueueFilter,
): Promise<ModerationQueueView> {
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "case_queue",
    context: { filter },
  });

  const statusCounts = await tx
    .select({ status: moderationCases.status, count: count() })
    .from(moderationCases)
    .groupBy(moderationCases.status);
  const [pending] = await tx
    .select({ count: countDistinct(moderationAppeals.caseId) })
    .from(moderationAppeals)
    .where(isNull(moderationAppeals.outcome));
  const counts = Object.fromEntries(
    MODERATION_CASE_STATUSES.map((status) => [status, 0]),
  ) as Record<ModerationCaseStatus, number>;
  for (const row of statusCounts) counts[row.status as ModerationCaseStatus] = Number(row.count);

  const cases = await tx
    .select()
    .from(moderationCases)
    .where(queueWhere(filter))
    .orderBy(desc(moderationCases.updatedAt), desc(moderationCases.caseNumber))
    .limit(QUEUE_LIMIT);
  const caseIds = cases.map((row) => row.id);

  const reportRows =
    caseIds.length === 0
      ? []
      : await tx
          .select({
            caseId: playerReports.caseId,
            reason: playerReports.reason,
            reports: count(),
            latest: max(playerReports.createdAt),
          })
          .from(playerReports)
          .where(inArray(playerReports.caseId, caseIds))
          .groupBy(playerReports.caseId, playerReports.reason);
  const appealRows =
    caseIds.length === 0
      ? []
      : await tx
          .select({ caseId: moderationAppeals.caseId, pending: count() })
          .from(moderationAppeals)
          .where(and(inArray(moderationAppeals.caseId, caseIds), isNull(moderationAppeals.outcome)))
          .groupBy(moderationAppeals.caseId);
  const identities = await accountIdentities(
    tx,
    cases.map((row) => row.subjectPlayerAccountId),
  );

  const entries: ModerationQueueEntry[] = cases.map((row) => {
    const reports = reportRows.filter((report) => report.caseId === row.id);
    const latest = reports.reduce<Date | null>(
      (newest, report) =>
        report.latest && (!newest || report.latest > newest) ? report.latest : newest,
      null,
    );
    return {
      caseId: row.id,
      reference: moderationCaseReference(row.caseNumber),
      status: row.status as ModerationCaseStatus,
      openedBy: row.openedBy as "report" | "operator",
      subject: identityOf(identities, row.subjectPlayerAccountId),
      reportCount: reports.reduce((sum, report) => sum + Number(report.reports), 0),
      reasons: reports.map((report) => report.reason as ReportReason),
      latestReportAt: latest ? iso(latest) : null,
      pendingAppeals: Number(appealRows.find((appeal) => appeal.caseId === row.id)?.pending ?? 0),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  });

  return { filter, counts, pendingAppealCases: Number(pending?.count ?? 0), entries };
}

/**
 * One case, in review order: reports (the allegation and its preserved
 * context), identities, interpretable signals, name history, notes,
 * sanctions with appeals, and the case's action history.
 */
export async function readModerationCaseAs(
  tx: Tx,
  adminUserId: string,
  caseId: string,
  now: Date,
): Promise<ModerationCaseView> {
  const moderationCase = await requireCase(tx, caseId);
  const subjectId = moderationCase.subjectPlayerAccountId;
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "case_detail",
    caseId,
    targetPlayerAccountId: subjectId,
    context: { reference: moderationCaseReference(moderationCase.caseNumber) },
  });

  const reports = await tx
    .select()
    .from(playerReports)
    .where(eq(playerReports.caseId, caseId))
    .orderBy(desc(playerReports.createdAt), desc(playerReports.id));
  const reporterCharacters = reports.length
    ? await tx
        .select({ id: characters.id, name: characters.displayName })
        .from(characters)
        .where(
          inArray(
            characters.id,
            reports.map((report) => report.reporterCharacterId),
          ),
        )
    : [];
  const blockersNow = new Set(
    (
      await tx
        .select({ blocker: playerBlocks.blockerPlayerAccountId })
        .from(playerBlocks)
        .where(eq(playerBlocks.blockedPlayerAccountId, subjectId))
    ).map((row) => row.blocker),
  );
  const identities = await accountIdentities(tx, [
    subjectId,
    ...reports.map((report) => report.reporterPlayerAccountId),
  ]);

  const reportViews: CaseReportView[] = reports.map((report) => {
    const evidence = report.evidence as MessageReportEvidence | null;
    return {
      reportId: report.id,
      kind: report.kind as "message" | "player",
      reason: report.reason as ReportReason,
      note: report.note,
      createdAt: iso(report.createdAt),
      channel: report.channel,
      reporter: {
        playerAccountId: report.reporterPlayerAccountId,
        playerName: identityOf(identities, report.reporterPlayerAccountId).playerName,
        characterId: report.reporterCharacterId,
        characterName:
          reporterCharacters.find((row) => row.id === report.reporterCharacterId)?.name ?? "",
      },
      reported: {
        characterId: report.reportedCharacterId,
        nameAtReport: report.reportedCharacterName,
      },
      reporterBlocksSubject: blockersNow.has(report.reporterPlayerAccountId),
      evidence: evidence
        ? {
            message: preserved(evidence.message),
            before: evidence.before.map(preserved),
            after: evidence.after.map(preserved),
          }
        : null,
    };
  });

  const windowStart = new Date(now.getTime() - SAFETY_SIGNAL_WINDOW_MS);
  const [reportSignals] = await tx
    .select({
      reports: count(),
      reporters: countDistinct(playerReports.reporterPlayerAccountId),
    })
    .from(playerReports)
    .where(
      and(
        eq(playerReports.reportedPlayerAccountId, subjectId),
        gte(playerReports.createdAt, windowStart),
      ),
    );
  const [blockSignals] = await tx
    .select({ blockers: countDistinct(playerBlockEvents.blockerPlayerAccountId) })
    .from(playerBlockEvents)
    .where(
      and(
        eq(playerBlockEvents.blockedPlayerAccountId, subjectId),
        eq(playerBlockEvents.kind, "block"),
        gte(playerBlockEvents.createdAt, windowStart),
      ),
    );
  const otherCases = await tx
    .select({
      caseId: moderationCases.id,
      caseNumber: moderationCases.caseNumber,
      status: moderationCases.status,
      createdAt: moderationCases.createdAt,
      reportCount: caseReportCount,
    })
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.subjectPlayerAccountId, subjectId),
        sql`${moderationCases.id} <> ${caseId}`,
      ),
    )
    .orderBy(desc(moderationCases.createdAt))
    .limit(20);

  // Names the subject's characters were seen under: now, at each report, and
  // as the sender of any preserved message in this case.
  const seen = new Map<string, Set<string>>();
  const see = (characterId: string, name: string) => {
    if (!seen.has(characterId)) seen.set(characterId, new Set());
    seen.get(characterId)!.add(name);
  };
  for (const report of reports) {
    if (report.reportedPlayerAccountId === subjectId) {
      see(report.reportedCharacterId, report.reportedCharacterName);
    }
    const evidence = report.evidence as MessageReportEvidence | null;
    if (!evidence) continue;
    for (const message of [evidence.message, ...evidence.before, ...evidence.after]) {
      if (message.senderPlayerAccountId === subjectId) {
        see(message.senderCharacterId, message.senderCharacterName);
      }
    }
  }
  const subject = identityOf(identities, subjectId);
  for (const character of subject.characters) see(character.characterId, character.name);
  const nameHistory = [...seen.entries()].map(([characterId, names]) => ({
    characterId,
    currentName: subject.characters.find((c) => c.characterId === characterId)?.name ?? null,
    seenAs: [...names],
  }));

  const notes = await tx
    .select()
    .from(moderationCaseNotes)
    .where(eq(moderationCaseNotes.caseId, caseId))
    .orderBy(asc(moderationCaseNotes.createdAt), asc(moderationCaseNotes.id));
  const sanctions = await tx
    .select()
    .from(moderationSanctions)
    .where(eq(moderationSanctions.caseId, caseId))
    .orderBy(desc(moderationSanctions.startsAt), desc(moderationSanctions.id));
  const appeals = await tx
    .select()
    .from(moderationAppeals)
    .where(eq(moderationAppeals.caseId, caseId));
  const audit = await loadModerationCaseAuditLog(tx, caseId);

  return {
    caseId,
    reference: moderationCaseReference(moderationCase.caseNumber),
    status: moderationCase.status as ModerationCaseStatus,
    openedBy: moderationCase.openedBy as "report" | "operator",
    openedByAdminUserId: moderationCase.openedByAdminUserId,
    openingReason: moderationCase.openingReason,
    createdAt: iso(moderationCase.createdAt),
    updatedAt: iso(moderationCase.updatedAt),
    subject,
    reports: reportViews,
    signals: {
      windowDays: Math.round(SAFETY_SIGNAL_WINDOW_MS / (24 * 60 * 60_000)),
      reportsInWindow: Number(reportSignals?.reports ?? 0),
      independentReportersInWindow: Number(reportSignals?.reporters ?? 0),
      blockedByAccountsNow: blockersNow.size,
      independentBlockersInWindow: Number(blockSignals?.blockers ?? 0),
      otherCases: otherCases.map((row) => ({
        caseId: row.caseId,
        reference: moderationCaseReference(row.caseNumber),
        status: row.status as ModerationCaseStatus,
        createdAt: iso(row.createdAt),
        reportCount: Number(row.reportCount),
      })),
    },
    nameHistory,
    notes: notes.map((note) => ({
      noteId: note.id,
      adminUserId: note.adminUserId,
      body: note.body,
      createdAt: iso(note.createdAt),
    })),
    sanctions: sanctions.map((sanction) =>
      sanctionView(
        sanction,
        appeals.find((appeal) => appeal.sanctionId === sanction.id),
        now,
      ),
    ),
    audit: audit.map((row) => ({
      id: row.id,
      adminUserId: row.adminUserId,
      operation: row.operation,
      details: row.details as Record<string, unknown>,
      createdAt: iso(row.createdAt),
    })),
  };
}

async function requireCaseReport(tx: Tx, caseId: string, reportId: string) {
  const [report] = await tx
    .select()
    .from(playerReports)
    .where(and(eq(playerReports.id, reportId), eq(playerReports.caseId, caseId)))
    .limit(1);
  if (!report) throw new ModerationCommandError("That report is not part of this case.", 404);
  return report;
}

function incidentWindow(anchor: Date) {
  const half = RETAINED_CHAT_WINDOW_MS / 2;
  return { from: new Date(anchor.getTime() - half), to: new Date(anchor.getTime() + half) };
}

function retainedView(
  kind: RetainedChatView["kind"],
  window: { from: Date; to: Date },
  rows: (typeof chatMessages.$inferSelect)[],
): RetainedChatView {
  const truncated = rows.length > RETAINED_CHAT_MAX_MESSAGES;
  return {
    kind,
    from: iso(window.from),
    to: iso(window.to),
    truncated,
    messages: rows.slice(0, RETAINED_CHAT_MAX_MESSAGES).map((row) => ({
      id: row.id,
      channel: row.channel,
      conversationId: row.conversationId,
      senderPlayerAccountId: row.senderPlayerAccountId,
      senderCharacterId: row.senderCharacterId,
      senderCharacterName: row.senderCharacterName,
      body: row.body,
      promoted: row.promotedPriceCredits !== null,
      sentAt: iso(row.createdAt),
    })),
  };
}

/**
 * The case subject's own retained General/Trade messages around one report's
 * incident. Bounded by the incident window and a message cap; ordinary
 * retention has already removed anything older than 90 days.
 */
export async function readRetainedPublicChatAs(
  tx: Tx,
  adminUserId: string,
  caseId: string,
  reportId: string,
): Promise<RetainedChatView> {
  const moderationCase = await requireCase(tx, caseId);
  const report = await requireCaseReport(tx, caseId, reportId);
  const window = incidentWindow(report.createdAt);
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "retained_public_chat",
    caseId,
    targetPlayerAccountId: moderationCase.subjectPlayerAccountId,
    context: { reportId, from: iso(window.from), to: iso(window.to) },
  });
  const rows = await tx
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.senderPlayerAccountId, moderationCase.subjectPlayerAccountId),
        inArray(chatMessages.channel, ["general", "trade"]),
        gte(chatMessages.createdAt, window.from),
        lte(chatMessages.createdAt, window.to),
      ),
    )
    .orderBy(asc(chatMessages.seq))
    .limit(RETAINED_CHAT_MAX_MESSAGES + 1);
  return retainedView("public", window, rows);
}

/**
 * Retained Whispers around one report's incident — only those between the
 * report's two accounts (the reporter and the case subject), never any other
 * conversation of either. This is the only operator path to Whisper content
 * beyond a report's preserved evidence, and it needs a report on a case.
 */
export async function readRetainedWhispersAs(
  tx: Tx,
  adminUserId: string,
  caseId: string,
  reportId: string,
): Promise<RetainedChatView> {
  const moderationCase = await requireCase(tx, caseId);
  const report = await requireCaseReport(tx, caseId, reportId);
  const window = incidentWindow(report.createdAt);
  const reporterSide = tx
    .select({ conversationId: whisperParticipants.conversationId })
    .from(whisperParticipants)
    .where(eq(whisperParticipants.playerAccountId, report.reporterPlayerAccountId));
  const conversations = (
    await tx
      .selectDistinct({ id: whisperParticipants.conversationId })
      .from(whisperParticipants)
      .where(
        and(
          eq(whisperParticipants.playerAccountId, moderationCase.subjectPlayerAccountId),
          inArray(whisperParticipants.conversationId, reporterSide),
        ),
      )
  ).map((row) => row.id);
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "retained_whispers",
    caseId,
    targetPlayerAccountId: moderationCase.subjectPlayerAccountId,
    context: {
      reportId,
      reporterPlayerAccountId: report.reporterPlayerAccountId,
      conversationIds: conversations,
      from: iso(window.from),
      to: iso(window.to),
    },
  });
  if (conversations.length === 0) return retainedView("whispers", window, []);
  const rows = await tx
    .select()
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.conversationId, conversations),
        gte(chatMessages.createdAt, window.from),
        lte(chatMessages.createdAt, window.to),
      ),
    )
    .orderBy(asc(chatMessages.seq))
    .limit(RETAINED_CHAT_MAX_MESSAGES + 1);
  return retainedView("whispers", window, rows);
}

export type AccountModerationHistory = {
  playerAccountId: string;
  cases: {
    caseId: string;
    reference: string;
    status: ModerationCaseStatus;
    createdAt: string;
    reportCount: number;
  }[];
  activeCaseId: string | null;
};

/** The inspected character's account: its moderation cases, for the inspector. */
export async function readAccountModerationHistoryAs(
  tx: Tx,
  adminUserId: string,
  characterId: string,
): Promise<AccountModerationHistory> {
  const [character] = await tx
    .select({ playerAccountId: characters.playerAccountId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!character) throw new ModerationCommandError("Character not found.", 404);
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "account_moderation_history",
    targetPlayerAccountId: character.playerAccountId,
    targetCharacterId: characterId,
    context: {},
  });
  const rows = await tx
    .select({
      caseId: moderationCases.id,
      caseNumber: moderationCases.caseNumber,
      status: moderationCases.status,
      createdAt: moderationCases.createdAt,
      reportCount: caseReportCount,
    })
    .from(moderationCases)
    .where(eq(moderationCases.subjectPlayerAccountId, character.playerAccountId))
    .orderBy(desc(moderationCases.createdAt));
  const cases = rows.map((row) => ({
    caseId: row.caseId,
    reference: moderationCaseReference(row.caseNumber),
    status: row.status as ModerationCaseStatus,
    createdAt: iso(row.createdAt),
    reportCount: Number(row.reportCount),
  }));
  return {
    playerAccountId: character.playerAccountId,
    cases,
    activeCaseId:
      cases.find((row) => (ACTIVE_CASE_STATUSES as readonly string[]).includes(row.status))
        ?.caseId ?? null,
  };
}

/** The privileged access log itself; viewing it is audited too. */
export async function readPrivilegedAccessLogAs(
  tx: Tx,
  adminUserId: string,
  limit: number,
): Promise<PrivilegedAccessEntry[]> {
  await recordPrivilegedAccess(tx, {
    adminUserId,
    kind: "privileged_access_log",
    context: { limit },
  });
  const rows = await loadPrivilegedAccessLog(tx, limit);
  const caseIds = [...new Set(rows.flatMap((row) => (row.caseId ? [row.caseId] : [])))];
  const cases = caseIds.length
    ? await tx
        .select({ id: moderationCases.id, caseNumber: moderationCases.caseNumber })
        .from(moderationCases)
        .where(inArray(moderationCases.id, caseIds))
    : [];
  return rows.map((row) => {
    const moderationCase = cases.find((c) => c.id === row.caseId);
    return {
      id: row.id,
      adminUserId: row.adminUserId,
      kind: row.accessKind as PrivilegedAccessEntry["kind"],
      caseId: row.caseId,
      caseReference: moderationCase ? moderationCaseReference(moderationCase.caseNumber) : null,
      targetPlayerAccountId: row.targetPlayerAccountId,
      targetCharacterId: row.targetCharacterId,
      context: row.context as Record<string, unknown>,
      createdAt: iso(row.createdAt),
    };
  });
}

// ---------------------------------------------------------------------------
// Audited mutations
// ---------------------------------------------------------------------------

function unchanged(moderationCase: ModerationCase): ModerationMutation {
  return {
    changed: false,
    caseId: moderationCase.id,
    subjectPlayerAccountId: moderationCase.subjectPlayerAccountId,
    noticesChanged: false,
    gameplayAccessChanged: false,
  };
}

function noteText(text: string, what: string): string {
  const normalized = normalizeModerationText(text, CASE_NOTE_MAX_LENGTH);
  if (!normalized.ok) {
    throw new ModerationCommandError(
      normalized.reason === "empty"
        ? `${what} can't be empty.`
        : `${what} can be up to ${CASE_NOTE_MAX_LENGTH} characters.`,
    );
  }
  return normalized.text;
}

async function hasOtherActiveCase(tx: Tx, subjectId: string, exceptCaseId?: string) {
  const [row] = await tx
    .select({ id: moderationCases.id })
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.subjectPlayerAccountId, subjectId),
        inArray(moderationCases.status, [...ACTIVE_CASE_STATUSES]),
        exceptCaseId ? sql`${moderationCases.id} <> ${exceptCaseId}` : undefined,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Open a case on the inspected character's account for an investigation no
 * report started, with the operator's stated reason. If the account already
 * has an open or reviewed case, that case is returned unchanged.
 */
export async function openModerationCaseAs(
  tx: Tx,
  adminUserId: string,
  characterId: string,
  reason: string,
  now: Date,
): Promise<ModerationMutation> {
  const openingReason = noteText(reason, "The reason for opening a case");
  const [character] = await tx
    .select({ playerAccountId: characters.playerAccountId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!character) throw new ModerationCommandError("Character not found.", 404);
  const subjectId = character.playerAccountId;
  // Serialize with reports opening a case for the same account.
  await tx
    .select({ id: playerAccounts.id })
    .from(playerAccounts)
    .where(eq(playerAccounts.id, subjectId))
    .for("update");
  const existing = await hasOtherActiveCase(tx, subjectId);
  if (existing) return unchanged(await requireCase(tx, existing));
  const inserted = await tx
    .insert(moderationCases)
    .values({
      subjectPlayerAccountId: subjectId,
      status: "open",
      openedBy: "operator",
      openedByAdminUserId: adminUserId,
      openingReason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const created = inserted[0];
  if (!created) {
    const raced = await hasOtherActiveCase(tx, subjectId);
    if (!raced) throw new ModerationCommandError("The case could not be opened. Try again.", 409);
    return unchanged(await requireCase(tx, raced));
  }
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: subjectId },
    operation: "open_moderation_case",
    targetIdentity: moderationCaseReference(created.caseNumber),
    moderationCaseId: created.id,
    details: { reason: openingReason, fromCharacterId: characterId },
  });
  return {
    changed: true,
    caseId: created.id,
    subjectPlayerAccountId: subjectId,
    noticesChanged: false,
    gameplayAccessChanged: false,
  };
}

/** Move a case to another status. The same status is a no-op. */
export async function setModerationCaseStatusAs(
  tx: Tx,
  adminUserId: string,
  caseId: string,
  status: ModerationCaseStatus,
  now: Date,
): Promise<ModerationMutation> {
  const moderationCase = await requireCase(tx, caseId, true);
  if (moderationCase.status === status) return unchanged(moderationCase);
  if (
    (ACTIVE_CASE_STATUSES as readonly string[]).includes(status) &&
    (await hasOtherActiveCase(tx, moderationCase.subjectPlayerAccountId, caseId))
  ) {
    throw new ModerationCommandError(
      "This account already has another open or reviewed case. Close that one first.",
      409,
    );
  }
  await tx
    .update(moderationCases)
    .set({ status, updatedAt: now })
    .where(eq(moderationCases.id, caseId));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: moderationCase.subjectPlayerAccountId },
    operation: "set_moderation_case_status",
    targetIdentity: moderationCaseReference(moderationCase.caseNumber),
    moderationCaseId: caseId,
    details: { from: moderationCase.status, to: status },
  });
  return { ...unchanged(moderationCase), changed: true };
}

/** Append one internal operator note to a case. */
export async function addModerationCaseNoteAs(
  tx: Tx,
  adminUserId: string,
  caseId: string,
  body: string,
  now: Date,
): Promise<ModerationMutation> {
  const text = noteText(body, "A note");
  const moderationCase = await requireCase(tx, caseId, true);
  const [note] = await tx
    .insert(moderationCaseNotes)
    .values({ caseId, adminUserId, body: text, createdAt: now })
    .returning({ id: moderationCaseNotes.id });
  await tx.update(moderationCases).set({ updatedAt: now }).where(eq(moderationCases.id, caseId));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: moderationCase.subjectPlayerAccountId },
    operation: "add_moderation_case_note",
    targetIdentity: moderationCaseReference(moderationCase.caseNumber),
    moderationCaseId: caseId,
    details: { noteId: note!.id },
  });
  return { ...unchanged(moderationCase), changed: true };
}

/**
 * Issue a warning, social restriction, or suspension on the case's subject
 * account, and mark the case Actioned. Takes the subject's chat send lock so a
 * send already in flight commits before the restriction and none after it.
 * A second in-effect sanction of the same kind on one case is refused: change
 * the existing one's duration instead.
 */
export async function issueSanctionAs(
  tx: Tx,
  adminUserId: string,
  request: {
    caseId: string;
    kind: SanctionKind;
    ruleCategory: ModerationRuleCategory;
    duration: SanctionDuration | null;
  },
  now: Date,
): Promise<ModerationMutation & { sanctionId: string }> {
  if ((request.kind === "warning") !== (request.duration === null)) {
    throw new ModerationCommandError("A warning has no duration; other sanctions need one.");
  }
  const moderationCase = await requireCase(tx, request.caseId, true);
  const subjectId = moderationCase.subjectPlayerAccountId;
  await lockAccountChatSends(tx, subjectId);
  if (request.kind !== "warning") {
    const sameKind = await tx
      .select()
      .from(moderationSanctions)
      .where(
        and(
          eq(moderationSanctions.caseId, request.caseId),
          eq(moderationSanctions.kind, request.kind),
          isNull(moderationSanctions.reversedAt),
        ),
      );
    if (
      sameKind.some(
        (row) =>
          sanctionState(
            { kind: request.kind, startsAt: row.startsAt, endsAt: row.endsAt, reversedAt: null },
            now,
          ) === "in_effect",
      )
    ) {
      throw new ModerationCommandError(
        "This case already has one in effect. Change its duration instead.",
        409,
      );
    }
  }
  const endsAt = sanctionEndsAt(request.kind, now, request.duration);
  const [sanction] = await tx
    .insert(moderationSanctions)
    .values({
      caseId: request.caseId,
      playerAccountId: subjectId,
      kind: request.kind,
      ruleCategory: request.ruleCategory,
      duration: request.duration,
      startsAt: now,
      endsAt,
      issuedByAdminUserId: adminUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: moderationSanctions.id });
  await tx
    .update(moderationCases)
    .set({ status: "actioned", updatedAt: now })
    .where(eq(moderationCases.id, request.caseId));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: subjectId },
    operation: "issue_moderation_sanction",
    targetIdentity: sanction!.id,
    moderationCaseId: request.caseId,
    details: {
      reference: moderationCaseReference(moderationCase.caseNumber),
      kind: request.kind,
      ruleCategory: request.ruleCategory,
      duration: request.duration,
      endsAt: endsAt ? iso(endsAt) : null,
      caseStatus: { from: moderationCase.status, to: "actioned" },
    },
  });
  return {
    changed: true,
    caseId: request.caseId,
    subjectPlayerAccountId: subjectId,
    noticesChanged: true,
    gameplayAccessChanged: request.kind === "suspension",
    sanctionId: sanction!.id,
  };
}

async function requireSanction(tx: Tx, sanctionId: string): Promise<ModerationSanction> {
  const [row] = await tx
    .select()
    .from(moderationSanctions)
    .where(eq(moderationSanctions.id, sanctionId))
    .limit(1)
    .for("update");
  if (!row) throw new ModerationCommandError("Sanction not found.", 404);
  return row;
}

async function changeDuration(
  tx: Tx,
  adminUserId: string,
  sanction: ModerationSanction,
  duration: SanctionDuration,
  now: Date,
  via: { appealId: string } | null,
): Promise<boolean> {
  if (sanction.kind === "warning") {
    throw new ModerationCommandError("A warning has no duration to change.");
  }
  if (sanction.reversedAt) throw new ModerationCommandError("That sanction was reversed.", 409);
  if (sanction.duration === duration) return false;
  const endsAt = sanctionEndsAt(sanction.kind as SanctionKind, sanction.startsAt, duration);
  await lockAccountChatSends(tx, sanction.playerAccountId);
  await tx
    .update(moderationSanctions)
    .set({ duration, endsAt, updatedAt: now })
    .where(eq(moderationSanctions.id, sanction.id));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: sanction.playerAccountId },
    operation: "change_moderation_sanction_duration",
    targetIdentity: sanction.id,
    moderationCaseId: sanction.caseId,
    details: {
      kind: sanction.kind,
      duration: { from: sanction.duration, to: duration },
      endsAt: {
        from: sanction.endsAt ? iso(sanction.endsAt) : null,
        to: endsAt ? iso(endsAt) : null,
      },
      ...(via ? { appealId: via.appealId } : {}),
    },
  });
  return true;
}

async function reverse(
  tx: Tx,
  adminUserId: string,
  sanction: ModerationSanction,
  now: Date,
  via: { appealId: string } | null,
): Promise<boolean> {
  if (sanction.reversedAt) return false;
  await tx
    .update(moderationSanctions)
    .set({ reversedAt: now, reversedByAdminUserId: adminUserId, updatedAt: now })
    .where(eq(moderationSanctions.id, sanction.id));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: sanction.playerAccountId },
    operation: "reverse_moderation_sanction",
    targetIdentity: sanction.id,
    moderationCaseId: sanction.caseId,
    details: {
      kind: sanction.kind,
      ruleCategory: sanction.ruleCategory,
      ...(via ? { appealId: via.appealId } : {}),
    },
  });
  return true;
}

function sanctionMutation(sanction: ModerationSanction, changed: boolean): ModerationMutation {
  return {
    changed,
    caseId: sanction.caseId,
    subjectPlayerAccountId: sanction.playerAccountId,
    noticesChanged: changed,
    gameplayAccessChanged: changed && sanction.kind === "suspension",
  };
}

/** Change a restriction's or suspension's duration, measured from when it was issued. */
export async function changeSanctionDurationAs(
  tx: Tx,
  adminUserId: string,
  sanctionId: string,
  duration: SanctionDuration,
  now: Date,
): Promise<ModerationMutation> {
  const sanction = await requireSanction(tx, sanctionId);
  const changed = await changeDuration(tx, adminUserId, sanction, duration, now, null);
  return sanctionMutation(sanction, changed);
}

/** Reverse a sanction: it stops applying at once. Already reversed is a no-op. */
export async function reverseSanctionAs(
  tx: Tx,
  adminUserId: string,
  sanctionId: string,
  now: Date,
): Promise<ModerationMutation> {
  const sanction = await requireSanction(tx, sanctionId);
  const changed = await reverse(tx, adminUserId, sanction, now, null);
  return sanctionMutation(sanction, changed);
}

/**
 * Decide a pending appeal: Uphold (no change), Modify (a new duration), or
 * Reverse. The decision and any resulting sanction change commit and are
 * audited together. A decided appeal cannot be decided again.
 */
export async function decideAppealAs(
  tx: Tx,
  adminUserId: string,
  request: {
    appealId: string;
    outcome: AppealOutcome;
    duration: SanctionDuration | null;
    note?: string;
  },
  now: Date,
): Promise<ModerationMutation> {
  if ((request.outcome === "modified") !== (request.duration !== null)) {
    throw new ModerationCommandError("Modify needs a new duration; Uphold and Reverse take none.");
  }
  const note =
    request.note && request.note.trim().length > 0
      ? noteText(request.note, "A decision note")
      : null;
  const [appeal] = await tx
    .select()
    .from(moderationAppeals)
    .where(eq(moderationAppeals.id, request.appealId))
    .limit(1)
    .for("update");
  if (!appeal) throw new ModerationCommandError("Appeal not found.", 404);
  if (appeal.outcome !== null) {
    throw new ModerationCommandError("That appeal has already been decided.", 409);
  }
  const sanction = await requireSanction(tx, appeal.sanctionId);
  const via = { appealId: appeal.id };
  if (request.outcome === "modified") {
    const changed = await changeDuration(tx, adminUserId, sanction, request.duration!, now, via);
    if (!changed) {
      throw new ModerationCommandError(
        "That is already the sanction's duration. Uphold it instead.",
      );
    }
  } else if (request.outcome === "reversed") {
    await reverse(tx, adminUserId, sanction, now, via);
  }
  await tx
    .update(moderationAppeals)
    .set({
      outcome: request.outcome,
      decidedAt: now,
      decidedByAdminUserId: adminUserId,
      decisionNote: note,
    })
    .where(eq(moderationAppeals.id, appeal.id));
  await tx
    .update(moderationCases)
    .set({ updatedAt: now })
    .where(eq(moderationCases.id, appeal.caseId));
  await recordOperatorAudit(tx, {
    adminUserId,
    target: { kind: "player_account", playerAccountId: sanction.playerAccountId },
    operation: "decide_moderation_appeal",
    targetIdentity: appeal.id,
    moderationCaseId: appeal.caseId,
    details: {
      sanctionId: sanction.id,
      outcome: request.outcome,
      ...(request.duration ? { duration: request.duration } : {}),
      hasNote: note !== null,
    },
  });
  return {
    changed: true,
    caseId: appeal.caseId,
    subjectPlayerAccountId: sanction.playerAccountId,
    noticesChanged: true,
    gameplayAccessChanged: sanction.kind === "suspension" && request.outcome !== "upheld",
  };
}
