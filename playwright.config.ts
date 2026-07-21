import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * Playwright configuration.
 *
 * Local browser smoke test only. CI does NOT run Playwright in this first
 * workflow (documented in CI workflow + docs/testing-strategy.md) to keep the
 * fast PR checks lightweight and reliable. Run locally with `pnpm test:e2e`.
 *
 * The webServer builds and starts the production server, then waits for the
 * registration screen to be reachable without requiring a seeded session.
 */

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
  webServer: {
    command: process.env.PLAYWRIGHT_DEV_SERVER
      ? `pnpm exec next dev -p ${port}`
      : `pnpm build && pnpm exec next start -p ${port}`,
    url: `${baseURL}/register`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
