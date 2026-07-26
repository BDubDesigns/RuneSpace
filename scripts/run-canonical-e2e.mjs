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
mkdirSync(resolve(ROOT, "artifacts/e2e-review/mining"), { recursive: true });
mkdirSync(resolve(ROOT, "artifacts/e2e-review/travel"), { recursive: true });

// ---- 5. Select dedicated test port ----
// Openchamber may occupy 3000 locally; use 3200 to avoid conflicts.
// Better Auth validates BETTER_AUTH_URL against this port.
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
  RUNESPACE_RELEASE_ID: "local-ci-parity",
  BETTER_AUTH_SECRET: "canonical-e2e-local-test-secret-not-for-production",
  BETTER_AUTH_URL: BASE_URL,
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
verifyAndCopyScreenshots(MINING_REQUIRED, resolve(ROOT, "artifacts/e2e-review/mining"));

// ---- 10. Remove auth state so Travel gets fresh account/character ----
const authFile = resolve(ROOT, ".playwright/mining-auth-state.json");
if (existsSync(authFile)) unlinkSync(authFile);

// ---- 11. Travel E2E ----
runPlaywright(["travel", "--project=chromium"], "Travel E2E");
verifyAndCopyScreenshots(TRAVEL_REQUIRED, resolve(ROOT, "artifacts/e2e-review/travel"));

// ---- 12. Play boundary flake check ----
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

// ---- 13. Final manifest verification ----
log("Final screenshot manifest verified.");
log("All canonical E2E checks passed.");
