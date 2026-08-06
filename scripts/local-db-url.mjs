#!/usr/bin/env node
// Dependency-free local database URL validation boundary (Issue #74).
//
// Single authoritative home for the repository's "may this DATABASE_URL be
// used for a local test/validation run?" rule. It is plain Node with no
// dependencies so it runs before `pnpm install` has installed node_modules,
// and it is shared by:
//   - scripts/managed-host-run.sh (via a quiet CLI invocation), and
//   - scripts/e2e-shared.mjs (re-exported to the canonical/focused runners).
//
// It never prints the URL, credentials, query parameters, or the private
// environment. Every refusal message is generic so a cause is clear without
// leaking the connection string.
//
// Beyond the authority hostname, it rejects any decoded query parameter named
// `host` (case-insensitively): node-postgres's connection-string parser honors
// a `?host=` query parameter that overrides the authority hostname, so a URL
// whose URL hostname is `localhost` could still contact a remote database.

import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_SCHEMES = new Set(["postgres:", "postgresql:"]);

export function validateLocalDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    return { ok: false, reason: "DATABASE_URL is required" };
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: "DATABASE_URL must use the postgres or postgresql scheme" };
  }

  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return { ok: false, reason: "DATABASE_URL host must be localhost or 127.0.0.1" };
  }

  // A `host` query parameter can override the authority hostname in
  // node-postgres, so reject it regardless of value or key case (the URL
  // parser decodes percent-encoded keys, so `%68ost` normalizes to `host`).
  for (const key of parsed.searchParams.keys()) {
    if (key.toLowerCase() === "host") {
      return {
        ok: false,
        reason: "DATABASE_URL must not specify a host query parameter",
      };
    }
  }

  return { ok: true, reason: null };
}

export function assertLocalDatabaseUrl(databaseUrl) {
  const result = validateLocalDatabaseUrl(databaseUrl);
  if (!result.ok) throw new Error(result.reason);
}

// Quiet CLI invocation: run directly (as the managed-host wrapper does) to
// validate process.env.DATABASE_URL. Prints only a generic refusal to stderr
// on failure and exits 0/1.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = validateLocalDatabaseUrl(process.env.DATABASE_URL);
  if (!result.ok) {
    console.error(`local-db-url: ${result.reason}`);
    process.exit(1);
  }
  process.exit(0);
}
