import { chromium, expect, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const miningStorageStatePath = "test-results/mining-auth-state.json";

function uniqueEmail() {
  return `mining-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * Creates one authenticated account and character for the Mining browser suite.
 * Repeated recovery tests restore this saved browser state rather than registering
 * from the same CI address again.
 */
export default async function setupMiningFixture(config: FullConfig) {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseHost = databaseUrl ? new URL(databaseUrl).hostname : "";
  if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1") {
    throw new Error("Mining E2E fixtures require a disposable localhost PostgreSQL database");
  }

  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright base URL is required");

  await mkdir(dirname(miningStorageStatePath), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await page.goto("/register");
    await page.getByLabel("Display name").fill("Mining Fixture");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("link", { name: "New character" }).click();
    await page.getByLabel("Character name").fill("Mining Fixture Pilot");
    await page.getByRole("button", { name: "Create character" }).click();
    await expect(page.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();
    await context.storageState({ path: miningStorageStatePath });
  } finally {
    await browser.close();
  }
}
