import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #172 — the committed migration into generic repair persistence.
 *
 * The rest of the integration suite runs against the migrated schema, which
 * proves the destination but not the journey. This one replays the real
 * committed migration files against a scratch database: it builds the schema as
 * it stood before #172, seeds Cargo Hold repairs in the states real characters
 * are actually in, applies the committed 0019 migration, and asserts that every
 * contributed material, every Welding increment, and every completion timestamp
 * survived verbatim — and that the specialized table is genuinely gone rather
 * than kept around as a fallback.
 *
 * It uses raw `pg` against its own database rather than the shared Drizzle
 * client, because the whole point is the pre-migration schema.
 */
suite("issue #172 repair-target migration (real PostgreSQL)", () => {
  const ROOT = resolve(new URL("../..", import.meta.url).pathname);
  const MIGRATION = "0019_crew_stop_repair_targets_and_travel_modes";
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

  it("carries every existing Cargo Hold repair across verbatim and retires the old table", async () => {
    const tags = journalTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);

    // Build the schema exactly as it stood before this issue.
    for (const tag of tags.slice(0, index)) await applyMigration(tag);
    const before = await client.query(
      `SELECT to_regclass('public.character_cargo_hold_repair') AS present`,
    );
    expect(before.rows[0].present).not.toBeNull();

    await client.query(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('migration-user', 'Migration Tester', 'migration@example.test', true, now(), now());
      INSERT INTO player_accounts (id, user_id) VALUES ('migration-account', 'migration-user');
      INSERT INTO characters (id, player_account_id, slot, display_name, normalized_name)
      VALUES ('finished', 'migration-account', 1, 'Finished', 'finished'),
             ('partway', 'migration-account', 2, 'Partway', 'partway'),
             ('untouched', 'migration-account', 3, 'Untouched', 'untouched');
      INSERT INTO character_cargo_hold_repair
        (character_id, refined_ferrite_contributed, slag_contributed, welding_progress, completed_at)
      VALUES ('finished', 15, 6, 12, timestamptz '2026-01-02 03:04:05+00'),
             ('partway', 15, 6, 7, NULL),
             ('untouched', 0, 0, 0, NULL);
      INSERT INTO character_travel_state (character_id, origin_location_id, destination_location_id)
      VALUES ('partway', 'crash_site', 'holo_hollow');
    `);

    await applyMigration(MIGRATION);

    const migrated = await client.query(
      `SELECT character_id, target_id, refined_ferrite_contributed, slag_contributed,
              welding_progress, completed_at
       FROM character_repair_targets ORDER BY character_id`,
    );
    expect(migrated.rows).toEqual([
      {
        character_id: "finished",
        target_id: "cargo_hold",
        refined_ferrite_contributed: 15,
        slag_contributed: 6,
        welding_progress: 12,
        completed_at: new Date("2026-01-02T03:04:05.000Z"),
      },
      {
        character_id: "partway",
        target_id: "cargo_hold",
        refined_ferrite_contributed: 15,
        slag_contributed: 6,
        welding_progress: 7,
        completed_at: null,
      },
      {
        character_id: "untouched",
        target_id: "cargo_hold",
        refined_ferrite_contributed: 0,
        slag_contributed: 0,
        welding_progress: 0,
        completed_at: null,
      },
    ]);

    // No compatibility shim is left behind.
    const after = await client.query(
      `SELECT to_regclass('public.character_cargo_hold_repair') AS present`,
    );
    expect(after.rows[0].present).toBeNull();
  }, 120_000);

  it("marks every existing Journey as a walk and keeps its Scavenge window", async () => {
    const travel = await client.query(
      `SELECT mode, scavenge_opportunity_start_tick FROM character_travel_state`,
    );
    expect(travel.rows).toEqual([{ mode: "walk", scavenge_opportunity_start_tick: 3 }]);
  });

  it("enforces the riding-has-no-Scavenge-window invariant in the schema itself", async () => {
    // A ride may never carry a window...
    await expect(
      client.query(
        `INSERT INTO character_travel_state
           (character_id, origin_location_id, destination_location_id, mode, scavenge_opportunity_start_tick)
         VALUES ('finished', 'holo_hollow', 'the_jag', 'crew_hauler', 5)`,
      ),
    ).rejects.toThrow();
    // ...and a walk may never be missing one.
    await expect(
      client.query(
        `INSERT INTO character_travel_state
           (character_id, origin_location_id, destination_location_id, mode, scavenge_opportunity_start_tick)
         VALUES ('finished', 'crash_site', 'holo_hollow', 'walk', NULL)`,
      ),
    ).rejects.toThrow();
    // A ride with no window is exactly right.
    await client.query(
      `INSERT INTO character_travel_state
         (character_id, origin_location_id, destination_location_id, mode, scavenge_opportunity_start_tick)
       VALUES ('finished', 'holo_hollow', 'the_jag', 'crew_hauler', NULL)`,
    );
    // And a claimed Scavenge outcome can only ever belong to a walk.
    await expect(
      client.query(
        `UPDATE character_travel_state SET scavenge_outcome_id = 'ferrite_shale_1'
         WHERE character_id = 'finished'`,
      ),
    ).rejects.toThrow();
  });
});
