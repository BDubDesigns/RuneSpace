import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import { expect, openEquipmentTab, openNpcConversation, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #233 — Fabrication 5 and 8 in the browser, at phone and desktop width.
 *
 * The level-5 and level-8 recipes appearing by level alone, the Power Cell
 * batch that stays x2 on its tile however many batches are chosen, the
 * advanced Tinker rows, the Loadsteel Cutter's Mining 5 gate and its charge
 * against its own maximum, Mining with both Cutters, the Freight Harness as a
 * container, and Tansy's and Renn's Missions played through their locked
 * scenes. Timers are fast-forwarded by moving the durable cursor, exactly as a
 * reconnect after time away; the arithmetic is proven against PostgreSQL in
 * the integration suite.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const balance = getEffectiveGameBalance();
const thresholds = standardSkillLevelThresholds(balance);
const xpForLevel = (level: number) =>
  thresholds.find((threshold) => threshold.level === level)!.totalXp;

const THROUGH_BRACE = [
  MISSION_IDS.walkItOff,
  MISSION_IDS.cutYourTeeth,
  MISSION_IDS.wasteNot,
  MISSION_IDS.holdItTogether,
  MISSION_IDS.keepTheChange,
  MISSION_IDS.tenThousandHours,
  MISSION_IDS.returnTheFavor,
  MISSION_IDS.breakItDown,
  MISSION_IDS.braceYourself,
];

async function completeThroughBrace(characterId: string) {
  const at = new Date();
  await db.insert(characterMissions).values(
    THROUGH_BRACE.map((missionId) => ({
      characterId,
      missionId,
      acceptedAt: at,
      completedAt: at,
    })),
  );
}

async function setLevel(characterId: string, skillId: string, level: number) {
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp: xpForLevel(level) })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp: xpForLevel(level) },
    });
}

async function standAt(characterId: string, locationId: LocationId) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

/** The starter Cutter every character past Walk It Off carries, equipped. */
async function equipStarterCutter(characterId: string) {
  const [cutter] = await db
    .insert(itemInstances)
    .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })
    .returning();
  await db.insert(equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: balance.carrying.miningToolSuitSlotId,
    itemInstanceId: cutter!.id,
  });
}

async function give(characterId: string, itemId: string, quantity: number) {
  await db.insert(inventoryStacks).values({ characterId, itemId, quantity });
}

async function addInstance(characterId: string, itemId: string, currentCharge: number | null) {
  const [row] = await db
    .insert(itemInstances)
    .values({ characterId, itemId, currentCharge })
    .returning();
  return row!;
}

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

async function instancesOf(characterId: string, itemId: string) {
  return db
    .select()
    .from(itemInstances)
    .where(and(eq(itemInstances.characterId, characterId), eq(itemInstances.itemId, itemId)));
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

async function creditsOf(characterId: string) {
  const [row] = await db
    .select({ credits: characters.credits })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row!.credits;
}

/** Move the running action's cursor back so that much time is due on the next load. */
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

/** Click through an authored sequence until one of its beats says something. */
async function playToDialogueText(dialogue: import("@playwright/test").Locator, pattern: RegExp) {
  const text = dialogue.locator("[data-dialogue-text]");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (pattern.test((await text.textContent()) ?? "")) return;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      if (await text.isVisible()) await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(text).toContainText(pattern);
}

/** Click through an authored sequence until its action control appears. */
async function playToAction(
  dialogue: import("@playwright/test").Locator,
  actionName: string | RegExp,
) {
  const action = dialogue.getByRole("button", { name: actionName });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await action.isVisible()) return action;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      const text = dialogue.locator("[data-dialogue-text]");
      if (await text.isVisible()) await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(action).toBeVisible();
  return action;
}

async function openStation(page: import("@playwright/test").Page) {
  await page.locator('[data-work-area="fabrication"]').click();
  const station = page.locator("[data-fabrication-station]");
  await expect(station).toBeVisible();
  return station;
}

