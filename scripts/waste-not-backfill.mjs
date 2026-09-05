#!/usr/bin/env node

// One-time Issue #141 maintenance operation.
//
// The default command is a read-only dry run. Execution requires both a saved
// dry-run report and an exact confirmation token. Active-action characters are
// reported and skipped so the operator can rerun after they are stationary.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MISSION_IDS } from "../game/config/foundations.ts";

const { Client } = pg;

export const REPORT_KIND = "runespace.issue-141.waste-not-backfill";
export const REPORT_SCHEMA_VERSION = 1;
export const EXECUTION_CONFIRMATION = "ISSUE-141-WASTE-NOT-BACKFILL";

const AUTHORITY = Object.freeze({
  missionIds: Object.freeze({
    walkItOff: MISSION_IDS.walkItOff,
    cutYourTeeth: MISSION_IDS.cutYourTeeth,
    wasteNot: MISSION_IDS.wasteNot,
  }),
  progressKey: "refining-attempts",
});

const USAGE = `Usage:
  pnpm --silent run maintenance:issue-141
  node --experimental-strip-types scripts/waste-not-backfill.mjs --verify --expected-report <dry-run.json>
  node --experimental-strip-types scripts/waste-not-backfill.mjs --execute --confirm ${EXECUTION_CONFIRMATION} --expected-report <dry-run.json>

The default mode is read-only dry run. Execution requires the exact
confirmation token and an unchanged saved dry-run report.`;

export class WasteNotBackfillError extends Error {
  constructor(message) {
    super(message);
    this.name = "WasteNotBackfillError";
  }
}

function fail(message) {
  throw new WasteNotBackfillError(message);
}

function stableJson(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return entry;
  });
}

function parseArgs(argv) {
  const options = { mode: "dry-run" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") options.mode = "execute";
    else if (argument === "--verify") options.mode = "verify";
    else if (argument === "--confirm") options.confirm = argv[++index];
    else if (argument === "--expected-report") options.expectedReport = argv[++index];
    else if (argument === "--help" || argument === "-h") return { help: true };
    else fail(`unknown argument: ${argument}`);
  }
  if (options.mode !== "dry-run" && !options.expectedReport) {
    fail("--expected-report is required for --execute and --verify");
  }
  if (options.mode === "execute" && options.confirm !== EXECUTION_CONFIRMATION) {
    fail(`--confirm must equal ${EXECUTION_CONFIRMATION}`);
  }
  return options;
}

function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("DATABASE_URL is invalid");
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    fail("refusing to run outside a localhost database");
  }
  return raw;
}

function expectedComparable(report) {
  return {
    authority: report.authority,
    wouldAcceptCharacterIds: report.wouldAcceptCharacterIds,
    skippedActiveAction: report.skippedActiveAction,
    alreadyAcceptedCharacterIds: report.alreadyAcceptedCharacterIds,
  };
}

function loadExpectedReport(path) {
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("could not read or parse the expected dry-run report");
  }
  if (!report || report.kind !== REPORT_KIND || report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    fail("expected report kind or schema version is invalid");
  }
  if (!Array.isArray(report.wouldAcceptCharacterIds))
    fail("expected eligible character IDs are invalid");
  if (!Array.isArray(report.skippedActiveAction))
    fail("expected skipped active-action report is invalid");
  if (!Array.isArray(report.alreadyAcceptedCharacterIds))
    fail("expected already-accepted IDs are invalid");
  return report;
}

export async function queryScan(client) {
  const [wouldAccept, skippedActiveAction, alreadyAccepted] = await Promise.all([
    client.query(
      `
        SELECT c.id
        FROM characters AS c
        INNER JOIN character_missions AS walk
          ON walk.character_id = c.id
         AND walk.mission_id = $1
         AND walk.completed_at IS NOT NULL
        INNER JOIN character_missions AS cut
          ON cut.character_id = c.id
         AND cut.mission_id = $2
         AND cut.completed_at IS NOT NULL
        LEFT JOIN character_missions AS waste
          ON waste.character_id = c.id
         AND waste.mission_id = $3
        LEFT JOIN active_actions AS action
          ON action.character_id = c.id
        WHERE waste.character_id IS NULL
          AND action.character_id IS NULL
        ORDER BY c.id
      `,
      [
        AUTHORITY.missionIds.walkItOff,
        AUTHORITY.missionIds.cutYourTeeth,
        AUTHORITY.missionIds.wasteNot,
      ],
    ),
    client.query(
      `
        SELECT c.id, action.action_id
        FROM characters AS c
        INNER JOIN character_missions AS walk
          ON walk.character_id = c.id
         AND walk.mission_id = $1
         AND walk.completed_at IS NOT NULL
        INNER JOIN character_missions AS cut
          ON cut.character_id = c.id
         AND cut.mission_id = $2
         AND cut.completed_at IS NOT NULL
        LEFT JOIN character_missions AS waste
          ON waste.character_id = c.id
         AND waste.mission_id = $3
        INNER JOIN active_actions AS action
          ON action.character_id = c.id
        WHERE waste.character_id IS NULL
        ORDER BY c.id, action.action_id
      `,
      [
        AUTHORITY.missionIds.walkItOff,
        AUTHORITY.missionIds.cutYourTeeth,
        AUTHORITY.missionIds.wasteNot,
      ],
    ),
    client.query(
      `
        SELECT c.id
        FROM characters AS c
        INNER JOIN character_missions AS walk
          ON walk.character_id = c.id
         AND walk.mission_id = $1
         AND walk.completed_at IS NOT NULL
        INNER JOIN character_missions AS cut
          ON cut.character_id = c.id
         AND cut.mission_id = $2
         AND cut.completed_at IS NOT NULL
        INNER JOIN character_missions AS waste
          ON waste.character_id = c.id
         AND waste.mission_id = $3
        ORDER BY c.id
      `,
      [
        AUTHORITY.missionIds.walkItOff,
        AUTHORITY.missionIds.cutYourTeeth,
        AUTHORITY.missionIds.wasteNot,
      ],
    ),
  ]);
  return {
    wouldAcceptCharacterIds: wouldAccept.rows.map((row) => row.id),
    skippedActiveAction: skippedActiveAction.rows.map((row) => ({
      characterId: row.id,
      actionId: row.action_id,
    })),
    alreadyAcceptedCharacterIds: alreadyAccepted.rows.map((row) => row.id),
  };
}

