import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterRepairTargets,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { expect, openMapSurface, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #209 — the Deep Jag journey in a real browser.
 *
 * What the server suites already prove is not repeated here. This covers the
 * things only a rendered page can answer: that a blocked Deep Jag reads as
 * blocked without a wasted Walk button, that the collapsed worksite presents
 * one generic repair panel with both materials, that the finished weld turns
 * the same location into a mine without a reload, that the Refining console
 * shows all three recipes with the locked ones legible, and that the map is
 * usable at phone width now that it has grown south as well as west.
 */

const balance = getEffectiveGameBalance();
const caveIn = balance.repairTargets.deepJagCaveIn;

function xpForLevel(level: number): number {
  return standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;
}

/**
 * Set one skill's total XP, whether or not play provisioning already created
 * that skill's zero row.
 */
async function setSkillXp(characterId: string, skillId: string, totalXp: number) {
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

/** Everything through 10,000 Hours, both skills at 5, standing at The Jag. */
async function qualifiedAtTheJag(characterId: string) {
  const now = new Date();
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
  await setSkillXp(characterId, SKILL_IDS.mining, xpForLevel(5));
  await setSkillXp(characterId, SKILL_IDS.welding, xpForLevel(5));
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.theJag })
    .where(eq(characters.id, characterId));
}

/** Accept Brace Yourself and stand at the collapsed worksite. */
async function atTheWorksite(characterId: string) {
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.braceYourself, acceptedAt: new Date() });
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.deepJag })
    .where(eq(characters.id, characterId));
}

test("a blocked Deep Jag identifies itself and offers no Walk", async ({ page, testCharacter }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await qualifiedAtTheJag(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  const hex = page.locator('[data-map-location="deep_jag"]');
  await expect(hex).toBeVisible();
  await expect(hex.locator("[data-map-status]")).toHaveText("CAVE-IN");
  await hex.click();

  // Named, explained, and honest: the status is the reason, and there is no
  // Walk button to press at all.
  await expect(page.getByText("Deep Jag", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-map-route-blocked="deep_jag"]')).toHaveText(/CAVE-IN/);
  await expect(page.getByRole("button", { name: /Walk to Deep Jag/ })).toHaveCount(0);
  await captureReviewScreenshot(page, "deep-jag-blocked-mobile.png");

  // The map now spans two axes, and both are honest native scrolling rather
  // than a zoom or a drag engine.
  const viewport = page.locator("[data-map-scroll-viewport]");
  const metrics = await viewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflow: getComputedStyle(element).overflow,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.overflow).toBe("auto");
  // The nested scroller is bounded but not so short that the page becomes
  // miserable to scroll past on a phone.
  expect(metrics.clientHeight).toBeGreaterThan(200);
  expect(metrics.clientHeight).toBeLessThan(844);
  // No horizontal page overflow escapes the bounded viewport.
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});

test("the accepted Mission opens the walk, and the same map hex offers it", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await qualifiedAtTheJag(testCharacter.id);
  await db.insert(characterMissions).values({
    characterId: testCharacter.id,
    missionId: MISSION_IDS.braceYourself,
    acceptedAt: new Date(),
  });
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  const hex = page.locator('[data-map-location="deep_jag"]');
  await hex.click();
  await expect(page.locator('[data-map-route-blocked="deep_jag"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Walk to Deep Jag/ })).toBeVisible();
});

test("the worksite is one generic repair panel, and the last weld opens the mine", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = testCharacter.id;
  await qualifiedAtTheJag(characterId);
  await atTheWorksite(characterId);
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
    { characterId, itemId: ITEM_IDS.powerCell, quantity: 2 },
  ]);
  await openTestCharacter(page, characterId);

  // One panel, two authored material rows, each with its authored note.
  const panel = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.deepJagCaveIn}"]`);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-repair-complete", "false");
  await expect(panel.getByText(/Refined Ferrite —/)).toBeVisible();
  await expect(panel.getByText(/Power Cell —/)).toBeVisible();
  await expect(panel.getByText("0 / 25")).toBeVisible();
  await expect(panel.getByText("0 / 5")).toBeVisible();
  await captureReviewScreenshot(page, "deep-jag-worksite-mobile.png");

  // A partial contribution takes exactly what is carried and persists it.
  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.getByText("5 / 25")).toBeVisible();
  await expect(panel.getByText("2 / 5")).toBeVisible();
  // Welding is not on offer while material is outstanding.
  await expect(panel.locator("[data-repair-start-welding]")).toHaveCount(0);

  // Finish the materials and all but the last weld server-side, then weld it.
  await db
    .update(characterRepairTargets)
    .set({
      materials: { [ITEM_IDS.refinedFerrite]: 25, [ITEM_IDS.powerCell]: 5 },
      weldingProgress: caveIn.repairIncrements - 1,
    })
    .where(eq(characterRepairTargets.characterId, characterId));
  await page.reload();
  await expect(panel.getByText(`${caveIn.repairIncrements - 1} / 15 welds`)).toBeVisible();
  await panel.locator("[data-repair-start-welding]").click();

  // Fast-forward the final section the way the other journeys do.
  const ago = new Date(Date.now() - balance.welding.attemptDurationTicks * 1_000 - 5_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();

  // The same location is now a mine: no second unlock, no trip to Tansy.
  await expect(page.locator("[data-repair-work-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start Mining/ })).toBeVisible();
  await captureReviewScreenshot(page, "deep-jag-opened-mobile.png");

  // And the map says so too.
  await openMapSurface(page);
  await expect(page.locator('[data-map-location="deep_jag"] [data-map-status]')).toHaveText(
    "MINING",
  );
});

test("the Refining console shows all three recipes, with the locked two legible", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = testCharacter.id;
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(characters.id, characterId));
  await openTestCharacter(page, characterId);

  const recipes = page.locator("[data-refining-recipes]");
  await expect(recipes.locator("[data-refining-recipe]")).toHaveCount(3);
  const stock = recipes.locator(`[data-refining-recipe="${ACTION_IDS.galvanicStockRefining}"]`);
  const alloy = recipes.locator(`[data-refining-recipe="${ACTION_IDS.galvaferriteRefining}"]`);

  // Visible from the beginning, clearly locked, and not selectable.
  await expect(stock).toHaveAttribute("data-refining-recipe-locked", "true");
  await expect(stock).toBeDisabled();
  await expect(stock).toContainText("Requires Refining 5");
  await expect(alloy).toHaveAttribute("data-refining-recipe-locked", "true");
  await expect(alloy).toContainText("Requires Refining 8");
  // The shipped recipe is open and selected.
  await expect(recipes.locator(`[data-refining-recipe="${ACTION_IDS.refining}"]`)).toHaveAttribute(
    "data-refining-recipe-locked",
    "false",
  );
  await captureReviewScreenshot(page, "refining-recipes-mobile.png");

  // At Refining 5 the second recipe becomes selectable, in the same console.
  await setSkillXp(characterId, SKILL_IDS.refining, xpForLevel(5));
  await page.reload();
  await expect(stock).toHaveAttribute("data-refining-recipe-locked", "false");
  await expect(stock).toBeEnabled();
  await stock.click();
  await expect(stock).toHaveAttribute("aria-pressed", "true");
});