test("Fabrication 5 and 8: recipes by level, the x2 Cell batch, and advanced Tinkering", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await completeThroughBrace(characterId);
  await equipStarterCutter(characterId);
  await setLevel(characterId, SKILL_IDS.fabrication, 5);
  await give(characterId, ITEM_IDS.galvanicStock, 4);
  await give(characterId, ITEM_IDS.galvaferrite, 2);
  await give(characterId, ITEM_IDS.galvanicWireSpool, 1);
  await give(characterId, ITEM_IDS.powerCell, 1);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Fabrication 5 shows the level-5 recipes the carried stock makes, by level
  // alone; the level-8 Freight Harness is nowhere at the station.
  let station = await openStation(page);
  const recipes = station.locator("[data-fabricate-recipes]");
  for (const actionId of [
    ACTION_IDS.galvanicScrapFabrication,
    ACTION_IDS.galvanicWireSpoolFabrication,
    ACTION_IDS.powerCellFabrication,
    ACTION_IDS.loadsteelCutterFabrication,
  ]) {
    await expect(recipes.locator(`[data-fabricate-recipe="${actionId}"]`)).toBeVisible();
  }
  await expect(
    recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.loadsteelCutterFabrication}"]`),
  ).toContainText(
    "2 Galvaferrite + 1 Galvanic Wire Spool + 1 Power Cell → 1 Loadsteel Cutter · 27 sec",
  );
  await expect(
    recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.freightHarnessFabrication}"]`),
  ).toHaveCount(0);
  await station.locator('[data-station-mode-select="recipes"]').click();
  const catalog = station.locator("[data-fabrication-recipes-catalog]");
  await expect(catalog.locator("[data-recipes-catalog-entry]")).toHaveCount(8);
  await expect(
    catalog.locator(`[data-recipes-catalog-entry="${ACTION_IDS.freightHarnessFabrication}"]`),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await station.locator('[data-station-mode-select="fabricate"]').click();

  // One Power Cell batch is two Cells, whatever the run size: four batches
  // still show x2 on the tile while the run totals eight.
  const cellTile = recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.powerCellFabrication}"]`);
  await cellTile.getByRole("button").first().click();
  await expect(cellTile).toContainText("x2");
  const runSize = station.locator("[data-bounded-run]");
  await expect(runSize).toHaveAttribute("data-bounded-run-affordable", "4");
  for (let step = 0; step < 3; step += 1) {
    await runSize.locator("[data-bounded-run-increase]").click();
  }
  await expect(runSize).toHaveAttribute("data-bounded-run-quantity", "4");
  await expect(runSize.locator("[data-bounded-run-summary]")).toContainText(
    "4 batches · 4 Galvanic Stock → 8 Power Cell · 72 sec · 300 base Fabrication XP",
  );
  await expect(cellTile).toContainText("x2");
  await expect(cellTile).not.toContainText("x8");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fabrication-advanced-power-cells-phone.png");

  await station.locator("[data-fabricate-start]").click();
  await expect(station.locator("[data-live-workpiece]")).toContainText("Power Cell");
  await fastForward(characterId, 4 * 18_000 + 1_000);
  await page.reload();
  station = await openStation(page);
  await expect(
    page.locator('[data-station-result="success"] [data-station-result-headline]'),
  ).toHaveText("8 × Power Cell fabricated");
  expect(await carried(characterId, ITEM_IDS.powerCell)).toBe(9);
  expect(await carried(characterId, ITEM_IDS.galvanicStock)).toBe(0);
  expect(await skillXp(characterId, SKILL_IDS.fabrication)).toBe(xpForLevel(5) + 300);

  // Tinker lists the advanced targets carried, each from the universal rules:
  // Power Cells only as a complete pair.
  await addInstance(characterId, ITEM_IDS.loadsteelCutter, 0);
  await page.reload();
  station = await openStation(page);
  await station.locator('[data-station-mode-select="tinker"]').click();
  const tinker = page.locator("[data-tinker-mode]");
  const cellTarget = tinker.locator(`[data-tinker-target="${ACTION_IDS.powerCellTinkering}"]`);
  await expect(cellTarget).toContainText("2 Power Cell → 1 Scrap Metal");
  await expect(cellTarget).toContainText("x2");
  await expect(
    tinker.locator(`[data-tinker-target="${ACTION_IDS.galvanicWireSpoolTinkering}"]`),
  ).toContainText("1 Galvanic Wire Spool → 1 Scrap Metal");
  await expect(
    tinker.locator(`[data-tinker-target="${ACTION_IDS.loadsteelCutterTinkering}"]`),
  ).toContainText("1 Loadsteel Cutter → 2 Scrap Metal");
  await cellTarget.getByRole("button").first().click();
  await expect(tinker.locator("[data-bounded-run-summary]")).toContainText(
    "1 batch · 2 Power Cell · 36 sec · 75 Fabrication XP · 1 Scrap Metal",
  );
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fabrication-advanced-tinker-phone.png");

  // Fabrication 8, at desktop width: the Freight Harness appears by level alone.
  await setLevel(characterId, SKILL_IDS.fabrication, 8);
  await give(characterId, ITEM_IDS.galvaferrite, 2);
  await give(characterId, ITEM_IDS.mountingBracket, 2);
  await addInstance(characterId, ITEM_IDS.freightHarness, null);
  await page.setViewportSize(DESKTOP);
  await page.reload();
  station = await openStation(page);
  await expect(
    station
      .locator("[data-fabricate-recipes]")
      .locator(`[data-fabricate-recipe="${ACTION_IDS.freightHarnessFabrication}"]`),
  ).toContainText("4 Galvaferrite + 2 Mounting Bracket → 1 Freight Harness · 36 sec");
  await station.locator('[data-station-mode-select="recipes"]').click();
  await expect(
    station.locator("[data-fabrication-recipes-catalog]").locator("[data-recipes-catalog-entry]"),
  ).toHaveCount(9);
  await station.locator('[data-station-mode-select="tinker"]').click();
  await expect(
    page
      .locator("[data-tinker-mode]")
      .locator(`[data-tinker-target="${ACTION_IDS.freightHarnessTinkering}"]`),
  ).toContainText("1 Freight Harness → 3 Scrap Metal");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fabrication-advanced-tinker-desktop.png");
});

