import { randomUUID } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessageView, ChatSendResult } from "@/game/schemas/chat";
import type { WhisperMessageView, WhisperSendResult } from "@/game/schemas/whispers";
import type { RealtimeEnvelope } from "@/game/schemas/realtime";
import type { ModerationCaseView } from "@/game/schemas/moderation";
import type {
  ModerationCaseStatus,
  ModerationRuleCategory,
  SanctionDuration,
  SanctionKind,
} from "@/game/domain/moderation";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  withPublicGameplayClosed,
} from "./fixtures";

/**
 * The production moderation surface authenticates through the real Better Auth
 * session and the real admin allowlist. The allowlist is parsed when
 * `server/env.ts` first loads, so the fixed test operator is put on it before
 * any module import runs.
 */
const { OPERATOR_ID } = vi.hoisted(() => {
  const id = "00000000-0000-0000-0000-0000000000a1";
  const existing = process.env.RUNESPACE_ADMIN_USER_IDS ?? "";
  process.env.RUNESPACE_ADMIN_USER_IDS = existing ? `${existing},${id}` : id;
  return { OPERATOR_ID: id };
});

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The operator id the seams act as; the seams take it explicitly. */
const ADMIN = "00000000-0000-4000-8000-000000000248";
/** A second operator, so a test can tell whose action a row records. */
const ADMIN_TWO = "00000000-0000-4000-8000-000000000249";

function whispered(result: WhisperSendResult): WhisperMessageView {
  if (result.status !== "sent") throw new Error(`expected a Whisper, got ${result.reason}`);
  return result.message;
}

function posted(result: ChatSendResult): ChatMessageView {
  if (result.status !== "sent") throw new Error(`expected a send, got ${result.reason}`);
  return result.message;
}

/**
 * Issue #248 acceptance against real PostgreSQL: privileged reads and
 * moderation actions are authorized and audited; reports become reviewable
 * cases; sanctions apply account-wide and expire deterministically; a
 * sanctioned player can be told and can appeal; nothing about a reporter or a
 * moderator reaches the reported player.
 */
