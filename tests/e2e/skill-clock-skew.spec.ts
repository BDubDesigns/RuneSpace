import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterPracticeWelds,
  characterWorkOrderPostings,
  characterResearchAssignments,
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
  RESEARCH_JOB_IDS,
  WORK_ORDER_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { THEYRE_MINERALS_MARIE } from "@/game/content/missions";
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

for (const skewMs of [0, ...SKEWS]) {
  test(`Lapidary follows server time with browser skew ${skewMs}ms (#468)`, async ({
    page,
    testCharacter,
  }) => {
    const characterId = testCharacter.id;
    await stand(characterId, LOCATION_IDS.wernersLab);
    await db
      .insert(characterSkillXp)
      .values({
        characterId,
        skillId: SKILL_IDS.lapidary,
        totalXp: levelXp(5),
      })
      .onConflictDoUpdate({
        target: [characterSkillXp.characterId, characterSkillXp.skillId],
        set: { totalXp: levelXp(5) },
      });
    const completedAt = new Date();
    await db.insert(characterMissions).values({
      characterId,
      missionId: MISSION_IDS.theyreMineralsMarie,
      completedStageIds: THEYRE_MINERALS_MARIE.stages!.map((stage) => stage.id),
      acceptedAt: completedAt,
      completedAt,
    });
    await give(characterId, ITEM_IDS.uncutTopaz, 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTestCharacter(page, characterId);
    await skewBrowserClock(page, skewMs);
    await page.reload();

    const bench = page.locator("[data-lapidary-workbench]");
    await bench.getByRole("button", { name: "Techniques", exact: true }).click();
    await expect(bench.locator("[data-lapidary-techniques-catalog]")).toBeVisible();
    await bench.getByRole("button", { name: "Work", exact: true }).click();
    await bench
      .locator(`[data-lapidary-recipe="${ACTION_IDS.cutTopaz}"]`)
      .getByRole("button")
      .click();
    await bench.locator("[data-bounded-run-max]").click();
    const durationMs = balance.lapidary.recipes.cutTopaz.durationTicks * GAME_TICK_MS;
    const window = await startAndBracket(() => bench.locator("[data-lapidary-start]").click());
    const meter = bench.getByRole("progressbar", { name: /Cut Topaz/ });
    await expect(meter).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(8);
    await expectMeterOnServerTimeline(meter, window, durationMs);
    await page.reload();
    await expect(meter).toBeVisible();
    await expectMeterOnServerTimeline(meter, window, durationMs);
    await expect(bench.getByRole("button", { name: "Stop After This Piece" })).toBeVisible();
    if (skewMs === 0) {
      // Advance the display clock without advancing the server, so the live
      // cycle stays projected while its display reaches the resolving state.
      await page.evaluate((advanceMs) => {
        const previousNow = Date.now;
        Date.now = () => previousNow() + advanceMs;
      }, durationMs);
      await expect(meter).toHaveAttribute("aria-label", /Resolving/);
      const ageCurrentPiece = async () => {
        const ago = new Date(Date.now() - durationMs - 1_000);
        await db
          .update(activeActions)
          .set({ startedAt: ago, resolvedThroughAt: ago })
          .where(eq(activeActions.characterId, characterId));
        await page.reload();
      };
      await ageCurrentPiece();
      await expect(bench.locator("[data-bounded-run-progress]")).toContainText("1 piece");
      await expect(meter).toBeVisible();
      await ageCurrentPiece();
      await expect(bench.locator("[data-lapidary-cycle]")).toHaveCount(0);
      await expect(bench.locator("[data-lapidary-result]")).toContainText("+300 Lapidary XP");
    }
  });
}

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

// The cursor is placed briefly in the future solely to keep this seeded,
// already-projected opportunity stable while CI loads and reloads the page.
// Both the server and this test process retain their real clocks.
for (const skewMs of [0, -5_000, 5_000]) {
  for (const label of ["Clean Pass window", "Current weld"]) {
    test(`${label} uses server time with browser skew ${skewMs}ms (#470)`, async ({
      page,
      testCharacter,
    }) => {
      const characterId = testCharacter.id;
      const target = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
      const now = new Date();
      await db.insert(characterMissions).values({
        characterId,
        missionId: MISSION_IDS.braceYourself,
        acceptedAt: now,
      });
      await stand(characterId, LOCATION_IDS.deepJag);
      await db.insert(characterRepairTargets).values({
        characterId,
        targetId: REPAIR_TARGET_IDS.deepJagCaveIn,
        materials: Object.fromEntries(target.materials.map((item) => [item.itemId, item.quantity])),
        weldingProgress: 1,
        cleanPass: [{ section: 2, outcome: null }],
      });
      await openTestCharacter(page, characterId);
      await skewBrowserClock(page, skewMs);
      const startsAt = new Date(Date.now() + 15_000);
      await db.insert(activeActions).values({
        characterId,
        actionId: target.actionId,
        startedAt: startsAt,
        resolvedThroughAt: startsAt,
      });
      await page.reload();
      const panel = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.deepJagCaveIn}"]`);
      const cleanPass = panel.locator('[data-clean-pass-state="open"]');
      const endMs = startsAt.getTime() + balance.welding.attemptDurationTicks * GAME_TICK_MS;
      await expect(cleanPass).toBeVisible();
      const meter = panel.getByRole("progressbar", { name: label });
      await expect(meter).toBeVisible();
      const text = await meter.getAttribute("aria-label");
      const readAt = Date.now();
      const match = /([\d.]+)s/.exec(text ?? "");
      expect(match, `missing countdown in ${text}`).not.toBeNull();
      const shownMs = Number(match![1]) * 1_000;
      expect(Math.abs(shownMs - (endMs - readAt)), `${label} at skew ${skewMs}`).toBeLessThan(
        2_000,
      );
      await expect(cleanPass.locator("[data-clean-pass-claim]")).toBeEnabled();
    });
  }
}

