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
import {
  expect,
  openEquipmentTab,
  openNpcConversation,
  openTestCharacter,
  openUtility,
  test,
  utilitySurface,
} from "./fixtures";
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

/** A tile shows the item's committed artwork — loaded, not initials (#233). */
async function expectArtwork(tile: import("@playwright/test").Locator, file: string) {
  const art = tile.locator(`[data-testid="item-artwork"][src*="${file}"]`).first();
  await art.scrollIntoViewIfNeeded();
  await expect(art).toBeVisible();
  await expect
    .poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
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
  await expectArtwork(
    recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.galvanicWireSpoolFabrication}"]`),
    "galvanic-wire-spool.webp",
  );
  await expectArtwork(
    recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.loadsteelCutterFabrication}"]`),
    "loadsteel-cutter.webp",
  );
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
  // The Recipes view is what is on screen now.
  await expectArtwork(
    station
      .locator("[data-fabrication-recipes-catalog]")
      .locator(`[data-recipes-catalog-entry="${ACTION_IDS.freightHarnessFabrication}"]`),
    "freight-harness.webp",
  );
  await station.locator('[data-station-mode-select="tinker"]').click();
  const harnessTarget = page
    .locator("[data-tinker-mode]")
    .locator(`[data-tinker-target="${ACTION_IDS.freightHarnessTinkering}"]`);
  await expect(harnessTarget).toContainText("1 Freight Harness → 3 Scrap Metal");
  await expectArtwork(harnessTarget, "freight-harness.webp");
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
  // Its charge buys ore, not the Salvage Cutter's faster attempts.
  await expect(tool).not.toContainText("Boosted attempt:");
  await expect(tool).toContainText(
    "While charged: +1 ore per successful attempt · attempt time unchanged",
  );
  await expectArtwork(
    equipment.getByRole("region", { name: "Mining tool" }),
    "loadsteel-cutter.webp",
  );
  await tool.getByRole("button", { name: "Load Power Cell" }).click();
  await expect(tool.getByText("Loaded · 10 / 10", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "loadsteel-equipment-phone.png");
  await equipment.getByRole("button", { name: "Close equipment" }).click();

  // Mining with it: the tool's own effects, 8-tick attempts charged or not,
  // and one more ore on the ordinary roll.
  const effects = page.locator(`[data-mining-tool-effects="${ITEM_IDS.loadsteelCutter}"]`);
  await expect(effects).toHaveText(
    "Loadsteel Cutter · 0.8× attempt time, charged or not · charged successes yield 2–3 Ferrite Shale",
  );
  await expect(page.getByText("POWER CELL BOOST · 10 / 10")).toBeVisible();
  await expect(page.getByText("Next attempt: 8 ticks")).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  // Stop Mining renders only from the server's committed active action.
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await fastForward(characterId, 5_000);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt" });
  await expect(latest).toContainText(
    "Power Cell boosted · 8 ticks · Power Cell charge consumed · 9 / 10 remaining",
  );
  // The deterministic browser roll is the low side: 1 ore, plus the one.
  await expect(latest.getByLabel("2 Ferrite Shale earned")).toBeVisible();
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
  await openUtility(page, "inventory");
  const inventory = utilitySurface(page, "Inventory");
  const tile = inventory.locator("button[aria-pressed]").filter({ hasText: "Loadsteel Cutter" });
  await expect(tile).toContainText("9/10");
  await tile.click();
  const details = inventory.getByRole("region", { name: "Loadsteel Cutter details" });
  await expect(details.locator('[data-stat="required-mining-level"]')).toContainText("Mining 5");
  await expect(details.locator('[data-stat="mining-time"]')).toContainText("0.8×");
  await expect(details.locator('[data-stat="charged-yield"]')).toContainText("+1 ore per success");
  await expectArtwork(tile, "loadsteel-cutter.webp");
  await expect(details.getByText("9 of 10 charges remaining").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // Widening past 1280px turns the open Inventory from the phone's modal Drawer
  // into the desktop dock (one presentation, never both). A new presentation is
  // a new instance, so the tile selection is made again there.
  await page.setViewportSize(DESKTOP);
  const docked = utilitySurface(page, "Inventory");
  await docked.locator("button[aria-pressed]").filter({ hasText: "Loadsteel Cutter" }).click();
  await expect(docked.getByRole("region", { name: "Loadsteel Cutter details" })).toBeVisible();
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
  await expectArtwork(second, "freight-harness.webp");
  await second.getByRole("button", { name: "Equip in Container attachment 2" }).click();
  await expect(equipment.getByText("14 slots", { exact: true })).toBeVisible();
  await expect(second).toContainText("Freight Harness");
  await expectArtwork(second, "freight-harness.webp");
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "freight-harness-equipment-desktop.png");
  await page.setViewportSize(PHONE);
  // The docked Equipment panel became the phone's Drawer, a new instance.
  await expect(
    utilitySurface(page, "Equipment").getByRole("region", { name: "Container attachment 2" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await utilitySurface(page, "Equipment").getByRole("button", { name: "Close equipment" }).click();
  await openUtility(page, "inventory");
  await expect(utilitySurface(page, "Inventory").getByLabel("14 inventory slots")).toBeVisible();
});

test("A Cut Above: show Tansy the Loadsteel Cutter in your hand, and keep it", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await completeThroughBrace(characterId);
  await setLevel(characterId, SKILL_IDS.fabrication, 5);
  await setLevel(characterId, SKILL_IDS.mining, 5);
  // Owned before the job and not made by this player: it is already equipped.
  const cutter = await addInstance(characterId, ITEM_IDS.loadsteelCutter, 3);
  await db.insert(equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: balance.carrying.miningToolSuitSlotId,
    itemInstanceId: cutter.id,
  });
  await standAt(characterId, LOCATION_IDS.theJag);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const offer = await openNpcConversation(page, "Tansy Rusk");
  const offerEntry = offer.getByRole("button", { name: /A Cut Above/ });
  await expect(offerEntry).toContainText("Available");
  await offerEntry.click();
  await playToDialogueText(offer, /starting to trust you/);
  await playToDialogueText(offer, /Better frame\. Better drive\./);
  await playToDialogueText(offer, /Get your hands on one\./);
  await playToDialogueText(offer, /Bring it by when you've got it\. I want to take a look\./);
  await expectNoHorizontalOverflow(page);
  await (await playToAction(offer, "TAKE THE JOB")).click();
  await page.keyboard.press("Escape");
  // The Cutter in hand satisfies the objective at once: no trip to the station.
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    "Show Tansy a Loadsteel Cutter",
  );

  const xpBefore = await skillXp(characterId, SKILL_IDS.fabrication);
  const turnIn = await openNpcConversation(page, "Tansy Rusk");
  await turnIn.getByRole("button", { name: /A Cut Above/ }).click();
  await playToDialogueText(turnIn, /There it is\./);
  await (await playToAction(turnIn, "SHOW HER THE CUTTER")).click();
  await playToDialogueText(turnIn, /Keep checking that recipe list/);
  await playToDialogueText(
    turnIn,
    /And keep the Cutter\. You'll get more use out of it than I will\./,
  );
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "a-cut-above-turn-in-phone.png");
  await page.keyboard.press("Escape");
  expect((await skillXp(characterId, SKILL_IDS.fabrication)) - xpBefore).toBe(500);
  // Kept, still equipped, charge untouched.
  const kept = await instancesOf(characterId, ITEM_IDS.loadsteelCutter);
  expect(kept.map((row) => [row.id, row.currentCharge])).toEqual([[cutter.id, 3]]);
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
