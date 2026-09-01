#!/usr/bin/env node

// One-time Issue #126 maintenance operation.
//
// The default command is a read-only dry run. Execution requires both a saved
// dry-run report and an exact confirmation token. This file intentionally owns
// only this operation; it is not a general admin or destructive-command
// framework.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ITEM_IDS, MISSION_IDS, SKILL_IDS } from "../game/config/foundations.ts";

const { Client } = pg;

export const REPORT_KIND = "runespace.issue-126.prealpha-mission-reset";
export const REPORT_SCHEMA_VERSION = 1;
export const EXECUTION_CONFIRMATION = "ISSUE-126-RESET";

const AUTHORITY = Object.freeze({
  missionIds: Object.freeze({
    walkItOff: MISSION_IDS.walkItOff,
    cutYourTeeth: MISSION_IDS.cutYourTeeth,
  }),
  itemIds: Object.freeze({ salvageCutter: ITEM_IDS.salvageCutter }),
  skillIds: Object.freeze({ mining: SKILL_IDS.mining }),
});

const COUNT_KEYS = [
  "affectedCharacters",
  "walkItOffRows",
  "cutYourTeethRows",
  "salvageCutterInstances",
  "equippedSalvageCutterAssignments",
  "unrelatedInventoryStackRows",
  "unrelatedInventoryQuantity",
  "unrelatedItemInstances",
];

const USAGE = `Usage:
  pnpm --silent run maintenance:issue-126
  node --experimental-strip-types scripts/prealpha-mission-reset.mjs --verify --expected-report <dry-run.json>
  node --experimental-strip-types scripts/prealpha-mission-reset.mjs --execute --confirm ${EXECUTION_CONFIRMATION} --expected-report <dry-run.json>

The default mode is read-only dry run. The execution mode requires the exact
confirmation token and an unchanged saved dry-run report.`;

export class Issue126ResetError extends Error {
  constructor(message) {
    super(message);
    this.name = "Issue126ResetError";
  }
}

function fail(message) {
  throw new Issue126ResetError(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
}

function normalizeForHash(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForHash(entry)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(normalizeForHash(value));
}

function sortedRows(rows) {
  return rows.map(normalizeForHash).sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson.localeCompare(rightJson);
  });
}

function fingerprintTables(tables) {
  const normalizedTables = Object.fromEntries(
    Object.entries(tables)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, rows]) => [name, sortedRows(rows)]),
  );
  return createHash("sha256").update(stableJson(normalizedTables)).digest("hex");
}

async function selectRows(client, query, parameters = []) {
  const result = await client.query(query, parameters);
  return result.rows;
}

async function countRows(client, query, parameters = []) {
  const rows = await selectRows(client, query, parameters);
  const rawCount = rows[0]?.count;
  const count = Number(rawCount ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) fail("database returned an invalid count");
  return count;
}

function textArray(values) {
  return values;
}

async function findAffectedCharacterIds(client) {
  const rows = await selectRows(
    client,
    `
      SELECT c.id
      FROM characters AS c
      WHERE EXISTS (
        SELECT 1
        FROM character_missions AS cm
        WHERE cm.character_id = c.id
          AND cm.mission_id = ANY($1::text[])
      )
      OR EXISTS (
        SELECT 1
        FROM item_instances AS ii
        WHERE ii.character_id = c.id
          AND ii.item_id = $2
      )
      ORDER BY c.id
    `,
    [
      [AUTHORITY.missionIds.walkItOff, AUTHORITY.missionIds.cutYourTeeth],
      AUTHORITY.itemIds.salvageCutter,
    ],
  );
  return rows.map((row) => row.id);
}