// Seed a future cursor, as in the Clean Pass test above, so these short
// sections remain projected during CI navigation. The expected countdown and
// fill use the unskewed test-process clock and the seeded server timestamps.
for (const skewMs of [0, -5_000, 5_000]) {
  for (const surface of ["practice", "work-order", "research"] as const) {
    test(`${surface} progress follows server time at ${skewMs}ms (#473 #474)`, async ({
      page,
      testCharacter,
    }) => {
      const characterId = testCharacter.id;
      const now = new Date();
      const research = surface === "research";
      await stand(
        characterId,
        research ? LOCATION_IDS.prospectingQuarry : LOCATION_IDS.ruskRecovery,
      );
      if (research) {
        const [loan] = await db
          .insert(itemInstances)
          .values({ characterId, itemId: ITEM_IDS.geologicalSampleCase })
          .returning();
        await db.insert(characterResearchAssignments).values({
          characterId,
          jobId: RESEARCH_JOB_IDS.geologicalFieldSurvey,
          itemInstanceId: loan!.id,
          startedAt: now,
        });
      } else {
        await db.insert(characterMissions).values({
          characterId,
          missionId: MISSION_IDS.tenThousandHours,
          acceptedAt: now,
          ...(surface === "work-order" ? { completedAt: now } : {}),
        });
        if (surface === "practice") {
          await db.insert(characterPracticeWelds).values({ characterId, cycleActive: true });
        } else {
          await db.insert(characterWorkOrderPostings).values({
            characterId,
            slotIndex: 0,
            workOrderId: WORK_ORDER_IDS.rennCarryFrame,
            acceptedAt: now,
          });
        }
      }
      await openTestCharacter(page, characterId);
      await skewBrowserClock(page, skewMs);
      const startsAt = new Date(Date.now() + 15_000);
      const durationMs =
        (research
          ? balance.researchJobs.surfaceSampleDurationTicks
          : balance.welding.attemptDurationTicks) * GAME_TICK_MS;
      await db.insert(activeActions).values({
        characterId,
        actionId: research
          ? ACTION_IDS.researchSurfaceSample
          : surface === "practice"
            ? ACTION_IDS.practiceWelding
            : ACTION_IDS.workOrderWelding,
        startedAt: startsAt,
        resolvedThroughAt: startsAt,
      });
      await page.reload();
      const panel = page.locator(
        research
          ? "[data-research-field-action]"
          : surface === "practice"
            ? "[data-practice-panel]"
            : "[data-work-order-bench]",
      );
      const meter = panel.getByRole("progressbar", {
        name: research ? /Working/ : /Current section/,
      });
      const expectTimeline = async () => {
        await expect(meter).toBeVisible();
        const label = await meter.getAttribute("aria-label");
        const readAt = Date.now();
        const shown = /([\d.]+)s/.exec(label ?? "");
        expect(shown, `missing countdown: ${label}`).not.toBeNull();
        const expectedRemaining = startsAt.getTime() + durationMs - readAt;
        expect(Math.abs(Number(shown![1]) * 1_000 - expectedRemaining)).toBeLessThan(2_000);
        const fill = Number(await meter.getAttribute("aria-valuenow"));
        const expectedFill = Math.min(100, (1 - expectedRemaining / durationMs) * 100);
        expect((Math.abs(fill - expectedFill) * durationMs) / 100).toBeLessThan(2_000);
      };
      await expectTimeline();
      await page.reload();
      await expectTimeline();
      // Let the real test-process clock enter the section, then check actual
      // in-progress countdown and fill rather than only the future cursor.
      await expect
        .poll(() => Date.now(), { timeout: 20_000, intervals: [100, 250] })
        .toBeGreaterThan(startsAt.getTime() + durationMs * 0.2);
      await expectMeterOnServerTimeline(
        meter,
        { before: startsAt.getTime(), after: startsAt.getTime() },
        durationMs,
      );
    });
  }
}
