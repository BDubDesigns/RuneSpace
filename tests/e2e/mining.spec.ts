import { expect, test } from "@playwright/test";

function uniqueEmail() {
  return `miner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("owned character can start, observe, stop, and restore Crash Site Mining", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Mining Pilot");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page
    .getByLabel("Character name")
    .fill(`Ore Runner ${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole("button", { name: "Create character" }).click();

  await expect(page.getByText("Ferrite Shale")).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText(/Salvage Cutter and MYKEA SCHLEPPRAUM-8 equipped/)).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(page.getByLabel(/Mining attempt/)).toBeVisible();
  await page.waitForTimeout(6_300);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText(/successful, .* failed attempts|Mining stopped/)).toBeVisible();
  await expect(page.getByText("This mining run")).toBeVisible();
  await expect(page.getByLabel("Latest mining attempts")).toContainText(/Attempt 1/);
  await page.getByRole("button", { name: /Inventory [01]\/8/ }).click();
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  await expect(page.getByLabel("Eight inventory slots")).toBeVisible();
  await page.screenshot({ path: "test-results/mining-mobile-inventory.png", fullPage: true });
  await page.getByRole("button", { name: "Close inventory" }).click();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeHidden();
  await page.reload();
  await expect(page.getByText("Ferrite Shale")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Inventory/ }).click();
  await page.screenshot({ path: "test-results/mining-desktop-inventory.png", fullPage: true });
});
