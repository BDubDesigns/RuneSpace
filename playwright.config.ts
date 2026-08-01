import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * Playwright configuration.
 *
 * `pnpm test:e2e` uses a production server by default. Set
 * `PLAYWRIGHT_DEV_SERVER=true` for the quick development-server variant.
 * The canonical runner builds and starts the production server itself, then
 * sets `RUNESPACE_E2E_EXTERNAL_SERVER=true` so every phase reuses that server.
 *
 * When Playwright owns the server, it waits for the registration screen to be
 * reachable without requiring a seeded session.
 */

const externalServer = process.env.RUNESPACE_E2E_EXTERNAL_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/mining.setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
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
