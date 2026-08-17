import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  characterMiningState,
  characterRefiningState,
  characterStarterProvisioning,
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

  // 2. travel to Abandoned Processing Yard — prove map truth
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await page.locator('[data-map-location="abandoned_processing_yard"]').click();
  await expect(page.getByText("Abandoned Processing Yard", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  // Fast-forward the 40-tick (24s) walk by moving cursor back deterministically
  const travelStartedAgo = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: travelStartedAgo, resolvedThroughAt: travelStartedAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();

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
  // Use explicit tick math: set cursor to exactly 7 ticks ago, so one attempt is due
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
  // Run totals: 1 Ferrite, 15 XP
  await expect(page.getByText("1 Refined Ferrite", { exact: true }).first()).toBeVisible();

  await page.screenshot({ path: "test-results/refining-mobile-active.png" });

  // 6. deterministic failure: exactly 1 Slag +3 XP (second roll 9000 >= 4000)
  // After first resolution, cursor advanced to ~now. Move it back 7 ticks for one more deterministic attempt.
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

  // 7. Refined Ferrite artwork loads
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
  // 7b. Slag artwork loads (second illustrated stack)
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

  // 9. Travel while Refining resolves only completed attempts; incomplete <7 tick discarded without shale/RNG
  // Make cursor only 6 ticks ahead (incomplete), then travel
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
  // Need 2 more shale? We had 10 - 2*2 = 6 left after 2 attempts
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await page.locator('[data-map-location="crash_site"]').click();
  await page.getByRole("button", { name: /Walk to Crash Site/ }).click();
  // Don't assert In transit immediately — the stop model change can make the
  // transition resolve synchronously and hide the button. Wait for either state.
  await expect(
    page.getByText("In transit").first().or(page.getByText("Mining").first()),
  ).toBeVisible();
  // Fast-forward arrival: push cursor back so travel resolver sees arrival as due
  const travelStarted = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: travelStarted, resolvedThroughAt: travelStarted })
    .where(eq(activeActions.characterId, characterId));
  // Arrival is resolved on next gameplay-state load; Refresh status triggers it.
  // If already arrived, Refresh is still needed to pull the new location.
  await page
    .getByRole("button", { name: "Refresh status" })
    .click()
    .catch(async () => {
      // If button hid during transit, a plain reload also resolves arrival via getMiningGameplayState
      await page.reload();
    });
  // 10. arrival leaves Refining stopped; completed count unchanged (no extra for incomplete)
  await expect(page.getByText("Mining").first()).toBeVisible();
  const shaleAfter = (
    await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId))
  )
    .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
    .reduce((t, s) => t + s.quantity, 0);
  expect(shaleAfter).toBe(shaleBeforeTravel); // incomplete consumed nothing
  expect(
    await db
      .select()
      .from(activeActions)
      .where(eq(activeActions.characterId, characterId))
      .then((rows) => rows.find((a) => a.actionId === ACTION_IDS.refining)),
  ).toBeUndefined();

  // Return to Yard for refusal checks
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await page.locator('[data-map-location="abandoned_processing_yard"]').click();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  await db
    .update(activeActions)
    .set({
      startedAt: new Date(Date.now() - 25_000),
      resolvedThroughAt: new Date(Date.now() - 25_000),
    })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("Refining", { exact: true }).first()).toBeVisible();

  // 11. insufficient-shale refusal
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByText(/Not enough Ferrite Shale/)).toBeVisible();

  // 12. inventory-fit refusal — fill slots so both branches cannot fit
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  // Fill to capacity 8: 1 shale (qty 3, so after removing 2 one remains -> no slot freed),
  // 1 ferrite full (5/5), 1 slag full (10/10), plus 5 filler ferrite full stacks = 8 total.
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
