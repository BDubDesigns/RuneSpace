#!/usr/bin/env node
// db-fingerprint.mjs — read-only database connection identity fingerprint (Issue #75).
//
// Lets an operator confirm which logical database / account / server boundary a
// supplied DATABASE_URL reaches, WITHOUT printing the URL, password, query
// string, or any reusable credential material. It performs no writes, DDL,
// migrations, resets, or cleanup.
//
// Intentionally NOT a database-management CLI: it reports a small approved,
// non-secret identity projection and nothing more. It is meant to be run in an
// operator's terminal (a deployment terminal can call it with the deployment's
// already-supplied DATABASE_URL), and it must never be exposed through an HTTP
// endpoint or used to stream environment contents.

import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

// The only approved non-secret fingerprint fields an operator may print.
// Deliberately omits the server host/IP and any raw connection string so the
// output cannot leak private network topology into shared PR/log evidence.
export function projectFingerprint({ database, dbUser, serverPort, inRecovery }, socketKind) {
  return {
    database,
    user: dbUser,
    serverPort,
    socket: socketKind === "unix" ? "unix" : "tcp",
    inRecovery: Boolean(inRecovery),
  };
}

// Answers "does this DATABASE_URL parse?" for a safe failure message, without
// printing the URL or any credential material.
export function classifyDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    return { ok: false, reason: "DATABASE_URL is not set" };
  }
  try {
    new URL(databaseUrl);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL" };
  }
}

// Maps a pg driver failure to a generic, credential-free reason so nothing in
// the error (which can include host and port, and on some systems a partially
// parsed connection string) is echoed to the operator or a shared log.
function describeConnectError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND") return "host not found";
  if (code === "ETIMEDOUT") return "connection timed out";
  if (code === "28P01") return "authentication failed";
  if (code === "3D000") return "database does not exist";
  return "connection failed";
}

function socketKind(client) {
  const host = client.connectionParameters?.host;
  return typeof host === "string" && host.startsWith("/") ? "unix" : "tcp";
}

const FINGERPRINT_QUERY = `
  SELECT
    current_database() AS "database",
    current_user      AS "dbUser",
    inet_server_port() AS "serverPort",
    pg_is_in_recovery() AS "inRecovery"
`;

async function fingerprint(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await client.query(FINGERPRINT_QUERY);
    const row = result.rows[0];
    if (!row) throw new Error("query returned no row");
    return {
      status: 0,
      output: JSON.stringify(projectFingerprint(row, socketKind(client)), null, 2),
    };
  } catch (error) {
    return {
      status: 1,
      error: connected
        ? "db-fingerprint: fingerprint query failed"
        : `db-fingerprint: could not connect to the configured database (${describeConnectError(error)})`,
    };
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

export async function main(environment = process.env, log = console.log, errorLog = console.error) {
  const url = environment.DATABASE_URL;
  const classified = classifyDatabaseUrl(url);
  if (!classified.ok) {
    errorLog(`db-fingerprint: ${classified.reason}`);
    return { status: 1, signal: null };
  }
  const result = await fingerprint(url);
  if (result.status === 0) log(result.output);
  else errorLog(result.error);
  return { status: result.status, signal: null };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(({ signal, status }) => {
      if (signal) process.kill(process.pid, signal);
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(`db-fingerprint: ${error instanceof Error ? error.message : "failed"}`);
      process.exitCode = 1;
    });
}
