#!/usr/bin/env node

// Shared lifecycle for local PostgreSQL test databases.
//
// Normal development continues to use the DATABASE_URL from .env. Test
// commands derive a uniquely named sibling database from that local server,
// run migrations and tests against it, and drop it in a finally path. This is
// deliberately local-only and never prints a connection string.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { assertLocalDatabaseUrl } from "./local-db-url.mjs";
import { assertPortAvailable } from "./e2e-shared.mjs";

const { Client } = pg;
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TEST_DATABASE_PREFIX = "runespace_test_";
const MAX_POSTGRES_IDENTIFIER_LENGTH = 63;

function readDotEnvDatabaseUrl() {
  try {
    const contents = readFileSync(resolve(ROOT, ".env"), "utf8");
    const line = contents
      .split(/\r?\n/)
      .find((entry) => /^(?:export\s+)?DATABASE_URL=/.test(entry.trim()));
    if (!line) return undefined;
    return line
      .trim()
      .replace(/^(?:export\s+)?DATABASE_URL=/, "")
      .trim()
      .replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

export function resolveDatabaseUrl(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL || readDotEnvDatabaseUrl();
  assertLocalDatabaseUrl(databaseUrl);
  return databaseUrl;
}

export function isDisposableDatabaseName(databaseName) {
  return databaseName.startsWith(TEST_DATABASE_PREFIX);
}

function buildDisposableName(label) {
  const safeLabel = String(label || "test")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  const suffix = `${Date.now()}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const candidate = `${TEST_DATABASE_PREFIX}${safeLabel || "test"}_${suffix}`;
  return candidate.slice(0, MAX_POSTGRES_IDENTIFIER_LENGTH);
}

function targetUrl(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withClient(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function createDisposableDatabase(databaseUrl, label) {
  assertLocalDatabaseUrl(databaseUrl);
  const databaseName = buildDisposableName(label);
  await withClient(databaseUrl, async (client) => {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (existing.rowCount > 0) throw new Error("generated disposable database name already exists");
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });
  return { databaseName, databaseUrl: targetUrl(databaseUrl, databaseName) };
}

export async function dropDisposableDatabase(databaseUrl, databaseName) {
  assertLocalDatabaseUrl(databaseUrl);
  if (!isDisposableDatabaseName(databaseName)) {
    throw new Error("refusing to drop a database outside the disposable test namespace");
  }
  await withClient(databaseUrl, async (client) => {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (existing.rowCount === 0) return;
    await client.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  });
}

let activeChild;

function forwardSignal(signal) {
  activeChild?.kill(signal);
}

export function runCommand(commandArgs, environment) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    throw new Error("a command is required after --");
  }
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: ROOT,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    activeChild = child;
    child.once("error", (error) => {
      if (activeChild === child) activeChild = undefined;
      rejectResult(error);
    });
    child.once("close", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      resolveResult({ code: code ?? 1, signal });
    });
  });
}

async function main(argv) {
  if (argv[0] !== "--" || argv.length < 2) {
    throw new Error("usage: node scripts/disposable-test-db.mjs -- <command> [args...]");
  }

  const baseDatabaseUrl = resolveDatabaseUrl();
  const isE2E = argv.includes("test:e2e:raw") || argv.includes("test:e2e:studio:raw");
  let e2ePort;
  if (isE2E) {
    e2ePort = Number(process.env.PLAYWRIGHT_PORT || 3_400 + (process.pid % 1_000));
    if (!Number.isInteger(e2ePort) || e2ePort < 1_024 || e2ePort > 65_535) {
      throw new Error("standalone E2E test port is invalid");
    }
    await assertPortAvailable(e2ePort);
  }
  const disposable = await createDisposableDatabase(baseDatabaseUrl, "command");
  const environment = {
    ...process.env,
    DATABASE_URL: disposable.databaseUrl,
    RUNESPACE_DISPOSABLE_TEST_DB: disposable.databaseName,
  };
  if (isE2E) {
    environment.CI = "true";
    // Standalone disposable E2E uses a plain localhost origin just like the
    // canonical/focused runners; Better Auth must therefore emit a test-only
    // non-Secure session cookie so Chromium can retain the new session.
    environment.RUNESPACE_E2E_CANONICAL_HTTP = "true";
    environment.PLAYWRIGHT_PORT = String(e2ePort);
    environment.PORT = String(e2ePort);
    environment.BASE_URL = `http://127.0.0.1:${e2ePort}`;
  }
  const signalHandlers = ["SIGINT", "SIGTERM"].map((signal) => {
    const handler = () => forwardSignal(signal);
    process.once(signal, handler);
    return { signal, handler };
  });

  let status = 1;
  try {
    const migration = await runCommand(["pnpm", "drizzle-kit", "migrate"], environment);
    if (migration.signal || migration.code !== 0) return migration.code || 1;
    const result = await runCommand(argv.slice(1), environment);
    status = result.signal ? 1 : result.code;
    return status;
  } finally {
    for (const { signal, handler } of signalHandlers) process.removeListener(signal, handler);
    await dropDisposableDatabase(baseDatabaseUrl, disposable.databaseName);
  }
}

if (new URL(import.meta.url).pathname === process.argv[1]) {
  main(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(`disposable-test-db: ${error instanceof Error ? error.message : "failed"}`);
      process.exitCode = 1;
    });
}
