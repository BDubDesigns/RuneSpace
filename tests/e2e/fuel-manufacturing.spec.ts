import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
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
  SKILL_IDS,
} from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #343 — fuel manufacturing in a real browser, at phone width.
 *
 * The server suites own the rules and the arithmetic. This covers what only a
 * rendered page can answer: the two recipes appear at the right level on the
 * existing Rusk Recovery station and Processing Yard console with the approved
 * canister art loaded (not initials), the success curve and the failure shape
 * read honestly, and the canisters are ordinary Inventory stacks.
 *
 * The CI Refining random alternates success and failure from the first
 * attempt (0, then 9,000), which at Refining 8 (5,068 basis points) is exactly
 * one Full canister and one failure that hands back its shell and 5 shale.
 */

const PHONE = { width: 390, height: 844 };
const balance = getEffectiveGameBalance();
const xpForLevel = (level: number) =>
  standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;
const REFINE = ACTION_IDS.fullSmallFuelCanisterRefining;
const FABRICATE = ACTION_IDS.emptySmallFuelCanisterFabrication;

const THROUGH_FABRICATION_CHAPTER = [
  MISSION_IDS.walkItOff,
  MISSION_IDS.cutYourTeeth,
  MISSION_IDS.wasteNot,
  MISSION_IDS.holdItTogether,
  MISSION_IDS.keepTheChange,
  MISSION_IDS.tenThousandHours,
  MISSION_IDS.returnTheFavor,
  MISSION_IDS.breakItDown,
];

async function setLevel(characterId: string, skillId: string, level: number) {
  const totalXp = xpForLevel(level);
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

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

async function skillXp(characterId: string, skillId: string) {
  const [row] = await db
    .select({ totalXp: characterSkillXp.totalXp })
    .from(characterSkillXp)
    .where(
      and(eq(characterSkillXp.characterId, characterId), eq(characterSkillXp.skillId, skillId)),
    );
  return row?.totalXp ?? 0;
}

/** Move the running action's cursor back so that much work is due on the next load. */
async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

/** A tile shows the item's committed artwork — loaded, not initials. */
async function expectArtwork(scope: import("@playwright/test").Locator, file: string) {
  const art = scope.locator(`[data-testid="item-artwork"][src*="${file}"]`).first();
  await art.scrollIntoViewIfNeeded();
  await expect(art).toBeVisible();
  await expect
    .poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
}

test("Fabrication 8 fabricates an Empty canister at Rusk Recovery, art and all", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  const now = new Date();
  await db.insert(characterMissions).values(
    THROUGH_FABRICATION_CHAPTER.map((missionId) => ({
      characterId,
      missionId,
      acceptedAt: now,
      completedAt: now,
    })),
  );
  await setLevel(characterId, SKILL_IDS.fabrication, 8);
  await setCarried(characterId, ITEM_IDS.galvanicStock, [2]);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.locator('[data-work-area="fabrication"]').click();
  let station = page.locator("[data-fabrication-station]");
  await expect(station).toBeVisible();
  const tile = station.locator(`[data-fabricate-recipe="${FABRICATE}"]`);
  await expect(tile).toBeVisible();
  // One Stock is one canister; 30 ticks is 18 seconds.
  await expect(tile).toContainText("1 Galvanic Stock → 1 Empty Small Fuel Canister · 18 sec");
  await expectArtwork(tile, "empty-small-fuel-canister.webp");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fuel-manufacturing-fabrication-phone.png");

  await tile.getByRole("button").first().click();
  await expect(station.locator("[data-bounded-run]")).toHaveAttribute(
    "data-bounded-run-affordable",
    "2",
  );
  await station.locator("[data-fabricate-start]").click();
  await expect(station.locator("[data-live-workpiece]")).toContainText("Empty Small Fuel Canister");
  await fastForward(characterId, 18_000 + 1_000);
  await page.reload();
  await page.locator('[data-work-area="fabrication"]').click();
  station = page.locator("[data-fabrication-station]");
  await expect(
    page.locator('[data-station-result="success"] [data-station-result-headline]'),
  ).toContainText("Empty Small Fuel Canister");

  expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(1);
  expect(await carried(characterId, ITEM_IDS.galvanicStock)).toBe(1);
  expect(await skillXp(characterId, SKILL_IDS.fabrication)).toBe(xpForLevel(8) + 75);

  // An ordinary Inventory stack, with its art, that stacks to five.
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(inventory).toContainText("Empty Small Fuel Canister");
  await expectArtwork(inventory, "empty-small-fuel-canister.webp");
});

