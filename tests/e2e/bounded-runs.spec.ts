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
 * starts at one, − and + step it inside what the inputs carried pay for, and
 * Max is its own choice — shown as Max, never as a number — that runs until
 * the activity is blocked. A number that authoritative state has since
 * outgrown is refused and chosen again rather than quietly run smaller.
 * Completion and durability arithmetic is proven against real PostgreSQL in
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
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  // A silent no-op would leave the action running in real time, so a caller
  // that raced its own start command would pass or fail on wall-clock timing.
  // Wait for a server-confirmed running state before calling this.
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

test("Refining runs a number of batches, or Max until blocked, through the shared selector", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const attemptMs = balance.refining.recipes.refinedFerrite.attemptDurationTicks * GAME_TICK_MS;
  await page.setViewportSize(PHONE);
  await setCarried(characterId, ITEM_IDS.ferriteShale, [6]);
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await openTestCharacter(page, characterId);

  const panel = page.locator("[data-refining-activity]");
  const selector = panel.locator("[data-bounded-run]");
  const value = selector.locator("[data-bounded-run-value]");
  const summary = selector.locator("[data-bounded-run-summary]");
  const decrease = selector.locator("[data-bounded-run-decrease]");
  const increase = selector.locator("[data-bounded-run-increase]");
  const max = selector.locator("[data-bounded-run-max]");

  // Starts at one; − cannot go below it; + stops at what the Shale pays for.
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await expect(selector).toHaveAttribute("data-bounded-run-affordable", "3");
  await expect(decrease).toBeDisabled();
  await expect(selector).toContainText("Materials for 3 batches");
  // A rolled recipe describes one batch: failures decide the rest.
  await expect(summary).toContainText("1 batch · 2 Ferrite Shale per batch · 4.2s each");
  await increase.click();
  await increase.click();
  await expect(value).toContainText("3");
  await expect(increase).toBeDisabled();

  // Max is its own choice, shown as Max rather than a computed number.
  await max.click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "max");
  await expect(value).toContainText("Max");
  await expect(max).toHaveAttribute("aria-pressed", "true");
  await expect(increase).toBeDisabled();
  await expect(summary).toContainText("Max · 2 Ferrite Shale per batch");
  await expect(summary).toContainText("runs until materials or space run out");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "bounded-run-refining-mobile-selector.png");
  // − leaves Max for the largest number.
  await decrease.click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "3");

  // The Shale shrinks behind the player's back: Start revalidates the number
  // and refuses rather than refining fewer batches than were chosen.
  await setCarried(characterId, ITEM_IDS.ferriteShale, [2]);
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(panel).toContainText(/Your materials cover 1 batch right now/);
  await expect(selector).toHaveAttribute("data-bounded-run-affordable", "1");
  await expect(selector.locator("[data-bounded-run-exceeds]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toHaveCount(0);
  expect(await carried(characterId, ITEM_IDS.ferriteShale)).toBe(2);

  // Choosing again from the fresh count starts the run.
  await decrease.click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  const progress = panel.locator("[data-bounded-run-progress]");
  await expect(progress).toContainText("batch 1 of 1");

  // A number stops by itself at its selection.
  await fastForward(characterId, attemptMs + 100);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(panel).toContainText("Run complete — 1 batch attempted.");
  await expect(page.getByRole("button", { name: "Start Refining" })).toBeVisible();
  await expect(panel.getByText("1 of 1 attempts", { exact: true })).toBeVisible();

  // A Max run shows no denominator, and ends when the Shale runs out.
  await setCarried(characterId, ITEM_IDS.ferriteShale, [6]);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await max.click();
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  await expect(progress).toHaveAttribute("data-bounded-run-mode", "max");
  await expect(progress).toContainText("Run — 0 batches · Max");
  await expect(progress).not.toContainText(" of ");
  await fastForward(characterId, attemptMs * 5 + 100);
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Refining" })).toBeVisible();
  await expect(panel).toContainText("Not enough material");
  await expect(panel.getByText("3 attempts · Max", { exact: true })).toBeVisible();
  expect(await carried(characterId, ITEM_IDS.ferriteShale)).toBe(0);

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

test("Practice Welding runs a number of complete welds, or Max until the Scrap runs out", async ({
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

  // The same interaction as Refining, counting complete welds. Practice
  // totals a number exactly: every weld costs the same Scrap and pays 100 XP.
  const summary = selector.locator("[data-bounded-run-summary]");
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "1");
  await expect(selector).toHaveAttribute("data-bounded-run-affordable", "3");
  await expect(selector.locator("[data-bounded-run-decrease]")).toBeDisabled();
  await expect(selector).toContainText("Materials for 3 welds");
  await expect(summary).toContainText("2 Scrap Metal");
  await expect(summary).toContainText("100 Welding XP");
  await selector.locator("[data-bounded-run-increase]").click();
  await selector.locator("[data-bounded-run-increase]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "3");
  await expect(summary).toContainText("300 Welding XP");
  await expectNoHorizontalOverflow(page);

  // Stale number: Start refuses before a single piece of Scrap is spent.
  await setCarried(characterId, ITEM_IDS.scrapMetal, [3, 1]);
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toContainText(/Your Scrap covers 2 welds right now/);
  await expect(selector).toHaveAttribute("data-bounded-run-affordable", "2");
  await expect(panel).toHaveAttribute("data-practice-active", "false");
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(4);

  // Choose again: Max, which welds until the Scrap runs out.
  await selector.locator("[data-bounded-run-max]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "max");
  await expect(selector.locator("[data-bounded-run-value]")).toContainText("Max");
  await expect(summary).toContainText("Max · 2 Scrap Metal per weld");
  await expect(summary).toContainText("runs until the Scrap runs out");
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toHaveAttribute("data-practice-active", "true");
  const progress = panel.locator("[data-bounded-run-progress]");
  await expect(progress).toHaveAttribute("data-bounded-run-mode", "max");
  await expect(progress).toContainText("Run — 0 welds · Max");
  await captureReviewScreenshot(page, "bounded-run-practice-mobile-active.png");

  // Both welds the Scrap pays for resolve while the player is away, and the
  // run ends on its own when the Scrap is gone, with no count it never had.
  const weldMs =
    balance.welding.attemptDurationTicks * balance.practiceWelding.sectionsPerWeld * GAME_TICK_MS;
  await fastForward(characterId, weldMs * 2 + 500);
  await page.reload();
  await expect(panel).toHaveAttribute("data-practice-active", "false");
  await expect(panel).toContainText("Out of Scrap Metal");
  await expect(panel.locator("[data-run-summary]")).toContainText("2 welds · Max");
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
  await selector.locator("[data-bounded-run-increase]").click();
  await selector.locator("[data-bounded-run-increase]").click();
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