test("the Loadsteel Cutter: Mining 5 to equip, its own charge, and Mining with both Cutters", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await equipStarterCutter(characterId);
  await setLevel(characterId, SKILL_IDS.mining, 4);
  const loadsteel = await addInstance(characterId, ITEM_IDS.loadsteelCutter, 0);
  await give(characterId, ITEM_IDS.powerCell, 1);
  await standAt(characterId, LOCATION_IDS.theJag);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Below Mining 5 it is listed, but locked, with the reason.
  let equipment = await openEquipmentTab(page);
  const toolSlot = equipment.getByRole("region", { name: "Mining tool" });
  await expect(toolSlot.locator("[data-equip-requirement]")).toHaveText(
    "Requires Mining 5 (you are 4)",
  );
  await expect(toolSlot.getByRole("button", { name: "Equip in Mining tool" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  // At Mining 5 it equips, starts at 0/10, and describes its own effects.
  await setLevel(characterId, SKILL_IDS.mining, 5);
  await page.reload();
  equipment = await openEquipmentTab(page);
  await equipment
    .getByRole("region", { name: "Mining tool" })
    .getByRole("button", { name: "Equip in Mining tool" })
    .click();
  const tool = equipment.locator(`[data-equipped-mining-tool="${ITEM_IDS.loadsteelCutter}"]`);
  await expect(tool).toBeVisible();
  await expect(tool.getByText("Depleted · 0 / 10", { exact: true })).toBeVisible();
  await expect(tool).toContainText(
    "Normal attempt: 8 ticks / 4.8 seconds (0.8× base time, charged or not)",
  );
  await expect(tool).toContainText("Boosted attempt: 4 ticks / 2.4 seconds");
  await expect(tool).toContainText("While charged: +1 maximum yield per success");
  await tool.getByRole("button", { name: "Load Power Cell" }).click();
  await expect(tool.getByText("Loaded · 10 / 10", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "loadsteel-equipment-phone.png");
  await equipment.getByRole("button", { name: "Close equipment" }).click();

  // Mining with it: the tool's own effects, and 4-tick charged attempts.
  const effects = page.locator(`[data-mining-tool-effects="${ITEM_IDS.loadsteelCutter}"]`);
  await expect(effects).toHaveText(
    "Loadsteel Cutter · 0.8× attempt time, charged or not · charged successes yield 1–3 Ferrite Shale",
  );
  await expect(page.getByText("POWER CELL BOOST · 10 / 10")).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await fastForward(characterId, 2_500);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt" });
  await expect(latest).toContainText(
    "Power Cell boosted · 4 ticks · Power Cell charge consumed · 9 / 10 remaining",
  );
  await expect(page.getByText(/POWER CELL BOOST · 9 \/ 10/)).toBeVisible();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "loadsteel-mining-phone.png");

  // Swap back to the Salvage Cutter: its own 10-tick attempts, no Loadsteel line.
  equipment = await openEquipmentTab(page);
  await equipment
    .getByRole("region", { name: "Mining tool" })
    .getByRole("button", { name: "Equip in Mining tool" })
    .click();
  await expect(
    equipment.locator(`[data-equipped-mining-tool="${ITEM_IDS.salvageCutter}"]`),
  ).toBeVisible();
  await equipment.getByRole("button", { name: "Close equipment" }).click();
  await expect(effects).toHaveCount(0);
  await expect(
    page.getByText("Mining is idle. Normal Ferrite Shale attempts take 10 ticks / 6 seconds", {
      exact: false,
    }),
  ).toBeVisible();

  // The stored Loadsteel Cutter keeps exactly its charge, shown against its own ten.
  expect((await instancesOf(characterId, ITEM_IDS.loadsteelCutter))[0]!.currentCharge).toBe(9);
  await page.getByRole("button", { name: /Inventory/ }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  const tile = inventory.locator("button[aria-pressed]").filter({ hasText: "Loadsteel Cutter" });
  await expect(tile).toContainText("9/10");
  await tile.click();
  const details = inventory.getByRole("region", { name: "Loadsteel Cutter details" });
  await expect(details.locator('[data-stat="required-mining-level"]')).toContainText("Mining 5");
  await expect(details.locator('[data-stat="mining-time"]')).toContainText("0.8×");
  await expect(details.locator('[data-stat="charged-yield"]')).toContainText("+1 maximum yield");
  await expect(details.getByText("9 of 10 charges remaining").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize(DESKTOP);
  await expect(details).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "loadsteel-inventory-desktop.png");
  expect(loadsteel.id).toBe((await instancesOf(characterId, ITEM_IDS.loadsteelCutter))[0]!.id);
});

test("the Freight Harness equips as a container for six more Inventory slots", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(DESKTOP);
  await equipStarterCutter(characterId);
  await addInstance(characterId, ITEM_IDS.freightHarness, null);
  await openTestCharacter(page, characterId);

  const equipment = await openEquipmentTab(page);
  await expect(equipment.getByText("8 slots", { exact: true })).toBeVisible();
  const second = equipment.getByRole("region", { name: "Container attachment 2" });
  await expect(second).toContainText("+6 Inventory slots");
  await second.getByRole("button", { name: "Equip in Container attachment 2" }).click();
  await expect(equipment.getByText("14 slots", { exact: true })).toBeVisible();
  await expect(second).toContainText("Freight Harness");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "freight-harness-equipment-desktop.png");
  await page.setViewportSize(PHONE);
  await expect(second).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await equipment.getByRole("button", { name: "Close equipment" }).click();
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Inventory" }).getByLabel("14 inventory slots"),
  ).toBeVisible();
});

