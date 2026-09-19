import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  refiningRecipeForActionId,
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
  type SkillId,
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
 * Issue #209 — the Deep Jag progression against real PostgreSQL.
 *
 * The rules here are the ones only durable, concurrent, server-side state can
 * prove: that a forged walk into a collapsed passage is refused whatever the
 * client believes, that twenty-five Refined Ferrite and five Power Cells go in
 * across several visits and are consumed exactly once, that the fifteenth weld
 * opens the mine from the repair record alone with no second flag anywhere,
 * that a locked Refining recipe is refused by the server and not merely greyed
 * out, and that the recipe a player selected survives a refresh.
 */
suite("issue #209 Deep Jag progression (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  let miningCommands: typeof import("@/server/mining-commands");
  let refiningCommands: typeof import("@/server/refining-commands");
  let progression: typeof import("@/server/progression");
  const createdUsers: string[] = [];
  const now = new Date("2026-09-19T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const caveIn = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
  const galvanicStock = refiningRecipeForActionId(ACTION_IDS.galvanicStockRefining, balance)!;
  const galvaferrite = refiningRecipeForActionId(ACTION_IDS.galvaferriteRefining, balance)!;
  const WELD_TICKS = balance.welding.attemptDurationTicks;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    repairs = await import("@/server/repair-commands");
    miningCommands = await import("@/server/mining-commands");
    refiningCommands = await import("@/server/refining-commands");
    progression = await import("@/server/progression");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const deterministicRandom = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  async function makeCharacter(label = "Deep Jag Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Jag ${userId.slice(0, 6)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /** Every Mission up to and including 10,000 Hours, completed. */
  async function completeChainThroughTenThousandHours(characterId: string) {
    await db
      .insert(rune.characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.tenThousandHours,
        ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
  }

  async function setSkill(characterId: string, skillId: SkillId, level: number) {
    // Grant the cumulative XP the shared authored curve requires for that
    // level, through the same boundary gameplay uses.
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId,
        awardedXp: xpForLevel(level),
        thresholds: standardSkillLevelThresholds(balance),
      });
    });
  }

  /** The cumulative XP the shared authored curve requires for a level. */
  function xpForLevel(level: number): number {
    const threshold = standardSkillLevelThresholds(balance).find(
      (candidate) => candidate.level === level,
    );
    if (!threshold) throw new Error(`No authored threshold for level ${level}`);
    return threshold.totalXp;
  }

  async function skillLevel(userId: string, characterId: string, skillId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, now, deterministicRandom());
    return skillId === SKILL_IDS.welding ? state.welding.level : state.mining.level;
  }

  /** Qualified for Brace Yourself and standing at The Jag. */
  async function qualified(label?: string) {
    const { userId, character } = await makeCharacter(label);
    await completeChainThroughTenThousandHours(character.id);
    await setSkill(character.id, SKILL_IDS.mining, 5);
    await setSkill(character.id, SKILL_IDS.welding, 5);
    await move(character.id, LOCATION_IDS.theJag);
    expect(await skillLevel(userId, character.id, SKILL_IDS.mining)).toBeGreaterThanOrEqual(5);
    expect(await skillLevel(userId, character.id, SKILL_IDS.welding)).toBeGreaterThanOrEqual(5);
    return { userId, character };
  }

  async function accept(userId: string, characterId: string) {
    return missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.braceYourself,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
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

  async function addCarried(characterId: string, itemId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  async function caveInRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.deepJagCaveIn),
          ),
        )
    )[0];
  }

  async function weldingXp(characterId: string) {
    return (
      (
        await db
          .select({ totalXp: rune.characterSkillXp.totalXp })
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, characterId),
              eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
            ),
          )
      )[0]?.totalXp ?? 0
    );
  }

  async function contribute(
    userId: string,
    characterId: string,
    expectedMaterials: Readonly<Record<string, number>>,
    at = now,
  ) {
    return repairs.contributeRepairMaterials(
      userId,
      characterId,
      { targetId: REPAIR_TARGET_IDS.deepJagCaveIn, expectedMaterials },
      at,
      deterministicRandom(),
    );
  }

  describe("the collapsed passage is closed until Tansy opens it", () => {
    it("refuses the walk from The Jag before the Mission is accepted", async () => {
      const { userId, character } = await qualified();
      const refused = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.deepJag,
        now,
        deterministicRandom(),
      );
      expect(refused.travelError).toBe("route_blocked");
      expect(refused.activeAction).toBeUndefined();
      expect(refused.location.currentLocationId).toBe(LOCATION_IDS.theJag);
      // The refusal is the server's, not the client's: no travel row exists.
      await expect(
        db
          .select()
          .from(rune.activeActions)
          .where(eq(rune.activeActions.characterId, character.id)),
      ).resolves.toEqual([]);
    });

    it("still shows Deep Jag on the map as CAVE-IN before acceptance", async () => {
      const { userId, character } = await qualified();
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(state.locationStates[LOCATION_IDS.deepJag]).toMatchObject({
        mapStatus: "CAVE-IN",
        travelable: false,
      });
    });

    it("refuses acceptance below Mining 5 even with 10,000 Hours complete", async () => {
      const { userId, character } = await makeCharacter("Under-levelled");
      await completeChainThroughTenThousandHours(character.id);
      await setSkill(character.id, SKILL_IDS.welding, 5);
      await move(character.id, LOCATION_IDS.theJag);
      const refused = await accept(userId, character.id);
      expect(refused.mission.status).not.toBe("accepted");
      await expect(
        db
          .select()
          .from(rune.characterMissions)
          .where(
            and(
              eq(rune.characterMissions.characterId, character.id),
              eq(rune.characterMissions.missionId, MISSION_IDS.braceYourself),
            ),
          ),
      ).resolves.toEqual([]);
    });

    it("refuses acceptance below Welding 5 even with 10,000 Hours complete", async () => {
      const { userId, character } = await makeCharacter("Under-torched");
      await completeChainThroughTenThousandHours(character.id);
      await setSkill(character.id, SKILL_IDS.mining, 5);
      await move(character.id, LOCATION_IDS.theJag);
      expect((await accept(userId, character.id)).mission.status).not.toBe("accepted");
    });

    it("opens the walk once the Mission is accepted", async () => {
      const { userId, character } = await qualified();
      expect((await accept(userId, character.id)).mission.status).toBe("accepted");
      const traveling = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.deepJag,
        now,
        deterministicRandom(),
      );
      expect(traveling.travelError).toBeUndefined();
      expect(traveling.travelState).toMatchObject({
        originLocationId: LOCATION_IDS.theJag,
        destinationLocationId: LOCATION_IDS.deepJag,
      });

      // And the walk actually lands there.
      const arrived = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, balance.travel.adjacentWalkDurationTicks),
        deterministicRandom(),
      );
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.deepJag);
    });
  });

  describe("twenty-five Refined Ferrite and five Power Cells, generically", () => {
    async function atTheWorksite(label?: string) {
      const { userId, character } = await qualified(label);
      await accept(userId, character.id);
      await move(character.id, LOCATION_IDS.deepJag);
      return { userId, character };
    }

    it("accepts partial contributions of both materials across visits", async () => {
      const { userId, character } = await atTheWorksite();
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5]);
      await addCarried(character.id, ITEM_IDS.powerCell, [2]);

      const first = await contribute(userId, character.id, {
        [ITEM_IDS.refinedFerrite]: 10,
        [ITEM_IDS.powerCell]: 2,
      });
      expect(first.repair).toMatchObject({
        status: "committed",
        materials: { [ITEM_IDS.refinedFerrite]: 10, [ITEM_IDS.powerCell]: 2 },
      });
      expect(await caveInRow(character.id)).toMatchObject({
        materials: { [ITEM_IDS.refinedFerrite]: 10, [ITEM_IDS.powerCell]: 2 },
      });

      // Leave, gather the rest, come back: the progress is still there.
      await move(character.id, LOCATION_IDS.theJag);
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5, 5]);
      await addCarried(character.id, ITEM_IDS.powerCell, [3]);
      await move(character.id, LOCATION_IDS.deepJag);
      const second = await contribute(userId, character.id, {
        [ITEM_IDS.refinedFerrite]: 15,
        [ITEM_IDS.powerCell]: 3,
      });
      expect(second.repair).toMatchObject({ status: "committed" });
      expect(await caveInRow(character.id)).toMatchObject({
        materials: installedMaterials(caveIn),
      });
      expect(second.state.repairs[REPAIR_TARGET_IDS.deepJagCaveIn]).toMatchObject({
        materialComplete: true,
        complete: false,
      });
    });

    it("never takes more than the recipe still needs", async () => {
      const { userId, character } = await atTheWorksite();
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5, 5, 5, 5, 5]);
      await addCarried(character.id, ITEM_IDS.powerCell, [5, 5]);

      const committed = await contribute(userId, character.id, {
        [ITEM_IDS.refinedFerrite]: 25,
        [ITEM_IDS.powerCell]: 5,
      });
      expect(committed.repair).toMatchObject({ status: "committed" });
      // Five surplus Ferrite and five surplus Cells stay carried.
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(5);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(5);
      expect(await caveInRow(character.id)).toMatchObject({
        materials: installedMaterials(caveIn),
      });
    });

    it("cannot double-remove carried material under a concurrent retry", async () => {
      const { userId, character } = await atTheWorksite();
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5, 5, 5, 5]);
      await addCarried(character.id, ITEM_IDS.powerCell, [5]);
      const expected = { [ITEM_IDS.refinedFerrite]: 25, [ITEM_IDS.powerCell]: 5 };

      const [first, second] = await Promise.all([
        contribute(userId, character.id, expected),
        contribute(userId, character.id, expected),
      ]);
      expect([first.repair.status, second.repair.status].sort()).toEqual(["committed", "refused"]);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(0);
      expect(await caveInRow(character.id)).toMatchObject({
        materials: installedMaterials(caveIn),
      });
    });

    it("keeps Power Cells in the shared materials map, with no column of their own", async () => {
      const { userId, character } = await atTheWorksite();
      await addCarried(character.id, ITEM_IDS.powerCell, [2]);
      await contribute(userId, character.id, { [ITEM_IDS.powerCell]: 2 });

      const columns = await db.execute(
        `select column_name from information_schema.columns
           where table_name = 'character_repair_targets'`,
      );
      const names = (columns.rows as { column_name: string }[]).map((row) => row.column_name);
      expect(names).toContain("materials");
      expect(names).not.toContain("power_cells_contributed");
      expect(names).not.toContain("refined_ferrite_contributed");
      expect(names).not.toContain("slag_contributed");
    });

    it("projects both material rows generically, from the recipe", async () => {
      const { userId, character } = await atTheWorksite();
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.deepJagCaveIn]?.materials).toMatchObject([
        { itemId: ITEM_IDS.refinedFerrite, name: "Refined Ferrite", required: 25, contributed: 0 },
        { itemId: ITEM_IDS.powerCell, name: "Power Cell", required: 5, contributed: 0 },
      ]);
    });

    it("refuses Welding until every material is in", async () => {
      const { userId, character } = await atTheWorksite();
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5, 5, 5, 5]);
      await contribute(userId, character.id, { [ITEM_IDS.refinedFerrite]: 25 });
      const refused = await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.deepJagCaveIn,
        now,
        deterministicRandom(),
      );
      expect(refused.weldingError).toBeTruthy();
      expect(refused.activeAction).toBeUndefined();
    });
  });

  describe("the fifteenth weld opens the mine", () => {
    async function readyToWeld(label?: string) {
      const { userId, character } = await qualified(label);
      await accept(userId, character.id);
      await move(character.id, LOCATION_IDS.deepJag);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.deepJagCaveIn, {
        materials: installedMaterials(caveIn),
        weldingProgress: 0,
        completedAt: null,
        updatedAt: now,
      });
      return { userId, character };
    }

    it("pays exactly 750 Welding XP for fifteen sections and completes once", async () => {
      const { userId, character } = await readyToWeld();
      const before = await weldingXp(character.id);
      const started = await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.deepJagCaveIn,
        now,
        deterministicRandom(),
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.deepJagWelding);

      const finished = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, caveIn.repairIncrements * WELD_TICKS),
        deterministicRandom(),
      );
      expect(finished.repairs[REPAIR_TARGET_IDS.deepJagCaveIn]).toMatchObject({
        weldingProgress: 15,
        weldingIncrements: 15,
        complete: true,
      });
      expect((await weldingXp(character.id)) - before).toBe(750);
      expect(finished.activeAction).toBeUndefined();

      // Resolving again pays nothing more and completes nothing twice.
      const again = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, caveIn.repairIncrements * WELD_TICKS * 3),
        deterministicRandom(),
      );
      expect((await weldingXp(character.id)) - before).toBe(750);
      expect(again.repairs[REPAIR_TARGET_IDS.deepJagCaveIn]?.complete).toBe(true);
    });

    it("changes scene, map status and available actions from the repair fact alone", async () => {
      const { userId, character } = await readyToWeld();
      const before = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(before.locationStates[LOCATION_IDS.deepJag]).toMatchObject({
        mapStatus: "CAVE-IN",
        variantId: "deep_jag_worksite",
      });

      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.deepJagCaveIn,
        now,
        deterministicRandom(),
      );
      const after = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, caveIn.repairIncrements * WELD_TICKS),
        deterministicRandom(),
      );
      expect(after.locationStates[LOCATION_IDS.deepJag]).toMatchObject({
        mapStatus: "MINING",
        variantId: "deep_jag_opened",
        travelable: true,
      });
      expect(after.locationStates[LOCATION_IDS.deepJag]?.availableActionIds).toContain(
        ACTION_IDS.galvaniteMining,
      );
      expect(after.locationStates[LOCATION_IDS.deepJag]?.scene.asset).not.toBe(
        before.locationStates[LOCATION_IDS.deepJag]?.scene.asset,
      );

      // The only durable fact behind that change is the repair row itself.
      expect(await caveInRow(character.id)).toMatchObject({ weldingProgress: 15 });
      expect((await caveInRow(character.id))?.completedAt).not.toBeNull();
    });

    it("refuses Galvanite Mining until the brace is in, then allows it at once", async () => {
      const { userId, character } = await readyToWeld();
      const refused = await miningCommands.startMining(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(refused.activeAction).toBeUndefined();

      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.deepJagCaveIn,
        now,
        deterministicRandom(),
      );
      const finishedAt = tick(now, caveIn.repairIncrements * WELD_TICKS);
      await play.getPlayGameplayState(userId, character.id, finishedAt, deterministicRandom());

      // No trip back to Tansy first: the mine is open the moment it is braced.
      const mining = await miningCommands.startMining(
        userId,
        character.id,
        finishedAt,
        deterministicRandom(),
      );
      expect(mining.activeAction?.actionId).toBe(ACTION_IDS.galvaniteMining);
    });
  });

  describe("Tansy's turn-in", () => {
    it("grants exactly 250 Welding XP, exactly once", async () => {
      const { userId, character } = await qualified();
      await accept(userId, character.id);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.deepJagCaveIn, {
        materials: installedMaterials(caveIn),
        weldingProgress: caveIn.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
      await move(character.id, LOCATION_IDS.theJag);
      const before = await weldingXp(character.id);

      const completed = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.braceYourself,
        NPC_IDS.tansyRusk,
        now,
        deterministicRandom(),
      );
      expect(completed.mission.status).toBe("completed");
      expect((await weldingXp(character.id)) - before).toBe(250);

      const again = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.braceYourself,
        NPC_IDS.tansyRusk,
        now,
        deterministicRandom(),
      );
      expect(again.mission.status).not.toBe("completed");
      expect((await weldingXp(character.id)) - before).toBe(250);
    });
  });

  describe("the Tier-2 recipes are gated by the server, not the console", () => {
    async function atTheYard(refiningLevel: number) {
      const { userId, character } = await makeCharacter("Refiner");
      if (refiningLevel > 1) {
        await setSkill(character.id, SKILL_IDS.refining, refiningLevel);
      }
      await move(character.id, LOCATION_IDS.abandonedProcessingYard);
      return { userId, character };
    }

    it("refuses Galvanic Stock below Refining 5", async () => {
      const { userId, character } = await atTheYard(1);
      await addCarried(character.id, ITEM_IDS.galvanite, [5]);
      const refused = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.galvanicStockRefining,
        now,
        deterministicRandom(),
      );
      expect(refused.refiningError).toBe("refining_recipe_locked");
      expect(refused.activeAction).toBeUndefined();
    });

    it("refuses Galvaferrite below Refining 8", async () => {
      const { userId, character } = await atTheYard(5);
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await addCarried(character.id, ITEM_IDS.galvanicStock, [5]);
      const refused = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.galvaferriteRefining,
        now,
        deterministicRandom(),
      );
      expect(refused.refiningError).toBe("refining_recipe_locked");
      expect(refused.activeAction).toBeUndefined();
    });

    it("accepts Galvanic Stock at Refining 5 and resolves its authored attempt", async () => {
      const { userId, character } = await atTheYard(5);
      await addCarried(character.id, ITEM_IDS.galvanite, [2]);
      const started = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.galvanicStockRefining,
        now,
        deterministicRandom(),
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.galvanicStockRefining);

      const resolved = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, galvanicStock.attemptDurationTicks),
        deterministicRandom(),
      );
      expect(resolved.refiningRun).toMatchObject({
        attempts: 1,
        successes: 1,
        outputsGained: { [ITEM_IDS.galvanicStock]: 1 },
        inputsConsumed: { [ITEM_IDS.galvanite]: 2 },
        xpGained: galvanicStock.successXp,
      });
      expect(await carried(character.id, ITEM_IDS.galvanicStock)).toBe(1);
      expect(await carried(character.id, ITEM_IDS.galvanite)).toBe(0);
    });

    it("returns exactly one input when a Galvaferrite pour fails", async () => {
      const { userId, character } = await atTheYard(8);
      await addCarried(character.id, ITEM_IDS.refinedFerrite, [1]);
      await addCarried(character.id, ITEM_IDS.galvanicStock, [1]);
      await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.galvaferriteRefining,
        now,
        { nextBasisPoints: () => 9_999, nextUnit: () => 0 },
      );
      const resolved = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, galvaferrite.attemptDurationTicks),
        { nextBasisPoints: () => 9_999, nextUnit: () => 0 },
      );
      expect(resolved.refiningRun.failures).toBe(1);
      expect(await carried(character.id, ITEM_IDS.galvaferrite)).toBe(0);
      // Exactly one of the two inputs came back; the other is gone.
      const returned =
        (await carried(character.id, ITEM_IDS.refinedFerrite)) +
        (await carried(character.id, ITEM_IDS.galvanicStock));
      expect(returned).toBe(1);
      expect(resolved.refiningRun.xpGained).toBe(galvaferrite.failureXp);
    });

    it("keeps the selected recipe across a refresh, because the action IS the selection", async () => {
      const { userId, character } = await atTheYard(5);
      await addCarried(character.id, ITEM_IDS.galvanite, [10]);
      await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.galvanicStockRefining,
        now,
        deterministicRandom(),
      );

      // A refresh reads the durable row back, with no client-supplied recipe.
      const refreshed = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(refreshed.activeAction?.actionId).toBe(ACTION_IDS.galvanicStockRefining);

      // And an offline window resolves THAT recipe, not the shipped one.
      const offline = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, galvanicStock.attemptDurationTicks * 2),
        deterministicRandom(),
      );
      expect(offline.refiningRun).toMatchObject({
        attempts: 2,
        outputsGained: { [ITEM_IDS.galvanicStock]: 2 },
        inputsConsumed: { [ITEM_IDS.galvanite]: 4 },
      });
    });
  });
});