test("Refining 8 refines Oil Shale at the Processing Yard: one Full canister, then a failure that hands the shell back", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await setLevel(characterId, SKILL_IDS.refining, 8);
  await setCarried(characterId, ITEM_IDS.oilShale, [5, 5, 5, 5]);
  await setCarried(characterId, ITEM_IDS.emptySmallFuelCanister, [2]);
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const panel = page.locator("[data-refining-activity]");
  const tile = panel.locator(`[data-refining-recipe="${REFINE}"]`);
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("data-refining-recipe-ready", "true");
  // Two inputs, one output, 60 ticks (36 s) and the level-8 chance on the shared curve.
  await expect(tile).toContainText(
    "10 Oil Shale + 1 Empty Small Fuel Canister → 1 Full Small Fuel Canister · 36.0s · 50.68%",
  );
  await expectArtwork(tile, "full-small-fuel-canister.webp");
  await tile.getByRole("button", { name: /^Full Small Fuel Canister:/ }).click();
  await expect(panel.locator("[data-refining-selected]")).toContainText("50.68%");
  await expect(panel.locator("[data-refining-selected]")).toContainText("100");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fuel-manufacturing-refining-phone.png");

  // Two batches: the materials pay for exactly two.
  const selector = panel.locator("[data-bounded-run]");
  await expect(selector).toHaveAttribute("data-bounded-run-affordable", "2");
  await selector.locator("[data-bounded-run-increase]").click();
  await expect(selector).toHaveAttribute("data-bounded-run-quantity", "2");
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  await fastForward(characterId, 2 * 36_000 + 1_000);
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Attempt 1 succeeded (one Full canister); attempt 2 failed and returned 5
  // shale and the same shell. No Slag anywhere.
  const latest = page.getByRole("region", { name: "Latest refining attempt", exact: true });
  await expect(latest).toHaveAttribute("data-result-outcome", "failed");
  await expect(latest).toContainText(
    "Latest attempt failed: 5 Oil Shale, 1 Empty Small Fuel Canister returned",
  );
  expect(await carried(characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(1);
  expect(await carried(characterId, ITEM_IDS.oilShale)).toBe(5);
  expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(1);
  expect(await carried(characterId, ITEM_IDS.slag)).toBe(0);
  expect(await skillXp(characterId, SKILL_IDS.refining)).toBe(xpForLevel(8) + 100 + 20);

  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(inventory).toContainText("Full Small Fuel Canister");
  await expectArtwork(inventory, "full-small-fuel-canister.webp");
  await expectArtwork(inventory, "empty-small-fuel-canister.webp");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fuel-manufacturing-inventory-phone.png");
});

test("Refining 7 is not offered the fuel recipe, however much material is carried", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await setLevel(characterId, SKILL_IDS.refining, 7);
  await setCarried(characterId, ITEM_IDS.oilShale, [5, 5]);
  await setCarried(characterId, ITEM_IDS.emptySmallFuelCanister, [1]);
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await openTestCharacter(page, characterId);

  const panel = page.locator("[data-refining-activity]");
  await expect(panel.locator(`[data-refining-recipe="${REFINE}"]`)).toHaveCount(0);
  await panel.locator('[data-refining-mode-select="recipes"]').click();
  await expect(panel.locator(`[data-refining-catalog-entry="${REFINE}"]`)).toHaveCount(0);
  expect(await carried(characterId, ITEM_IDS.oilShale)).toBe(10);
  expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(1);
});
