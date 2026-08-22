#!/usr/bin/env node

// Narrow managed-host focused E2E runner (Issue #61).
//
// Proves ONE selected existing canonical phase from a clean state on a managed
// host without creating a second canonical runner. It reuses the shared
// primitives and process supervisor from scripts/e2e-shared.mjs; the canonical
// runner's own environment map, phase sequencing, and screenshot handling
// remain untouched in scripts/run-canonical-e2e.mjs.
//
// Guarantees:
// - localhost-only database safety (refuses remote DATABASE_URL)
// - Node 22.x validation
// - a separately confirmed-free high port (default 3310, never 3000 or 3200)
// - a clearly fake local build-and-runtime auth placeholder (never deployment)
// - RUNESPACE_E2E_CANONICAL_HTTP=true (plain-HTTP test origin sessions)
// - production build/server startup and readiness
// - stale auth-state cleanup and per-invocation Playwright output cleanup
// - deterministic teardown of ONLY its own processes (targeted kill, no
//   broad pkill), safe when process ownership is uncertain
//
// Focused execution is iteration evidence only. Only `pnpm test:e2e:canonical`
// and the matching CI job establish CI parity.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalDatabaseUrl,
  assertNode22,
  assertPortAvailable,
  createE2eRuntime,
  fail,
  readPositiveInteger,
  ROOT,
} from "./e2e-shared.mjs";
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  resolveDatabaseUrl,
} from "./disposable-test-db.mjs";

export const DEFAULT_FOCUSED_PORT = 3310;
export const RESERVED_FOCUSED_PORTS = [3000, 3200];
export const FOCUSED_PHASES = [
  "mining",
  "character-profile",
  "location-population",
  "character-portraits",
  "cargo-hold",
  "inventory-equip",
];
// Local E2E build-and-runtime placeholder only: the production build and
// `next start` both run as production, so server/env.ts requires a
// BETTER_AUTH_SECRET of at least 16 characters. Never used in a deployment.
export const FOCUSED_AUTH_SECRET = "focused-e2e-local-test-secret-not-for-production";

const READY_TIMEOUT_MS = readPositiveInteger(
  process.env.RUNESPACE_FOCUSED_READY_TIMEOUT_MS,
  120_000,
  "Focused readiness timeout",
);
const OVERALL_TIMEOUT_MS = readPositiveInteger(
  process.env.RUNESPACE_FOCUSED_TIMEOUT_MS,
  600_000,
  "Focused overall timeout",
);

export function requireFocusedSpec(argv) {
  if (argv.length !== 1) {
    fail(
      `exactly one phase is required (supported: ${FOCUSED_PHASES.join(", ")}), got ${argv.length} argument(s)`,
    );
  }
  const spec = argv[0];
  if (!FOCUSED_PHASES.includes(spec)) {
    fail(`unsupported focused phase "${spec}" (supported: ${FOCUSED_PHASES.join(", ")})`);
  }
  return spec;
}

export function resolveFocusedPort(raw) {
  const port = readPositiveInteger(raw, DEFAULT_FOCUSED_PORT, "Focused port");
  if (port < 1024 || port > 65535) {
    fail(`focused port must be a high port in 1024..65535, got ${port}`);
  }
  if (RESERVED_FOCUSED_PORTS.includes(port)) {
    fail(
      `focused port must not be ${port} (3000 belongs to OpenChamber, 3200 to the canonical runner)`,
    );
  }
  return port;
}

export function buildFocusedEnv({ databaseUrl, port, databaseName }) {
  assertLocalDatabaseUrl(databaseUrl);
  return {
    ...process.env,
    CI: "true",
    DATABASE_URL: databaseUrl,
    ...(databaseName ? { RUNESPACE_DISPOSABLE_TEST_DB: databaseName } : {}),
    BETTER_AUTH_SECRET: FOCUSED_AUTH_SECRET,
    RUNESPACE_E2E_CANONICAL_HTTP: "true",
    RUNESPACE_E2E_EXTERNAL_SERVER: "true",
    // The Mining phase needs the canonical phase flags: CI + RUNESPACE_E2E_MINING
    // select the deterministic server-side mining RNG, and
    // RUNESPACE_E2E_PLAY_ERROR is baked into the client bundle at build time by
    // next.config.ts for the Play-boundary test.
    RUNESPACE_E2E_MINING: "true",
    RUNESPACE_E2E_PLAY_ERROR: "true",
    PLAYWRIGHT_PORT: String(port),
    PORT: String(port),
    BASE_URL: `http://127.0.0.1:${port}`,
  };
}

function prepareState(log) {
  for (const path of [
    resolve(ROOT, ".playwright/mining-auth-state.json"),
    resolve(ROOT, "test-results"),
    resolve(ROOT, "playwright-report"),
  ]) {
    if (existsSync(path)) rmSync(path, { force: true, recursive: true });
  }
  mkdirSync(resolve(ROOT, ".playwright"), { recursive: true });
  log("Stale auth state and per-invocation Playwright output cleaned.");
  // Note: artifacts/e2e-review/ is deliberately NOT cleaned — curated
  // canonical screenshots must survive focused runs.
}

async function runFocused({ runtime, spec }) {
  prepareState(runtime.log);
  await runtime.runTimedCommand(["drizzle-kit", "migrate"], "Migrations");
  await runtime.runTimedCommand(["build"], "Production build (once)");
  runtime.startServer();
  await runtime.waitForServer();
  await runtime.runTimedCommand(
    ["run", "test:e2e:raw", spec, "--project=chromium"],
    `Focused E2E phase: ${spec}`,
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const spec = requireFocusedSpec(process.argv.slice(2));
  assertNode22();
  const baseDatabaseUrl = resolveDatabaseUrl();
  const port = resolveFocusedPort(process.env.RUNESPACE_FOCUSED_E2E_PORT);
  await assertPortAvailable(port);
  let disposableDatabase;
  let runtime;
  let timeout;
  const signalHandlers = [];

  try {
    disposableDatabase = await createDisposableDatabase(baseDatabaseUrl, `focused_${spec}`);
    const env = buildFocusedEnv({
      databaseUrl: disposableDatabase.databaseUrl,
      databaseName: disposableDatabase.databaseName,
      port,
    });
    runtime = createE2eRuntime({
      label: "focused-e2e",
      port,
      env,
      readyTimeoutMs: READY_TIMEOUT_MS,
    });
    runtime.log(
      `Focused test port ${port} is available (OpenChamber port 3000 and canonical port 3200 are never used).`,
    );

    const onSignal = (signal) => {
      runtime.abort(`Received ${signal}; focused E2E teardown requested`);
      void runtime.terminateOwned();
    };
    const onSigint = () => onSignal("SIGINT");
    const onSigterm = () => onSignal("SIGTERM");
    signalHandlers.push(["SIGINT", onSigint], ["SIGTERM", onSigterm]);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const startedAt = Date.now();
    timeout = setTimeout(() => {
      runtime.abort(`Focused E2E exceeded ${OVERALL_TIMEOUT_MS} ms`);
      void runtime.terminateOwned();
    }, OVERALL_TIMEOUT_MS);

    await runFocused({ runtime, spec });
    runtime.throwIfAborted();
    runtime.log(`Focused E2E phase passed in ${Date.now() - startedAt} ms.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (runtime) await runtime.terminateOwned();
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (disposableDatabase) {
      await dropDisposableDatabase(baseDatabaseUrl, disposableDatabase.databaseName);
    }
  }
}
