import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * Playwright configuration.
 *
 * `pnpm test:e2e` uses a production server by default. Set
 * `PLAYWRIGHT_DEV_SERVER=true` for the quick development-server variant.
 * The canonical runner builds and starts the production server itself, then
 * sets `RUNESPACE_E2E_EXTERNAL_SERVER=true` so one authoritative Playwright
 * selection reuses that server.
 *
 * When Playwright owns the server, it waits for the registration screen to be
 * reachable without requiring a seeded session.
 */

const externalServer = process.env.RUNESPACE_E2E_EXTERNAL_SERVER === "true";
const canonical = process.env.RUNESPACE_E2E_CANONICAL === "true";
const canonicalWorkers = Number.parseInt(process.env.RUNESPACE_E2E_WORKERS ?? "2", 10);
const requestedWorkers = process.env.RUNESPACE_E2E_WORKERS
  ? Number.parseInt(process.env.RUNESPACE_E2E_WORKERS, 10)
  : undefined;
const canonicalSpecPattern =
  /.*\/(?:admin-operator|cargo-hold|character-portraits|character-profile|cut-your-teeth|inventory-equip|location-population|mining|overlay|refining|signout|travel|walk-it-off)\.spec\.ts$/;
const timingOutput = process.env.RUNESPACE_E2E_TIMING_OUTPUT;

export default defineConfig({
  testDir: "./tests/e2e",
  ...(canonical ? { testMatch: canonicalSpecPattern } : {}),
  ...(requestedWorkers ? { workers: canonical ? canonicalWorkers : requestedWorkers } : {}),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: canonical ? 0 : process.env.CI ? 1 : 0,
  reporter: canonical
    ? [["list"], ["./scripts/e2e-timing-reporter.mjs", { outputFile: timingOutput }]]
    : "list",
  use: {
    baseURL,
    trace: canonical ? "retain-on-failure" : "on-first-retry",
    // Failure diagnostics are always retained (bounded to failing tests) so a
    // broken run leaves a screenshot + trace in test-results/, independent of the
    // opt-in frozen review screenshots. Intentional review screenshots are taken
    // explicitly by the specs and only verified/uploaded when requested.
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: process.env.PLAYWRIGHT_DEV_SERVER
            ? `pnpm exec next dev -p ${port}`
            : `pnpm build && pnpm exec next start -p ${port}`,
          url: `${baseURL}/register`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
