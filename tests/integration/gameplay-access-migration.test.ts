import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #223 — the committed gameplay-access migration, replayed from the
 * schema as it stood before #223 with existing operator audit history.
 *
 * The rest of the integration suite runs against the migrated schema, which
 * proves the destination but not the journey. This replays the real committed
 * migration files into a scratch database: it builds the pre-#223 schema, seeds
 * character-scoped operator audit rows the way #113 wrote them, applies 0026,
 * and asserts that the history kept its meaning, that the singleton access
 * state is initialized Closed with the locked target, and that the new
 * invariants hold in the database itself.
 */
suite("issue #223 gameplay-access migration (real PostgreSQL)", () => {
  const ROOT = resolve(new URL("../..", import.meta.url).pathname);
  const MIGRATION = "0026_gameplay_access_launch_control";
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

  it("keeps existing character audit history verbatim and seeds public gameplay Closed", async () => {
    const tags = journalTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);
    for (const tag of tags.slice(0, index)) await applyMigration(tag);

    await client.query(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('migration-user', 'Migration Tester', 'migration-223@example.test', true, now(), now());
      INSERT INTO player_accounts (id, user_id) VALUES ('migration-account', 'migration-user');
      INSERT INTO characters (id, player_account_id, slot, display_name, normalized_name)
      VALUES ('audited', 'migration-account', 1, 'Audited', 'audited');
      INSERT INTO operator_audit_logs
        (id, admin_user_id, character_id, operation, target_identity, details, created_at)
      VALUES ('audit-1', 'operator-1', 'audited', 'teleport_character', 'holo_hollow',
              '{"from":"crash_site","to":"holo_hollow"}', timestamptz '2026-08-01 10:00:00+00'),
             ('audit-2', 'operator-1', 'audited', 'set_skill_xp', 'mining',
              '{"skillId":"mining","before":0,"after":120}', timestamptz '2026-08-02 11:00:00+00');
    `);

    await applyMigration(MIGRATION);

    const history = await client.query(
      `SELECT id, admin_user_id, target_kind, character_id, player_account_id, operation,
              target_identity, details, created_at
       FROM operator_audit_logs ORDER BY id`,
    );
    expect(history.rows).toEqual([
      {
        id: "audit-1",
        admin_user_id: "operator-1",
        target_kind: "character",
        character_id: "audited",
        player_account_id: null,
        operation: "teleport_character",
        target_identity: "holo_hollow",
        details: { from: "crash_site", to: "holo_hollow" },
        created_at: new Date("2026-08-01T10:00:00.000Z"),
      },
      {
        id: "audit-2",
        admin_user_id: "operator-1",
        target_kind: "character",
        character_id: "audited",
        player_account_id: null,
        operation: "set_skill_xp",
        target_identity: "mining",
        details: { skillId: "mining", before: 0, after: 120 },
        created_at: new Date("2026-08-02T11:00:00.000Z"),
      },
    ]);

    const state = await client.query(`SELECT * FROM runespace_access_state`);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      id: 1,
      public_gameplay_open: false,
      soft_alpha_launch_target_at: new Date("2026-10-27T16:00:00.000Z"),
      updated_by_admin_user_id: null,
    });

    const account = await client.query(
      `SELECT early_access_granted_at, early_access_granted_by_admin_user_id
       FROM player_accounts WHERE id = 'migration-account'`,
    );
    expect(account.rows).toEqual([
      { early_access_granted_at: null, early_access_granted_by_admin_user_id: null },
    ]);
  }, 120_000);

  it("requires every future audit row to state its target kind", async () => {
    await expect(
      client.query(
        `INSERT INTO operator_audit_logs (admin_user_id, character_id, operation, details)
         VALUES ('operator-1', 'audited', 'stop_current_action', '{}')`,
      ),
    ).rejects.toThrow(/target_kind/);
  });

  it("enforces the target shape, the paired Early Access fields, and the singleton in the schema", async () => {
    const reject = (statement: string) => expect(client.query(statement)).rejects.toThrow();
    await reject(
      `INSERT INTO operator_audit_logs (admin_user_id, target_kind, player_account_id, operation, details)
       VALUES ('operator-1', 'character', 'migration-account', 'grant_early_access', '{}')`,
    );
    await reject(
      `INSERT INTO operator_audit_logs (admin_user_id, target_kind, character_id, operation, details)
       VALUES ('operator-1', 'system', 'audited', 'open_public_gameplay', '{}')`,
    );
    await reject(
      `UPDATE player_accounts SET early_access_granted_at = now() WHERE id = 'migration-account'`,
    );
    await reject(
      `INSERT INTO runespace_access_state (id, soft_alpha_launch_target_at) VALUES (2, now())`,
    );
    // The valid account and system shapes are accepted.
    await client.query(
      `INSERT INTO operator_audit_logs (admin_user_id, target_kind, player_account_id, operation, details)
       VALUES ('operator-1', 'player_account', 'migration-account', 'grant_early_access', '{}')`,
    );
    await client.query(
      `INSERT INTO operator_audit_logs (admin_user_id, target_kind, operation, details)
       VALUES ('operator-1', 'system', 'open_public_gameplay', '{}')`,
    );
  });
});
