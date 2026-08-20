import { chromium, expect, type FullConfig } from "@playwright/test";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { assertDisposableE2EDatabase } from "./test-database";

export const miningStorageStatePath = ".playwright/mining-auth-state.json";

function uniqueEmail() {
  return `mining-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * Creates one authenticated account and character for the Mining browser suite.
 * Repeated recovery tests restore this saved browser state rather than registering
 * from the same CI address again.
 */
export default async function setupMiningFixture(config: FullConfig) {
  assertDisposableE2EDatabase();

  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright base URL is required");

  await mkdir(dirname(miningStorageStatePath), { recursive: true });
  const browser = await chromium.launch();

  try {
    try {
      await access(miningStorageStatePath);
      const existingContext = await browser.newContext({
        baseURL,
        storageState: miningStorageStatePath,
      });
      const existingPage = await existingContext.newPage();
      await existingPage.goto("/characters");
      if (await existingPage.getByRole("link", { name: "Play" }).count()) return;
      await existingContext.close();
    } catch {
      // A missing or expired state belongs to a prior local database; replace it.
    }

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/register");
    await page.getByLabel("Display name").fill("Mining Fixture");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("link", { name: "New character" }).click();
    await page.getByLabel("Character name").fill(`Mining Fixture ${Date.now()}`);
    // Character creation requires a deliberate portrait choice (issue #65).
    await page.getByRole("button", { name: "Gramma portrait" }).click();
    await page.getByRole("button", { name: "Create character" }).click();
    await expect(page.getByText("World map", { exact: true })).toBeVisible();
    await context.storageState({ path: miningStorageStatePath });
  } finally {
    await browser.close();
  }
}