test("A Cut Above: Tansy's lesson, one Loadsteel Cutter made, and the Cutter kept", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await completeThroughBrace(characterId);
  await equipStarterCutter(characterId);
  await setLevel(characterId, SKILL_IDS.fabrication, 5);
  await standAt(characterId, LOCATION_IDS.theJag);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const offer = await openNpcConversation(page, "Tansy Rusk");
  const offerEntry = offer.getByRole("button", { name: /A Cut Above/ });
  await expect(offerEntry).toContainText("Available");
  await offerEntry.click();
  await playToDialogueText(offer, /starting to trust you/);
  await playToDialogueText(offer, /Better frame\. Better drive\./);
  await playToDialogueText(offer, /higher tier materials/);
  await expectNoHorizontalOverflow(page);
  await (await playToAction(offer, "TAKE THE JOB")).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    "Fabricate a Loadsteel Cutter — 0 / 1",
  );

  // Make one, at the station in Wade's yard.
  await give(characterId, ITEM_IDS.galvaferrite, 2);
  await give(characterId, ITEM_IDS.galvanicWireSpool, 1);
  await give(characterId, ITEM_IDS.powerCell, 1);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  const station = await openStation(page);
  const cutterTile = station.locator(
    `[data-fabricate-recipe="${ACTION_IDS.loadsteelCutterFabrication}"]`,
  );
  await expect(cutterTile.locator('[data-mission-guidance="active"]')).toHaveCount(1);
  await expect(
    station.locator(`[data-fabricate-selected="${ACTION_IDS.loadsteelCutterFabrication}"]`),
  ).toBeVisible();
  await station.locator("[data-fabricate-start]").click();
  await expect(station.locator("[data-live-workpiece]")).toContainText("Loadsteel Cutter");
  // Back after the timer: the workpiece resolves at the station, then the
  // player walks to The Jag.
  await fastForward(characterId, 28_000);
  await page.reload();
  await expect(page.locator("[data-live-workpiece]")).toHaveCount(0);
  await standAt(characterId, LOCATION_IDS.theJag);
  await page.reload();
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    "Show Tansy Rusk the Loadsteel Cutter at The Jag",
  );
  const made = await instancesOf(characterId, ITEM_IDS.loadsteelCutter);
  expect(made).toHaveLength(1);
  expect(made[0]!.currentCharge).toBe(0);

  const xpBefore = await skillXp(characterId, SKILL_IDS.fabrication);
  const turnIn = await openNpcConversation(page, "Tansy Rusk");
  await turnIn.getByRole("button", { name: /A Cut Above/ }).click();
  await playToDialogueText(turnIn, /There it is\./);
  await (await playToAction(turnIn, "SHOW HER THE CUTTER")).click();
  await playToDialogueText(turnIn, /Keep checking that recipe list/);
  await playToDialogueText(turnIn, /And keep the Cutter\. You earned it\./);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "a-cut-above-turn-in-phone.png");
  await page.keyboard.press("Escape");
  expect((await skillXp(characterId, SKILL_IDS.fabrication)) - xpBefore).toBe(500);
  expect(await instancesOf(characterId, ITEM_IDS.loadsteelCutter)).toHaveLength(1);
});

