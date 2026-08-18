#!/usr/bin/env node
// Safe disposable local PostgreSQL database helper (Issue #84).
//
// This helper deliberately reuses scripts/local-db-url.mjs as the authoritative
// localhost boundary. It adds only RuneSpace-specific control-database, role,
// and disposable-name rules, then uses the repository's existing `pg`
// dependency for create/drop/probe operations. It never prints connection
// strings, credentials, or raw database-driver errors.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertLocalDatabaseUrl } from "./local-db-url.mjs";

const { Client } = pg;

export const CONTROL_DATABASE = "runespace_control";
export const DEVELOPMENT_ROLE = "runespace_dev";
const MAX_POSTGRES_IDENTIFIER_LENGTH = 63;
const ISSUE_KEY = /^issue-([1-9][0-9]*)$/;
const SCRATCH_KEY = /^scratch(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/;

export class LocalDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalDatabaseError";
  }
}

export function normalizeDatabaseKey(key) {
  if (typeof key !== "string") {
    throw new LocalDatabaseError("database key must be issue-<number> or scratch[-<slug>]");
  }

  const issueMatch = ISSUE_KEY.exec(key);
  if (issueMatch) {
    const databaseName = `runespace_issue_${issueMatch[1]}`;
    if (databaseName.length <= MAX_POSTGRES_IDENTIFIER_LENGTH) return databaseName;
  }

  const scratchMatch = SCRATCH_KEY.exec(key);
  if (scratchMatch) {
    const suffix = scratchMatch[1]?.replaceAll("-", "_");
    const databaseName = suffix ? `runespace_scratch_${suffix}` : "runespace_scratch";
    if (databaseName.length <= MAX_POSTGRES_IDENTIFIER_LENGTH) return databaseName;
  }

  throw new LocalDatabaseError("database key must be issue-<number> or scratch[-<slug>]");
}

export function parseControlDatabaseUrl(databaseUrl) {
  try {
    assertLocalDatabaseUrl(databaseUrl);
  } catch (error) {
    throw new LocalDatabaseError(
      error instanceof Error ? error.message : "DATABASE_URL is not a safe local postgres URL",
    );
  }

  const parsed = new URL(databaseUrl);
  if (parsed.search !== "") {
    throw new LocalDatabaseError("DATABASE_URL must not contain query parameters");
  }

  let databaseName;
  let username;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new LocalDatabaseError("DATABASE_URL contains invalid encoded credentials or path data");
  }

  if (databaseName !== CONTROL_DATABASE) {
    throw new LocalDatabaseError(`DATABASE_URL must select ${CONTROL_DATABASE}`);
  }
  if (username !== DEVELOPMENT_ROLE) {
    throw new LocalDatabaseError(`DATABASE_URL must authenticate as ${DEVELOPMENT_ROLE}`);
  }

  return parsed;
}

export function buildTargetDatabaseUrl(databaseUrl, key) {
  const targetName = normalizeDatabaseKey(key);
  const parsed = parseControlDatabaseUrl(databaseUrl);
  parsed.pathname = `/${targetName}`;
  const targetUrl = parsed.toString();

  try {
    assertLocalDatabaseUrl(targetUrl);
  } catch {
    throw new LocalDatabaseError("derived DATABASE_URL is not a safe local postgres URL");
  }

  return { databaseName: targetName, databaseUrl: targetUrl };
}

function defaultClientFactory(connectionString) {
  return new Client({ connectionString });
}

async function withClient(connectionString, clientFactory, callback) {
  const client = clientFactory(connectionString);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(client, databaseName) {
  const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  return result.rowCount > 0;
}

export async function createDatabase(databaseUrl, key, options = {}) {
  const databaseName = normalizeDatabaseKey(key);
  const controlUrl = parseControlDatabaseUrl(databaseUrl).toString();
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  await withClient(controlUrl, clientFactory, async (client) => {
    if (await databaseExists(client, databaseName)) {
      throw new LocalDatabaseError("disposable database already exists");
    }
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });

  return databaseName;
}

export async function dropDatabase(databaseUrl, key, options = {}) {
  const databaseName = normalizeDatabaseKey(key);
  const controlUrl = parseControlDatabaseUrl(databaseUrl).toString();
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  await withClient(controlUrl, clientFactory, async (client) => {
    if (!(await databaseExists(client, databaseName))) {
      throw new LocalDatabaseError("disposable database does not exist");
    }
    await client.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  });

  return databaseName;
}

export async function runDatabaseCommand(databaseUrl, key, commandArgs, options = {}) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    throw new LocalDatabaseError("run requires a command after --");
  }

  const { databaseUrl: targetUrl } = buildTargetDatabaseUrl(databaseUrl, key);
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  await withClient(targetUrl, clientFactory, (client) => client.query("SELECT 1"));

  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn(commandArgs[0], commandArgs.slice(1), {
    env: { ...process.env, DATABASE_URL: targetUrl },
    shell: false,
    stdio: "inherit",
  });

  if (result.error) throw new LocalDatabaseError("command could not be started");
  return { signal: result.signal ?? null, status: result.status ?? 1 };
}

export function safeErrorMessage(error) {
  return error instanceof LocalDatabaseError ? error.message : "database operation failed";
}

function usage() {
  return [
    "usage:",
    "  node scripts/runespace-db.mjs create <issue-N|scratch[-slug]>",
    "  node scripts/runespace-db.mjs run <issue-N|scratch[-slug]> -- <command> [args...]",
    "  node scripts/runespace-db.mjs drop <issue-N|scratch[-slug]>",
  ].join("\n");
}

export async function main(argv, environment = process.env) {
  const [operation, key, separator, ...commandArgs] = argv;
  const databaseUrl = environment.DATABASE_URL;

  if (operation === "create" && argv.length === 2) {
    await createDatabase(databaseUrl, key);
    return { status: 0, signal: null };
  }
  if (operation === "drop" && argv.length === 2) {
    await dropDatabase(databaseUrl, key);
    return { status: 0, signal: null };
  }
  if (operation === "run" && separator === "--" && commandArgs.length > 0) {
    return runDatabaseCommand(databaseUrl, key, commandArgs);
  }

  throw new LocalDatabaseError(usage());
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
    .then(({ signal, status }) => {
      if (signal) process.kill(process.pid, signal);
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(`runespace-db: ${safeErrorMessage(error)}`);
      process.exitCode = 1;
    });
}
