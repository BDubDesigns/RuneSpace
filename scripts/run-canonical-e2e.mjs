#!/usr/bin/env node

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, unlinkSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const log = (msg) => console.log(`[canonical-e2e] ${msg}`);
const fail = (msg) => {
  console.error(`[canonical-e2e] FAIL: ${msg}`);
  process.exit(1);
};

// ---- Frozen review screenshots are OPT-IN ----
// The behavioral E2E assertions always run; the curated screenshot package in
// artifacts/e2e-review/ is only produced and verified when explicitly requested
// (the CI workflow sets this from the `e2e-screenshots` PR label). The default
// successful run is green on behavior alone and uploads no frozen package.
// Per-test failure screenshots are handled separately by Playwright
// (screenshot: "only-on-failure") and uploaded by CI on failure regardless.
const captureScreenshots = process.env.RUNESPACE_E2E_SCREENSHOTS === "true";

// ---- 1. Verify Node ----
const nodeVersion = process.versions.node;
if (!nodeVersion.startsWith("22.")) fail(`Node 22.x required, found ${nodeVersion}`);

// ---- 2. DATABASE_URL ----
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) fail("DATABASE_URL is required");

// ---- 3. Parse without printing ----
let dbHost;
try {
  dbHost = new URL(dbUrl).hostname;
} catch {
  fail("DATABASE_URL is not a valid URL");
}
if (dbHost !== "localhost" && dbHost !== "127.0.0.1")
  fail(`DATABASE_URL host must be localhost or 127.0.0.1, got ${dbHost}`);

// ---- 4. Remove stale state ----
const cleanupPaths = [
  resolve(ROOT, ".playwright/mining-auth-state.json"),
  resolve(ROOT, "test-results"),
  resolve(ROOT, "playwright-report"),
  resolve(ROOT, "artifacts/e2e-review"),
];
for (const p of cleanupPaths) {
  if (existsSync(p)) execSync(`rm -rf "${p}"`, { stdio: "inherit", cwd: ROOT });
}
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

// ---- 5. Select dedicated test port ----
// Openchamber may occupy 3000 locally; use 3200 to avoid conflicts.
// Better Auth validates allowed origins against this port.
execSync(`fuser -k 3200/tcp 2>/dev/null || true`, { stdio: "inherit", cwd: ROOT });
const PORT = 3200;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ---- 6. Environment for CI parity ----
const env = {
  ...process.env,
  CI: "true",
  RUNESPACE_E2E_MINING: "true",
  RUNESPACE_E2E_PLAY_ERROR: "true",
  RUNESPACE_E2E_TRAVEL: "true",
  RUNESPACE_E2E_CANONICAL_HTTP: "true",
  RUNESPACE_RELEASE_ID: "local-ci-parity",
  BETTER_AUTH_SECRET: "canonical-e2e-local-test-secret-not-for-production",
  PLAYWRIGHT_PORT: String(PORT),
  PORT: String(PORT),
};

// ---- 7. Run committed migrations ----
log("Running migrations...");
const mig = spawnSync("pnpm", ["drizzle-kit", "migrate"], { cwd: ROOT, env, stdio: "inherit" });
if (mig.status !== 0) fail("Migration failed");

// ---- Helper: run Playwright and check result ----
function runPlaywright(args, label) {
  log(`Running ${label}...`);
  const r = spawnSync("pnpm", ["test:e2e", ...args], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0 && r.status !== null) fail(`${label} failed (exit ${r.status})`);
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
];

function verifyAndCopyScreenshots(required, destDir) {
  log("Verifying and preserving screenshots...");
  for (const f of required) {
    const src = resolve(BASE_RESULTS, f);
    if (!existsSync(src)) fail(`Missing screenshot: ${f}`);
    const st = statSync(src);
    if (st.size === 0) fail(`Screenshot ${f} is empty`);
    const dest = resolve(destDir, f);
    copyFileSync(src, dest);
    log(`  ${f} — ${st.size} bytes`);
  }
}

// ---- 9. Mining E2E ----
runPlaywright(["mining", "--project=chromium"], "Mining E2E");
if (captureScreenshots)
  verifyAndCopyScreenshots(MINING_REQUIRED, resolve(ROOT, "artifacts/e2e-review/mining"));

// ---- 10. Overlay E2E (reuses Mining auth state) ----
runPlaywright(["overlay", "--project=chromium"], "Overlay E2E");
if (captureScreenshots)
  verifyAndCopyScreenshots(OVERLAY_REQUIRED, resolve(ROOT, "artifacts/e2e-review/overlay"));

// ---- 11. Remove auth state so Travel gets fresh account/character ----
const authFile = resolve(ROOT, ".playwright/mining-auth-state.json");
if (existsSync(authFile)) unlinkSync(authFile);

// ---- 12. Travel E2E ----
runPlaywright(["travel", "--project=chromium"], "Travel E2E");
if (captureScreenshots)
  verifyAndCopyScreenshots(TRAVEL_REQUIRED, resolve(ROOT, "artifacts/e2e-review/travel"));

// ---- 13. Play boundary flake check ----
log("Running Mining play-boundary check...");
const boundary = spawnSync(
  "pnpm",
  [
    "test:e2e",
    "mining",
    "--project=chromium",
    "--grep",
    "Play boundary",
    "--repeat-each=3",
    "--workers=1",
  ],
  { cwd: ROOT, env, stdio: "inherit" },
);
if (boundary.status !== 0 && boundary.status !== null)
  fail("Play boundary check failed (exit " + boundary.status + ")");

// ---- 14. Final verification ----
if (captureScreenshots) {
  log("Final screenshot manifest verified.");
} else {
  log("Frozen screenshot manifest not requested; behavioral E2E passed without it.");
}
log("All canonical E2E checks passed.");
