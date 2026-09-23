#!/usr/bin/env node

// One-time Issue #221 cutover for accounts created before Player names and
// mandatory email verification existed.
//
// Cohort: every Better Auth user with no Player name (`username IS NULL`).
// After the #221 deploy every new account is created with a Player name, so
// this is exactly the set of pre-cutover accounts — no email, ID, or date
// special case exists anywhere.
//
// For that cohort the operation sets the official Username-plugin fields
// from the account's existing `user.name` (through the canonical Player-name
// rules) and marks the email verified, so trusted pre-alpha players keep
// their accounts without recreating anything or receiving a verification
// email. It never suffixes, truncates, lowercases, or otherwise invents a
// name: an invalid or colliding legacy name blocks execution until an
// operator supplies an explicit `--name <userId>=<Player name>` resolution.
//
// The default command is a read-only dry run. Execution requires the exact
// confirmation token and an unchanged saved dry-run report. Retire this
// script once production has been cut over (see docs/authentication.md).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validatePlayerName } from "../game/domain/player-name.ts";

const { Client } = pg;

export const REPORT_KIND = "runespace.issue-221.player-identity-cutover";
export const REPORT_SCHEMA_VERSION = 1;
export const EXECUTION_CONFIRMATION = "ISSUE-221-PLAYER-IDENTITY-CUTOVER";

const USAGE = `Usage:
  pnpm --silent run maintenance:issue-221 [--name <userId>=<Player name> ...]
  node --experimental-strip-types scripts/player-identity-cutover.mjs --verify --expected-report <dry-run.json>
  node --experimental-strip-types scripts/player-identity-cutover.mjs --execute --confirm ${EXECUTION_CONFIRMATION} --expected-report <dry-run.json> [--name ...]

The default mode is a read-only dry run. Execution requires the exact
confirmation token, an unchanged saved dry-run report with no problems, and
the same --name resolutions the dry run used.`;

export class PlayerIdentityCutoverError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlayerIdentityCutoverError";
  }
}

