import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #322 — Wheel Be Right Back, against real PostgreSQL.
 *
 * Wade's landing-gear job is an ordinary Mission-authorized repair target: it
 * stays locked until he is asked, takes exactly two Wheel Assemblies, two
 * Mounting Brackets and a Galvanic Wire Spool, needs twelve real Welding
 * sections, and finishes durably in the generic repair-target row. None of it
 * depends on the character's own Fabrication or Refining level — the parts here
 * are simply given, which is exactly what a trade leaves behind — and the 250
 * Welding XP lands once.
 */
suite("issue #322 Wheel Be Right Back (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  let fabrication: typeof import("@/server/fabrication-commands");
  let tinkering: typeof import("@/server/tinkering-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-05T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const gear = getRepairTargetBalance(REPAIR_TARGET_IDS.landingGear, balance);
  const wheel = balance.fabrication.recipes.wheelAssembly;
  const thresholds = standardSkillLevelThresholds(balance);
  const WELD_TICKS = balance.welding.attemptDurationTicks;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    missions = await import("@/server/missions");
    repairs = await import("@/server/repair-commands");
    fabrication = await import("@/server/fabrication-commands");
    tinkering = await import("@/server/tinkering-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const deterministicRandom = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  /** Everything through Tansy's Fabrication chapter, with Brace Yourself optionally done. */
  const STORY = [
    MISSION_IDS.walkItOff,
    MISSION_IDS.cutYourTeeth,
    MISSION_IDS.wasteNot,
    MISSION_IDS.holdItTogether,
    MISSION_IDS.keepTheChange,
    MISSION_IDS.tenThousandHours,
    MISSION_IDS.returnTheFavor,
    MISSION_IDS.breakItDown,
  ];

  /**
   * A character with the lowest possible levels everywhere — Fabrication 1,
   * Refining 1, no Welding to speak of — which is the point: nothing in this job
   * may ask for more.
   */
  async function makeCharacter(
    options: { brace?: boolean; location?: LocationId; fabrication?: number } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Wheel Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Wheel ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    await db.insert(rune.characterMissions).values(
      [...STORY, ...(options.brace === false ? [] : [MISSION_IDS.braceYourself])].map(
        (missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: now,
          completedAt: now,
        }),
      ),
    );
    await move(character.id, options.location ?? LOCATION_IDS.ruskRecovery);
    if (options.fabrication && options.fabrication > 1) {
      await grantLevel(character.id, SKILL_IDS.fabrication, options.fabrication);
    }
    return { userId, characterId: character.id };
  }

  async function grantLevel(characterId: string, skillId: string, level: number) {
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId,
        awardedXp: thresholds.find((threshold) => threshold.level === level)!.totalXp,
        thresholds,
      });
    });
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function xp(characterId: string, skillId: string) {
    return (
      (
        await db
          .select({ totalXp: rune.characterSkillXp.totalXp })
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, characterId),
              eq(rune.characterSkillXp.skillId, skillId),
            ),
          )
      )[0]?.totalXp ?? 0
    );
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function give(characterId: string, itemId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  /** The complete shopping list, as a trade or a purchase would leave it. */
  async function giveLandingGearParts(characterId: string) {
    await give(characterId, ITEM_IDS.wheelAssembly, [2]);
    await give(characterId, ITEM_IDS.mountingBracket, [2]);
    await give(characterId, ITEM_IDS.galvanicWireSpool, [1]);
  }

  async function gearRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.landingGear),
          ),
        )
    )[0];
  }

  async function missionRow(characterId: string, missionId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, missionId),
          ),
        )
    )[0];
  }

  const accept = (userId: string, characterId: string) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.wheelBeRightBack,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );

  const complete = (userId: string, characterId: string, at = now) =>
    missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.wheelBeRightBack,
      NPC_IDS.wadeRusk,
      at,
      deterministicRandom(),
    );

  const contribute = (userId: string, characterId: string, expected: Record<string, number>) =>
    repairs.contributeRepairMaterials(
      userId,
      characterId,
      { targetId: REPAIR_TARGET_IDS.landingGear, expectedMaterials: expected },
      now,
      deterministicRandom(),
    );

  const fullContribution = {
    [ITEM_IDS.wheelAssembly]: 2,
    [ITEM_IDS.mountingBracket]: 2,
    [ITEM_IDS.galvanicWireSpool]: 1,
  };

  async function installGear(characterId: string, completedAt: Date | null = now) {
    await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.landingGear, {
      materials: installedMaterials(gear),
      weldingProgress: completedAt ? gear.repairIncrements : 0,
      completedAt,
      updatedAt: now,
    });
  }

  describe("Wade offers it by hand, and only after Brace Yourself", () => {
    it("refuses acceptance until Brace Yourself is complete", async () => {
      const { userId, characterId } = await makeCharacter({ brace: false });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId, MISSION_IDS.wheelBeRightBack)).toBeUndefined();
    });

    it("accepts at Rusk Recovery with Fabrication 1, Refining 1 and no A Cut Above", async () => {
      const { userId, characterId } = await makeCharacter();
      expect(await missionRow(characterId, MISSION_IDS.aCutAbove)).toBeUndefined();
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      expect(state.refining.level).toBe(1);
      const accepted = await accept(userId, characterId);
      expect(accepted.mission.status).toBe("accepted");
      expect(await missionRow(characterId, MISSION_IDS.wheelBeRightBack)).toMatchObject({
        completedAt: null,
      });
      // Accepting hands over nothing and starts nothing else.
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(0);
      expect((await accept(userId, characterId)).mission.status).toBe("already_accepted");
    });

    it("refuses acceptance away from Rusk Recovery", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.crashSite });
      expect((await accept(userId, characterId)).mission.status).toBe("refused");
      expect(await missionRow(characterId, MISSION_IDS.wheelBeRightBack)).toBeUndefined();
    });

    it("is not started by completing Brace Yourself", async () => {
      const { userId, characterId } = await makeCharacter({
        brace: false,
        location: LOCATION_IDS.theJag,
      });
      await db.insert(rune.characterMissions).values({
        characterId,
        missionId: MISSION_IDS.braceYourself,
        acceptedAt: now,
      });
      await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.deepJagCaveIn, {
        materials: installedMaterials(
          getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance),
        ),
        weldingProgress: getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance)
          .repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
      const finished = await missions.completeMission(
        userId,
        characterId,
        MISSION_IDS.braceYourself,
        NPC_IDS.tansyRusk,
        now,
        deterministicRandom(),
      );
      expect(finished.mission.status).toBe("completed");
      // Wade has to be spoken to: nothing was auto-accepted.
      expect(await missionRow(characterId, MISSION_IDS.wheelBeRightBack)).toBeUndefined();
    });
  });

  describe("the Landing Gear is a Mission-authorized repair at the Crash Site", () => {
    it("refuses every repair command before the job is taken", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.crashSite });
      await giveLandingGearParts(characterId);
      const refused = await contribute(userId, characterId, fullContribution);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });
      const welding = await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.landingGear,
        now,
        deterministicRandom(),
      );
      expect(welding.weldingError).toBe("welding_locked");
      expect(await gearRow(characterId)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(2);
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.landingGear]).toMatchObject({
        repairAvailable: false,
        complete: false,
      });
    });

    it("works only at the Crash Site", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await giveLandingGearParts(characterId);
      // Still standing in Rusk Recovery.
      expect((await contribute(userId, characterId, fullContribution)).repair).toMatchObject({
        status: "refused",
        reason: "wrong_location",
      });
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(2);
    });

    it("installs exactly the recipe from parts that were only ever given", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      // A bracket stack and a spare stack beyond what the job needs.
      await give(characterId, ITEM_IDS.wheelAssembly, [2]);
      await give(characterId, ITEM_IDS.mountingBracket, [5]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [2]);

      const committed = await contribute(userId, characterId, fullContribution);
      expect(committed.repair).toMatchObject({ status: "committed" });
      expect(await gearRow(characterId)).toMatchObject({ materials: installedMaterials(gear) });
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(0);
      // Only what the recipe asked for was taken.
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(3);
      expect(await carried(characterId, ITEM_IDS.galvanicWireSpool)).toBe(1);
      expect(committed.state.repairs[REPAIR_TARGET_IDS.landingGear]).toMatchObject({
        materialComplete: true,
        complete: false,
      });
    });

    it("takes the parts in stages and projects every material row from the recipe", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await give(characterId, ITEM_IDS.wheelAssembly, [1]);
      await contribute(userId, characterId, { [ITEM_IDS.wheelAssembly]: 1 });
      const partial = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      const repair = partial.repairs[REPAIR_TARGET_IDS.landingGear]!;
      expect(repair.materialComplete).toBe(false);
      expect(repair.weldingIncrements).toBe(12);
      expect(
        repair.materials.map((material) => [
          material.itemId,
          material.contributed,
          material.required,
        ]),
      ).toEqual([
        [ITEM_IDS.wheelAssembly, 1, 2],
        [ITEM_IDS.mountingBracket, 0, 2],
        [ITEM_IDS.galvanicWireSpool, 0, 1],
      ]);
      // Welding cannot start on an unfinished kit.
      const early = await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.landingGear,
        now,
        deterministicRandom(),
      );
      expect(early.weldingError).toBe("welding_locked");
    });

    it("cannot double-remove the parts under a concurrent retry", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await giveLandingGearParts(characterId);
      const [first, second] = await Promise.all([
        contribute(userId, characterId, fullContribution),
        contribute(userId, characterId, fullContribution),
      ]);
      expect([first.repair.status, second.repair.status].sort()).toEqual(["committed", "refused"]);
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.galvanicWireSpool)).toBe(0);
    });

    it("welds twelve real sections for 600 base Welding XP and stays finished", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await giveLandingGearParts(characterId);
      await contribute(userId, characterId, fullContribution);

      const before = await xp(characterId, SKILL_IDS.welding);
      const started = await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.landingGear,
        now,
        deterministicRandom(),
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.landingGearWelding);

      // Eleven sections in, the gear is not done.
      const midway = await play.getPlayGameplayState(
        userId,
        characterId,
        tick(now, 11 * WELD_TICKS),
        deterministicRandom(),
      );
      expect(midway.repairs[REPAIR_TARGET_IDS.landingGear]).toMatchObject({
        weldingProgress: 11,
        complete: false,
      });

      const finishedAt = tick(now, gear.repairIncrements * WELD_TICKS);
      const finished = await play.getPlayGameplayState(
        userId,
        characterId,
        finishedAt,
        deterministicRandom(),
      );
      expect(finished.repairs[REPAIR_TARGET_IDS.landingGear]).toMatchObject({
        weldingProgress: 12,
        weldingIncrements: 12,
        complete: true,
      });
      expect(finished.activeAction).toBeUndefined();
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(12 * 50);

      // Durable: the generic repair row is complete, and a later reload agrees.
      expect((await gearRow(characterId))?.completedAt).not.toBeNull();
      const reloaded = await play.getPlayGameplayState(
        userId,
        characterId,
        tick(finishedAt, 1_000),
        deterministicRandom(),
      );
      expect(reloaded.repairs[REPAIR_TARGET_IDS.landingGear]?.complete).toBe(true);
      expect(reloaded.repairs[REPAIR_TARGET_IDS.landingGear]?.weldingProgress).toBe(12);
      // And a finished gear takes no further parts or welding.
      await give(characterId, ITEM_IDS.wheelAssembly, [2]);
      expect((await contribute(userId, characterId, fullContribution)).repair.status).toBe(
        "refused",
      );
    });
  });

  describe("Wade's turn-in", () => {
    it("refuses the report until the Landing Gear is finished", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installGear(characterId, null);
      const refused = await complete(userId, characterId);
      expect(refused.mission).toMatchObject({
        status: "refused",
        reason: "repair_target_complete",
      });
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(0);
    });

    it("grants exactly 250 Welding XP, exactly once", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installGear(characterId);
      const before = await xp(characterId, SKILL_IDS.welding);

      const first = await complete(userId, characterId);
      expect(first.mission.status).toBe("completed");
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(250);

      const again = await complete(userId, characterId);
      expect(again.mission.status).not.toBe("completed");
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(250);
    });

    it("pays once under concurrent duplicate reports", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installGear(characterId);
      const results = await Promise.all([
        complete(userId, characterId),
        complete(userId, characterId),
        complete(userId, characterId),
      ]);
      expect(results.filter((result) => result.mission.status === "completed")).toHaveLength(1);
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(250);
    });

    it("refuses the report away from Rusk Recovery", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installGear(characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      expect((await complete(userId, characterId)).mission.status).toBe("refused");
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(0);
    });

    it("adds up to 850 ordinary Welding XP across the repair and the report", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await giveLandingGearParts(characterId);
      await contribute(userId, characterId, fullContribution);
      await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.landingGear,
        now,
        deterministicRandom(),
      );
      await play.getPlayGameplayState(
        userId,
        characterId,
        tick(now, gear.repairIncrements * WELD_TICKS),
        deterministicRandom(),
      );
      await move(characterId, LOCATION_IDS.ruskRecovery);
      const reported = await complete(userId, characterId, tick(now, 1_000));
      expect(reported.mission.status).toBe("completed");
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(600 + 250);
    });

    it("opens no flight and starts no further job", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installGear(characterId);
      await complete(userId, characterId);
      const rows = await db
        .select({ missionId: rune.characterMissions.missionId })
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, characterId));
      const ids = rows.map((row) => row.missionId);
      // Only the seeded story, plus this one: nothing was auto-accepted after it.
      expect(ids.sort()).toEqual(
        [...STORY, MISSION_IDS.braceYourself, MISSION_IDS.wheelBeRightBack].sort(),
      );
      // The Crash Site keeps its one wreck presentation and ordinary walking edges.
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      expect(state.locationStates[LOCATION_IDS.crashSite]?.mapStatus).toBeUndefined();
      expect(state.locationStates[LOCATION_IDS.crashSite]?.travelable).toBe(true);
    });
  });

  describe("the Wheel Assembly on the Fabrication Station", () => {
    it("is locked below Fabrication 5 and open at it, with no Refining requirement", async () => {
      const four = await makeCharacter({ fabrication: 4 });
      await give(four.characterId, ITEM_IDS.refinedFerrite, [3]);
      await give(four.characterId, ITEM_IDS.galvanicStock, [1]);
      await give(four.characterId, ITEM_IDS.mountingBracket, [1]);
      const refused = await fabrication.startFabrication(
        four.userId,
        four.characterId,
        ACTION_IDS.wheelAssemblyFabrication,
        1,
        now,
      );
      expect(refused.fabricationError).toBe("fabrication_recipe_locked");

      const five = await makeCharacter({ fabrication: 5 });
      const state = await play.getPlayGameplayState(five.userId, five.characterId, now);
      const entry = state.fabricationStation.recipes.find(
        (recipe) => recipe.actionId === ACTION_IDS.wheelAssemblyFabrication,
      );
      expect(entry).toMatchObject({ unlocked: true, minimumLevel: 5, outputQuantity: 1 });
      expect(state.refining.level).toBe(1);
    });

    it("turns 3 Ferrite + 1 Galvanic Stock + 1 Bracket into one Wheel in 36 ticks for 100 XP", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 5 });
      await give(characterId, ITEM_IDS.refinedFerrite, [3]);
      await give(characterId, ITEM_IDS.galvanicStock, [1]);
      await give(characterId, ITEM_IDS.mountingBracket, [1]);
      const before = await xp(characterId, SKILL_IDS.fabrication);

      const started = await fabrication.startFabrication(
        userId,
        characterId,
        ACTION_IDS.wheelAssemblyFabrication,
        1,
        now,
      );
      expect(started.fabricationError).toBeUndefined();
      // Not done one tick early.
      await play.getPlayGameplayState(userId, characterId, tick(now, wheel.durationTicks - 1));
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(0);

      await play.getPlayGameplayState(userId, characterId, tick(now, wheel.durationTicks));
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(1);
      expect(await carried(characterId, ITEM_IDS.refinedFerrite)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.galvanicStock)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(0);
      expect((await xp(characterId, SKILL_IDS.fabrication)) - before).toBe(100);
    });

    it("stacks two Wheel Assemblies to a slot and no more", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 5 });
      await give(characterId, ITEM_IDS.refinedFerrite, [5, 4]);
      await give(characterId, ITEM_IDS.galvanicStock, [3]);
      await give(characterId, ITEM_IDS.mountingBracket, [3]);
      await fabrication.startFabrication(
        userId,
        characterId,
        ACTION_IDS.wheelAssemblyFabrication,
        3,
        now,
      );
      await play.getPlayGameplayState(userId, characterId, tick(now, wheel.durationTicks * 3));
      const stacks = await db
        .select({ quantity: rune.inventoryStacks.quantity })
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, characterId),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.wheelAssembly),
          ),
        );
      expect(stacks.map((stack) => stack.quantity).sort()).toEqual([1, 2]);
    });

    it("dismantles through ordinary Tinkering: base XP and ceil(5 / 2) Scrap", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 5 });
      await give(characterId, ITEM_IDS.wheelAssembly, [1]);
      const state = await play.getPlayGameplayState(userId, characterId, now);
      const target = state.tinkering.targets.find(
        (candidate) => candidate.actionId === ACTION_IDS.wheelAssemblyTinkering,
      );
      expect(target).toMatchObject({
        affordableBatches: 1,
        durationTicks: wheel.durationTicks * 2,
        xp: wheel.baseXp,
        scrap: 3,
      });
      const before = await xp(characterId, SKILL_IDS.fabrication);
      await tinkering.startTinkering(
        userId,
        characterId,
        ACTION_IDS.wheelAssemblyTinkering,
        1,
        now,
      );
      await play.getPlayGameplayState(userId, characterId, tick(now, wheel.durationTicks * 2));
      expect(await carried(characterId, ITEM_IDS.wheelAssembly)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(3);
      expect((await xp(characterId, SKILL_IDS.fabrication)) - before).toBe(100);
    });
  });
});
