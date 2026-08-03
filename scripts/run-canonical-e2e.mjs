#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3200;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = readPositiveDuration(
  process.env.RUNESPACE_CANONICAL_READY_TIMEOUT_MS,
  120_000,
);
const OVERALL_TIMEOUT_MS = readPositiveDuration(
  process.env.RUNESPACE_CANONICAL_TIMEOUT_MS,
  900_000,
);
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const log = (msg) => console.log(`[canonical-e2e] ${msg}`);

let activeProcess = null;
let serverProcess = null;
let cleanupPromise = null;
let abortReason = null;

function readPositiveDuration(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Duration must be a positive integer, got ${value}`);
  }
  return parsed;
}

function fail(msg) {
  throw new Error(`[canonical-e2e] FAIL: ${msg}`);
}

function throwIfAborted() {
  if (abortReason) fail(abortReason);
}

// ---- Frozen review screenshots are OPT-IN ----
// The behavioral E2E assertions always run; the curated screenshot package in
// artifacts/e2e-review/ is only produced and verified when explicitly requested
// (the CI workflow sets this from the `e2e-screenshots` PR label). The default
// successful run is green on behavior alone and uploads no frozen package.
// Per-test failure screenshots are handled separately by Playwright
// (screenshot: "only-on-failure") and uploaded by CI on failure regardless.
const captureScreenshots = process.env.RUNESPACE_E2E_SCREENSHOTS === "true";

// ---- Environment and process helpers ----
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) fail("DATABASE_URL is required");

let dbHost;
try {
  dbHost = new URL(dbUrl).hostname;
} catch {
  fail("DATABASE_URL is not a valid URL");
}
if (dbHost !== "localhost" && dbHost !== "127.0.0.1")
  fail(`DATABASE_URL host must be localhost or 127.0.0.1, got ${dbHost}`);

if (!process.versions.node.startsWith("22.")) {
  fail(`Node 22.x required, found ${process.versions.node}`);
}

const cleanupPaths = [
  resolve(ROOT, ".playwright/mining-auth-state.json"),
  resolve(ROOT, "test-results"),
  resolve(ROOT, "playwright-report"),
  resolve(ROOT, "artifacts/e2e-review"),
];

const env = {
  ...process.env,
  CI: "true",
  RUNESPACE_E2E_MINING: "true",
  RUNESPACE_E2E_PLAY_ERROR: "true",
  RUNESPACE_E2E_TRAVEL: "true",
  RUNESPACE_POWER_ANNEX_CLOCK_FILE: resolve(ROOT, ".playwright/power-annex-clock"),
  RUNESPACE_E2E_CANONICAL_HTTP: "true",
  RUNESPACE_E2E_EXTERNAL_SERVER: "true",
  RUNESPACE_RELEASE_ID: "local-ci-parity",
  BETTER_AUTH_SECRET: "canonical-e2e-local-test-secret-not-for-production",
  PLAYWRIGHT_PORT: String(PORT),
  PORT: String(PORT),
};

function isRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function waitForClose(child, timeoutMs) {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
    timer = setTimeout(() => {
      child.removeListener("close", onClose);
      resolve(!isRunning(child));
    }, timeoutMs);
  });
}

async function terminateProcess(child, label) {
  if (!isRunning(child)) return;

  const sendSignal = (signal) => {
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  log(`Stopping ${label}...`);
  sendSignal("SIGTERM");
  if (await waitForClose(child, 5_000)) return;
  log(`Stopping ${label} forcefully...`);
  sendSignal("SIGKILL");
  await waitForClose(child, 5_000);
}

async function terminateChildren() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const phase = activeProcess;
    if (phase) await terminateProcess(phase, "active Playwright phase");
    const server = serverProcess;
    if (server) await terminateProcess(server, "Next server");
  })();
  return cleanupPromise;
}

function runCommand(args, label, command = packageManager) {
  throwIfAborted();
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    activeProcess = child;
    let settled = false;

    const clearActive = () => {
      if (activeProcess === child) activeProcess = null;
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearActive();
      callback(value);
    };

    child.once("error", (error) => settle(rejectResult, error));
    child.once("close", (code, signal) => settle(resolveResult, { code, signal }));
  }).then(({ code, signal }) => {
    if (code !== 0 || signal) {
      fail(`${label} failed (${signal ? `signal ${signal}` : `exit ${code}`})`);
    }
    throwIfAborted();
  });
}

async function runTimedCommand(args, label, command = packageManager) {
  const startedAt = Date.now();
  log(`${label}...`);
  await runCommand(args, label, command);
  log(`${label} completed in ${Date.now() - startedAt} ms.`);
}

function assertPortAvailable() {
  return new Promise((resolvePort, rejectPort) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.once("connect", () =>
      settle(rejectPort, new Error(`dedicated test port ${PORT} is already in use`)),
    );
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") settle(resolvePort);
      else settle(rejectPort, error);
    });
    socket.setTimeout(1_000, () =>
      settle(rejectPort, new Error(`could not verify that test port ${PORT} is available`)),
    );
  });
}

function startServer() {
  throwIfAborted();
  const child = spawn(packageManager, ["exec", "next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  serverProcess = child;
  child.once("error", (error) => {
    child.startupError = error;
  });
  log("Next production server started; waiting for /register readiness...");
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "no response";

  while (Date.now() < deadline) {
    throwIfAborted();
    if (serverProcess?.startupError) throw serverProcess.startupError;
    if (!isRunning(serverProcess)) fail("Next server exited before readiness");

    try {
      const response = await fetch(`${BASE_URL}/register`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status < 500) {
        log(`Next server ready at ${BASE_URL} (${response.status}).`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }

  fail(`Next server did not become ready within ${READY_TIMEOUT_MS} ms (${lastError})`);
}

// ---- Helper: verify and preserve screenshots ----
const BASE_RESULTS = resolve(ROOT, "test-results");

const MINING_REQUIRED = [
  "mining-mobile-no-yield.png",
  "mining-desktop-no-yield.png",
  "mining-mobile-success.png",
  "mining-desktop-success.png",
  "mining-mobile-equipment.png",
  "mining-desktop-equipment.png",
  "mining-mobile-equipment-artwork.png",
  "mining-desktop-equipment-artwork.png",
  "mining-mobile-inventory-mixed.png",
  "mining-desktop-inventory-mixed.png",
  "mining-mobile-inventory-selection.png",
  "mining-mobile-inventory-drop-confirmation.png",
  "mining-mobile-inventory-drop-success.png",
  "mining-mobile-inventory-cell-loaded.png",
  "mining-mobile-inventory-carried-cutter-selected.png",
  "mining-mobile-header.png",
  "mining-desktop-header.png",
  "layout-mobile-characters.png",
  "layout-mobile-play-yard.png",
  "layout-mobile-play-bottom.png",
  "layout-mobile-play-scrolled-background.png",
];

const OVERLAY_REQUIRED = [
  "overlay-mobile-inventory.png",
  "overlay-desktop-inventory.png",
  "overlay-mobile-equipment.png",
  "overlay-desktop-equipment.png",
  "overlay-mobile-contact-sheet.png",
  "overlay-desktop-contact-sheet.png",
];

const TRAVEL_REQUIRED = [
  "travel-mobile-stationary.png",
  "travel-desktop-stationary.png",
  "travel-mobile-selected.png",
  "travel-desktop-selected.png",
  "travel-mobile-in-transit.png",
  "travel-desktop-in-transit.png",
  "travel-mobile-arrived.png",
  "travel-desktop-arrived.png",
  "power-annex-mobile-available.png",
  "power-annex-mobile-claimed.png",
  "power-annex-desktop-available.png",
  "power-annex-desktop-claimed.png",
];

function verifyAndCopyScreenshots(required, destDir) {
  log("Verifying and preserving screenshots...");
  for (const filename of required) {
    const source = resolve(BASE_RESULTS, filename);
    if (!existsSync(source)) fail(`Missing screenshot: ${filename}`);
    const size = statSync(source).size;
    if (size === 0) fail(`Screenshot ${filename} is empty`);
    copyFileSync(source, resolve(destDir, filename));
    log(`  ${filename} — ${size} bytes`);
  }
}

async function runPlaywright(args, label) {
  await runTimedCommand(["test:e2e", ...args], label);
}

async function prepareState() {
  for (const path of cleanupPaths) {
    if (existsSync(path)) rmSync(path, { force: true, recursive: true });
  }
  mkdirSync(resolve(ROOT, ".playwright"), { recursive: true });
  writeFileSync(resolve(ROOT, ".playwright/power-annex-clock"), "", "utf8");
  if (captureScreenshots) {
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/mining"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/overlay"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/travel"), { recursive: true });
    log("Frozen review screenshots: ENABLED (manifest will be verified and uploaded).");
  } else {
    log(
      "Frozen review screenshots: disabled (behavioral assertions only). " +
        "Set RUNESPACE_E2E_SCREENSHOTS=true, or add the `e2e-screenshots` PR label, to capture them.",
    );
  }
}

async function runCanonical() {
  await prepareState();
  await assertPortAvailable();
  log(`Dedicated test port ${PORT} is available.`);

  await runTimedCommand(["drizzle-kit", "migrate"], "Migrations");
  await runTimedCommand(["build"], "Production build (once)");

  startServer();
  await waitForServer();

  await runPlaywright(["mining", "--project=chromium"], "Mining E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(MINING_REQUIRED, resolve(ROOT, "artifacts/e2e-review/mining"));

  await runPlaywright(["overlay", "--project=chromium"], "Overlay E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(OVERLAY_REQUIRED, resolve(ROOT, "artifacts/e2e-review/overlay"));

  const authFile = resolve(ROOT, ".playwright/mining-auth-state.json");
  if (existsSync(authFile)) unlinkSync(authFile);

  await runPlaywright(["travel", "--project=chromium"], "Travel E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(TRAVEL_REQUIRED, resolve(ROOT, "artifacts/e2e-review/travel"));

  await runPlaywright(
    ["mining", "--project=chromium", "--grep", "Play boundary", "--repeat-each=3", "--workers=1"],
    "Mining play-boundary check",
  );

  await runPlaywright(["signout", "--project=chromium"], "Sign-out E2E");
}

function onSignal(signal) {
  if (!abortReason) {
    abortReason = `Received ${signal}; canonical E2E teardown requested`;
  }
  void terminateChildren();
}

process.once("SIGINT", () => onSignal("SIGINT"));
process.once("SIGTERM", () => onSignal("SIGTERM"));

async function main() {
  const startedAt = Date.now();
  const timeout = setTimeout(() => {
    if (!abortReason) abortReason = `Canonical E2E exceeded ${OVERALL_TIMEOUT_MS} ms`;
    void terminateChildren();
  }, OVERALL_TIMEOUT_MS);

  try {
    await runCanonical();
    throwIfAborted();
    log(`All canonical E2E checks passed in ${Date.now() - startedAt} ms.`);
  } finally {
    clearTimeout(timeout);
    await terminateChildren();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
