import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissionProgress,
  characterMissions,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #229 — the shared bounded-run selector on both activity surfaces.
 *
 * Refining and Practice Welding present the same interaction: the run size
 * starts at one, − and + step it inside the server's maximum, Max jumps there
 * in one action, and a selection that authoritative state has since outgrown
 * is refused and chosen again rather than quietly run smaller. Completion and
 * durability arithmetic is proven against real PostgreSQL in
 * tests/integration/bounded-runs.test.ts; this proves what the player sees.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const balance = getEffectiveGameBalance();

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function setCarried(characterId: string, itemId: string, quantities: readonly number[]) {
  await db
    .delete(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  for (const quantity of quantities) {
    await db.insert(inventoryStacks).values({ characterId, itemId, quantity });
  }
}

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

/** Move the active action's cursor back so that much work is due on the next command. */
async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

test("Refining runs a selected number of batches through the shared selector", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await setCarried(characterId, ITEM_IDS.ferriteShale, [6]);
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await openTestCharacter(page, characterId);

  const panel = page.locator("[data-refining-activity]");
  const selector = panel.locator("[data-bounded-run]");
  const value = selector.locator("[data-bounded-run-value]");
  const decrease = selector.locator("[data-bounded-run-decrease]");
  const increase = selector.locator("[data-bounded-run-increase]");
  const max = selector.locator("[data-bounded-run-max]");

  // Starts at one; − cannot go below it; the maximum is the server's.
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await expect(selector).toHaveAttribute("data-bounded-run-maximum", "3");
  await expect(decrease).toBeDisabled();
  await expect(selector).toContainText("Up to 3 batches");
  await expect(selector.locator("[data-bounded-run-summary]")).toContainText("2 Ferrite Shale");

  // + steps by one; Max is a single action; + stops at the maximum.
  await increase.click();
  await expect(value).toContainText("2");
  await max.click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "3");
  await expect(increase).toBeDisabled();
  await expect(max).toBeDisabled();
  // The whole run, before Start: every input it will take.
  await expect(selector.locator("[data-bounded-run-summary]")).toContainText("6 Ferrite Shale");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "bounded-run-refining-mobile-selector.png");

  // The Shale shrinks behind the player's back: Start revalidates and refuses
  // rather than refining fewer batches than were chosen.
  await setCarried(characterId, ITEM_IDS.ferriteShale, [2]);
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(panel).toContainText(/Only 1 batch can start now/);
  await expect(selector).toHaveAttribute("data-bounded-run-maximum", "1");
  await expect(selector.locator("[data-bounded-run-exceeds]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toHaveCount(0);
  expect(await carried(characterId, ITEM_IDS.ferriteShale)).toBe(2);

  // Choosing again from the fresh maximum starts the run.
  await decrease.click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  const progress = panel.locator("[data-bounded-run-progress]");
  await expect(progress).toContainText("batch 1 of 1");

  // It stops by itself at its selection.
  await fastForward(
    characterId,
    balance.refining.recipes.refinedFerrite.attemptDurationTicks * GAME_TICK_MS + 100,
  );
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(panel).toContainText("Run complete — 1 batch attempted.");
  await expect(page.getByRole("button", { name: "Start Refining" })).toBeVisible();
  await expect(panel.getByText("1 of 1 attempts", { exact: true })).toBeVisible();

  // The deliberate Slag recipes are listed, and locked below Refining 5.
  const recipes = panel.locator("[data-refining-recipes]");
  for (const recipe of ["ferrite_shale_slag_refining", "galvanite_slag_refining"]) {
    const tile = recipes.locator(`[data-refining-recipe="${recipe}"]`);
    await expect(tile).toHaveAttribute("data-refining-recipe-locked", "true");
    await expect(tile).toContainText("Requires Refining 5");
  }

  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
});

test("Practice Welding runs a selected number of complete welds", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.tenThousandHours, acceptedAt: now });
  await db.insert(characterMissionProgress).values({
    characterId,
    missionId: MISSION_IDS.tenThousandHours,
    progressKey: "practice-welds",
    progress: 0,
  });
  // Seven pieces at three to a stack: three welds' worth, with one left over.
  await setCarried(characterId, ITEM_IDS.scrapMetal, [3, 3, 1]);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);

  const panel = page.locator("[data-practice-panel]");
  const selector = panel.locator("[data-bounded-run]");
  await expect(panel).toBeVisible();

  // The same interaction as Refining, counting complete welds.
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await expect(selector).toHaveAttribute("data-bounded-run-maximum", "3");
  await expect(selector.locator("[data-bounded-run-decrease]")).toBeDisabled();
  await expect(selector).toContainText("Up to 3 welds");
  await expect(selector.locator("[data-bounded-run-summary]")).toContainText("2 Scrap Metal");
  await expect(selector.locator("[data-bounded-run-summary]")).toContainText("100 Welding XP");
  await selector.locator("[data-bounded-run-max]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "3");
  await expect(selector.locator("[data-bounded-run-summary]")).toContainText("300 Welding XP");
  await expectNoHorizontalOverflow(page);

  // Stale selection: Start refuses before a single piece of Scrap is spent.
  await setCarried(characterId, ITEM_IDS.scrapMetal, [3, 1]);
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toContainText(/The bench can run 2 welds right now/);
  await expect(selector).toHaveAttribute("data-bounded-run-maximum", "2");
  await expect(panel).toHaveAttribute("data-practice-active", "false");
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(4);

  // Choose again: two welds.
  await selector.locator("[data-bounded-run-max]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "2");
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toHaveAttribute("data-practice-active", "true");
  await expect(panel.locator("[data-bounded-run-progress]")).toContainText("weld 1 of 2");
  await captureReviewScreenshot(page, "bounded-run-practice-mobile-active.png");

  // Both selected welds resolve while the player is away, and the run ends
  // there on its own with the bench clear and exactly two welds of Scrap spent.
  const weldMs =
    balance.welding.attemptDurationTicks * balance.practiceWelding.sectionsPerWeld * GAME_TICK_MS;
  await fastForward(characterId, weldMs * 2 + 500);
  await page.reload();
  await expect(panel).toHaveAttribute("data-practice-active", "false");
  await expect(panel).toContainText("Run complete — 2 welds finished.");
  await expect(panel.locator("[data-run-summary]")).toContainText("2 of 2 welds");
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(0);

  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
});

test("Stop After Current Weld ends a bounded Practice run after the weld on the bench", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
  await setCarried(characterId, ITEM_IDS.scrapMetal, [3, 3]);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);

  const panel = page.locator("[data-practice-panel]");
  const selector = panel.locator("[data-bounded-run]");
  await selector.locator("[data-bounded-run-max]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "3");
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toHaveAttribute("data-practice-active", "true");

  // Asking to stop after this weld leaves the rest of the selection unstarted.
  await panel.locator("[data-practice-finish]").click();
  await expect(panel.locator("[data-practice-finish]")).toHaveAttribute(
    "data-practice-finish-armed",
    "true",
  );
  const weldMs =
    balance.welding.attemptDurationTicks * balance.practiceWelding.sectionsPerWeld * GAME_TICK_MS;
  await fastForward(characterId, weldMs * 3 + 500);
  await page.reload();
  await expect(panel).toHaveAttribute("data-practice-active", "false");
  await expect(panel).toContainText("Weld finished. The Workbench is clear.");
  await expect(panel.locator("[data-run-summary]")).toContainText("1 of 3 welds");
  // Only the weld that was on the bench was paid for.
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(4);
});
