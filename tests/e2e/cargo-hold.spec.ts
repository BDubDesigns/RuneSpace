import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
  characterCargoHoldRepair,
  characterMiningState,
  characterRefiningState,
  characterSkillXp,
  characterStarterProvisioning,
  characterTravelState,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Cargo Hold E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openCargoFixture(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openCargoFixture(page);
  await db.transaction(async (transaction) => {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
    await transaction
      .delete(characterTravelState)
      .where(eq(characterTravelState.characterId, characterId));
    await transaction
      .delete(cargoHoldItemInstances)
      .where(eq(cargoHoldItemInstances.characterId, characterId));
    await transaction.delete(cargoHoldStacks).where(eq(cargoHoldStacks.characterId, characterId));
    await transaction
      .delete(characterCargoHoldRepair)
      .where(eq(characterCargoHoldRepair.characterId, characterId));
    await transaction
      .delete(characterMiningState)
      .where(eq(characterMiningState.characterId, characterId));
    await transaction
      .delete(characterRefiningState)
      .where(eq(characterRefiningState.characterId, characterId));
    await transaction.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
    await transaction.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
    await transaction.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
    await transaction.delete(characterSkillXp).where(eq(characterSkillXp.characterId, characterId));
    await transaction
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId));
    await transaction
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId));
  });
  await page.reload();
});

test("repairs the Cargo Hold, hard-stops Welding, and transfers occupied storage on mobile and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 15 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 6 },
  ]);
  await page.reload();

  const cargoPanel = page.locator("[data-cargo-hold]");
  await expect(cargoPanel).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 6");
  await expect(cargoPanel).toContainText("LOCKED until both material requirements are complete");
  await page.screenshot({ path: "test-results/cargo-mobile-repair.png" });

  await cargoPanel.getByRole("button", { name: "CONTRIBUTE MATERIALS" }).click();
  const confirmation = page.locator("[data-cargo-confirmation]");
  await expect(confirmation).toContainText("Refined Ferrite ×15");
  await expect(confirmation).toContainText("Slag ×6");
  await expect(confirmation).toContainText("cannot be recovered");
  await confirmation.getByRole("button", { name: "COMMIT MATERIALS" }).click();
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("15 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("6 / 6");
  await expect(cargoPanel.getByRole("button", { name: "START WELDING" })).toBeVisible();

  await cargoPanel.getByRole("button", { name: "START WELDING" }).click();
  await expect(cargoPanel.getByRole("button", { name: "STOP WELDING" })).toBeVisible();
  await expect(cargoPanel).toContainText("0 / 12 completed increments");
  await expect(cargoPanel).toContainText("Current welding pass");

  const completedAgo = new Date(Date.now() - 12 * 5 * 600 - 100);
  await db
    .update(activeActions)
    .set({ startedAt: completedAgo, resolvedThroughAt: completedAgo })
    .where(eq(activeActions.characterId, characterId));
  // The mounted play boundary reconciles due work without a reload. This
  // proves the completion transition is authoritative and immediate in the
  // existing action-state presentation.
  await expect(cargoPanel.locator('[data-cargo-hold-status="restored"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(cargoPanel).toContainText("CARGO HOLD RESTORED");
  await expect(cargoPanel).toContainText("0 / 32 slots occupied");
  await expect(cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" })).toBeVisible();
  await page.screenshot({ path: "test-results/cargo-mobile-restored.png" });

  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await expect(cargoPanel.locator("[data-cargo-storage]")).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText(
    "No occupied Cargo Hold items",
  );

  const carriedStack = (
    await db
      .insert(inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 })
      .returning()
  )[0]!;
  await page.reload();
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await cargoPanel.getByRole("button", { name: "DEPOSIT STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("Ferrite Shale");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("1 / 32");
  await expect(cargoPanel.locator(`[data-cargo-entry='${carriedStack.id}']`)).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toBeVisible();
  await page.screenshot({ path: "test-results/cargo-desktop-storage.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(characters.id, characterId));
  await page.reload();
  await expect(page.locator("[data-cargo-hold]")).toHaveCount(0);

  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.crashSite })
    .where(eq(characters.id, characterId));
  await page.reload();
  await expect(cargoPanel).toBeVisible();
  await expect(cargoPanel.locator('[data-cargo-hold-status="restored"]')).toHaveCount(0);
  await expect(cargoPanel.locator('[data-cargo-hold-status="operational"]')).toContainText(
    "CARGO HOLD",
  );
  await expect(cargoPanel.locator('[data-cargo-hold-status="operational"]')).toContainText(
    "OPERATIONAL",
  );
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("Ferrite Shale");
  await cargoPanel.getByRole("button", { name: "WITHDRAW STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toContainText("Ferrite Shale");
});