export function reportFromScan(scan) {
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    authority: AUTHORITY,
    ...scan,
    counts: {
      wouldAccept: scan.wouldAcceptCharacterIds.length,
      skippedActiveAction: scan.skippedActiveAction.length,
      alreadyAccepted: scan.alreadyAcceptedCharacterIds.length,
    },
  };
}

function assertExpectedReportMatches(scan, expectedReport) {
  if (
    stableJson(expectedComparable(reportFromScan(scan))) !==
    stableJson(expectedComparable(expectedReport))
  ) {
    fail("database state no longer matches the reviewed dry-run report; aborting without writes");
  }
}

export async function lockPopulation(client) {
  await client.query("SELECT id FROM player_accounts ORDER BY id FOR UPDATE");
  await client.query("SELECT id FROM characters ORDER BY id FOR UPDATE");
}

export async function applyBackfill(client, characterIds, now) {
  if (characterIds.length === 0) return;
  await client.query(
    `
      INSERT INTO character_missions (character_id, mission_id, accepted_at)
      SELECT unnest($1::text[]), $2, $3
      ON CONFLICT (character_id, mission_id) DO NOTHING
    `,
    [characterIds, AUTHORITY.missionIds.wasteNot, now],
  );
  await client.query(
    `
      INSERT INTO character_mission_progress
        (character_id, mission_id, progress_key, progress, updated_at)
      SELECT unnest($1::text[]), $2, $3, 0, $4
      ON CONFLICT (character_id, mission_id, progress_key) DO NOTHING
    `,
    [characterIds, AUTHORITY.missionIds.wasteNot, AUTHORITY.progressKey, now],
  );
}

export async function verifyApplied(client, expectedReport) {
  const rows = await client.query(
    `
      SELECT cm.character_id, cm.accepted_at, cm.completed_at, p.progress
      FROM character_missions AS cm
      LEFT JOIN character_mission_progress AS p
        ON p.character_id = cm.character_id
       AND p.mission_id = cm.mission_id
       AND p.progress_key = $2
      WHERE cm.mission_id = $1
        AND cm.character_id = ANY($3::text[])
      ORDER BY cm.character_id
    `,
    [AUTHORITY.missionIds.wasteNot, AUTHORITY.progressKey, expectedReport.wouldAcceptCharacterIds],
  );
  const byCharacter = new Map(rows.rows.map((row) => [row.character_id, row]));
  const passed = expectedReport.wouldAcceptCharacterIds.every((characterId) => {
    const row = byCharacter.get(characterId);
    return row && row.accepted_at && !row.completed_at && row.progress === 0;
  });
  return {
    expected: expectedReport.wouldAcceptCharacterIds.length,
    accepted: rows.rows.length,
    progressAtZero: rows.rows.filter((row) => row.progress === 0).length,
    passed,
  };
}

async function run(options) {
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    if (options.mode === "dry-run") {
      const report = reportFromScan(await queryScan(client));
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return;
    }

    const expectedReport = loadExpectedReport(options.expectedReport);
    if (options.mode === "verify") {
      const verification = await verifyApplied(client, expectedReport);
      process.stdout.write(
        `${JSON.stringify({
          kind: REPORT_KIND,
          schemaVersion: REPORT_SCHEMA_VERSION,
          mode: "verify",
          generatedAt: new Date().toISOString(),
          verification,
        })}\n`,
      );
      if (!verification.passed) process.exitCode = 1;
      return;
    }

    const before = await queryScan(client);
    assertExpectedReportMatches(before, expectedReport);
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    try {
      await lockPopulation(client);
      const lockedScan = await queryScan(client);
      assertExpectedReportMatches(lockedScan, expectedReport);
      await applyBackfill(client, expectedReport.wouldAcceptCharacterIds, new Date());
      const verification = await verifyApplied(client, expectedReport);
      if (!verification.passed) fail("backfill verification failed; rolling back");
      await client.query("COMMIT");
      process.stdout.write(
        `${JSON.stringify({
          kind: REPORT_KIND,
          schemaVersion: REPORT_SCHEMA_VERSION,
          mode: "execute",
          generatedAt: new Date().toISOString(),
          accepted: expectedReport.wouldAcceptCharacterIds.length,
          skippedActiveAction: expectedReport.skippedActiveAction,
          verification,
        })}\n`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}