async function loadTargetCounts(client, characterIds) {
  const [walkItOffRows, cutYourTeethRows, salvageCutterInstances, equippedAssignments] =
    await Promise.all([
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM character_missions
          WHERE character_id = ANY($1::text[])
            AND mission_id = $2
        `,
        [textArray(characterIds), AUTHORITY.missionIds.walkItOff],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM character_missions
          WHERE character_id = ANY($1::text[])
            AND mission_id = $2
        `,
        [textArray(characterIds), AUTHORITY.missionIds.cutYourTeeth],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM item_instances
          WHERE character_id = ANY($1::text[])
            AND item_id = $2
        `,
        [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM equipped_items AS e
          INNER JOIN item_instances AS i
            ON i.character_id = e.character_id
           AND i.id = e.item_instance_id
          WHERE e.character_id = ANY($1::text[])
            AND i.item_id = $2
        `,
        [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
      ),
    ]);

  return {
    affectedCharacters: characterIds.length,
    walkItOffRows,
    cutYourTeethRows,
    salvageCutterInstances,
    equippedSalvageCutterAssignments: equippedAssignments,
  };
}

async function loadUnsafeStates(client, characterIds) {
  const [activeActionRows, cargoCutterRows] = await Promise.all([
    selectRows(
      client,
      `
        SELECT character_id, action_id
        FROM active_actions
        WHERE character_id = ANY($1::text[])
        ORDER BY character_id, action_id
      `,
      [textArray(characterIds)],
    ),
    selectRows(
      client,
      `
        SELECT h.character_id, h.item_instance_id
        FROM cargo_hold_item_instances AS h
        INNER JOIN item_instances AS i
          ON i.character_id = h.character_id
         AND i.id = h.item_instance_id
        WHERE h.character_id = ANY($1::text[])
          AND i.item_id = $2
        ORDER BY h.character_id, h.item_instance_id
      `,
      [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
    ),
  ]);

  const unsafeStates = [];
  if (activeActionRows.length > 0) {
    unsafeStates.push({
      code: "active_action",
      count: activeActionRows.length,
      characterIds: [...new Set(activeActionRows.map((row) => row.character_id))].sort(),
      actionIds: [...new Set(activeActionRows.map((row) => row.action_id))].sort(),
    });
  }
  if (cargoCutterRows.length > 0) {
    unsafeStates.push({
      code: "salvage_cutter_in_cargo_hold",
      count: cargoCutterRows.length,
      characterIds: [...new Set(cargoCutterRows.map((row) => row.character_id))].sort(),
    });
  }
  return unsafeStates;
}

async function captureUnchangedState(client, characterIds) {
  const parameters = [textArray(characterIds), AUTHORITY.itemIds.salvageCutter];
  const tables = {
    characters: await selectRows(client, `SELECT * FROM characters WHERE id = ANY($1::text[])`, [
      textArray(characterIds),
    ]),
    character_skill_xp: await selectRows(
      client,
      `SELECT * FROM character_skill_xp WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    inventory_stacks: await selectRows(
      client,
      `SELECT * FROM inventory_stacks WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    item_instances: await selectRows(
      client,
      `
        SELECT *
        FROM item_instances
        WHERE character_id = ANY($1::text[])
          AND item_id <> $2
      `,
      parameters,
    ),
    equipped_items: await selectRows(
      client,
      `
        SELECT e.*
        FROM equipped_items AS e
        WHERE e.character_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1
            FROM item_instances AS i
            WHERE i.character_id = e.character_id
              AND i.id = e.item_instance_id
              AND i.item_id = $2
          )
      `,
      parameters,
    ),
    active_actions: await selectRows(
      client,
      `SELECT * FROM active_actions WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_travel_state: await selectRows(
      client,
      `SELECT * FROM character_travel_state WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_scavenge_reveals: await selectRows(
      client,
      `SELECT * FROM character_scavenge_reveals WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_starter_provisioning: await selectRows(
      client,
      `SELECT * FROM character_starter_provisioning WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_mining_state: await selectRows(
      client,
      `SELECT * FROM character_mining_state WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_refining_state: await selectRows(
      client,
      `SELECT * FROM character_refining_state WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_cargo_hold_repair: await selectRows(
      client,
      `SELECT * FROM character_cargo_hold_repair WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    cargo_hold_stacks: await selectRows(
      client,
      `SELECT * FROM cargo_hold_stacks WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    cargo_hold_item_instances: await selectRows(
      client,
      `SELECT * FROM cargo_hold_item_instances WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_power_cell_daily_claims: await selectRows(
      client,
      `SELECT * FROM character_power_cell_daily_claims WHERE character_id = ANY($1::text[])`,
      [textArray(characterIds)],
    ),
    character_missions: await selectRows(
      client,
      `
        SELECT *
        FROM character_missions
        WHERE character_id = ANY($1::text[])
          AND mission_id <> ALL($2::text[])
      `,
      [
        textArray(characterIds),
        [AUTHORITY.missionIds.walkItOff, AUTHORITY.missionIds.cutYourTeeth],
      ],
    ),
  };

  const inventoryStacks = tables.inventory_stacks;
  const miningRows = tables.character_skill_xp.filter(
    (row) => row.skill_id === AUTHORITY.skillIds.mining,
  );
  const miningByCharacter = new Map(
    miningRows.map((row) => [row.character_id, { totalXp: row.total_xp, rowCount: 1 }]),
  );
  const miningXp = characterIds.map((characterId) => ({
    characterId,
    totalXp: miningByCharacter.get(characterId)?.totalXp ?? null,
    rowCount: miningByCharacter.get(characterId)?.rowCount ?? 0,
  }));

  return {
    unrelatedStateFingerprint: fingerprintTables(tables),
    unrelatedInventoryStackRows: inventoryStacks.length,
    unrelatedInventoryQuantity: inventoryStacks.reduce(
      (total, row) => total + Number(row.quantity),
      0,
    ),
    unrelatedItemInstances: tables.item_instances.length,
    miningXp,
  };
}

export async function scanResetState(client) {
  const characterIds = await findAffectedCharacterIds(client);
  const [targetCounts, unsafeStates, baseline] = await Promise.all([
    loadTargetCounts(client, characterIds),
    loadUnsafeStates(client, characterIds),
    captureUnchangedState(client, characterIds),
  ]);
  return {
    characterIds,
    counts: { ...targetCounts, ...baselineCounts(baseline) },
    unsafeStates,
    baseline,
  };
}

function baselineCounts(baseline) {
  return {
    unrelatedInventoryStackRows: baseline.unrelatedInventoryStackRows,
    unrelatedInventoryQuantity: baseline.unrelatedInventoryQuantity,
    unrelatedItemInstances: baseline.unrelatedItemInstances,
  };
}

function reportFromScan(scan, mode = "dry-run") {
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode,
    authority: AUTHORITY,
    generatedAt: new Date().toISOString(),
    affectedCharacterIds: scan.characterIds,
    counts: scan.counts,
    unsafeStates: scan.unsafeStates,
    baseline: scan.baseline,
  };
}

function assertAuthority(authority) {
  if (stableJson(authority) !== stableJson(AUTHORITY))
    fail("dry-run report uses different canonical mission, item, or skill IDs");
}

function assertReportShape(report, expectedMode = "dry-run") {
  if (!isObject(report)) fail("expected report must be a JSON object");
  if (report.kind !== REPORT_KIND || report.schemaVersion !== REPORT_SCHEMA_VERSION)
    fail("expected report kind or schema version is invalid");
  if (report.mode !== expectedMode) fail(`expected report must be in ${expectedMode} mode`);
  assertAuthority(report.authority);
  if (!Array.isArray(report.affectedCharacterIds)) fail("affectedCharacterIds must be an array");
  const ids = report.affectedCharacterIds;
  if (ids.some((id) => typeof id !== "string" || id.length === 0))
    fail("affectedCharacterIds must contain non-empty strings");
  if (stableJson([...ids].sort()) !== stableJson(ids)) fail("affectedCharacterIds must be sorted");
  if (new Set(ids).size !== ids.length) fail("affectedCharacterIds must be unique");
  if (!isObject(report.counts)) fail("counts must be an object");
  for (const key of COUNT_KEYS) assertNonNegativeInteger(report.counts[key], `counts.${key}`);
  if (report.counts.affectedCharacters !== ids.length)
    fail("affectedCharacters must match affectedCharacterIds");
  if (!Array.isArray(report.unsafeStates)) fail("unsafeStates must be an array");
  if (!isObject(report.baseline)) fail("baseline must be an object");
  if (typeof report.baseline.unrelatedStateFingerprint !== "string")
    fail("baseline fingerprint is missing");
  for (const key of [
    "unrelatedInventoryStackRows",
    "unrelatedInventoryQuantity",
    "unrelatedItemInstances",
  ]) {
    assertNonNegativeInteger(report.baseline[key], `baseline.${key}`);
  }
  if (!Array.isArray(report.baseline.miningXp)) fail("baseline.miningXp must be an array");
}

function comparableReport(report) {
  return {
    authority: report.authority,
    affectedCharacterIds: report.affectedCharacterIds,
    counts: report.counts,
    unsafeStates: report.unsafeStates,
    baseline: report.baseline,
  };
}

export function assertExpectedDryRunMatches(currentScan, expectedReport) {
  assertReportShape(expectedReport, "dry-run");
  const currentReport = reportFromScan(currentScan);
  if (
    stableJson(comparableReport(currentReport)) !== stableJson(comparableReport(expectedReport))
  ) {
    fail("database state no longer matches the reviewed dry-run report; aborting without writes");
  }
}

function loadExpectedReport(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("could not read or parse the expected dry-run report");
  }
  assertReportShape(parsed, "dry-run");
  return parsed;
}

async function loadRemainingCounts(client, characterIds) {
  const [walkItOffRows, cutYourTeethRows, salvageCutterInstances, equippedAssignments] =
    await Promise.all([
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM character_missions
          WHERE character_id = ANY($1::text[])
            AND mission_id = $2
        `,
        [textArray(characterIds), AUTHORITY.missionIds.walkItOff],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM character_missions
          WHERE character_id = ANY($1::text[])
            AND mission_id = $2
        `,
        [textArray(characterIds), AUTHORITY.missionIds.cutYourTeeth],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM item_instances
          WHERE character_id = ANY($1::text[])
            AND item_id = $2
        `,
        [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
      ),
      countRows(
        client,
        `
          SELECT COUNT(*)::text AS count
          FROM equipped_items AS e
          INNER JOIN item_instances AS i
            ON i.character_id = e.character_id
           AND i.id = e.item_instance_id
          WHERE e.character_id = ANY($1::text[])
            AND i.item_id = $2
        `,
        [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
      ),
    ]);
  return {
    walkItOffRows,
    cutYourTeethRows,
    salvageCutterInstances,
    equippedSalvageCutterAssignments: equippedAssignments,
  };
}

async function loadCharacterCount(client, characterIds) {
  return countRows(
    client,
    `SELECT COUNT(*)::text AS count FROM characters WHERE id = ANY($1::text[])`,
    [textArray(characterIds)],
  );
}

export async function verifyReset(client, expectedReport) {
  assertReportShape(expectedReport, "dry-run");
  const [characterCount, remaining, baseline] = await Promise.all([
    loadCharacterCount(client, expectedReport.affectedCharacterIds),
    loadRemainingCounts(client, expectedReport.affectedCharacterIds),
    captureUnchangedState(client, expectedReport.affectedCharacterIds),
  ]);
  const unrelatedInventoryItemCountsUnchanged =
    baseline.unrelatedInventoryStackRows === expectedReport.baseline.unrelatedInventoryStackRows &&
    baseline.unrelatedInventoryQuantity === expectedReport.baseline.unrelatedInventoryQuantity &&
    baseline.unrelatedItemInstances === expectedReport.baseline.unrelatedItemInstances;
  const miningXpUnchanged =
    stableJson(baseline.miningXp) === stableJson(expectedReport.baseline.miningXp);
  const unrelatedStateUnchanged =
    baseline.unrelatedStateFingerprint === expectedReport.baseline.unrelatedStateFingerprint;
  const verification = {
    expectedCharacterCount: expectedReport.affectedCharacterIds.length,
    charactersPresent: characterCount,
    walkItOffRowsRemaining: remaining.walkItOffRows,
    cutYourTeethRowsRemaining: remaining.cutYourTeethRows,
    salvageCutterInstancesRemaining: remaining.salvageCutterInstances,
    equippedSalvageCutterAssignmentsRemaining: remaining.equippedSalvageCutterAssignments,
    unrelatedInventoryItemCountsUnchanged,
    miningXpUnchanged,
    unrelatedStateUnchanged,
    passed:
      characterCount === expectedReport.affectedCharacterIds.length &&
      remaining.walkItOffRows === 0 &&
      remaining.cutYourTeethRows === 0 &&
      remaining.salvageCutterInstances === 0 &&
      remaining.equippedSalvageCutterAssignments === 0 &&
      unrelatedInventoryItemCountsUnchanged &&
      miningXpUnchanged &&
      unrelatedStateUnchanged,
  };
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode: "verify",
    authority: AUTHORITY,
    generatedAt: new Date().toISOString(),
    affectedCharacterIds: expectedReport.affectedCharacterIds,
    verification,
  };
}

async function lockDatabasePopulation(client) {
  // Account-first ordering matches character creation's account lock and keeps
  // concurrent app commands from changing the population during preflight.
  await client.query(`SELECT id FROM player_accounts ORDER BY id FOR UPDATE`);
  await client.query(`SELECT id FROM characters ORDER BY id FOR UPDATE`);
}

async function deleteResetRows(client, characterIds) {
  const assignments = await client.query(
    `
      DELETE FROM equipped_items AS e
      USING item_instances AS i
      WHERE e.character_id = ANY($1::text[])
        AND e.character_id = i.character_id
        AND e.item_instance_id = i.id
        AND i.item_id = $2
    `,
    [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
  );
  const instances = await client.query(
    `
      DELETE FROM item_instances
      WHERE character_id = ANY($1::text[])
        AND item_id = $2
    `,
    [textArray(characterIds), AUTHORITY.itemIds.salvageCutter],
  );
  const missions = await client.query(
    `
      DELETE FROM character_missions
      WHERE character_id = ANY($1::text[])
        AND mission_id = ANY($2::text[])
    `,
    [textArray(characterIds), [AUTHORITY.missionIds.walkItOff, AUTHORITY.missionIds.cutYourTeeth]],
  );
  return {
    equippedSalvageCutterAssignments: assignments.rowCount ?? 0,
    salvageCutterInstances: instances.rowCount ?? 0,
    missionRows: missions.rowCount ?? 0,
  };
}

export async function executeReset(client, expectedReport) {
  assertReportShape(expectedReport, "dry-run");
  if (expectedReport.unsafeStates.length > 0)
    fail("reviewed dry run reports unsafe state; execution is refused");

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let committed = false;
  try {
    await lockDatabasePopulation(client);
    const currentScan = await scanResetState(client);
    assertExpectedDryRunMatches(currentScan, expectedReport);
    if (currentScan.unsafeStates.length > 0) fail("unsafe state found during execution preflight");

    const deleted = await deleteResetRows(client, expectedReport.affectedCharacterIds);
    const expectedMissionRows =
      expectedReport.counts.walkItOffRows + expectedReport.counts.cutYourTeethRows;
    if (
      deleted.equippedSalvageCutterAssignments !==
        expectedReport.counts.equippedSalvageCutterAssignments ||
      deleted.salvageCutterInstances !== expectedReport.counts.salvageCutterInstances ||
      deleted.missionRows !== expectedMissionRows
    ) {
      fail("deletion counts changed during execution; transaction will roll back");
    }

    const withinTransaction = await verifyReset(client, expectedReport);
    if (!withinTransaction.verification.passed)
      fail("post-reset verification failed before commit; transaction will roll back");

    await client.query("COMMIT");
    committed = true;
    const afterCommit = await verifyReset(client, expectedReport);
    if (!afterCommit.verification.passed)
      fail("post-commit verification failed; inspect the database before retrying");

    return {
      kind: REPORT_KIND,
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: "execute",
      authority: AUTHORITY,
      generatedAt: new Date().toISOString(),
      affectedCharacterIds: expectedReport.affectedCharacterIds,
      preflightMatchedReviewedDryRun: true,
      deleted,
      verification: {
        withinTransaction: withinTransaction.verification,
        afterCommit: afterCommit.verification,
      },
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export function parseArguments(argv) {
  let mode = "dry-run";
  let expectedReportPath;
  let confirmation;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--dry-run") {
      if (mode !== "dry-run") fail("--dry-run cannot be combined with another mode");
      continue;
    }
    if (argument === "--execute" || argument === "--verify") {
      const nextMode = argument.slice(2);
      if (mode !== "dry-run") fail("execution modes are mutually exclusive");
      mode = nextMode;
      continue;
    }
    if (argument === "--expected-report" || argument.startsWith("--expected-report=")) {
      const value = argument.includes("=")
        ? argument.slice(argument.indexOf("=") + 1)
        : argv[++index];
      if (!value) fail("--expected-report requires a path");
      expectedReportPath = value;
      continue;
    }
    if (argument === "--confirm" || argument.startsWith("--confirm=")) {
      const value = argument.includes("=")
        ? argument.slice(argument.indexOf("=") + 1)
        : argv[++index];
      if (!value) fail("--confirm requires a value");
      confirmation = value;
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }

  if (help) return { mode: "help" };
  if (mode === "dry-run" && (expectedReportPath || confirmation))
    fail("--expected-report and --confirm are valid only with --verify or --execute");
  if (mode !== "dry-run" && !expectedReportPath)
    fail(`--${mode} requires --expected-report <dry-run.json>`);
  if (mode === "execute" && confirmation !== EXECUTION_CONFIRMATION)
    fail(`--execute requires --confirm ${EXECUTION_CONFIRMATION}`);
  if (mode === "verify" && confirmation) fail("--confirm is valid only with --execute");
  return { mode, expectedReportPath, confirmation };
}

function describeDatabaseError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ECONNREFUSED") return "database connection refused";
  if (code === "ENOTFOUND") return "database host not found";
  if (code === "ETIMEDOUT") return "database connection timed out";
  if (code === "28P01") return "database authentication failed";
  if (code === "3D000") return "database does not exist";
  return "database operation failed";
}

function safeErrorMessage(error) {
  return error instanceof Issue126ResetError ? error.message : describeDatabaseError(error);
}

export async function runWithDatabase(options, environment = process.env) {
  if (typeof environment.DATABASE_URL !== "string" || environment.DATABASE_URL.length === 0)
    fail("DATABASE_URL is not set");
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();
  try {
    if (options.mode === "dry-run") return reportFromScan(await scanResetState(client));
    const expected = loadExpectedReport(options.expectedReportPath);
    if (options.mode === "verify") {
      const verification = await verifyReset(client, expected);
      return verification;
    }
    const execution = await executeReset(client, expected);
    return execution;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env, io = console) {
  try {
    const options = parseArguments(argv);
    if (options.mode === "help") {
      io.log(USAGE);
      return 0;
    }
    const report = await runWithDatabase(options, environment);
    io.log(JSON.stringify(report, null, 2));
    if (report.mode === "verify" && !report.verification.passed) return 1;
    return 0;
  } catch (error) {
    io.error(`issue-126 reset: ${safeErrorMessage(error)}`);
    return 1;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((status) => {
    process.exitCode = status;
  });
}
