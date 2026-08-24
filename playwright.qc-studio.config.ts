import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3312";
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * QC Studio is a development-only tool and has no player/auth fixture. Keep
 * its browser coverage independent from the gameplay global setup while the
 * disposable database wrapper still supplies the normal safe app runtime.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "qc-studio.spec.ts",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `${baseURL}/qc-studio`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
