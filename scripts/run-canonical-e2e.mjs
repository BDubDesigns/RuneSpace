#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  assertNode22,
  assertPortAvailable,
  createE2eRuntime,
  readPositiveDuration,
  ROOT,
} from "./e2e-shared.mjs";
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  resolveDatabaseUrl,
} from "./disposable-test-db.mjs";

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

// ---- Frozen review screenshots are OPT-IN ----
// The behavioral E2E assertions always run; the curated screenshot package in
// artifacts/e2e-review/ is only produced and verified when explicitly requested
// (the CI workflow sets this from the `e2e-screenshots` PR label). The default
// successful run is green on behavior alone and uploads no frozen package.
// Per-test failure screenshots are handled separately by Playwright
// (screenshot: "only-on-failure") and uploaded by CI on failure regardless.
const captureScreenshots = process.env.RUNESPACE_E2E_SCREENSHOTS === "true";

// ---- Environment and process helpers ----
let runtime;
let log;
let fail;
let disposableDatabase;
let timeout;
const signalHandlers = [];

const cleanupPaths = [
  resolve(ROOT, ".playwright/mining-auth-state.json"),
  resolve(ROOT, "test-results"),
  resolve(ROOT, "playwright-report"),
  resolve(ROOT, "artifacts/e2e-review"),
];

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
  "mining-mobile-inventory-dossier.png",
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

const LOCATION_POPULATION_REQUIRED = [
  "location-population-mobile-list.png",
  "location-population-mobile-yard.png",
];

const CHARACTER_PROFILE_REQUIRED = [
  "character-profile-mobile-panel.png",
  "character-profile-mobile-rows.png",
];

const PORTRAITS_REQUIRED = ["portraits-mobile-characters.png", "portraits-mobile-profile.png"];

const REFINING_REQUIRED = [
  "refining-mobile-active.png",
  "refining-desktop-active.png",
  "refining-mobile-result.png",
];

const CARGO_HOLD_REQUIRED = [
  "cargo-mobile-repair.png",
  "cargo-mobile-restored.png",
  "cargo-desktop-storage.png",
];

const INVENTORY_EQUIP_REQUIRED = [
  "inventory-equip-mobile-selected-cutter.png",
  "inventory-equip-mobile-equipped.png",
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
  await runtime.runTimedCommand(["run", "test:e2e:raw", ...args], label);
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
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/location-population"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/character-profile"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/character-portraits"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/refining"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/cargo-hold"), { recursive: true });
    mkdirSync(resolve(ROOT, "artifacts/e2e-review/inventory-equip"), { recursive: true });
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
  await assertPortAvailable(PORT);
  log(`Dedicated test port ${PORT} is available.`);

  await runtime.runTimedCommand(["drizzle-kit", "migrate"], "Migrations");
  await runtime.runTimedCommand(["build"], "Production build (once)");

  runtime.startServer();
  await runtime.waitForServer();

  await runPlaywright(["mining", "--project=chromium"], "Mining E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(MINING_REQUIRED, resolve(ROOT, "artifacts/e2e-review/mining"));

  await runPlaywright(["inventory-equip", "--project=chromium"], "Inventory equip E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(
      INVENTORY_EQUIP_REQUIRED,
      resolve(ROOT, "artifacts/e2e-review/inventory-equip"),
    );

  await runPlaywright(["overlay", "--project=chromium"], "Overlay E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(OVERLAY_REQUIRED, resolve(ROOT, "artifacts/e2e-review/overlay"));

  await runPlaywright(["walk-it-off", "--project=chromium"], "Walk It Off E2E");
  await runPlaywright(["cut-your-teeth", "--project=chromium"], "Cut Your Teeth E2E");

  const authFile = resolve(ROOT, ".playwright/mining-auth-state.json");
  if (existsSync(authFile)) unlinkSync(authFile);

  await runPlaywright(["travel", "--project=chromium"], "Travel E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(TRAVEL_REQUIRED, resolve(ROOT, "artifacts/e2e-review/travel"));

  await runPlaywright(["location-population", "--project=chromium"], "Location population E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(
      LOCATION_POPULATION_REQUIRED,
      resolve(ROOT, "artifacts/e2e-review/location-population"),
    );

  await runPlaywright(["character-profile", "--project=chromium"], "Character profile E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(
      CHARACTER_PROFILE_REQUIRED,
      resolve(ROOT, "artifacts/e2e-review/character-profile"),
    );

  await runPlaywright(["character-portraits", "--project=chromium"], "Character portraits E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(
      PORTRAITS_REQUIRED,
      resolve(ROOT, "artifacts/e2e-review/character-portraits"),
    );

  await runPlaywright(["refining", "--project=chromium"], "Refining E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(REFINING_REQUIRED, resolve(ROOT, "artifacts/e2e-review/refining"));

  await runPlaywright(["cargo-hold", "--project=chromium"], "Cargo Hold E2E");
  if (captureScreenshots)
    verifyAndCopyScreenshots(CARGO_HOLD_REQUIRED, resolve(ROOT, "artifacts/e2e-review/cargo-hold"));

  await runPlaywright(
    ["mining", "--project=chromium", "--grep", "Play boundary", "--repeat-each=3", "--workers=1"],
    "Mining play-boundary check",
  );

  await runPlaywright(["signout", "--project=chromium"], "Sign-out E2E");
}

function onSignal(signal) {
  if (!runtime) return;
  runtime.abort(`Received ${signal}; canonical E2E teardown requested`);
  void runtime.terminateOwned();
}

async function main() {
  assertNode22();
  const baseDatabaseUrl = resolveDatabaseUrl();
  try {
    disposableDatabase = await createDisposableDatabase(baseDatabaseUrl, "canonical");
    const env = {
      ...process.env,
      DATABASE_URL: disposableDatabase.databaseUrl,
      RUNESPACE_DISPOSABLE_TEST_DB: disposableDatabase.databaseName,
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
    runtime = createE2eRuntime({
      label: "canonical-e2e",
      port: PORT,
      env,
      readyTimeoutMs: READY_TIMEOUT_MS,
    });
    ({ log, fail } = runtime);
    const onSigint = () => onSignal("SIGINT");
    const onSigterm = () => onSignal("SIGTERM");
    signalHandlers.push(["SIGINT", onSigint], ["SIGTERM", onSigterm]);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const startedAt = Date.now();
    timeout = setTimeout(() => {
      runtime.abort(`Canonical E2E exceeded ${OVERALL_TIMEOUT_MS} ms`);
      void runtime.terminateOwned();
    }, OVERALL_TIMEOUT_MS);

    await runCanonical();
    runtime.throwIfAborted();
    log(`All canonical E2E checks passed in ${Date.now() - startedAt} ms.`);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (runtime) await runtime.terminateOwned();
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (disposableDatabase) {
      await dropDisposableDatabase(baseDatabaseUrl, disposableDatabase.databaseName);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
