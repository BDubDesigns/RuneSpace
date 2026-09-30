import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #256 — the committed migration that makes Auto-discard Slag a
 * character-wide preference.
 *
 * Replays the real committed migration files against a scratch database: it
 * builds the schema as it stood when the preference lived in Practice Welding's
 * own table, seeds characters in the states real ones are in, applies the
 * committed 0031 migration, and asserts every existing Practice choice survived
 * on the character while everyone else keeps the Off default.
 */
suite("issue #256 Auto-discard Slag migration (real PostgreSQL)", () => {
  const ROOT = resolve(new URL("../..", import.meta.url).pathname);
  const MIGRATION = "0031_character_auto_discard_slag";
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

  it("carries each Practice choice onto its character and retires the Practice column", async () => {
    const tags = journalTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);

    for (const tag of tags.slice(0, index)) await applyMigration(tag);

    await client.query(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('slag-user', 'Slag Tester', 'slag@example.test', true, now(), now());
      INSERT INTO player_accounts (id, user_id) VALUES ('slag-account', 'slag-user');
      INSERT INTO characters (id, player_account_id, slot, display_name, normalized_name)
      VALUES ('discards', 'slag-account', 1, 'Discards', 'discards'),
             ('keeps', 'slag-account', 2, 'Keeps', 'keeps'),
             ('never-practised', 'slag-account', 3, 'Never', 'never');
      INSERT INTO character_practice_welds (character_id, auto_discard_slag)
      VALUES ('discards', true), ('keeps', false);
    `);

    await applyMigration(MIGRATION);

    const rows = await client.query(`SELECT id, auto_discard_slag FROM characters ORDER BY id`);
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.auto_discard_slag]))).toEqual({
      discards: true,
      keeps: false,
      "never-practised": false,
    });

    const practiceColumn = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'character_practice_welds' AND column_name = 'auto_discard_slag'`,
    );
    expect(practiceColumn.rowCount).toBe(0);

    // The discarded-output run totals start empty for an existing Refining row.
    const refining = await client.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'character_refining_state' AND column_name = 'run_outputs_discarded'`,
    );
    expect(refining.rowCount).toBe(1);
  });
});
