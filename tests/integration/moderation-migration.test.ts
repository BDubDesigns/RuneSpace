import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #248 — the committed moderation migration, replayed from the schema as
 * it stood before #248 with reports already on file.
 *
 * The rest of the integration suite runs against the migrated schema, which
 * proves the destination but not the journey. This replays the real committed
 * migration files into a scratch database: it builds the pre-#248 schema, files
 * `player_reports` against two accounts the way #247 wrote them, applies 0034,
 * and asserts that every report is linked to exactly one open, report-opened
 * case per reported account (with `case_id` now required) and that the new
 * CHECKs, unique indexes, and restrict foreign keys hold in the database itself.
 */
suite("issue #248 moderation migration (real PostgreSQL)", () => {
  const ROOT = resolve(new URL("../..", import.meta.url).pathname);
  const MIGRATION = "0034_moderation_review_sanctions";
  const scratchDatabase = `runespace_test_migration_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let admin: pg.Client;
  let client: pg.Client;

  function journalTags(): readonly string[] {
    const journal = JSON.parse(
      readFileSync(resolve(ROOT, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    return journal.entries.map((entry) => entry.tag);
  }

  async function applyMigration(tag: string) {
    const sql = readFileSync(resolve(ROOT, `drizzle/${tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim().length === 0) continue;
      await client.query(statement);
    }
  }

  async function rejects(statement: string, pattern?: RegExp) {
    const attempt = expect(client.query(statement)).rejects;
    if (pattern) await attempt.toThrow(pattern);
    else await attempt.toThrow();
  }

  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratchDatabase}"`);
    url.pathname = `/${scratchDatabase}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${scratchDatabase}"`);
    await admin?.end();
  }, 60_000);

  it("links every pre-existing report to one open report-opened case per reported account", async () => {
    const tags = journalTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);
    expect(tags[index - 1]).toBe("0033_whispers_blocks_reports");
    for (const tag of tags.slice(0, index)) await applyMigration(tag);

    // Four accounts, one character each: two reporters and two reported.
    // `reported-b`'s first report is older than `reported-a`'s, so its case
    // is numbered first; `reported-a` has three reports, `reported-b` one.
    await client.query(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('u-rep-1', 'Rep One', 'rep1-248@example.test', true, now(), now()),
             ('u-rep-2', 'Rep Two', 'rep2-248@example.test', true, now(), now()),
             ('u-rd-a', 'Reported A', 'rda-248@example.test', true, now(), now()),
             ('u-rd-b', 'Reported B', 'rdb-248@example.test', true, now(), now());
      INSERT INTO player_accounts (id, user_id)
      VALUES ('acct-rep-1', 'u-rep-1'), ('acct-rep-2', 'u-rep-2'),
             ('acct-rd-a', 'u-rd-a'), ('acct-rd-b', 'u-rd-b');
      INSERT INTO characters (id, player_account_id, slot, display_name, normalized_name)
      VALUES ('char-rep-1', 'acct-rep-1', 1, 'RepOne', 'repone'),
             ('char-rep-2', 'acct-rep-2', 1, 'RepTwo', 'reptwo'),
             ('char-rd-a', 'acct-rd-a', 1, 'ReportedA', 'reporteda'),
             ('char-rd-b', 'acct-rd-b', 1, 'ReportedB', 'reportedb');
      INSERT INTO player_reports
        (id, kind, reporter_player_account_id, reporter_character_id,
         reported_player_account_id, reported_character_id, reported_character_name,
         reason, note, message_id, channel, evidence, created_at)
      VALUES
        ('rpt-a1', 'player', 'acct-rep-1', 'char-rep-1', 'acct-rd-a', 'char-rd-a', 'ReportedA',
         'other', 'first', NULL, NULL, NULL, timestamptz '2026-08-10 10:00:00+00'),
        ('rpt-b1', 'message', 'acct-rep-1', 'char-rep-1', 'acct-rd-b', 'char-rd-b', 'ReportedB',
         'threats', NULL, 'msg-b1', 'general',
         '{"message":{"id":"msg-b1","body":"hi"},"before":[],"after":[]}',
         timestamptz '2026-08-09 09:00:00+00'),
        ('rpt-a2', 'message', 'acct-rep-2', 'char-rep-2', 'acct-rd-a', 'char-rd-a', 'ReportedA',
         'harassment_hate', 'second', 'msg-a2', 'trade',
         '{"message":{"id":"msg-a2","body":"yo"},"before":[],"after":[]}',
         timestamptz '2026-08-12 12:00:00+00'),
        ('rpt-a3', 'player', 'acct-rep-2', 'char-rep-2', 'acct-rd-a', 'char-rd-a', 'ReportedA',
         'spam_scam', NULL, NULL, NULL, NULL, timestamptz '2026-08-15 15:00:00+00');
    `);

    await applyMigration(MIGRATION);

    const cases = await client.query(
      `SELECT case_number::int AS case_number, subject_player_account_id, status, opened_by,
              opened_by_admin_user_id, opening_reason, created_at, updated_at
       FROM moderation_cases ORDER BY case_number`,
    );
    expect(cases.rows).toEqual([
      {
        case_number: 1,
        subject_player_account_id: "acct-rd-b",
        status: "open",
        opened_by: "report",
        opened_by_admin_user_id: null,
        opening_reason: null,
        created_at: new Date("2026-08-09T09:00:00.000Z"),
        updated_at: new Date("2026-08-09T09:00:00.000Z"),
      },
      {
        case_number: 2,
        subject_player_account_id: "acct-rd-a",
        status: "open",
        opened_by: "report",
        opened_by_admin_user_id: null,
        opening_reason: null,
        created_at: new Date("2026-08-10T10:00:00.000Z"),
        updated_at: new Date("2026-08-15T15:00:00.000Z"),
      },
    ]);

    // Every report is linked to its reported account's one case, verbatim
    // otherwise, and case_id is now required.
    const reports = await client.query(
      `SELECT r.id, r.kind, r.reason, r.note, r.message_id, r.created_at,
              c.subject_player_account_id AS case_subject
       FROM player_reports r JOIN moderation_cases c ON c.id = r.case_id
       ORDER BY r.created_at`,
    );
    expect(reports.rows).toEqual([
      expect.objectContaining({
        id: "rpt-b1",
        kind: "message",
        reason: "threats",
        message_id: "msg-b1",
        case_subject: "acct-rd-b",
      }),
      expect.objectContaining({
        id: "rpt-a1",
        kind: "player",
        reason: "other",
        note: "first",
        case_subject: "acct-rd-a",
      }),
      expect.objectContaining({
        id: "rpt-a2",
        kind: "message",
        reason: "harassment_hate",
        message_id: "msg-a2",
        case_subject: "acct-rd-a",
      }),
      expect.objectContaining({ id: "rpt-a3", kind: "player", case_subject: "acct-rd-a" }),
    ]);
    const unlinked = await client.query(`SELECT count(*)::int AS n FROM player_reports r
       WHERE r.case_id IS NULL`);
    expect(unlinked.rows[0].n).toBe(0);
    const nullable = await client.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'player_reports' AND column_name = 'case_id'`,
    );
    expect(nullable.rows).toEqual([{ is_nullable: "NO" }]);

    // The new tables start empty: nothing is sanctioned, appealed, or audited.
    for (const table of [
      "moderation_case_notes",
      "moderation_sanctions",
      "moderation_appeals",
      "privileged_access_logs",
    ]) {
      const rows = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows.rows[0].n, table).toBe(0);
    }
  }, 120_000);

  it("requires a case for every new report and refuses a second active case per account", async () => {
    await rejects(
      `INSERT INTO player_reports
         (kind, reporter_player_account_id, reporter_character_id, reported_player_account_id,
          reported_character_id, reported_character_name, reason)
       VALUES ('player', 'acct-rep-1', 'char-rep-1', 'acct-rd-a', 'char-rd-a', 'ReportedA', 'other')`,
      /case_id/,
    );
    // Open or Reviewed: one per subject account.
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rd-a', 'open', 'report')`,
      /moderation_cases_one_active_per_subject_idx/,
    );
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rd-a', 'reviewed', 'report')`,
      /moderation_cases_one_active_per_subject_idx/,
    );
    // A closed case does not block a new active one, and history may repeat.
    await client.query(
      `UPDATE moderation_cases SET status = 'dismissed' WHERE subject_player_account_id = 'acct-rd-a'`,
    );
    await client.query(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rd-a', 'open', 'report')`,
    );
    await client.query(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rd-a', 'dismissed', 'report'), ('acct-rd-a', 'actioned', 'report')`,
    );
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rd-a', 'reviewed', 'report')`,
      /moderation_cases_one_active_per_subject_idx/,
    );
    // A different account is unaffected.
    await client.query(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rep-1', 'open', 'report')`,
    );
  });

  it("enforces case status, opener shape, and the append-only note bounds", async () => {
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rep-2', 'closed', 'report')`,
      /moderation_cases_status_check/,
    );
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rep-2', 'open', 'robot')`,
      /moderation_cases_opened_by_check/,
    );
    // An operator-opened case names its operator and reason; a report-opened one names neither.
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by)
       VALUES ('acct-rep-2', 'open', 'operator')`,
      /moderation_cases_opened_by_check/,
    );
    await rejects(
      `INSERT INTO moderation_cases (subject_player_account_id, status, opened_by, opened_by_admin_user_id)
       VALUES ('acct-rep-2', 'open', 'report', 'operator-1')`,
      /moderation_cases_opened_by_check/,
    );
    await client.query(
      `INSERT INTO moderation_cases
         (id, subject_player_account_id, status, opened_by, opened_by_admin_user_id, opening_reason)
       VALUES ('case-operator', 'acct-rep-2', 'open', 'operator', 'operator-1', 'Seen in Trade')`,
    );

    await rejects(
      `INSERT INTO moderation_case_notes (case_id, admin_user_id, body)
       VALUES ('case-operator', 'operator-1', '')`,
      /moderation_case_notes_body_check/,
    );
    await rejects(
      `INSERT INTO moderation_case_notes (case_id, admin_user_id, body)
       VALUES ('case-operator', 'operator-1', '${"x".repeat(2001)}')`,
      /moderation_case_notes_body_check/,
    );
    await client.query(
      `INSERT INTO moderation_case_notes (case_id, admin_user_id, body)
       VALUES ('case-operator', 'operator-1', '${"x".repeat(2000)}')`,
    );
  });

  it("enforces the sanction shape, appeals once per sanction, and audit-log kinds", async () => {
    const sanction = (columns: string, values: string) =>
      `INSERT INTO moderation_sanctions
         (case_id, player_account_id, kind, rule_category, issued_by_admin_user_id, starts_at, ${columns})
       VALUES ('case-operator', 'acct-rep-2', ${values})`;
    const base = `'harassment', 'operator-1', now()`;
    // A warning has neither duration nor end.
    await rejects(
      sanction("duration, ends_at", `'warning', ${base}, '24h', now() + interval '1 day'`),
      /moderation_sanctions_duration_check/,
    );
    await rejects(
      sanction("duration, ends_at", `'warning', ${base}, NULL, now() + interval '1 day'`),
      /moderation_sanctions_duration_check/,
    );
    // A restriction or suspension needs a preset duration; permanent means no end.
    await rejects(
      sanction("duration, ends_at", `'suspension', ${base}, '3d', now() + interval '3 days'`),
      /moderation_sanctions_duration_check/,
    );
    await rejects(
      sanction("duration, ends_at", `'suspension', ${base}, 'permanent', now() + interval '1 day'`),
      /moderation_sanctions_duration_check/,
    );
    await rejects(
      sanction("duration, ends_at", `'social_restriction', ${base}, '7d', NULL`),
      /moderation_sanctions_duration_check/,
    );
    // Kind and rule vocabularies are closed.
    await rejects(
      sanction("duration, ends_at", `'ban', ${base}, 'permanent', NULL`),
      /moderation_sanctions_kind_check/,
    );
    await rejects(
      `INSERT INTO moderation_sanctions
         (case_id, player_account_id, kind, rule_category, issued_by_admin_user_id, starts_at, duration, ends_at)
       VALUES ('case-operator', 'acct-rep-2', 'warning', 'rudeness', 'operator-1', now(), NULL, NULL)`,
      /moderation_sanctions_rule_check/,
    );
    // Reversal time and reversing operator are set together.
    await rejects(
      sanction(
        "duration, ends_at, reversed_at",
        `'social_restriction', ${base}, 'permanent', NULL, now()`,
      ),
      /moderation_sanctions_reversal_paired_check/,
    );
    await rejects(
      sanction(
        "duration, ends_at, reversed_by_admin_user_id",
        `'social_restriction', ${base}, 'permanent', NULL, 'operator-1'`,
      ),
      /moderation_sanctions_reversal_paired_check/,
    );

    await client.query(
      sanction("id, duration, ends_at", `'suspension', ${base}, 'sanction-1', 'permanent', NULL`),
    );

    // One appeal per sanction, with a bounded body and a paired decision.
    const appeal = (body: string, extra = "") =>
      `INSERT INTO moderation_appeals (sanction_id, case_id, player_account_id, body${extra ? ", " + extra.split("|")[0] : ""})
       VALUES ('sanction-1', 'case-operator', 'acct-rep-2', '${body}'${extra ? ", " + extra.split("|")[1] : ""})`;
    await rejects(appeal(""), /moderation_appeals_body_check/);
    await rejects(appeal("x".repeat(1001)), /moderation_appeals_body_check/);
    await rejects(
      appeal("please", "outcome|'maybe'"),
      /moderation_appeals_outcome_check|moderation_appeals_decision_paired_check/,
    );
    // Outcome, decision time, and decider are all set or all unset.
    await rejects(appeal("please", "outcome|'upheld'"), /moderation_appeals_decision_paired_check/);
    await client.query(appeal("please, review this"));
    await rejects(appeal("again"), /moderation_appeals_sanction_id_unique/);

    // The privileged access log's kinds are closed.
    await rejects(
      `INSERT INTO privileged_access_logs (admin_user_id, access_kind, context)
       VALUES ('operator-1', 'everything', '{}')`,
      /privileged_access_logs_kind_check/,
    );
    await client.query(
      `INSERT INTO privileged_access_logs (admin_user_id, access_kind, case_id, context)
       VALUES ('operator-1', 'case_detail', 'case-operator', '{"reference":"MOD-00099"}')`,
    );
    // Moderation audit rows carry the case id.
    await client.query(
      `INSERT INTO operator_audit_logs
         (admin_user_id, target_kind, player_account_id, operation, details, moderation_case_id)
       VALUES ('operator-1', 'player_account', 'acct-rep-2', 'set_moderation_case_status', '{}', 'case-operator')`,
    );
  });

  it("refuses a restriction or suspension with no duration at all", async () => {
    // Otherwise a NULL duration with a NULL end reads as an unbounded sanction
    // the domain layer can never issue.
    for (const kind of ["social_restriction", "suspension"]) {
      await rejects(
        `INSERT INTO moderation_sanctions
           (case_id, player_account_id, kind, rule_category, issued_by_admin_user_id, starts_at,
            duration, ends_at)
         VALUES ('case-operator', 'acct-rep-2', '${kind}', 'harassment', 'operator-1', now(), NULL, NULL)`,
        /moderation_sanctions_duration_check/,
      );
    }
  });

  it("restricts deleting a case that has reports, notes, sanctions, appeals, or audit rows", async () => {
    // Every moderation foreign key is `restrict`: cases are never erased under evidence.
    await rejects(
      `DELETE FROM moderation_cases WHERE id = 'case-operator'`,
      /violates foreign key constraint/,
    );
    const reportedCase = await client.query(
      `SELECT case_id FROM player_reports WHERE id = 'rpt-a1'`,
    );
    await rejects(
      `DELETE FROM moderation_cases WHERE id = '${reportedCase.rows[0].case_id}'`,
      /violates foreign key constraint/,
    );
    await rejects(`DELETE FROM moderation_sanctions WHERE id = 'sanction-1'`, /foreign key/);
    await rejects(
      `INSERT INTO operator_audit_logs
         (admin_user_id, target_kind, player_account_id, operation, details, moderation_case_id)
       VALUES ('operator-1', 'player_account', 'acct-rep-2', 'set_moderation_case_status', '{}', 'no-such-case')`,
      /violates foreign key constraint/,
    );
  });
});
