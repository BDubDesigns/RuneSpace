import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * Local browser smoke test only. CI does NOT run Playwright in this first
 * workflow (documented in CI workflow + docs/testing-strategy.md) to keep the
 * fast PR checks lightweight and reliable. Run locally with `pnpm test:e2e`.
 *
 * The webServer builds and starts the production server, then waits for the
 * smoke screen to be reachable.
 */

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000",
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
    command: "pnpm build && pnpm start",
    url: process.env.BASE_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
