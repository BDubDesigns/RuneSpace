import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissions,
  characterRepairTargets,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import {
  expectMeterOnServerTimeline,
  skewBrowserClock,
  startAndBracket,
} from "./server-clock-skew";

/**
 * Cross-skill regression for #446: a browser clock 5 s slow or fast must not
 * move a skill's countdown or fill away from the server's timeline. Mining has
 * its own pair in mining.spec.ts; this covers Refining, Fabrication and the
 * Runeworking Rig cycle, each at both skews, mid-action and after a reload
 * (active-state rehydration). Durations come from the authored balance.
 */

const balance = getEffectiveGameBalance();
const rig = getRepairTargetBalance(REPAIR_TARGET_IDS.resonanceRig, balance);
const thresholds = standardSkillLevelThresholds(balance);
const levelXp = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;
const SKEWS = [-5_000, 5_000];

async function stand(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function give(characterId: string, itemId: string, quantity: number) {
  await db.insert(inventoryStacks).values({ characterId, itemId, quantity });
}

for (const skewMs of SKEWS) {
  const tag = `${skewMs / 1_000}s`;

  test(`Refining follows the server clock with the browser ${tag} off (#446)`, async ({
    page,
    testCharacter,
  }) => {
    const characterId = testCharacter.id;
    await stand(characterId, LOCATION_IDS.abandonedProcessingYard);
    await give(characterId, ITEM_IDS.ferriteShale, 10);
    await openTestCharacter(page, characterId);
    await skewBrowserClock(page, skewMs);
    await page.reload();

    const durationMs = balance.refining.recipes.refinedFerrite.attemptDurationTicks * GAME_TICK_MS;
    const window = await startAndBracket(() =>
      page.getByRole("button", { name: "Start Refining" }).click(),
    );
    const meter = page.getByRole("progressbar", { name: /Refining attempt/ });
    await expect(meter).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
    await page.reload();
    await expect(meter).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
  });

  test(`Fabrication follows the server clock with the browser ${tag} off (#446)`, async ({
    page,
    testCharacter,
  }) => {
    const characterId = testCharacter.id;
    const at = new Date();
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
        ].map((missionId) => ({ characterId, missionId, acceptedAt: at, completedAt: at })),
      );
    await db
      .insert(characterMissions)
      .values({ characterId, missionId: MISSION_IDS.returnTheFavor, acceptedAt: at });
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
    await give(characterId, ITEM_IDS.refinedFerrite, 7);
    await stand(characterId, LOCATION_IDS.ruskRecovery);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openTestCharacter(page, characterId);
    await skewBrowserClock(page, skewMs);
    await page.reload();

    const openStation = async () => {
      await page.locator('[data-work-area="fabrication"]').click();
      return page.locator("[data-fabrication-station]");
    };
    let station = await openStation();
    await station
      .locator(`[data-fabricate-recipe="${ACTION_IDS.mountingBracketFabrication}"]`)
      .getByRole("button")
      .click();
    const durationMs = balance.fabrication.recipes.mountingBracket.durationTicks * GAME_TICK_MS;
    const window = await startAndBracket(() => station.locator("[data-fabricate-start]").click());
    const meter = () => station.getByRole("progressbar", { name: /Workpiece/ });
    await expect(meter()).toBeVisible();
    await expectMeterOnServerTimeline(meter(), window, durationMs);
    await page.reload();
    station = await openStation();
    await expect(meter()).toBeVisible();
    await expectMeterOnServerTimeline(meter(), window, durationMs);
  });

  test(`The Resonance Rig cycle follows the server clock with the browser ${tag} off (#446)`, async ({
    page,
    testCharacter,
  }) => {
    const characterId = testCharacter.id;
    const now = new Date();
    await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
    await stand(characterId, LOCATION_IDS.crashSite);
    await db.insert(characterMissions).values(
      [MISSION_IDS.notFromAroundHere, MISSION_IDS.firstRuneworkingLesson].map((missionId) => ({
        characterId,
        missionId,
        acceptedAt: now,
        completedAt: now,
      })),
    );
    await db.insert(characterMissions).values([
      { characterId, missionId: MISSION_IDS.aPlaceToCallHome, acceptedAt: now, completedAt: now },
      { characterId, missionId: MISSION_IDS.aRuneOfYourOwn, acceptedAt: now },
    ]);
    await db.insert(characterSkillXp).values([
      { characterId, skillId: SKILL_IDS.runeworking, totalXp: levelXp(5) },
      { characterId, skillId: SKILL_IDS.welding, totalXp: levelXp(12) },
    ]);
    await db.insert(characterRepairTargets).values({
      characterId,
      targetId: REPAIR_TARGET_IDS.resonanceRig,
      materials: Object.fromEntries(rig.materials.map((item) => [item.itemId, item.quantity])),
      weldingProgress: rig.repairIncrements,
      completedAt: now,
      arrivalAcknowledgedAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryStacks).values([
      { characterId, itemId: ITEM_IDS.cutQuartz, quantity: 1 },
      { characterId, itemId: ITEM_IDS.runestone, quantity: 1 },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTestCharacter(page, characterId);
    await skewBrowserClock(page, skewMs);
    await page.reload();

    const station = page.locator("[data-resonance-rig]");
    const durationMs = balance.runeworking.recipes.skatbollTpRune.durationTicks * GAME_TICK_MS;
    const window = await startAndBracket(() => station.locator("[data-attune-start]").click());
    const meter = station.getByRole("progressbar", { name: /Attunement/ });
    await expect(meter).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
    await page.reload();
    await expect(station.getByRole("progressbar", { name: /Attunement/ })).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
  });
}