function fail(message) {
  throw new PlayerIdentityCutoverError(message);
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

export function parseArguments(argv) {
  const options = { mode: "dry-run", nameOverrides: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") options.mode = "execute";
    else if (argument === "--verify") options.mode = "verify";
    else if (argument === "--confirm") options.confirm = argv[++index];
    else if (argument === "--expected-report") options.expectedReport = argv[++index];
    else if (argument === "--name") {
      const value = argv[++index] ?? "";
      const separator = value.indexOf("=");
      if (separator <= 0) fail("--name must be <userId>=<Player name>");
      const userId = value.slice(0, separator);
      if (userId in options.nameOverrides) fail(`duplicate --name for ${userId}`);
      options.nameOverrides[userId] = value.slice(separator + 1);
    } else if (argument === "--help" || argument === "-h") return { help: true };
    else fail(`unknown argument: ${argument}`);
  }
  if (options.mode !== "dry-run" && !options.expectedReport) {
    fail("--expected-report is required for --execute and --verify");
  }
  if (options.mode === "dry-run" && (options.expectedReport || options.confirm)) {
    fail("--expected-report and --confirm are valid only with --verify or --execute");
  }
  if (options.mode === "execute" && options.confirm !== EXECUTION_CONFIRMATION) {
    fail(`--confirm must equal ${EXECUTION_CONFIRMATION}`);
  }
  if (options.mode === "verify" && (options.confirm || Object.keys(options.nameOverrides).length)) {
    fail("--confirm and --name are valid only with a dry run or --execute");
  }
  return options;
}

function databaseUrl(environment = process.env) {
  const raw = environment.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is required");
  return raw;
}

/**
 * Read the cohort and plan each account's Player name. Pure planning over two
 * reads; never writes. `forUpdate` locks the rows when called inside the
 * execution transaction.
 */
export async function queryPlan(client, nameOverrides = {}, { forUpdate = false } = {}) {
  const cohortRows = await client.query(
    `
      SELECT id, name, email_verified
      FROM "user"
      WHERE username IS NULL
      ORDER BY id
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
  );
  const takenRows = await client.query(
    `SELECT id, username FROM "user" WHERE username IS NOT NULL`,
  );
  const cohortIds = new Set(cohortRows.rows.map((row) => row.id));
  for (const userId of Object.keys(nameOverrides)) {
    if (!cohortIds.has(userId)) fail(`--name names ${userId}, which is not in the cohort`);
  }

  const takenKeys = new Map(takenRows.rows.map((row) => [row.username, row.id]));
  const planned = cohortRows.rows.map((row) => {
    const override = nameOverrides[row.id];
    const source = override ?? row.name;
    const validation = validatePlayerName(source);
    return {
      userId: row.id,
      legacyName: row.name,
      source: override === undefined ? "legacy-name" : "operator-resolution",
      emailVerified: row.email_verified,
      validation,
    };
  });
  const keyCounts = new Map();
  for (const entry of planned) {
    if (entry.validation.ok) {
      keyCounts.set(entry.validation.key, (keyCounts.get(entry.validation.key) ?? 0) + 1);
    }
  }

  const accounts = [];
  const problems = [];
  for (const entry of planned) {
    const base = { userId: entry.userId, legacyName: entry.legacyName, source: entry.source };
    if (!entry.validation.ok) {
      problems.push({ ...base, reason: "invalid", detail: entry.validation.error });
      continue;
    }
    const { display, key } = entry.validation;
    if (takenKeys.has(key)) {
      problems.push({ ...base, reason: "taken", detail: `"${display}" is already a Player name` });
      continue;
    }
    if (keyCounts.get(key) > 1) {
      problems.push({
        ...base,
        reason: "cohort-collision",
        detail: `"${display}" collides with another pre-cutover account`,
      });
      continue;
    }
    accounts.push({
      ...base,
      playerName: display,
      playerNameKey: key,
      wasEmailVerified: entry.emailVerified,
    });
  }
  return { accounts, problems };
}

export function reportFromPlan(plan, nameOverrides = {}) {
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    nameOverrides,
    accounts: plan.accounts,
    problems: plan.problems,
    counts: {
      cohort: plan.accounts.length + plan.problems.length,
      ready: plan.accounts.length,
      problems: plan.problems.length,
      toMarkVerified: plan.accounts.filter((account) => !account.wasEmailVerified).length,
    },
  };
}

function assertReportShape(report) {
  if (!report || report.kind !== REPORT_KIND || report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    fail("expected report kind or schema version is invalid");
  }
  if (report.mode !== "dry-run") fail("expected report must be a dry-run report");
  if (!Array.isArray(report.accounts) || !Array.isArray(report.problems)) {
    fail("expected report cohorts are missing");
  }
}

function loadExpectedReport(path) {
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("could not read or parse the expected dry-run report");
  }
  assertReportShape(report);
  return report;
}

function comparablePlan(plan) {
  return stableJson({ accounts: plan.accounts, problems: plan.problems });
}

export async function verifyApplied(client, expectedReport) {
  assertReportShape(expectedReport);
  const ids = expectedReport.accounts.map((account) => account.userId);
  const rows = await client.query(
    `SELECT id, username, display_username, email_verified FROM "user" WHERE id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  const passed = expectedReport.accounts.every((account) => {
    const row = byId.get(account.userId);
    return (
      row &&
      row.username === account.playerNameKey &&
      row.display_username === account.playerName &&
      row.email_verified === true
    );
  });
  return { expected: ids.length, found: rows.rows.length, passed };
}

export async function executeCutover(client, expectedReport, confirmation, nameOverrides = {}) {
  assertReportShape(expectedReport);
  if (confirmation !== EXECUTION_CONFIRMATION) {
    fail(`--execute requires --confirm ${EXECUTION_CONFIRMATION}`);
  }
  if (stableJson(expectedReport.nameOverrides ?? {}) !== stableJson(nameOverrides)) {
    fail("--name resolutions differ from the reviewed dry-run report");
  }
  if (expectedReport.problems.length > 0) {
    fail("the reviewed dry-run report lists problems; resolve them and produce a new report");
  }
  const before = await queryPlan(client, nameOverrides);
  if (comparablePlan(before) !== comparablePlan(expectedReport)) {
    fail("database state no longer matches the reviewed dry-run report; aborting without writes");
  }
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let committed = false;
  try {
    const locked = await queryPlan(client, nameOverrides, { forUpdate: true });
    if (comparablePlan(locked) !== comparablePlan(expectedReport)) {
      fail("database state changed during execution; rolling back");
    }
    for (const account of expectedReport.accounts) {
      const result = await client.query(
        `
          UPDATE "user"
          SET username = $2, display_username = $3, email_verified = true, updated_at = now()
          WHERE id = $1 AND username IS NULL
        `,
        [account.userId, account.playerNameKey, account.playerName],
      );
      if (result.rowCount !== 1) fail(`account ${account.userId} was not updated; rolling back`);
    }
    const verification = await verifyApplied(client, expectedReport);
    if (!verification.passed) fail("cutover verification failed; rolling back");
    await client.query("COMMIT");
    committed = true;
    const afterCommit = await verifyApplied(client, expectedReport);
    if (!afterCommit.passed) fail("post-commit cutover verification failed");
    return {
      kind: REPORT_KIND,
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: "execute",
      generatedAt: new Date().toISOString(),
      updated: expectedReport.accounts.length,
      verification: { withinTransaction: verification, afterCommit },
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runWithDatabase(options, environment = process.env) {
  const client = new Client({ connectionString: databaseUrl(environment) });
  await client.connect();
  try {
    if (options.mode === "dry-run") {
      return reportFromPlan(await queryPlan(client, options.nameOverrides), options.nameOverrides);
    }
    const expectedReport = loadExpectedReport(options.expectedReport);
    if (options.mode === "verify") {
      return {
        kind: REPORT_KIND,
        schemaVersion: REPORT_SCHEMA_VERSION,
        mode: "verify",
        generatedAt: new Date().toISOString(),
        verification: await verifyApplied(client, expectedReport),
      };
    }
    return await executeCutover(client, expectedReport, options.confirm, options.nameOverrides);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env, io = console) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      io.log(USAGE);
      return 0;
    }
    const report = await runWithDatabase(options, environment);
    io.log(JSON.stringify(report, null, 2));
    if (report.mode === "verify" && !report.verification.passed) return 1;
    return 0;
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 1;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((status) => {
    process.exitCode = status;
  });
}
