import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Mining E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

function uniqueEmail() {
  return `miner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("owned character can start, observe, stop, and restore Crash Site Mining", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  await expect(page.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText(/Salvage Cutter and MYKEA SCHLEPPRAUM-8 equipped/)).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const characterId = page.url().split("/").at(-1)!;
  // The test process seeds the pre-existing full stack; the app still resolves
  // the next success/failure and creates the second stack through server rules.
  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 10,
  });
  const twoAttemptsAgo = new Date(Date.now() - 12_100);
  await db
    .update(activeActions)
    .set({ startedAt: twoAttemptsAgo, resolvedThroughAt: twoAttemptsAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("This mining run")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await expect(page.getByText("1 successful", { exact: true })).toBeVisible();
  await expect(page.getByText("1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("1 shale gained", { exact: true })).toBeVisible();
  await expect(page.getByText("15 Mining XP", { exact: true })).toBeVisible();
  const history = page.getByLabel("Latest mining attempts");
  await expect(history).toContainText("Attempt 2 - Failed");
  await expect(history).toContainText("Attempt 1 - Success");
  await expect(history).toContainText("Roll 35.00 | Needed below 35.00");
  await expect(history).toContainText("Missed by 0.01");
  await expect(history).toContainText("Roll 0.00 | Needed below 35.00");
  await page.screenshot({ path: "test-results/mining-mobile-active-viewport.png" });
  await page.getByText("This mining run").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mining-mobile-run-history-viewport.png" });
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByText("2 occupied / 8 slots")).toBeVisible();
  await expect(inventory.getByText("Ferrite Shale", { exact: true })).toHaveCount(2);
  const ferriteArtwork = inventory.getByTestId("item-artwork");
  await expect(ferriteArtwork).toHaveCount(2);
  await expect(ferriteArtwork.first()).toHaveCSS("object-fit", "contain");
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await expect(inventory.getByText("x1", { exact: true })).toBeVisible();
  await expect(inventory.locator('[data-stack-fill="100"]')).toBeVisible();
  await expect(inventory.locator('[data-stack-fill="10"]')).toBeVisible();
  await expect(inventory.locator("[data-stack-fill]")).toHaveCount(2);
  const fullFill = await inventory.locator('[data-stack-fill="100"]').evaluate((fill) => {
    const slot = fill.parentElement!;
    return {
      fraction: fill.getBoundingClientRect().height / slot.getBoundingClientRect().height,
      background: getComputedStyle(fill).backgroundColor,
      fillZIndex: getComputedStyle(fill).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  const partialFill = await inventory.locator('[data-stack-fill="10"]').evaluate((fill) => {
    const slot = fill.parentElement!;
    return {
      fraction: fill.getBoundingClientRect().height / slot.getBoundingClientRect().height,
      background: getComputedStyle(fill).backgroundColor,
      fillZIndex: getComputedStyle(fill).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  expect(fullFill.fraction).toBeGreaterThan(0.95);
  expect(fullFill.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(fullFill.fillZIndex).toBe("0");
  expect(fullFill.textZIndex).toBe("10");
  expect(partialFill.fraction).toBeGreaterThan(0.08);
  expect(partialFill.fraction).toBeLessThan(0.12);
  expect(partialFill.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(partialFill.fillZIndex).toBe("0");
  expect(partialFill.textZIndex).toBe("10");
  await expect(inventory.getByLabel(/Empty inventory slot/)).toHaveCount(6);
  await page.screenshot({ path: "test-results/mining-mobile-inventory-10-plus-1.png" });
  await page.getByRole("button", { name: "Close inventory" }).click();
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  const inventoryToolbar = page.getByRole("button", { name: "Inventory 2/8" }).locator("..");
  const backToCharacters = page.getByRole("link", { name: "Back to characters" });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(history).toBeVisible();
  await expect(inventoryToolbar).toBeVisible();
  await expect(backToCharacters).toBeVisible();
  const [historyBox, toolbarBox, backLinkBox] = await Promise.all([
    history.boundingBox(),
    inventoryToolbar.boundingBox(),
    backToCharacters.boundingBox(),
  ]);
  expect(historyBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(backLinkBox).not.toBeNull();
  expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(toolbarBox!.y);
  expect(backLinkBox!.y - (toolbarBox!.y + toolbarBox!.height)).toBeGreaterThanOrEqual(0);
  expect(backLinkBox!.y - (toolbarBox!.y + toolbarBox!.height)).toBeLessThan(48);
  expect(backLinkBox!.y).toBeGreaterThanOrEqual(0);
  expect(844 - (backLinkBox!.y + backLinkBox!.height)).toBeLessThan(64);
  expect(backLinkBox!.y + backLinkBox!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/mining-mobile-page-bottom.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(inventoryToolbar).toHaveCSS("position", "fixed");
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mining-desktop-inventory-10-plus-1.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeHidden();
  await expect(page.getByText("0 attempts", { exact: true })).toBeVisible();
  await expect(history).toContainText("No resolved attempts in this run yet.");
});
