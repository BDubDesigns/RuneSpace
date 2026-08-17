import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  characterMiningState,
  characterRefiningState,
  characterStarterProvisioning,
  characterTravelState,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Refining E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openRefiningFixture(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^\/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openRefiningFixture(page);
  await Promise.all([
    db.delete(activeActions).where(eq(activeActions.characterId, characterId)),
    db.delete(characterTravelState).where(eq(characterTravelState.characterId, characterId)),
    db.delete(characterMiningState).where(eq(characterMiningState.characterId, characterId)),
    db.delete(characterRefiningState).where(eq(characterRefiningState.characterId, characterId)),
    db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId)),
    db
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId)),
    db
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId)),
  ]);
  await db.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
  await db.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
  await page.reload();
});

async function travelTo(
  page: import("@playwright/test").Page,
  characterId: string,
  locationId: string,
  walkButton: RegExp,
) {
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await expect(page.locator(`[data-map-location="${locationId}"]`)).toBeVisible();
  await page.locator(`[data-map-location="${locationId}"]`).click();
  await expect(page.getByRole("button", { name: walkButton })).toBeVisible();
  await page.getByRole("button", { name: walkButton }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Fast-forward the 40-tick (24s) walk — arrival resolves on next page load via server
  const ago = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
}

test("Processing Yard Refining journey — Ferrite and Slag both branches, artwork, refresh, Travel partial, refusals, no metallurgy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  // 1. character carries Ferrite Shale
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 10 });
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("button", { name: /Inventory/ })).toContainText("1/8");

  // 2. travel to Abandoned Processing Yard
  await travelTo(
    page,
    characterId,
    "abandoned_processing_yard",
    /Walk to Abandoned Processing Yard/,
  );

  // 3. Yard is active, not offline; Refining level/progress shown; success chance 40.00%
  await expect(page.getByText("Refining", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Refining progression")).toBeVisible();
  await expect(page.getByText(/Success chance: 40\.00%/)).toBeVisible();
  await expect(page.getByText("offline", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Metallurgy", { exact: false })).toHaveCount(0);

  // 4. Start Refining works
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();

  // 5. deterministic success: exactly 1 Refined Ferrite +15 XP (roll 0 < 4000)
  const oneAttemptAgo = new Date(Date.now() - 7 * GAME_TICK_MS - 100);
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latestRefining = page.getByRole("region", { name: "Latest refining attempt", exact: true });
  await expect(latestRefining).toContainText("Latest attempt: Refined Ferrite");
  await expect(latestRefining.getByLabel("1 Refined Ferrite produced")).toBeVisible();
  await expect(latestRefining.getByLabel("15 Refining XP earned")).toBeVisible();
  await expect(page.getByText("1 attempts", { exact: true })).toBeVisible();
  await expect(page.getByText("1 Refined Ferrite", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/refining-mobile-active.png" });

  // 6. deterministic failure: exactly 1 Slag +3 XP (second roll 9000 >= 4000)
  const secondAttemptAgo = new Date(Date.now() - 7 * GAME_TICK_MS - 100);
  await db
    .update(activeActions)
    .set({ resolvedThroughAt: secondAttemptAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(latestRefining).toContainText("Latest attempt: Slag");
  await expect(latestRefining.getByLabel("1 Slag produced")).toBeVisible();
  await expect(latestRefining.getByLabel("3 Refining XP earned")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();

  // 7. Artwork loads for both outputs
  await page.getByRole("button", { name: /Inventory/ }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  const artwork = inventory.getByTestId("item-artwork");
  await expect(artwork.first()).toBeVisible();
  await expect
    .poll(() =>
      artwork.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await expect(inventory.getByLabel(/Refined Ferrite/).first()).toBeVisible();
  await expect(inventory.getByLabel(/Slag/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close inventory" }).click();
  await page.screenshot({ path: "test-results/refining-mobile-result.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: "test-results/refining-desktop-active.png" });

  // 8. refresh/reload while Refining retains authoritative run/progress state
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await expect(latestRefining).toContainText("Latest attempt: Slag");

  // 9. Travel while Refining resolves only completed attempts; incomplete <7 tick discarded
  const incompleteCursor = new Date(Date.now() - 6 * GAME_TICK_MS);
  await db
    .update(activeActions)
    .set({ resolvedThroughAt: incompleteCursor })
    .where(eq(activeActions.characterId, characterId));
  const shaleBeforeTravel = (
    await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId))
  )
    .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
    .reduce((t, s) => t + s.quantity, 0);
  // travel back to Crash Site via helper (ensures In transit is reached before warp)
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-map-location="crash_site"]')).toBeVisible();
  await page.locator('[data-map-location="crash_site"]').click();
  await expect(page.getByRole("button", { name: /Walk to Crash Site/ })).toBeVisible();
  await page.getByRole("button", { name: /Walk to Crash Site/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  // Travel was just created at ~now; fast-forward 25s by moving cursor back so arrival is due on next load.
  const travelStarted = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: travelStarted, resolvedThroughAt: travelStarted })
    .where(eq(activeActions.characterId, characterId));
  // Reload forces getMiningGameplayState(now) to resolve travel arrival
  await page.reload();
  await expect(page.getByText("Mining", { exact: true }).first()).toBeVisible();
  const shaleAfter = (
    await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId))
  )
    .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
    .reduce((t, s) => t + s.quantity, 0);
  expect(shaleAfter).toBe(shaleBeforeTravel);
  expect(
    await db
      .select()
      .from(activeActions)
      .where(eq(activeActions.characterId, characterId))
      .then((rows) => rows.find((a) => a.actionId === ACTION_IDS.refining)),
  ).toBeUndefined();

  // Return to Yard for refusal checks (reuse travelTo helper)
  await travelTo(
    page,
    characterId,
    "abandoned_processing_yard",
    /Walk to Abandoned Processing Yard/,
  );
  await expect(page.getByText("Refining", { exact: true }).first()).toBeVisible();

  // 11. insufficient-shale refusal
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByText(/Not enough Ferrite Shale/)).toBeVisible();

  // 12. inventory-fit refusal
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  for (let i = 0; i < 5; i++) {
    await db
      .insert(inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 });
  }
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 });
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 });
  await db.insert(inventoryStacks).values({ characterId, itemId: ITEM_IDS.slag, quantity: 10 });
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByText(/make room for the resulting material/)).toBeVisible();
});