suite("issue #248 moderation review, sanctions, and appeals (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let chat: typeof import("@/server/chat");
  let whispers: typeof import("@/server/whispers");
  let blocks: typeof import("@/server/player-blocks");
  let reports: typeof import("@/server/player-reports");
  let access: typeof import("@/server/gameplay-access");
  let seams: typeof import("@/server/moderation-seams");
  let commands: typeof import("@/server/moderation-commands");
  let sanctions: typeof import("@/server/moderation-sanctions");
  let notices: typeof import("@/server/moderation-notices");
  let audit: typeof import("@/server/admin-audit");
  let play: typeof import("@/server/play");
  let mining: typeof import("@/server/mining-commands");
  let realtime: typeof import("@/server/realtime");
  let adminSession: typeof import("@/tests/e2e/admin-session");
  let operatorHeaders: Headers;
  let ordinaryHeaders: Headers;
  const anonymousHeaders = new Headers({ host: "127.0.0.1:3000" });
  const createdUsers: string[] = [];

  type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
  const inTx = <T>(run: (tx: Tx) => Promise<T>): Promise<T> => db.transaction(run);

  async function signIn(credentials: { email: string; password: string }): Promise<Headers> {
    const { auth } = await import("@/server/auth");
    const result = await auth.api.signInEmail({
      headers: new Headers({ host: "127.0.0.1:3000" }),
      body: credentials,
      returnHeaders: true,
    });
    const sessionCookie = [
      ...parseSetCookieHeader(result.headers.get("set-cookie") ?? "").entries(),
    ].find(([name, value]) => name.endsWith("session_token") && value.value);
    expect(sessionCookie).toBeDefined();
    return new Headers({
      host: "127.0.0.1:3000",
      cookie: `${sessionCookie![0]}=${sessionCookie![1].value}`,
    });
  }

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    chat = await import("@/server/chat");
    whispers = await import("@/server/whispers");
    blocks = await import("@/server/player-blocks");
    reports = await import("@/server/player-reports");
    access = await import("@/server/gameplay-access");
    seams = await import("@/server/moderation-seams");
    commands = await import("@/server/moderation-commands");
    sanctions = await import("@/server/moderation-sanctions");
    notices = await import("@/server/moderation-notices");
    audit = await import("@/server/admin-audit");
    play = await import("@/server/play");
    mining = await import("@/server/mining-commands");
    realtime = await import("@/server/realtime");
    adminSession = await import("@/tests/e2e/admin-session");
    expect(adminSession.ADMIN_USER_ID).toBe(OPERATOR_ID);
    operatorHeaders = await signIn(await adminSession.seedAdminOperator());
    ordinaryHeaders = await signIn(await adminSession.seedNonAdminUser());
  }, 60_000);

  /** Residual privileged-access rows name no case or account; they are ours to remove. */
  async function removeResidualAccessRows() {
    await db
      .delete(rune.privilegedAccessLogs)
      .where(inArray(rune.privilegedAccessLogs.adminUserId, [ADMIN, ADMIN_TWO, OPERATOR_ID]));
  }

  afterEach(async () => {
    for (const userId of createdUsers.splice(0)) {
      await cleanupTestUser(db, authSchema, rune, userId);
    }
    await removeResidualAccessRows();
  });

  afterAll(async () => {
    await removeResidualAccessRows();
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  async function player() {
    const userId = await createTestUser(db, authSchema, `mod-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Mod${token()}`,
    );
    return { userId, character, accountId: character.playerAccountId };
  }
  type Player = Awaited<ReturnType<typeof player>>;

  async function altOf(userId: string) {
    return createCharacterForUser(db, rune, ownership, characters, userId, `Alt${token()}`);
  }

  const reportPlayer = (
    reporter: Player,
    subject: Player,
    reason: "other" | "threats" | "spam_scam" | "harassment_hate" = "other",
    options: { now?: Date; note?: string; alsoBlock?: boolean } = {},
  ) =>
    reports.reportPlayer(
      reporter.userId,
      reporter.character.id,
      {
        target: { characterId: subject.character.id },
        reason,
        note: options.note,
        alsoBlock: options.alsoBlock,
      },
      { now: options.now },
    );

  async function newestCase(accountId: string) {
    const [row] = await db
      .select()
      .from(rune.moderationCases)
      .where(eq(rune.moderationCases.subjectPlayerAccountId, accountId))
      .orderBy(desc(rune.moderationCases.caseNumber))
      .limit(1);
    if (!row) throw new Error("expected a moderation case");
    return row;
  }

  const casesOf = (accountId: string) =>
    db
      .select()
      .from(rune.moderationCases)
      .where(eq(rune.moderationCases.subjectPlayerAccountId, accountId))
      .orderBy(asc(rune.moderationCases.caseNumber));

  const reportsOf = (caseId: string) =>
    db
      .select()
      .from(rune.playerReports)
      .where(eq(rune.playerReports.caseId, caseId))
      .orderBy(asc(rune.playerReports.createdAt), asc(rune.playerReports.id));

  /** A subject with one report against it, and its case. */
  async function reportedSubject() {
    const subject = await player();
    const reporter = await player();
    await reportPlayer(reporter, subject);
    return { subject, reporter, moderationCase: await newestCase(subject.accountId) };
  }

  async function sendWhisper(from: Player, toCharacterId: string, text: string, now: Date) {
    return whispered(
      await whispers.sendWhisper(
        from.userId,
        from.character.id,
        { recipientCharacterId: toCharacterId, text },
        { now },
      ),
    );
  }

  const issue = (
    caseId: string,
    kind: SanctionKind,
    duration: SanctionDuration | null,
    now: Date = new Date(),
    ruleCategory: ModerationRuleCategory = "harassment",
    actor: string = ADMIN,
  ) =>
    inTx((tx) => seams.issueSanctionAs(tx, actor, { caseId, kind, ruleCategory, duration }, now));

  const setStatus = (caseId: string, status: ModerationCaseStatus, now: Date = new Date()) =>
    inTx((tx) => seams.setModerationCaseStatusAs(tx, ADMIN, caseId, status, now));

  const readCase = (caseId: string, now: Date = new Date()): Promise<ModerationCaseView> =>
    inTx((tx) => seams.readModerationCaseAs(tx, ADMIN, caseId, now));

  const changeDuration = (sanctionId: string, duration: SanctionDuration, now = new Date()) =>
    inTx((tx) => seams.changeSanctionDurationAs(tx, ADMIN, sanctionId, duration, now));

  const reverse = (sanctionId: string, now = new Date()) =>
    inTx((tx) => seams.reverseSanctionAs(tx, ADMIN, sanctionId, now));

  const decide = (
    appealId: string,
    outcome: "upheld" | "modified" | "reversed",
    duration: SanctionDuration | null = null,
    now = new Date(),
    note?: string,
  ) => inTx((tx) => seams.decideAppealAs(tx, ADMIN, { appealId, outcome, duration, note }, now));

  const caseAudit = (caseId: string) =>
    db
      .select()
      .from(rune.operatorAuditLogs)
      .where(eq(rune.operatorAuditLogs.moderationCaseId, caseId));

  const accessRowsFor = (adminUserId: string) =>
    db
      .select()
      .from(rune.privilegedAccessLogs)
      .where(eq(rune.privilegedAccessLogs.adminUserId, adminUserId));

  /** The operator-audit rows one call adds to a case. */
  async function auditDelta<T>(caseId: string, run: () => Promise<T>) {
    const before = new Set((await caseAudit(caseId)).map((row) => row.id));
    const result = await run();
    const rows = (await caseAudit(caseId)).filter((row) => !before.has(row.id));
    return { result, rows };
  }

  /** The privileged-access rows one call writes for `adminUserId`. */
  async function accessDelta<T>(adminUserId: string, run: () => Promise<T>) {
    const before = new Set((await accessRowsFor(adminUserId)).map((row) => row.id));
    const result = await run();
    const rows = (await accessRowsFor(adminUserId)).filter((row) => !before.has(row.id));
    return { result, rows };
  }

  const moderationError = (status: number) =>
    expect.objectContaining({ name: "ModerationCommandError", status });

  /** Every delivery each observed scope receives while `run` executes. */
  async function observe<T>(
    scopes: { playerAccountId: string; characterId: string }[],
    run: () => Promise<T>,
  ) {
    const fanout = realtime.getRealtimeFanout();
    const received = new Map<string, RealtimeEnvelope[]>();
    const closed = new Map<string, string[]>();
    const unsubscribes = scopes.map((scope) => {
      received.set(scope.characterId, []);
      closed.set(scope.characterId, []);
      return fanout.subscribe({
        scope,
        deliver: (envelope) => received.get(scope.characterId)!.push(envelope),
        close: (reason) => closed.get(scope.characterId)!.push(reason),
      });
    });
    try {
      return { result: await run(), received, closed };
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  }

  const scopeOf = (character: { id: string; playerAccountId: string }) => ({
    playerAccountId: character.playerAccountId,
    characterId: character.id,
  });

  // -------------------------------------------------------------------------
  // Authorization and the privileged-access audit
  // -------------------------------------------------------------------------

  describe("authorization and audit", () => {
    it("refuses an ordinary player's session and an anonymous caller everything, with no data and no rows", async () => {
      const { subject, reporter, moderationCase } = await reportedSubject();
      const [report] = await reportsOf(moderationCase.id);
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "7d");
      await sendWhisper(reporter, subject.character.id, "hello", new Date());
      const appeal = await notices.submitAppeal(subject.userId, {
        sanctionId,
        body: "please review this",
      });
      expect(appeal).toMatchObject({ status: "submitted" });
      const [appealRow] = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.sanctionId, sanctionId));

      const attempts = (headers: Headers) => ({
        loadModerationQueue: () => commands.loadModerationQueue(headers, "active"),
        loadModerationCase: () => commands.loadModerationCase(headers, moderationCase.id),
        loadRetainedPublicChat: () =>
          commands.loadRetainedPublicChat(headers, moderationCase.id, report!.id),
        loadRetainedWhispers: () =>
          commands.loadRetainedWhispers(headers, moderationCase.id, report!.id),
        loadAccountModerationHistory: () =>
          commands.loadAccountModerationHistory(headers, subject.character.id),
        loadPrivilegedAccessLogView: () => commands.loadPrivilegedAccessLogView(headers, 50),
        openModerationCase: () =>
          commands.openModerationCase(headers, reporter.character.id, "sneaky"),
        setModerationCaseStatus: () =>
          commands.setModerationCaseStatus(headers, moderationCase.id, "dismissed"),
        addModerationCaseNote: () =>
          commands.addModerationCaseNote(headers, moderationCase.id, "a note"),
        issueSanction: () =>
          commands.issueSanction(headers, {
            caseId: moderationCase.id,
            kind: "suspension",
            ruleCategory: "harassment",
            duration: "permanent",
          }),
        changeSanctionDuration: () => commands.changeSanctionDuration(headers, sanctionId, "24h"),
        reverseSanction: () => commands.reverseSanction(headers, sanctionId),
        decideAppeal: () =>
          commands.decideAppeal(headers, {
            appealId: appealRow!.id,
            outcome: "reversed",
            duration: null,
          }),
      });

      const auditBefore = await caseAudit(moderationCase.id);
      for (const [label, headers, status, name] of [
        ["ordinary player", ordinaryHeaders, 403, "AdminError"],
        ["anonymous", anonymousHeaders, 401, "OwnershipError"],
      ] as const) {
        for (const [command, attempt] of Object.entries(attempts(headers))) {
          await expect(attempt(), `${label}: ${command}`).rejects.toMatchObject({ name, status });
        }
      }

      // No privileged-access row for the case, its subject, or the refused caller.
      const accessed = await db
        .select()
        .from(rune.privilegedAccessLogs)
        .where(
          sql`${rune.privilegedAccessLogs.caseId} = ${moderationCase.id}
            or ${rune.privilegedAccessLogs.targetPlayerAccountId} = ${subject.accountId}
            or ${rune.privilegedAccessLogs.adminUserId} = ${adminSession.NON_ADMIN_USER_ID}`,
        );
      expect(accessed).toEqual([]);
      // Nothing changed: same audit history, case, sanction, appeal, and notes.
      expect(await caseAudit(moderationCase.id)).toHaveLength(auditBefore.length);
      expect((await casesOf(subject.accountId)).map((row) => row.status)).toEqual(["actioned"]);
      const [sanction] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(sanction).toMatchObject({ duration: "7d", reversedAt: null });
      const [appealAfter] = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.id, appealRow!.id));
      expect(appealAfter!.outcome).toBeNull();
      expect(
        await db
          .select()
          .from(rune.moderationCaseNotes)
          .where(eq(rune.moderationCaseNotes.caseId, moderationCase.id)),
      ).toEqual([]);
    });

    it("audits every sensitive read exactly once, with the server-derived operator, before returning data", async () => {
      const subject = await player();
      const reporter = await player();
      const start = Date.now() - 30 * 60_000;
      const publicLine = posted(
        await chat.sendChatMessage(
          subject.userId,
          subject.character.id,
          { channel: "general", text: "public line" },
          { now: new Date(start) },
        ),
      );
      const whisper = await sendWhisper(
        subject,
        reporter.character.id,
        "private line",
        new Date(start + 11_000),
      );
      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: whisper.id,
          reason: "harassment_hate",
        }),
      ).toMatchObject({ status: "reported" });
      const moderationCase = await newestCase(subject.accountId);
      const [report] = await reportsOf(moderationCase.id);
      const [conversation] = await db
        .select()
        .from(rune.whisperParticipants)
        .where(eq(rune.whisperParticipants.characterId, subject.character.id));
      const reference = `MOD-${String(moderationCase.caseNumber).padStart(5, "0")}`;

      // Queue: no case, no target.
      const queue = await accessDelta(OPERATOR_ID, () =>
        commands.loadModerationQueue(operatorHeaders, "active"),
      );
      expect(queue.rows).toHaveLength(1);
      expect(queue.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "case_queue",
        caseId: null,
        targetPlayerAccountId: null,
        targetCharacterId: null,
        context: { filter: "active" },
      });
      expect(queue.result.entries.map((entry) => entry.caseId)).toContain(moderationCase.id);

      // Case detail.
      const detail = await accessDelta(OPERATOR_ID, () =>
        commands.loadModerationCase(operatorHeaders, moderationCase.id),
      );
      expect(detail.rows).toHaveLength(1);
      expect(detail.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "case_detail",
        caseId: moderationCase.id,
        targetPlayerAccountId: subject.accountId,
        targetCharacterId: null,
        context: { reference },
      });
      expect(detail.result.reference).toBe(reference);

      // Retained public chat.
      const publicChat = await accessDelta(OPERATOR_ID, () =>
        commands.loadRetainedPublicChat(operatorHeaders, moderationCase.id, report!.id),
      );
      expect(publicChat.rows).toHaveLength(1);
      expect(publicChat.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "retained_public_chat",
        caseId: moderationCase.id,
        targetPlayerAccountId: subject.accountId,
        context: { reportId: report!.id, from: publicChat.result.from, to: publicChat.result.to },
      });
      expect(publicChat.result.messages.map((message) => message.id)).toEqual([publicLine.id]);

      // Retained Whispers name the conversations they opened.
      const whisperRead = await accessDelta(OPERATOR_ID, () =>
        commands.loadRetainedWhispers(operatorHeaders, moderationCase.id, report!.id),
      );
      expect(whisperRead.rows).toHaveLength(1);
      expect(whisperRead.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "retained_whispers",
        caseId: moderationCase.id,
        targetPlayerAccountId: subject.accountId,
        context: {
          reportId: report!.id,
          reporterPlayerAccountId: reporter.accountId,
          conversationIds: [conversation!.conversationId],
          from: whisperRead.result.from,
          to: whisperRead.result.to,
        },
      });
      expect(whisperRead.result.messages.map((message) => message.id)).toEqual([whisper.id]);

      // An inspected account's moderation history.
      const history = await accessDelta(OPERATOR_ID, () =>
        commands.loadAccountModerationHistory(operatorHeaders, subject.character.id),
      );
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "account_moderation_history",
        caseId: null,
        targetPlayerAccountId: subject.accountId,
        targetCharacterId: subject.character.id,
        context: {},
      });
      expect(history.result).toMatchObject({
        playerAccountId: subject.accountId,
        activeCaseId: moderationCase.id,
        cases: [{ caseId: moderationCase.id, status: "open" }],
      });

      // The access log itself: viewing it is audited, and the row is in the view.
      const log = await accessDelta(OPERATOR_ID, () =>
        commands.loadPrivilegedAccessLogView(operatorHeaders, 20),
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({
        adminUserId: OPERATOR_ID,
        accessKind: "privileged_access_log",
        caseId: null,
        context: { limit: 20 },
      });
      expect(log.result.map((entry) => entry.id)).toContain(log.rows[0]!.id);
      const detailEntry = log.result.find((entry) => entry.id === detail.rows[0]!.id);
      expect(detailEntry).toMatchObject({
        adminUserId: OPERATOR_ID,
        kind: "case_detail",
        caseId: moderationCase.id,
        caseReference: reference,
        targetPlayerAccountId: subject.accountId,
      });
    });

    it("writes no row and returns nothing when the case, report, or character does not exist", async () => {
      const { moderationCase } = await reportedSubject();
      const other = await reportedSubject();
      const [otherReport] = await reportsOf(other.moderationCase.id);
      const unknown = randomUUID();
      const before = (await accessRowsFor(ADMIN_TWO)).length;

      await expect(
        inTx((tx) => seams.readModerationCaseAs(tx, ADMIN_TWO, unknown, new Date())),
      ).rejects.toMatchObject(moderationError(404));
      await expect(
        inTx((tx) => seams.readRetainedPublicChatAs(tx, ADMIN_TWO, unknown, unknown)),
      ).rejects.toMatchObject(moderationError(404));
      await expect(
        inTx((tx) => seams.readRetainedWhispersAs(tx, ADMIN_TWO, unknown, unknown)),
      ).rejects.toMatchObject(moderationError(404));
      // A real report of a different case is not this case's report.
      await expect(
        inTx((tx) =>
          seams.readRetainedPublicChatAs(tx, ADMIN_TWO, moderationCase.id, otherReport!.id),
        ),
      ).rejects.toMatchObject(moderationError(404));
      await expect(
        inTx((tx) =>
          seams.readRetainedWhispersAs(tx, ADMIN_TWO, moderationCase.id, otherReport!.id),
        ),
      ).rejects.toMatchObject(moderationError(404));
      await expect(
        inTx((tx) => seams.readAccountModerationHistoryAs(tx, ADMIN_TWO, unknown)),
      ).rejects.toMatchObject(moderationError(404));
      // The production surface is no different for an authorized operator.
      const production = await accessDelta(OPERATOR_ID, async () => {
        await expect(commands.loadModerationCase(operatorHeaders, unknown)).rejects.toMatchObject(
          moderationError(404),
        );
      });
      expect(production.rows).toEqual([]);
      expect((await accessRowsFor(ADMIN_TWO)).length).toBe(before);
    });

    it("returns nothing when the audit row cannot be written", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const [report] = await reportsOf(moderationCase.id);
      // An operator id the database refuses (NOT NULL) makes the audit insert
      // itself fail, as any audit-store failure would.
      const noOperator = null as unknown as string;
      const reads: [string, () => Promise<unknown>][] = [
        ["queue", () => inTx((tx) => seams.readModerationQueueAs(tx, noOperator, "active"))],
        [
          "case",
          () =>
            inTx((tx) => seams.readModerationCaseAs(tx, noOperator, moderationCase.id, new Date())),
        ],
        [
          "public chat",
          () =>
            inTx((tx) =>
              seams.readRetainedPublicChatAs(tx, noOperator, moderationCase.id, report!.id),
            ),
        ],
        [
          "whispers",
          () =>
            inTx((tx) =>
              seams.readRetainedWhispersAs(tx, noOperator, moderationCase.id, report!.id),
            ),
        ],
        [
          "history",
          () =>
            inTx((tx) =>
              seams.readAccountModerationHistoryAs(tx, noOperator, subject.character.id),
            ),
        ],
        ["access log", () => inTx((tx) => seams.readPrivilegedAccessLogAs(tx, noOperator, 10))],
      ];
      for (const [label, read] of reads) {
        // The audit insert's own NOT NULL violation, not a later or earlier error.
        await expect(read(), label).rejects.toMatchObject({
          cause: expect.objectContaining({ code: "23502", table: "privileged_access_logs" }),
        });
      }
      expect(
        await db
          .select()
          .from(rune.privilegedAccessLogs)
          .where(eq(rune.privilegedAccessLogs.caseId, moderationCase.id)),
      ).toEqual([]);
      // An operator whose audit works reads normally.
      await expect(
        inTx((tx) => seams.readModerationCaseAs(tx, ADMIN, moderationCase.id, new Date())),
      ).resolves.toMatchObject({ caseId: moderationCase.id });
    });

    it("rolls a moderation change back when its operator-audit row cannot be written", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "7d");
      const appealResult = await notices.submitAppeal(subject.userId, {
        sanctionId,
        body: "review please",
      });
      expect(appealResult).toMatchObject({ status: "submitted" });
      const [appeal] = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.sanctionId, sanctionId));
      await setStatus(moderationCase.id, "reviewed");
      const fresh = await player();
      const freshCharacterId = fresh.character.id;
      const auditBefore = (await caseAudit(moderationCase.id)).length;

      // The audit write is the last step of each mutation; making it fail must
      // roll the whole change back.
      const failAudit = vi
        .spyOn(audit, "recordOperatorAudit")
        .mockRejectedValue(new Error("forced operator audit failure"));
      try {
        const failing = (run: (tx: Tx) => Promise<unknown>) => () => inTx(run);
        const failures: [string, () => Promise<unknown>][] = [
          [
            "open",
            failing((tx) =>
              seams.openModerationCaseAs(tx, ADMIN, freshCharacterId, "why", new Date()),
            ),
          ],
          [
            "status",
            failing((tx) =>
              seams.setModerationCaseStatusAs(
                tx,
                ADMIN,
                moderationCase.id,
                "dismissed",
                new Date(),
              ),
            ),
          ],
          [
            "note",
            failing((tx) =>
              seams.addModerationCaseNoteAs(tx, ADMIN, moderationCase.id, "a note", new Date()),
            ),
          ],
          [
            "issue",
            failing((tx) =>
              seams.issueSanctionAs(
                tx,
                ADMIN,
                {
                  caseId: moderationCase.id,
                  kind: "suspension",
                  ruleCategory: "harassment",
                  duration: "permanent",
                },
                new Date(),
              ),
            ),
          ],
          [
            "duration",
            failing((tx) =>
              seams.changeSanctionDurationAs(tx, ADMIN, sanctionId, "30d", new Date()),
            ),
          ],
          ["reverse", failing((tx) => seams.reverseSanctionAs(tx, ADMIN, sanctionId, new Date()))],
          [
            "decide",
            failing((tx) =>
              seams.decideAppealAs(
                tx,
                ADMIN,
                { appealId: appeal!.id, outcome: "reversed", duration: null },
                new Date(),
              ),
            ),
          ],
        ];
        for (const [label, attempt] of failures) {
          await expect(attempt(), label).rejects.toThrow(/forced operator audit failure/);
        }
      } finally {
        failAudit.mockRestore();
      }

      // Every change rolled back with its audit row.
      expect(await casesOf(fresh.accountId)).toEqual([]);
      const [caseRow] = await casesOf(subject.accountId);
      expect(caseRow!.status).toBe("reviewed");
      expect(
        await db
          .select()
          .from(rune.moderationCaseNotes)
          .where(eq(rune.moderationCaseNotes.caseId, moderationCase.id)),
      ).toEqual([]);
      const rows = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.caseId, moderationCase.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ duration: "7d", reversedAt: null });
      const [appealAfter] = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.id, appeal!.id));
      expect(appealAfter).toMatchObject({ outcome: null, decidedAt: null });
      expect(await caseAudit(moderationCase.id)).toHaveLength(auditBefore);
    });

    it("audits each moderation action with the case id and writes nothing for a no-op", async () => {
      const subject = await player();
      const other = await player();

      // Opening a case.
      const open = await inTx((tx) =>
        seams.openModerationCaseAs(
          tx,
          ADMIN,
          subject.character.id,
          "  seen scamming  ",
          new Date(),
        ),
      );
      expect(open).toMatchObject({ changed: true, subjectPlayerAccountId: subject.accountId });
      const caseId = open.caseId;
      const rows = await caseAudit(caseId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        adminUserId: ADMIN,
        operation: "open_moderation_case",
        targetKind: "player_account",
        playerAccountId: subject.accountId,
        characterId: null,
        moderationCaseId: caseId,
        details: { reason: "seen scamming", fromCharacterId: subject.character.id },
      });
      const [caseRow] = await casesOf(subject.accountId);
      expect(caseRow).toMatchObject({
        status: "open",
        openedBy: "operator",
        openedByAdminUserId: ADMIN,
        openingReason: "seen scamming",
      });
      expect(rows[0]!.targetIdentity).toBe(`MOD-${String(caseRow!.caseNumber).padStart(5, "0")}`);

      // Opening again returns the existing case unchanged and audits nothing.
      const again = await auditDelta(caseId, () =>
        inTx((tx) =>
          seams.openModerationCaseAs(tx, ADMIN_TWO, subject.character.id, "again", new Date()),
        ),
      );
      expect(again.result).toMatchObject({ changed: false, caseId });
      expect(again.rows).toEqual([]);
      // Refused: no reason, unknown character.
      await expect(
        inTx((tx) => seams.openModerationCaseAs(tx, ADMIN, other.character.id, "   ", new Date())),
      ).rejects.toMatchObject(moderationError(400));
      await expect(
        inTx((tx) => seams.openModerationCaseAs(tx, ADMIN, randomUUID(), "who", new Date())),
      ).rejects.toMatchObject(moderationError(404));
      expect(await casesOf(other.accountId)).toEqual([]);

      // Status: a change audits, the same status does not.
      const reviewed = await auditDelta(caseId, () => setStatus(caseId, "reviewed"));
      expect(reviewed.result.changed).toBe(true);
      expect(reviewed.rows).toHaveLength(1);
      expect(reviewed.rows[0]).toMatchObject({
        adminUserId: ADMIN,
        operation: "set_moderation_case_status",
        moderationCaseId: caseId,
        details: { from: "open", to: "reviewed" },
      });
      const same = await auditDelta(caseId, () => setStatus(caseId, "reviewed"));
      expect(same.result.changed).toBe(false);
      expect(same.rows).toEqual([]);

      // Notes.
      const noted = await auditDelta(caseId, () =>
        inTx((tx) =>
          seams.addModerationCaseNoteAs(tx, ADMIN, caseId, "  looked at logs ", new Date()),
        ),
      );
      expect(noted.rows).toHaveLength(1);
      expect(noted.rows[0]).toMatchObject({
        operation: "add_moderation_case_note",
        moderationCaseId: caseId,
      });

      // Sanctions.
      const issued = await auditDelta(caseId, () => issue(caseId, "social_restriction", "7d"));
      expect(issued.result).toMatchObject({ changed: true, noticesChanged: true });
      expect(issued.rows).toHaveLength(1);
      expect(issued.rows[0]).toMatchObject({
        adminUserId: ADMIN,
        operation: "issue_moderation_sanction",
        moderationCaseId: caseId,
        targetIdentity: issued.result.sanctionId,
        details: expect.objectContaining({
          kind: "social_restriction",
          ruleCategory: "harassment",
          duration: "7d",
          caseStatus: { from: "reviewed", to: "actioned" },
        }),
      });
      const lengthened = await auditDelta(caseId, () =>
        changeDuration(issued.result.sanctionId, "30d"),
      );
      expect(lengthened.result.changed).toBe(true);
      expect(lengthened.rows).toHaveLength(1);
      expect(lengthened.rows[0]).toMatchObject({
        operation: "change_moderation_sanction_duration",
        details: expect.objectContaining({ duration: { from: "7d", to: "30d" } }),
      });
      const sameDuration = await auditDelta(caseId, () =>
        changeDuration(issued.result.sanctionId, "30d"),
      );
      expect(sameDuration.result.changed).toBe(false);
      expect(sameDuration.rows).toEqual([]);
      const reversed = await auditDelta(caseId, () => reverse(issued.result.sanctionId));
      expect(reversed.result.changed).toBe(true);
      expect(reversed.rows).toHaveLength(1);
      expect(reversed.rows[0]).toMatchObject({
        operation: "reverse_moderation_sanction",
        moderationCaseId: caseId,
      });
      const reversedAgain = await auditDelta(caseId, () => reverse(issued.result.sanctionId));
      expect(reversedAgain.result.changed).toBe(false);
      expect(reversedAgain.rows).toEqual([]);
      // A reversed sanction's duration cannot be changed.
      await expect(changeDuration(issued.result.sanctionId, "7d")).rejects.toMatchObject(
        moderationError(409),
      );
      // Neither can a warning's, and a warning always needs no duration.
      const warning = await issue(caseId, "warning", null);
      await expect(changeDuration(warning.sanctionId, "7d")).rejects.toMatchObject(
        moderationError(400),
      );
      await expect(issue(caseId, "warning", "7d")).rejects.toMatchObject(moderationError(400));
      await expect(issue(caseId, "suspension", null)).rejects.toMatchObject(moderationError(400));
      await expect(setStatus(randomUUID(), "open")).rejects.toMatchObject(moderationError(404));

      // Every audit row carries the case id and the subject account as its target.
      for (const row of await caseAudit(caseId)) {
        expect(row.moderationCaseId).toBe(caseId);
        expect(row).toMatchObject({
          targetKind: "player_account",
          playerAccountId: subject.accountId,
        });
      }
    });

    it("keeps moderation rows out of the account audit log and shows them only in their case", async () => {
      const { subject, moderationCase } = await reportedSubject();
      await setStatus(moderationCase.id, "reviewed");
      await issue(moderationCase.id, "warning", null);
      await inTx((tx) =>
        audit.recordOperatorAudit(tx, {
          adminUserId: ADMIN,
          target: { kind: "player_account", playerAccountId: subject.accountId },
          operation: "grant_early_access",
          details: { note: "not moderation" },
        }),
      );

      const accountLog = await db.transaction((tx) =>
        audit.loadPlayerAccountAuditLog(tx, subject.accountId),
      );
      expect(accountLog.map((row) => row.operation)).toEqual(["grant_early_access"]);
      expect(accountLog.every((row) => row.moderationCaseId === null)).toBe(true);

      const caseLog = await db.transaction((tx) =>
        audit.loadModerationCaseAuditLog(tx, moderationCase.id),
      );
      expect(caseLog.map((row) => row.operation).sort()).toEqual(
        ["issue_moderation_sanction", "set_moderation_case_status"].sort(),
      );
      // The case view carries the same history, and viewing it is audited.
      const view = await accessDelta(ADMIN, () => readCase(moderationCase.id));
      expect(view.rows.map((row) => row.accessKind)).toEqual(["case_detail"]);
      expect(view.result.audit.map((entry) => entry.operation).sort()).toEqual(
        ["issue_moderation_sanction", "set_moderation_case_status"].sort(),
      );
      expect(view.result.audit.every((entry) => entry.adminUserId === ADMIN)).toBe(true);
    });

    it("scopes a moderation audit row to its case, and no other row to one", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const write = (
        operation: (typeof audit.MODERATION_OPERATIONS)[number] | "grant_early_access",
        moderationCaseId?: string,
      ) =>
        inTx((tx) =>
          audit.recordOperatorAudit(tx, {
            adminUserId: ADMIN,
            target: { kind: "player_account", playerAccountId: subject.accountId },
            operation,
            details: {},
            moderationCaseId,
          }),
        );
      await expect(write("set_moderation_case_status")).rejects.toThrow(
        /wrong moderation case scope/,
      );
      await expect(write("grant_early_access", moderationCase.id)).rejects.toThrow(
        /wrong moderation case scope/,
      );
      await expect(write("set_moderation_case_status", moderationCase.id)).resolves.toBeUndefined();
    });

    it("runs the production surface as the session's operator, publishing to the sanctioned account only", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const bystander = await player();
      const { result, received, closed } = await observe(
        [scopeOf(subject.character), scopeOf(bystander.character)],
        async () => {
          const reviewed = await commands.setModerationCaseStatus(
            operatorHeaders,
            moderationCase.id,
            "reviewed",
          );
          const noted = await commands.addModerationCaseNote(
            operatorHeaders,
            moderationCase.id,
            "checked the report",
          );
          const issued = await commands.issueSanction(operatorHeaders, {
            caseId: moderationCase.id,
            kind: "suspension",
            ruleCategory: "scams_spam",
            duration: "7d",
          });
          return { reviewed, noted, issued };
        },
      );
      expect(result.reviewed).toEqual({ changed: true, caseId: moderationCase.id });
      expect(result.noted).toEqual({ changed: true, caseId: moderationCase.id });
      expect(result.issued).toEqual({ changed: true, caseId: moderationCase.id });

      const view = await commands
        .loadModerationCase(operatorHeaders, moderationCase.id)
        .then((loaded) => loaded);
      expect(view.notes.map((note) => [note.adminUserId, note.body])).toEqual([
        [OPERATOR_ID, "checked the report"],
      ]);
      expect(view.sanctions.map((s) => [s.kind, s.issuedByAdminUserId, s.state])).toEqual([
        ["suspension", OPERATOR_ID, "in_effect"],
      ]);
      expect(new Set(view.audit.map((entry) => entry.adminUserId))).toEqual(new Set([OPERATOR_ID]));

      // The sanctioned account's tabs are told to re-read (an empty prompt) and,
      // for a suspension, closed so a reconnect re-runs authorization. Nobody
      // else hears anything.
      expect(received.get(subject.character.id)!.map((envelope) => envelope.type)).toEqual([
        "moderation.notices",
      ]);
      expect(closed.get(subject.character.id)).toEqual(["lifetime"]);
      expect(received.get(bystander.character.id)).toEqual([]);
      expect(closed.get(bystander.character.id)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------

  describe("cases", () => {
    it("joins a message report and a player report against one account into one open case", async () => {
      const subject = await player();
      const reporterOne = await player();
      const reporterTwo = await player();
      const line = posted(
        await chat.sendChatMessage(subject.userId, subject.character.id, {
          channel: "general",
          text: `case line ${token()}`,
        }),
      );
      expect(
        await reports.reportMessage(reporterOne.userId, reporterOne.character.id, {
          messageId: line.id,
          reason: "spam_scam",
        }),
      ).toMatchObject({ status: "reported" });
      const [first] = await casesOf(subject.accountId);
      expect(first).toMatchObject({
        status: "open",
        openedBy: "report",
        openedByAdminUserId: null,
      });

      // Even through another character of the reported account.
      const alt = await altOf(subject.userId);
      expect(
        await reports.reportPlayer(reporterTwo.userId, reporterTwo.character.id, {
          target: { characterId: alt.id },
          reason: "threats",
        }),
      ).toMatchObject({ status: "reported" });

      const cases = await casesOf(subject.accountId);
      expect(cases).toHaveLength(1);
      const joined = await reportsOf(first!.id);
      expect(joined.map((row) => [row.kind, row.reportedCharacterId])).toEqual([
        ["message", subject.character.id],
        ["player", alt.id],
      ]);
      // Joining marks activity on the case but never changes its status.
      expect(cases[0]!.status).toBe("open");
      expect(cases[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(first!.updatedAt.getTime());

      await setStatus(first!.id, "reviewed");
      await reportPlayer(reporterOne, subject, "threats");
      const afterReviewed = await casesOf(subject.accountId);
      expect(afterReviewed).toHaveLength(1);
      expect(afterReviewed[0]!.status).toBe("reviewed");
      expect(await reportsOf(first!.id)).toHaveLength(3);
    });

    it("opens a new case for a report after the case is Dismissed or Actioned", async () => {
      const subject = await player();
      const reporter = await player();
      await reportPlayer(reporter, subject);
      const [first] = await casesOf(subject.accountId);
      await setStatus(first!.id, "dismissed");

      await reportPlayer(reporter, subject, "threats");
      const second = await newestCase(subject.accountId);
      expect(second.id).not.toBe(first!.id);
      expect(second.caseNumber).toBeGreaterThan(first!.caseNumber);
      expect(second.status).toBe("open");
      // The decided case keeps its status and its own reports.
      const [reloaded] = await casesOf(subject.accountId);
      expect(reloaded).toMatchObject({ id: first!.id, status: "dismissed" });
      expect(await reportsOf(first!.id)).toHaveLength(1);
      expect(await reportsOf(second.id)).toHaveLength(1);

      await issue(second.id, "warning", null);
      await reportPlayer(reporter, subject, "spam_scam");
      const third = await newestCase(subject.accountId);
      expect(third.id).not.toBe(second.id);
      expect(third.status).toBe("open");
      expect((await casesOf(subject.accountId)).map((row) => row.status)).toEqual([
        "dismissed",
        "actioned",
        "open",
      ]);
      // A further report joins the new active case.
      await reportPlayer(reporter, subject, "harassment_hate");
      expect(await casesOf(subject.accountId)).toHaveLength(3);
      expect(await reportsOf(third.id)).toHaveLength(2);
    });

    it("stores nothing and opens no empty case for a duplicate message report", async () => {
      const subject = await player();
      const reporter = await player();
      const reporterAlt = await altOf(reporter.userId);
      const line = posted(
        await chat.sendChatMessage(subject.userId, subject.character.id, {
          channel: "general",
          text: `dup line ${token()}`,
        }),
      );
      const report = (characterId: string) =>
        reports.reportMessage(reporter.userId, characterId, {
          messageId: line.id,
          reason: "other",
        });
      expect(await report(reporter.character.id)).toMatchObject({ status: "reported" });
      const [first] = await casesOf(subject.accountId);

      // With the case still active the repeat changes nothing, not even activity.
      expect(await report(reporterAlt.id)).toMatchObject({ status: "duplicate" });
      expect(await reportsOf(first!.id)).toHaveLength(1);

      // With the case decided, a repeat must not open a fresh, empty case.
      await setStatus(first!.id, "dismissed");
      expect(await report(reporter.character.id)).toMatchObject({ status: "duplicate" });
      expect(await report(reporterAlt.id)).toMatchObject({ status: "duplicate" });
      expect(await casesOf(subject.accountId)).toHaveLength(1);
      expect(await reportsOf(first!.id)).toHaveLength(1);
    });

    it("keeps exactly one report and no empty case when the same report races itself", async () => {
      const subject = await player();
      const reporter = await player();
      const reporterAlt = await altOf(reporter.userId);
      const line = posted(
        await chat.sendChatMessage(subject.userId, subject.character.id, {
          channel: "general",
          text: `race line ${token()}`,
        }),
      );
      const results = await Promise.all(
        [reporter.character.id, reporterAlt.id, reporter.character.id, reporterAlt.id].map(
          (characterId) =>
            reports.reportMessage(reporter.userId, characterId, {
              messageId: line.id,
              reason: "other",
            }),
        ),
      );
      expect(
        results.map((result) => ("status" in result ? result.status : "error")).sort(),
      ).toEqual(["duplicate", "duplicate", "duplicate", "reported"]);
      const cases = await casesOf(subject.accountId);
      expect(cases).toHaveLength(1);
      expect(await reportsOf(cases[0]!.id)).toHaveLength(1);
    });

    it("shows the reported message first with 10 before and 10 after from its own feed only", async () => {
      const subject = await player();
      const reporter = await player();
      const bystander = await player();
      const start = Date.now() - HOUR_MS;
      const run: ChatMessageView[] = [];
      let general: ChatMessageView | undefined;
      for (let index = 0; index < 25; index += 1) {
        run.push(
          posted(
            await chat.sendChatMessage(
              subject.userId,
              subject.character.id,
              { channel: "trade", text: `ctx trade ${index}` },
              { now: new Date(start + index * 11_000) },
            ),
          ),
        );
        if (index === 12) {
          // Other feeds run alongside, between the reported message and its next.
          general = posted(
            await chat.sendChatMessage(
              bystander.userId,
              bystander.character.id,
              { channel: "general", text: "ctx general noise" },
              { now: new Date(start + 12 * 11_000 + 5_000) },
            ),
          );
        }
      }
      const target = run[12]!;
      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: target.id,
          reason: "spam_scam",
          note: "keeps posting this",
        }),
      ).toMatchObject({ status: "reported" });
      const moderationCase = await newestCase(subject.accountId);

      const view = await readCase(moderationCase.id);
      expect(view.reports).toHaveLength(1);
      const [report] = view.reports;
      expect(report).toMatchObject({
        kind: "message",
        reason: "spam_scam",
        note: "keeps posting this",
        channel: "trade",
        reported: {
          characterId: subject.character.id,
          nameAtReport: subject.character.displayName,
        },
        reporter: {
          playerAccountId: reporter.accountId,
          characterId: reporter.character.id,
          characterName: reporter.character.displayName,
        },
      });
      const evidence = report!.evidence!;
      expect(evidence.message).toMatchObject({
        id: target.id,
        body: "ctx trade 12",
        channel: "trade",
        senderPlayerAccountId: subject.accountId,
        senderCharacterId: subject.character.id,
      });
      expect(evidence.before).toHaveLength(10);
      expect(evidence.after).toHaveLength(10);
      // Context is the trade feed only: never the General line between messages.
      const context = [...evidence.before, ...evidence.after];
      expect(context.every((message) => message.channel === "trade")).toBe(true);
      expect(context.map((message) => message.id)).not.toContain(general!.id);
      // Other suites may post to Trade too, so ours are the nearest neighbours in order.
      const ours = (list: { body: string }[]) =>
        list.map((message) => message.body).filter((body) => body.startsWith("ctx trade"));
      const lines = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, index) => `ctx trade ${from + index}`);
      const before = ours(evidence.before);
      const after = ours(evidence.after);
      expect(before).toEqual(lines(12 - before.length, 11));
      expect(after).toEqual(lines(13, 12 + after.length));
    });

    it("bounds a Whisper report's evidence and the retained-Whisper read to that pair's conversation", async () => {
      const reporter = await player();
      const subject = await player();
      const third = await player();
      const fourth = await player();
      const start = Date.now() - HOUR_MS;
      let step = 0;
      const send = (from: Player, toCharacterId: string, text: string) =>
        sendWhisper(from, toCharacterId, text, new Date(start + (step += 11_000)));

      await send(reporter, subject.character.id, "hello there");
      // Each side's unrelated private conversations with third parties, interleaved.
      await send(subject, third.character.id, "subject private with third");
      await send(reporter, fourth.character.id, "reporter private with fourth");
      const bad = await send(subject, reporter.character.id, "nasty line");
      await send(third, subject.character.id, "third reply to subject");
      await send(fourth, reporter.character.id, "fourth reply to reporter");
      await send(reporter, subject.character.id, "please stop");

      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: bad.id,
          reason: "harassment_hate",
        }),
      ).toMatchObject({ status: "reported" });
      const moderationCase = await newestCase(subject.accountId);
      const [reportRow] = await reportsOf(moderationCase.id);

      const view = await readCase(moderationCase.id);
      const evidence = view.reports[0]!.evidence!;
      expect(evidence.message.body).toBe("nasty line");
      expect(evidence.before.map((message) => message.body)).toEqual(["hello there"]);
      expect(evidence.after.map((message) => message.body)).toEqual(["please stop"]);
      const evidenceJson = JSON.stringify(evidence);
      expect(evidenceJson).not.toContain("private");
      expect(evidenceJson).not.toContain("third reply");
      expect(evidenceJson).not.toContain("fourth reply");

      // The operator's retained-Whisper read: this pair only, never a third party's.
      const retained = await inTx((tx) =>
        seams.readRetainedWhispersAs(tx, ADMIN, moderationCase.id, reportRow!.id),
      );
      expect(retained.kind).toBe("whispers");
      expect(retained.messages.map((message) => message.body)).toEqual([
        "hello there",
        "nasty line",
        "please stop",
      ]);
      expect(retained.truncated).toBe(false);
      const retainedJson = JSON.stringify(retained);
      expect(retainedJson).not.toContain("private");
      expect(retainedJson).not.toContain("third reply");
      expect(retainedJson).not.toContain("fourth reply");
      expect(new Set(retained.messages.map((message) => message.conversationId)).size).toBe(1);
      // No public chat is returned by the Whisper read, and no Whisper by the public one.
      const publicRead = await inTx((tx) =>
        seams.readRetainedPublicChatAs(tx, ADMIN, moderationCase.id, reportRow!.id),
      );
      expect(publicRead.messages).toEqual([]);
    });

    it("bounds retained public chat to the subject's own General and Trade messages around the incident", async () => {
      const subject = await player();
      const reporter = await player();
      const bystander = await player();
      await reportPlayer(reporter, subject);
      const moderationCase = await newestCase(subject.accountId);
      const [reportRow] = await reportsOf(moderationCase.id);
      const incident = reportRow!.createdAt.getTime();
      const at = (offsetMs: number) => new Date(incident + offsetMs);
      const say = async (
        from: Player,
        channel: "general" | "trade",
        text: string,
        offsetMs: number,
      ) =>
        posted(
          await chat.sendChatMessage(
            from.userId,
            from.character.id,
            { channel, text },
            { now: at(offsetMs) },
          ),
        );
      const inGeneral = await say(subject, "general", "in window general", -3 * HOUR_MS);
      const inTrade = await say(subject, "trade", "in window trade", -HOUR_MS);
      await say(subject, "general", "before the window", -13 * HOUR_MS);
      await say(bystander, "general", "someone else in window", -2 * HOUR_MS);
      // Whispers are never part of the public read.
      await sendWhisper(subject, reporter.character.id, "whisper in window", at(-30 * 60_000));

      const view = await inTx((tx) =>
        seams.readRetainedPublicChatAs(tx, ADMIN, moderationCase.id, reportRow!.id),
      );
      expect(view.kind).toBe("public");
      expect(view.messages.map((message) => message.id)).toEqual([inGeneral.id, inTrade.id]);
      expect(
        view.messages.every((message) => message.senderPlayerAccountId === subject.accountId),
      ).toBe(true);
      expect(Date.parse(view.to) - Date.parse(view.from)).toBe(24 * HOUR_MS);
      expect(view.truncated).toBe(false);
    });

    it("caps retained chat at 100 messages and says when it is truncated", async () => {
      const subject = await player();
      const reporter = await player();
      await reportPlayer(reporter, subject);
      const moderationCase = await newestCase(subject.accountId);
      const [reportRow] = await reportsOf(moderationCase.id);
      const incident = reportRow!.createdAt.getTime();
      const inserted = await db
        .insert(rune.chatMessages)
        .values(
          Array.from({ length: 101 }, (_, index) => ({
            channel: "general",
            senderPlayerAccountId: subject.accountId,
            senderCharacterId: subject.character.id,
            senderCharacterName: subject.character.displayName,
            body: `bulk ${index}`,
            createdAt: new Date(incident - HOUR_MS + index * 1_000),
          })),
        )
        .returning({ id: rune.chatMessages.id });
      expect(inserted).toHaveLength(101);
      const view = await inTx((tx) =>
        seams.readRetainedPublicChatAs(tx, ADMIN, moderationCase.id, reportRow!.id),
      );
      expect(view.truncated).toBe(true);
      expect(view.messages).toHaveLength(100);
      expect(view.messages[0]!.body).toBe("bulk 0");
      expect(view.messages[99]!.body).toBe("bulk 99");
    });

    it("counts distinct accounts for recent reports and blocks, and reports whether the reporter blocks the subject", async () => {
      const subject = await player();
      const reporterOne = await player();
      const reporterOneAlt = await altOf(reporterOne.userId);
      const reporterTwo = await player();
      const blockerOne = await player();
      const blockerOneAlt = await altOf(blockerOne.userId);
      const blockerTwo = await player();
      const now = new Date();
      const lines = [];
      for (let index = 0; index < 3; index += 1) {
        lines.push(
          posted(
            await chat.sendChatMessage(
              subject.userId,
              subject.character.id,
              { channel: "general", text: `signal ${index} ${token()}` },
              { now: new Date(now.getTime() - (10 - index) * 15_000) },
            ),
          ),
        );
      }
      // One reporter account reports twice, through two characters; another once.
      await reports.reportMessage(reporterOne.userId, reporterOne.character.id, {
        messageId: lines[0]!.id,
        reason: "other",
      });
      await reports.reportMessage(reporterOne.userId, reporterOneAlt.id, {
        messageId: lines[1]!.id,
        reason: "other",
      });
      await reports.reportMessage(reporterTwo.userId, reporterTwo.character.id, {
        messageId: lines[2]!.id,
        reason: "threats",
      });
      // A report from outside the 30-day window is not "recent".
      await reportPlayer(blockerTwo, subject, "other", {
        now: new Date(now.getTime() - 31 * DAY_MS),
      });
      const moderationCase = await newestCase(subject.accountId);

      // Reporter one blocks the subject; reporter two does not.
      await blocks.blockPlayer(reporterOne.userId, reporterOne.character.id, {
        characterId: subject.character.id,
      });
      // A blocker account blocks, unblocks, and blocks again through different
      // characters: still one account. Another account blocks today; a third
      // blocked before the window.
      await blocks.blockPlayer(
        blockerOne.userId,
        blockerOne.character.id,
        { characterId: subject.character.id },
        new Date(now.getTime() - 3 * DAY_MS),
      );
      await blocks.unblockPlayer(
        blockerOne.userId,
        blockerOne.character.id,
        subject.character.id,
        new Date(now.getTime() - 2 * DAY_MS),
      );
      await blocks.blockPlayer(
        blockerOne.userId,
        blockerOneAlt.id,
        { characterId: subject.character.id },
        new Date(now.getTime() - DAY_MS),
      );
      await blocks.blockPlayer(
        blockerTwo.userId,
        blockerTwo.character.id,
        { characterId: subject.character.id },
        new Date(now.getTime() - 40 * DAY_MS),
      );

      const view = await readCase(moderationCase.id, now);
      expect(view.signals).toMatchObject({
        windowDays: 30,
        // reporterOne x2, reporterTwo x1 (the 31-day-old report is outside).
        reportsInWindow: 3,
        independentReportersInWindow: 2,
        // reporterOne, blockerOne, blockerTwo block the subject today.
        blockedByAccountsNow: 3,
        // reporterOne (now) and blockerOne (block, unblock, block) — blockerTwo's block is 40 days old.
        independentBlockersInWindow: 2,
      });
      const blocksBy = new Map(
        view.reports.map((report) => [
          report.reporter.playerAccountId,
          report.reporterBlocksSubject,
        ]),
      );
      expect(blocksBy.get(reporterOne.accountId)).toBe(true);
      expect(blocksBy.get(reporterTwo.accountId)).toBe(false);
      // The 31-day-old report is part of the case, but from an account that also blocks.
      expect(blocksBy.get(blockerTwo.accountId)).toBe(true);
      expect(
        view.reports.filter((report) => report.reporter.playerAccountId === reporterOne.accountId),
      ).toHaveLength(2);

      // Unblocking makes that reporter's flag false without touching the counts of the window.
      await blocks.unblockPlayer(
        reporterOne.userId,
        reporterOne.character.id,
        subject.character.id,
      );
      const after = await readCase(moderationCase.id, now);
      expect(after.signals.blockedByAccountsNow).toBe(2);
      expect(after.signals.independentBlockersInWindow).toBe(2);
      expect(
        after.reports
          .filter((report) => report.reporter.playerAccountId === reporterOne.accountId)
          .map((report) => report.reporterBlocksSubject),
      ).toEqual([false, false]);
    });

    it("lists the subject's other cases and every name its characters were seen under", async () => {
      const subject = await player();
      const reporter = await player();
      await reportPlayer(reporter, subject);
      const [first] = await casesOf(subject.accountId);
      await setStatus(first!.id, "dismissed");
      await reportPlayer(reporter, subject, "threats");
      await reportPlayer(reporter, subject, "spam_scam");
      const second = await newestCase(subject.accountId);
      const renamed = `Ren${token()}`;
      await db
        .update(rune.characters)
        .set({ displayName: renamed, normalizedName: renamed.toLowerCase() })
        .where(eq(rune.characters.id, subject.character.id));

      const view = await readCase(second.id);
      expect(view.signals.otherCases).toMatchObject([
        {
          caseId: first!.id,
          reference: `MOD-${String(first!.caseNumber).padStart(5, "0")}`,
          status: "dismissed",
          createdAt: first!.createdAt.toISOString(),
        },
      ]);
      expect(view.nameHistory).toEqual([
        {
          characterId: subject.character.id,
          currentName: renamed,
          seenAs: [subject.character.displayName, renamed],
        },
      ]);
      expect(view.subject.characters.map((character) => character.name)).toEqual([renamed]);
    });

    it("counts each case's reports in the other-cases list and the account history", async () => {
      const subject = await player();
      const reporterOne = await player();
      const reporterTwo = await player();
      await reportPlayer(reporterOne, subject);
      const [first] = await casesOf(subject.accountId);
      await setStatus(first!.id, "dismissed");
      await reportPlayer(reporterOne, subject, "threats");
      await reportPlayer(reporterTwo, subject, "spam_scam");
      await reportPlayer(reporterTwo, subject, "harassment_hate");
      const second = await newestCase(subject.accountId);

      const view = await readCase(second.id);
      expect(view.signals.otherCases).toMatchObject([{ caseId: first!.id, reportCount: 1 }]);
      const history = await inTx((tx) =>
        seams.readAccountModerationHistoryAs(tx, ADMIN, subject.character.id),
      );
      expect(history.activeCaseId).toBe(second.id);
      expect(history.cases).toMatchObject([
        { caseId: second.id, status: "open", reportCount: 3 },
        { caseId: first!.id, status: "dismissed", reportCount: 1 },
      ]);
    });

    it("persists status changes and notes, and refuses an empty or overlong note", async () => {
      const { moderationCase } = await reportedSubject();
      await setStatus(moderationCase.id, "reviewed");
      await inTx((tx) =>
        seams.addModerationCaseNoteAs(
          tx,
          ADMIN,
          moderationCase.id,
          "  first look \r\n done ",
          new Date(Date.now() - 1_000),
        ),
      );
      await inTx((tx) =>
        seams.addModerationCaseNoteAs(
          tx,
          ADMIN_TWO,
          moderationCase.id,
          "second opinion",
          new Date(),
        ),
      );
      const view = await readCase(moderationCase.id);
      expect(view.status).toBe("reviewed");
      expect(view.notes.map((note) => [note.adminUserId, note.body])).toEqual([
        [ADMIN, "first look \n done"],
        [ADMIN_TWO, "second opinion"],
      ]);
      const [row] = await db
        .select()
        .from(rune.moderationCases)
        .where(eq(rune.moderationCases.id, moderationCase.id));
      expect(row!.status).toBe("reviewed");
      expect(row!.updatedAt.getTime()).toBeGreaterThan(moderationCase.updatedAt.getTime());

      const before = (await caseAudit(moderationCase.id)).length;
      await expect(
        inTx((tx) =>
          seams.addModerationCaseNoteAs(tx, ADMIN, moderationCase.id, "  \n ", new Date()),
        ),
      ).rejects.toMatchObject(moderationError(400));
      await expect(
        inTx((tx) =>
          seams.addModerationCaseNoteAs(
            tx,
            ADMIN,
            moderationCase.id,
            "x".repeat(2_001),
            new Date(),
          ),
        ),
      ).rejects.toMatchObject(moderationError(400));
      // Exactly the limit is fine, counted in code points.
      await inTx((tx) =>
        seams.addModerationCaseNoteAs(
          tx,
          ADMIN,
          moderationCase.id,
          "\u{1F600}".repeat(2_000),
          new Date(),
        ),
      );
      expect(await caseAudit(moderationCase.id)).toHaveLength(before + 1);

      await setStatus(moderationCase.id, "dismissed");
      expect((await readCase(moderationCase.id)).status).toBe("dismissed");
    });

    it("refuses to reopen a case while the account has another Open or Reviewed case", async () => {
      const subject = await player();
      const reporter = await player();
      await reportPlayer(reporter, subject);
      const [first] = await casesOf(subject.accountId);
      await setStatus(first!.id, "dismissed");
      await reportPlayer(reporter, subject, "threats");
      const second = await newestCase(subject.accountId);
      expect(second.id).not.toBe(first!.id);

      const auditBefore = (await caseAudit(first!.id)).length;
      for (const status of ["open", "reviewed"] as const) {
        await expect(setStatus(first!.id, status)).rejects.toMatchObject(moderationError(409));
      }
      const [stillDismissed] = await casesOf(subject.accountId);
      expect(stillDismissed).toMatchObject({ id: first!.id, status: "dismissed" });
      expect(await caseAudit(first!.id)).toHaveLength(auditBefore);

      // Once the other case is closed the older one may reopen; the database
      // still admits only one active case per account.
      await setStatus(second.id, "actioned");
      expect(await setStatus(first!.id, "reviewed")).toMatchObject({ changed: true });
      await expect(setStatus(second.id, "open")).rejects.toMatchObject(moderationError(409));
      await expect(
        db.insert(rune.moderationCases).values({
          subjectPlayerAccountId: subject.accountId,
          status: "open",
          openedBy: "report",
        }),
      ).rejects.toThrow();
    });

    it("lets a report join a case an operator opened", async () => {
      const subject = await player();
      const reporter = await player();
      const opened = await inTx((tx) =>
        seams.openModerationCaseAs(tx, ADMIN, subject.character.id, "seen in Trade", new Date()),
      );
      await reportPlayer(reporter, subject);
      const cases = await casesOf(subject.accountId);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({ id: opened.caseId, openedBy: "operator" });
      expect(await reportsOf(opened.caseId)).toHaveLength(1);
    });

    it("lists queue entries with report reasons and pending appeals, filtered by status", async () => {
      const subject = await player();
      const reporterOne = await player();
      const reporterTwo = await player();
      await reportPlayer(reporterOne, subject, "threats");
      await reportPlayer(reporterTwo, subject, "spam_scam");
      await reportPlayer(reporterTwo, subject, "spam_scam");
      const moderationCase = await newestCase(subject.accountId);
      const queue = (filter: "active" | "appeals" | ModerationCaseStatus) =>
        inTx((tx) => seams.readModerationQueueAs(tx, ADMIN, filter));
      const entryOf = (view: Awaited<ReturnType<typeof queue>>) =>
        view.entries.find((entry) => entry.caseId === moderationCase.id);

      const active = await queue("active");
      const entry = entryOf(active);
      expect(entry).toMatchObject({
        reference: `MOD-${String(moderationCase.caseNumber).padStart(5, "0")}`,
        status: "open",
        openedBy: "report",
        reportCount: 3,
        pendingAppeals: 0,
        subject: { playerAccountId: subject.accountId },
      });
      expect([...entry!.reasons].sort()).toEqual(["spam_scam", "threats"]);
      expect(entry!.subject.characters.map((c) => c.characterId)).toEqual([subject.character.id]);
      expect(entryOf(await queue("appeals"))).toBeUndefined();
      expect(entryOf(await queue("dismissed"))).toBeUndefined();

      const { sanctionId } = await issue(moderationCase.id, "warning", null);
      expect(entryOf(await queue("active"))).toBeUndefined();
      expect(entryOf(await queue("actioned"))).toMatchObject({ status: "actioned" });
      await notices.submitAppeal(subject.userId, { sanctionId, body: "that wasn't me" });
      const appeals = await queue("appeals");
      expect(entryOf(appeals)).toMatchObject({ pendingAppeals: 1 });
      expect(appeals.pendingAppealCases).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Sanctions
  // -------------------------------------------------------------------------

  describe("sanctions", () => {
    it("refuses General, Trade, promoted ads, and Whispers on every character of a restricted account", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const alt = await altOf(subject.userId);
      const friend = await player();
      await db
        .update(rune.characters)
        .set({ credits: 500 })
        .where(inArray(rune.characters.id, [subject.character.id, alt.id]));
      const sentBefore = async () =>
        (
          await db
            .select({ id: rune.chatMessages.id })
            .from(rune.chatMessages)
            .where(eq(rune.chatMessages.senderPlayerAccountId, subject.accountId))
        ).length;
      const creditsOf = async (characterId: string) =>
        (
          await db
            .select({ credits: rune.characters.credits })
            .from(rune.characters)
            .where(eq(rune.characters.id, characterId))
        )[0]!.credits;
      const now = new Date();
      await issue(moderationCase.id, "social_restriction", "7d", now);
      const messagesBefore = await sentBefore();

      for (const character of [subject.character, alt]) {
        for (const channel of ["general", "trade"] as const) {
          expect(
            await chat.sendChatMessage(subject.userId, character.id, { channel, text: "hello" }),
            `${channel} as ${character.displayName}`,
          ).toMatchObject({ status: "refused", reason: "socially_restricted" });
        }
        const ad = await chat.postPromotedTradeAd(subject.userId, character.id, { text: "buy" });
        expect(ad).toMatchObject({ status: "refused", reason: "socially_restricted" });
        expect(await creditsOf(character.id)).toBe(500);
        expect(
          await whispers.sendWhisper(subject.userId, character.id, {
            recipientCharacterId: friend.character.id,
            text: "psst",
          }),
        ).toMatchObject({ status: "refused", reason: "socially_restricted" });
      }
      // A refusal is never persisted, and refuses even before content is checked.
      expect(await sentBefore()).toBe(messagesBefore);
      expect(
        await chat.sendChatMessage(subject.userId, alt.id, { channel: "general", text: "   " }),
      ).toMatchObject({ status: "refused", reason: "socially_restricted" });

      // Reading, reporting, and blocking stay available.
      await expect(
        chat.readChatHistory(subject.userId, alt.id, { channel: "general" }),
      ).resolves.toMatchObject({ channel: "general" });
      await expect(whispers.readWhisperInbox(subject.userId, alt.id)).resolves.toBeDefined();
      expect(await reportPlayer(subject, friend)).toMatchObject({ status: "reported" });
      expect(
        await blocks.blockPlayer(subject.userId, alt.id, { characterId: friend.character.id }),
      ).toMatchObject({ status: "blocked" });
      // Another account is unaffected.
      expect(
        await chat.sendChatMessage(friend.userId, friend.character.id, {
          channel: "general",
          text: `friend ${token()}`,
        }),
      ).toMatchObject({ status: "sent" });
    });

    it("lifts the restriction immediately on reversal", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const alt = await altOf(subject.userId);
      await db.update(rune.characters).set({ credits: 500 }).where(eq(rune.characters.id, alt.id));
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "30d");
      expect(
        await chat.sendChatMessage(subject.userId, alt.id, { channel: "general", text: "hi" }),
      ).toMatchObject({ status: "refused", reason: "socially_restricted" });

      const reversedAt = new Date();
      expect(await reverse(sanctionId, reversedAt)).toMatchObject({ changed: true });
      const [row] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(row).toMatchObject({ reversedByAdminUserId: ADMIN });
      expect(row!.reversedAt!.getTime()).toBe(reversedAt.getTime());
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, new Date())).toBe(false);
      // The very next request sends, on either character.
      expect(
        await chat.sendChatMessage(subject.userId, alt.id, {
          channel: "general",
          text: `back ${token()}`,
        }),
      ).toMatchObject({ status: "sent" });
      expect(
        await chat.postPromotedTradeAd(subject.userId, alt.id, { text: `ad ${token()}` }),
      ).toMatchObject({ status: "sent" });
      expect(
        (
          await db
            .select({ credits: rune.characters.credits })
            .from(rune.characters)
            .where(eq(rune.characters.id, alt.id))
        )[0]!.credits,
      ).toBe(450);
    });

    it("ends a restriction at its exact end instant, deterministically, for Whispers and trade requests", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const friend = await player();
      // Issued far enough in the past that its end is also in the past.
      const start = new Date(Date.now() - 25 * HOUR_MS);
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "24h", start);
      const endsAt = new Date(start.getTime() + 24 * HOUR_MS);
      const [row] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(row!.startsAt.getTime()).toBe(start.getTime());
      expect(row!.endsAt!.getTime()).toBe(endsAt.getTime());

      const justBefore = new Date(endsAt.getTime() - 1);
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, start)).toBe(true);
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, justBefore)).toBe(true);
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, endsAt)).toBe(false);
      expect(
        await sanctions.isSociallyRestricted(db, subject.accountId, new Date(endsAt.getTime() + 1)),
      ).toBe(false);

      expect(
        await whispers.sendWhisper(
          subject.userId,
          subject.character.id,
          { recipientCharacterId: friend.character.id, text: "too early" },
          { now: justBefore },
        ),
      ).toMatchObject({ status: "refused", reason: "socially_restricted" });
      expect(
        await whispers.sendWhisper(
          subject.userId,
          subject.character.id,
          { recipientCharacterId: friend.character.id, text: "on the dot" },
          { now: endsAt },
        ),
      ).toMatchObject({ status: "sent" });

      // The trade-request seam for #225.
      const decision = (at: Date) =>
        sanctions.requireTradeRequestInitiationAllowed(db, subject.accountId, at);
      expect(await decision(justBefore)).toMatchObject({
        allowed: false,
        reason: "socially_restricted",
        error: expect.stringMatching(/social restriction/i),
      });
      expect(await decision(endsAt)).toEqual({ allowed: true });
      expect(
        await sanctions.requireTradeRequestInitiationAllowed(db, friend.accountId, justBefore),
      ).toEqual({
        allowed: true,
      });
    });

    it("refuses starting a trade request while restricted and allows it after reversal", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const initiate = () =>
        sanctions.requireTradeRequestInitiationAllowed(db, subject.accountId, new Date());
      expect(await initiate()).toEqual({ allowed: true });
      // A warning restricts nothing, and neither does a suspension's social side.
      await issue(moderationCase.id, "warning", null);
      expect(await initiate()).toEqual({ allowed: true });
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "90d");
      expect(await initiate()).toMatchObject({ allowed: false, reason: "socially_restricted" });
      await reverse(sanctionId);
      expect(await initiate()).toEqual({ allowed: true });
      // A suspension is enforced by gameplay access, not the social seam.
      await issue(moderationCase.id, "suspension", "7d");
      expect(await initiate()).toEqual({ allowed: true });
    });

    it("suspends every character from gameplay even with Early Access, and ends at the exact instant", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const alt = await altOf(subject.userId);
      const before = await withPublicGameplayClosed(db, rune, () =>
        access.loadAccountGameplayAccess(db, subject.userId),
      );
      expect(before).toMatchObject({
        suspended: false,
        decision: { allowed: true, via: "early_access" },
      });
      expect(before.earlyAccessGrantedAt).not.toBeNull();

      const { sanctionId } = await issue(moderationCase.id, "suspension", "24h");
      const during = await access.loadAccountGameplayAccess(db, subject.userId);
      expect(during).toMatchObject({
        suspended: true,
        decision: { allowed: false, reason: "suspended" },
      });
      // Early Access is still granted; the suspension outranks it.
      expect(during.earlyAccessGrantedAt).not.toBeNull();

      const refused = { name: "GameplayAccessError", status: 403, reason: "suspended" };
      await expect(access.requireGameplayAccess(db, subject.userId)).rejects.toMatchObject(refused);
      for (const character of [subject.character, alt]) {
        await expect(
          access.requirePlayableOwnedCharacter(subject.userId, character.id),
        ).rejects.toMatchObject(refused);
        await expect(play.getPlayGameplayState(subject.userId, character.id)).rejects.toMatchObject(
          refused,
        );
        await expect(mining.startMining(subject.userId, character.id)).rejects.toMatchObject(
          refused,
        );
        await expect(
          chat.readChatHistory(subject.userId, character.id, { channel: "general" }),
        ).rejects.toMatchObject(refused);
        await expect(
          chat.sendChatMessage(subject.userId, character.id, { channel: "general", text: "hi" }),
        ).rejects.toMatchObject(refused);
        await expect(whispers.readWhisperInbox(subject.userId, character.id)).rejects.toMatchObject(
          refused,
        );
      }

      // Deterministic expiry from the stored start and end.
      const [row] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      const endsAt = row!.endsAt!;
      expect(endsAt.getTime() - row!.startsAt.getTime()).toBe(24 * HOUR_MS);
      const at = (when: Date) => access.loadAccountGameplayAccess(db, subject.userId, when);
      expect((await at(new Date(endsAt.getTime() - 1))).suspended).toBe(true);
      const atEnd = await withPublicGameplayClosed(db, rune, () => at(endsAt));
      expect(atEnd).toMatchObject({
        suspended: false,
        decision: { allowed: true, via: "early_access" },
      });
      expect((await at(new Date(endsAt.getTime() + DAY_MS))).suspended).toBe(false);
      expect((await at(row!.startsAt)).suspended).toBe(true);
    });

    it("lifts a suspension immediately on reversal and marks the case Actioned when issued", async () => {
      const { subject, moderationCase } = await reportedSubject();
      expect(moderationCase.status).toBe("open");
      const { sanctionId } = await issue(moderationCase.id, "suspension", "permanent");
      expect((await readCase(moderationCase.id)).status).toBe("actioned");
      await expect(access.requireGameplayAccess(db, subject.userId)).rejects.toMatchObject({
        reason: "suspended",
      });
      await reverse(sanctionId);
      await expect(access.requireGameplayAccess(db, subject.userId)).resolves.toBe(
        subject.accountId,
      );
      await expect(
        access.requirePlayableOwnedCharacter(subject.userId, subject.character.id),
      ).resolves.toMatchObject({ id: subject.character.id });
      const view = await readCase(moderationCase.id);
      expect(view.sanctions).toMatchObject([{ state: "reversed", reversedByAdminUserId: ADMIN }]);
      // A reversal wins over the clock, even asked about an earlier moment.
      expect(
        (await access.loadAccountGameplayAccess(db, subject.userId, new Date(Date.now() - DAY_MS)))
          .suspended,
      ).toBe(false);
    });

    it("keeps a permanent suspension in effect and every report, case, and evidence row intact", async () => {
      const subject = await player();
      const reporter = await player();
      const line = posted(
        await chat.sendChatMessage(subject.userId, subject.character.id, {
          channel: "general",
          text: `evidence ${token()}`,
        }),
      );
      await reports.reportMessage(reporter.userId, reporter.character.id, {
        messageId: line.id,
        reason: "harassment_hate",
        note: "keep me",
      });
      await reportPlayer(reporter, subject, "threats");
      const moderationCase = await newestCase(subject.accountId);
      const reportsBefore = await reportsOf(moderationCase.id);
      expect(reportsBefore).toHaveLength(2);

      const { sanctionId } = await issue(moderationCase.id, "suspension", "permanent");
      const [row] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(row).toMatchObject({ duration: "permanent", endsAt: null });
      const farFuture = new Date(Date.now() + 100 * 365 * DAY_MS);
      expect(
        (await access.loadAccountGameplayAccess(db, subject.userId, farFuture)).suspended,
      ).toBe(true);

      expect(await reportsOf(moderationCase.id)).toEqual(reportsBefore);
      expect(await casesOf(subject.accountId)).toHaveLength(1);
      const view = await readCase(moderationCase.id);
      expect(view.reports).toHaveLength(2);
      expect(view.reports.find((report) => report.kind === "message")!.evidence!.message.id).toBe(
        line.id,
      );
      expect(view.reports.find((report) => report.kind === "message")!.note).toBe("keep me");
      expect(view.sanctions).toMatchObject([
        { kind: "suspension", duration: "permanent", endsAt: null, state: "in_effect" },
      ]);
    });

    it("recomputes the end from the start when the duration changes", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const start = new Date(Date.now() - 2 * DAY_MS);
      const { sanctionId } = await issue(moderationCase.id, "social_restriction", "7d", start);
      const later = new Date(Date.now() - HOUR_MS);
      const endsAtOf = async () =>
        (
          await db
            .select()
            .from(rune.moderationSanctions)
            .where(eq(rune.moderationSanctions.id, sanctionId))
        )[0]!;

      await changeDuration(sanctionId, "30d", later);
      let row = await endsAtOf();
      expect(row).toMatchObject({ duration: "30d" });
      // From when it was issued, never from when it was changed.
      expect(row.endsAt!.getTime()).toBe(start.getTime() + 30 * DAY_MS);
      expect(row.startsAt.getTime()).toBe(start.getTime());
      expect(row.updatedAt.getTime()).toBe(later.getTime());
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, new Date())).toBe(true);

      await changeDuration(sanctionId, "permanent", later);
      row = await endsAtOf();
      expect(row).toMatchObject({ duration: "permanent", endsAt: null });
      expect(
        await sanctions.isSociallyRestricted(
          db,
          subject.accountId,
          new Date(Date.now() + 500 * DAY_MS),
        ),
      ).toBe(true);

      // Shortening past the start ends it at once.
      await changeDuration(sanctionId, "24h", later);
      row = await endsAtOf();
      expect(row.endsAt!.getTime()).toBe(start.getTime() + 24 * HOUR_MS);
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, new Date())).toBe(false);
      expect(
        await sanctions.isSociallyRestricted(
          db,
          subject.accountId,
          new Date(start.getTime() + 24 * HOUR_MS - 1),
        ),
      ).toBe(true);
      const view = await readCase(moderationCase.id);
      expect(view.sanctions[0]).toMatchObject({ state: "expired", duration: "24h" });
    });

    it("refuses a second in-effect sanction of the same kind on a case, but not other kinds or ended ones", async () => {
      const { moderationCase } = await reportedSubject();
      const first = await issue(moderationCase.id, "social_restriction", "7d");
      await expect(issue(moderationCase.id, "social_restriction", "24h")).rejects.toMatchObject(
        moderationError(409),
      );
      await expect(
        issue(moderationCase.id, "social_restriction", "permanent"),
      ).rejects.toMatchObject(moderationError(409));
      // A restriction and a suspension are different kinds; warnings never conflict.
      const suspension = await issue(moderationCase.id, "suspension", "24h");
      await issue(moderationCase.id, "warning", null);
      await issue(moderationCase.id, "warning", null);
      await expect(issue(moderationCase.id, "suspension", "7d")).rejects.toMatchObject(
        moderationError(409),
      );
      const rows = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.caseId, moderationCase.id));
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "social_restriction",
        "suspension",
        "warning",
        "warning",
      ]);

      // Once reversed, or once expired, a new one may be issued.
      await reverse(first.sanctionId);
      expect(await issue(moderationCase.id, "social_restriction", "24h")).toMatchObject({
        changed: true,
      });
      const expiry = new Date(Date.now() + 25 * HOUR_MS);
      expect(suspension.sanctionId).toBeTruthy();
      expect(await issue(moderationCase.id, "suspension", "7d", expiry)).toMatchObject({
        changed: true,
      });
    });

    it("has the sanction's persisted facts drive every check, for the account and only the account", async () => {
      const { subject, moderationCase } = await reportedSubject();
      const bystander = await player();
      await issue(moderationCase.id, "suspension", "7d");
      expect((await access.loadAccountGameplayAccess(db, bystander.userId)).suspended).toBe(false);
      await expect(
        access.requirePlayableOwnedCharacter(bystander.userId, bystander.character.id),
      ).resolves.toMatchObject({ id: bystander.character.id });
      await expect(
        access.requirePlayableOwnedCharacter(subject.userId, subject.character.id),
      ).rejects.toMatchObject({ reason: "suspended" });
    });
  });

  // -------------------------------------------------------------------------
  // Notices and appeals
  // -------------------------------------------------------------------------

  describe("notices and appeals", () => {
    /** A sanctioned subject whose case was reported through a Whisper, with a note and a moderator. */
    async function sanctioned(
      kind: SanctionKind = "social_restriction",
      duration: SanctionDuration | null = "7d",
    ) {
      const subject = await player();
      const reporter = await player();
      const whisper = await sendWhisper(
        subject,
        reporter.character.id,
        "private line",
        new Date(Date.now() - 10 * 60_000),
      );
      const reportNote = `REPORTNOTE-${token()}`;
      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: whisper.id,
          reason: "harassment_hate",
          note: reportNote,
        }),
      ).toMatchObject({ status: "reported" });
      const moderationCase = await newestCase(subject.accountId);
      await inTx((tx) =>
        seams.addModerationCaseNoteAs(
          tx,
          ADMIN,
          moderationCase.id,
          `INTERNALNOTE-${token()}`,
          new Date(),
        ),
      );
      const issued = await issue(moderationCase.id, kind, duration, new Date(), "harassment");
      return { subject, reporter, moderationCase, sanctionId: issued.sanctionId, reportNote };
    }

    const appealFor = async (sanctionId: string) => {
      const [row] = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.sanctionId, sanctionId));
      return row!;
    };

    it("tells the sanctioned player the rule, the access affected, the duration, the case, and how to appeal", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned();
      const { notices: list } = await notices.loadSanctionNotices(subject.userId);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        sanctionId,
        caseReference: `MOD-${String(moderationCase.caseNumber).padStart(5, "0")}`,
        kind: "social_restriction",
        kindLabel: "Social restriction",
        ruleCategory: "harassment",
        ruleLabel: "Harassment",
        durationLabel: "7 days",
        state: "in_effect",
        current: true,
        appealable: true,
        appeal: { status: "none" },
      });
      expect(list[0]!.accessAffected).toMatch(/General|Whisper/);
      expect(list[0]!.rulesHref).toMatch(/^\//);
      expect(Date.parse(list[0]!.endsAt!) - Date.parse(list[0]!.startsAt)).toBe(7 * DAY_MS);

      const warning = await issue(moderationCase.id, "warning", null);
      const all = await notices.loadSanctionNotices(subject.userId);
      expect(all.notices.map((notice) => notice.sanctionId).sort()).toEqual(
        [sanctionId, warning.sanctionId].sort(),
      );
      const warningNotice = all.notices.find((notice) => notice.sanctionId === warning.sanctionId)!;
      expect(warningNotice).toMatchObject({
        kind: "warning",
        state: "recorded",
        endsAt: null,
        appealable: true,
        current: true,
      });
      // Another account never sees it.
      const stranger = await player();
      expect((await notices.loadSanctionNotices(stranger.userId)).notices).toEqual([]);
      expect(await notices.loadSanctionNotice(stranger.userId, sanctionId)).toBeNull();
    });

    it("never shows the reported player a reporter, a moderator, a note, or a signal", async () => {
      const { subject, reporter, moderationCase, sanctionId, reportNote } = await sanctioned();
      const submitted = await notices.submitAppeal(subject.userId, {
        sanctionId,
        body: "I did nothing wrong",
      });
      expect(submitted).toMatchObject({ status: "submitted" });
      await decide(
        (await appealFor(sanctionId)).id,
        "upheld",
        null,
        new Date(),
        `DECISIONNOTE-${token()}`,
      );
      const decided = await notices.loadSanctionNotices(subject.userId);

      const forbidden = [
        reporter.userId,
        reporter.accountId,
        reporter.character.id,
        reporter.character.displayName,
        reportNote,
        ADMIN,
        OPERATOR_ID,
        "INTERNALNOTE",
        "DECISIONNOTE",
        "private line",
      ];
      const serialized = JSON.stringify([submitted, decided]);
      for (const secret of forbidden) expect(serialized, secret).not.toContain(secret);
      expect(serialized).not.toMatch(
        /reporter|moderator|adminUser|issuedBy|decidedBy|decisionNote|signal|reportCount/i,
      );
      // A player's own notice does not even carry the case's report ids.
      const reportRows = await reportsOf(moderationCase.id);
      for (const row of reportRows) expect(serialized).not.toContain(row.id);
    });

    it("lets a sanctioned player appeal once per sanction", async () => {
      const { subject, sanctionId } = await sanctioned();
      const first = await notices.submitAppeal(subject.userId, {
        sanctionId,
        body: "  I was quoting a game character.  ",
      });
      expect(first).toMatchObject({
        status: "submitted",
        notice: { sanctionId, appealable: false, appeal: { status: "pending" } },
      });
      const stored = await appealFor(sanctionId);
      expect(stored).toMatchObject({
        body: "I was quoting a game character.",
        playerAccountId: subject.accountId,
        outcome: null,
        decidedAt: null,
      });
      expect(
        await notices.submitAppeal(subject.userId, { sanctionId, body: "asking again" }),
      ).toEqual({
        error: "You've already appealed this. We'll review it.",
      });
      // The stored submission is never changed.
      expect((await appealFor(sanctionId)).body).toBe("I was quoting a game character.");
      expect(
        await db
          .select()
          .from(rune.moderationAppeals)
          .where(eq(rune.moderationAppeals.playerAccountId, subject.accountId)),
      ).toHaveLength(1);
    });

    it("refuses an empty or overlong appeal and stores nothing", async () => {
      const { subject, sanctionId } = await sanctioned();
      expect(await notices.submitAppeal(subject.userId, { sanctionId, body: "  \n " })).toEqual({
        error: "Tell us why you want this reviewed.",
      });
      expect(
        await notices.submitAppeal(subject.userId, { sanctionId, body: "x".repeat(1_001) }),
      ).toEqual({
        error: "Appeals can be up to 1000 characters.",
      });
      expect(
        await db
          .select()
          .from(rune.moderationAppeals)
          .where(eq(rune.moderationAppeals.sanctionId, sanctionId)),
      ).toEqual([]);
      expect(
        await notices.submitAppeal(subject.userId, { sanctionId, body: "\u{1F600}".repeat(1_000) }),
      ).toMatchObject({
        status: "submitted",
      });
    });

    it("does not let a player appeal another account's sanction, or one that does not exist", async () => {
      const { sanctionId } = await sanctioned();
      const stranger = await player();
      const before = await db
        .select()
        .from(rune.moderationAppeals)
        .where(eq(rune.moderationAppeals.sanctionId, sanctionId));
      expect(before).toEqual([]);
      for (const id of [sanctionId, randomUUID()]) {
        expect(
          await notices.submitAppeal(stranger.userId, { sanctionId: id, body: "not mine" }),
        ).toEqual({
          error: "This notice can't be appealed.",
        });
      }
      expect(
        await db
          .select()
          .from(rune.moderationAppeals)
          .where(eq(rune.moderationAppeals.sanctionId, sanctionId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(rune.moderationAppeals)
          .where(eq(rune.moderationAppeals.playerAccountId, stranger.accountId)),
      ).toEqual([]);
    });

    it("does not let a player appeal an expired or reversed sanction", async () => {
      const expiring = await sanctioned("social_restriction", "24h");
      const startsAt = (
        await db
          .select()
          .from(rune.moderationSanctions)
          .where(eq(rune.moderationSanctions.id, expiring.sanctionId))
      )[0]!.startsAt;
      const endsAt = new Date(startsAt.getTime() + 24 * HOUR_MS);
      // Still standing one instant before its end; over at its end.
      const beforeEnd = await notices.loadSanctionNotice(
        expiring.subject.userId,
        expiring.sanctionId,
        new Date(endsAt.getTime() - 1),
      );
      expect(beforeEnd).toMatchObject({ state: "in_effect", appealable: true });
      const atEnd = await notices.loadSanctionNotice(
        expiring.subject.userId,
        expiring.sanctionId,
        endsAt,
      );
      expect(atEnd).toMatchObject({ state: "expired", appealable: false, current: false });
      expect(
        await notices.submitAppeal(
          expiring.subject.userId,
          { sanctionId: expiring.sanctionId, body: "too late" },
          endsAt,
        ),
      ).toEqual({ error: "This sanction is no longer in effect, so there's nothing to appeal." });

      const reversed = await sanctioned("suspension", "7d");
      await reverse(reversed.sanctionId);
      expect(
        await notices.loadSanctionNotice(reversed.subject.userId, reversed.sanctionId),
      ).toMatchObject({
        state: "reversed",
        appealable: false,
        current: false,
      });
      expect(
        await notices.submitAppeal(reversed.subject.userId, {
          sanctionId: reversed.sanctionId,
          body: "already lifted",
        }),
      ).toEqual({ error: "This sanction is no longer in effect, so there's nothing to appeal." });
      for (const id of [expiring.sanctionId, reversed.sanctionId]) {
        expect(
          await db
            .select()
            .from(rune.moderationAppeals)
            .where(eq(rune.moderationAppeals.sanctionId, id)),
        ).toEqual([]);
      }
    });

    it("lets a suspended player read their notice and appeal without any gameplay access", async () => {
      const { subject, sanctionId } = await sanctioned("suspension", "30d");
      await expect(
        access.requirePlayableOwnedCharacter(subject.userId, subject.character.id),
      ).rejects.toMatchObject({ reason: "suspended" });
      const list = await notices.loadSanctionNotices(subject.userId);
      expect(list.notices).toMatchObject([
        { sanctionId, kind: "suspension", state: "in_effect", appealable: true },
      ]);
      expect(
        await notices.submitAppeal(subject.userId, { sanctionId, body: "please look again" }),
      ).toMatchObject({
        status: "submitted",
        notice: { appeal: { status: "pending" } },
      });
      // Still suspended: an appeal is not a decision.
      await expect(access.requireGameplayAccess(db, subject.userId)).rejects.toMatchObject({
        reason: "suspended",
      });
    });

    it("audits Uphold as one decision and changes nothing else", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned();
      await notices.submitAppeal(subject.userId, { sanctionId, body: "review" });
      const appeal = await appealFor(sanctionId);
      const decidedAt = new Date();
      const { result, rows } = await auditDelta(moderationCase.id, () =>
        decide(appeal.id, "upheld", null, decidedAt, "  reviewed, stands  "),
      );
      expect(result).toMatchObject({
        changed: true,
        noticesChanged: true,
        gameplayAccessChanged: false,
      });
      expect(rows.map((row) => row.operation)).toEqual(["decide_moderation_appeal"]);
      expect(rows[0]).toMatchObject({
        adminUserId: ADMIN,
        moderationCaseId: moderationCase.id,
        targetIdentity: appeal.id,
        details: { sanctionId, outcome: "upheld", hasNote: true },
      });
      expect(await appealFor(sanctionId)).toMatchObject({
        outcome: "upheld",
        decidedByAdminUserId: ADMIN,
        decisionNote: "reviewed, stands",
      });
      expect(decidedAt.getTime()).toBe((await appealFor(sanctionId)).decidedAt!.getTime());
      const [notice] = (await notices.loadSanctionNotices(subject.userId)).notices;
      expect(notice).toMatchObject({
        state: "in_effect",
        appealable: false,
        appeal: { status: "decided", outcome: "upheld" },
      });
      expect(await sanctions.isSociallyRestricted(db, subject.accountId, new Date())).toBe(true);
    });

    it("audits Modify as the decision plus the duration change, tagged with the appeal", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned("social_restriction", "30d");
      await notices.submitAppeal(subject.userId, { sanctionId, body: "too long" });
      const appeal = await appealFor(sanctionId);
      const [before] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));

      // Modify needs a new, different duration.
      await expect(decide(appeal.id, "modified", null)).rejects.toMatchObject(moderationError(400));
      await expect(decide(appeal.id, "upheld", "7d")).rejects.toMatchObject(moderationError(400));
      await expect(decide(appeal.id, "modified", "30d")).rejects.toMatchObject(
        moderationError(400),
      );
      expect(await appealFor(sanctionId)).toMatchObject({ outcome: null });

      const decidedAt = new Date();
      const { result, rows } = await auditDelta(moderationCase.id, () =>
        decide(appeal.id, "modified", "24h", decidedAt),
      );
      expect(result).toMatchObject({ changed: true, gameplayAccessChanged: false });
      expect(rows.map((row) => row.operation).sort()).toEqual(
        ["change_moderation_sanction_duration", "decide_moderation_appeal"].sort(),
      );
      const change = rows.find((row) => row.operation === "change_moderation_sanction_duration")!;
      expect(change).toMatchObject({
        adminUserId: ADMIN,
        moderationCaseId: moderationCase.id,
        details: expect.objectContaining({
          appealId: appeal.id,
          duration: { from: "30d", to: "24h" },
        }),
      });
      const decision = rows.find((row) => row.operation === "decide_moderation_appeal")!;
      expect(decision.details).toMatchObject({ outcome: "modified", duration: "24h", sanctionId });
      const [after] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(after).toMatchObject({ duration: "24h" });
      expect(after!.endsAt!.getTime()).toBe(before!.startsAt.getTime() + 24 * HOUR_MS);
      const [notice] = (await notices.loadSanctionNotices(subject.userId)).notices;
      expect(notice).toMatchObject({
        durationLabel: "24 hours",
        appeal: { status: "decided", outcome: "modified" },
      });

      // A warning has no duration to modify; the decision rolls back.
      const warned = await sanctioned("warning", null);
      await notices.submitAppeal(warned.subject.userId, {
        sanctionId: warned.sanctionId,
        body: "why",
      });
      const warnedAppeal = await appealFor(warned.sanctionId);
      await expect(decide(warnedAppeal.id, "modified", "7d")).rejects.toMatchObject(
        moderationError(400),
      );
      expect(await appealFor(warned.sanctionId)).toMatchObject({ outcome: null });
    });

    it("audits Reverse as the decision plus the reversal, tagged with the appeal, and lifts the effect at once", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned("suspension", "permanent");
      await notices.submitAppeal(subject.userId, { sanctionId, body: "wrong account" });
      const appeal = await appealFor(sanctionId);
      await expect(access.requireGameplayAccess(db, subject.userId)).rejects.toMatchObject({
        reason: "suspended",
      });

      const { result, rows } = await auditDelta(moderationCase.id, () =>
        decide(appeal.id, "reversed", null, new Date()),
      );
      expect(result).toMatchObject({ changed: true, gameplayAccessChanged: true });
      expect(rows.map((row) => row.operation).sort()).toEqual(
        ["decide_moderation_appeal", "reverse_moderation_sanction"].sort(),
      );
      const reversal = rows.find((row) => row.operation === "reverse_moderation_sanction")!;
      expect(reversal).toMatchObject({
        adminUserId: ADMIN,
        moderationCaseId: moderationCase.id,
        targetIdentity: sanctionId,
        details: expect.objectContaining({ appealId: appeal.id, kind: "suspension" }),
      });
      expect(
        rows.find((row) => row.operation === "decide_moderation_appeal")!.details,
      ).toMatchObject({
        outcome: "reversed",
        sanctionId,
      });
      await expect(access.requireGameplayAccess(db, subject.userId)).resolves.toBe(
        subject.accountId,
      );
      const [notice] = (await notices.loadSanctionNotices(subject.userId)).notices;
      expect(notice).toMatchObject({
        state: "reversed",
        appealable: false,
        current: false,
        appeal: { status: "decided", outcome: "reversed" },
      });
    });

    it("audits only the decision when Reverse is decided on an already reversed sanction", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned();
      await notices.submitAppeal(subject.userId, { sanctionId, body: "review" });
      await reverse(sanctionId);
      const appeal = await appealFor(sanctionId);
      const { rows } = await auditDelta(moderationCase.id, () => decide(appeal.id, "reversed"));
      expect(rows.map((row) => row.operation)).toEqual(["decide_moderation_appeal"]);
    });

    it("decides an appeal once and never changes a decided one", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned();
      await notices.submitAppeal(subject.userId, { sanctionId, body: "review" });
      const appeal = await appealFor(sanctionId);
      await decide(appeal.id, "upheld", null, new Date(), "final");
      const decided = await appealFor(sanctionId);
      const auditCount = (await caseAudit(moderationCase.id)).length;

      for (const outcome of ["upheld", "reversed"] as const) {
        await expect(decide(appeal.id, outcome)).rejects.toMatchObject(moderationError(409));
      }
      await expect(decide(appeal.id, "modified", "24h")).rejects.toMatchObject(
        moderationError(409),
      );
      await expect(decide(randomUUID(), "upheld")).rejects.toMatchObject(moderationError(404));
      expect(await appealFor(sanctionId)).toEqual(decided);
      expect(await caseAudit(moderationCase.id)).toHaveLength(auditCount);
      const [row] = await db
        .select()
        .from(rune.moderationSanctions)
        .where(eq(rune.moderationSanctions.id, sanctionId));
      expect(row!.reversedAt).toBeNull();
    });

    it("reflects appeal decisions in the operator's case view", async () => {
      const { subject, moderationCase, sanctionId } = await sanctioned();
      await notices.submitAppeal(subject.userId, { sanctionId, body: "the appeal text" });
      const pending = await readCase(moderationCase.id);
      expect(pending.sanctions[0]!.appeal).toMatchObject({
        body: "the appeal text",
        outcome: null,
        decidedAt: null,
        decidedByAdminUserId: null,
      });
      await inTx((tx) =>
        seams.decideAppealAs(
          tx,
          ADMIN_TWO,
          {
            appealId: pending.sanctions[0]!.appeal!.appealId,
            outcome: "upheld",
            duration: null,
            note: "no change",
          },
          new Date(),
        ),
      );
      const decided = await readCase(moderationCase.id);
      expect(decided.sanctions[0]!.appeal).toMatchObject({
        outcome: "upheld",
        decidedByAdminUserId: ADMIN_TWO,
        decisionNote: "no change",
      });
      const queue = await inTx((tx) => seams.readModerationQueueAs(tx, ADMIN, "appeals"));
      expect(queue.entries.find((entry) => entry.caseId === moderationCase.id)).toBeUndefined();
    });
  });
});
