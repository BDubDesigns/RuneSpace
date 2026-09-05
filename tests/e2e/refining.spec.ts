import { expect, test, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters, inventoryStacks } from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { captureReviewScreenshot } from "./review-screenshot";

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
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

  // 1. character carries Ferrite Shale (no Refresh at Crash Site after #83 — reload to revalidate)
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 10 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Inventory" })).toHaveAttribute(
    "aria-label",
    "Inventory, 7 slots free",
  );

  // 2. travel to Abandoned Processing Yard
  await travelTo(
    page,
    characterId,
    "abandoned_processing_yard",
    /Walk to Abandoned Processing Yard/,
  );

  // 3. Yard is active; Refining level/progress shown; success chance 40.00%
  await expect(page.getByText("Refining", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Refining progression")).toBeVisible();
  await expect(page.getByText(/Success chance: 40\.00%/)).toBeVisible();
  // Crash Site has no production-status plate after Mining moved to The Jag, so
  // check the activity panel rather than treating the whole page as inactive.
  await expect(
    page.getByRole("main").getByText("No production activity", { exact: false }),
  ).toHaveCount(0);
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
  await captureReviewScreenshot(page, "refining-mobile-active.png");

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

  // 7. Artwork loads for both outputs — explicitly verify each image loads via naturalWidth
  await page.getByRole("button", { name: /Inventory/ }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  // Both Refined Ferrite and Slag tiles must be present and their <img> must have loaded
  const refinedTile = inventory.getByLabel(/Refined Ferrite/).first();
  await expect(refinedTile).toBeVisible();
  const refinedImg = refinedTile.getByTestId("item-artwork");
  await expect(refinedImg).toBeVisible();
  await expect
    .poll(() =>
      refinedImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  const slagTile = inventory.getByLabel(/Slag/).first();
  await expect(slagTile).toBeVisible();
  const slagImg = slagTile.getByTestId("item-artwork");
  await expect(slagImg).toBeVisible();
  await expect
    .poll(() => slagImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await page.getByRole("button", { name: "Close inventory" }).click();
  await captureReviewScreenshot(page, "refining-mobile-result.png");
  await page.setViewportSize({ width: 1280, height: 800 });
  await captureReviewScreenshot(page, "refining-desktop-active.png");

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