test("Cutting Costs: Renn buys any Loadsteel Cutter for 500 Credits", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(DESKTOP);
  await completeThroughBrace(characterId);
  await equipStarterCutter(characterId);
  // Not fabricated by this player at all: Renn does not care where it came from.
  const cutter = await addInstance(characterId, ITEM_IDS.loadsteelCutter, 0);
  await standAt(characterId, LOCATION_IDS.holoHollow);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowAssistanceCenter}"]`)
    .click();

  const offer = await openNpcConversation(page, "Renn Calder");
  const offerEntry = offer.getByRole("button", { name: /Cutting Costs/ });
  await expect(offerEntry).toContainText("Available");
  await offerEntry.click();
  await playToDialogueText(offer, /Been looking at those Loadsteel Cutters\./);
  await playToDialogueText(offer, /Five hundred credits\./);
  await playToDialogueText(offer, /I need the Cutter, not the story behind it\./);
  await (await playToAction(offer, "TAKE THE JOB")).click();
  await page.keyboard.press("Escape");

  const creditsBefore = await creditsOf(characterId);
  const turnIn = await openNpcConversation(page, "Renn Calder");
  await turnIn.getByRole("button", { name: /Cutting Costs/ }).click();
  await playToDialogueText(turnIn, /That it\?/);
  await playToDialogueText(turnIn, /Five hundred credits, like I said\./);
  await expectNoHorizontalOverflow(page);
  await (await playToAction(turnIn, "HAND OVER THE CUTTER")).click();
  await playToDialogueText(turnIn, /Renn takes the Loadsteel Cutter\./);
  await playToDialogueText(turnIn, /half my weight around in Power Cells/);
  await captureReviewScreenshot(page, "cutting-costs-turn-in-desktop.png");
  await page.keyboard.press("Escape");
  expect((await creditsOf(characterId)) - creditsBefore).toBe(500);
  expect(
    (await instancesOf(characterId, ITEM_IDS.loadsteelCutter)).map((row) => row.id),
  ).not.toContain(cutter.id);
  await page.setViewportSize(PHONE);
  await expectNoHorizontalOverflow(page);
});
