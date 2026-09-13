import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #172 — Out of the Weather, against real PostgreSQL.
 *
 * These are the rules neither a browser nor a pure unit test can prove: that
 * twenty Refined Ferrite are consumed exactly once across several visits and
 * under concurrency, that ten genuine Welding increments pay exactly 500 XP and
 * cannot be duplicated by interruption or retry, that Renn's turn-in adds
 * exactly 250 more, that the 5-Credit fare commits atomically with the Journey
 * and never twice, and that a paid ride persists no Scavenge window for anybody
 * to claim.
 */
suite("issue #172 Out of the Weather (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-09-13T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const crewStop = getRepairTargetBalance(REPAIR_TARGET_IDS.crewStop, balance);
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
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const deterministicRandom = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  async function makeCharacter(label = "Crew Stop Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Crew ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
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

  async function setCredits(characterId: string, credits: number) {
    await db.update(rune.characters).set({ credits }).where(eq(rune.characters.id, characterId));
  }

  async function creditsOf(characterId: string) {
    return (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]?.credits;
  }

  async function completeChainThroughHoldItTogether(characterId: string) {
    await db
      .insert(rune.characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
        ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
  }

  async function acceptSideMission(userId: string, characterId: string) {
    await move(characterId, LOCATION_IDS.holoHollow);
    const result = await missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.outOfTheWeather,
      NPC_IDS.rennCalder,
      now,
      deterministicRandom(),
    );
    expect(result.mission.status).toBe("accepted");
  }

  async function addRefinedFerrite(characterId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.refinedFerrite, quantity });
    }
  }

  async function carriedRefinedFerrite(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.refinedFerrite),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function crewStopRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.crewStop),
          ),
        )
    )[0];
  }

  async function weldingXp(characterId: string) {
    return (
      await db
        .select({ totalXp: rune.characterSkillXp.totalXp })
        .from(rune.characterSkillXp)
        .where(
          and(
            eq(rune.characterSkillXp.characterId, characterId),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        )
    )[0]?.totalXp;
  }

  async function contribute(userId: string, characterId: string, expected: number, at = now) {
    return repairs.contributeRepairMaterials(
      userId,
      characterId,
      {
        targetId: REPAIR_TARGET_IDS.crewStop,
        expectedRefinedFerrite: expected,
        expectedSlag: 0,
      },
      at,
      deterministicRandom(),
    );
  }

  describe("the repair is gated by the accepted Mission, not by finding the place", () => {
    it("refuses materials and Welding before the Mission is accepted", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await move(character.id, LOCATION_IDS.holoHollow);
      await addRefinedFerrite(character.id, [5, 5]);

      const refused = await contribute(userId, character.id, 10);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });
      expect(await carriedRefinedFerrite(character.id)).toBe(10);
      // A refusal changes nothing, and that includes creating the row: a target
      // nobody has legitimately worked on stays genuinely untouched.
      expect(await crewStopRow(character.id)).toBeUndefined();

      const refusedWelding = await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );
      expect(refusedWelding.weldingError).toBe("welding_locked");
      expect(await crewStopRow(character.id)).toBeUndefined();

      const welding = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(welding.repairs[REPAIR_TARGET_IDS.crewStop]).toMatchObject({
        repairAvailable: false,
        complete: false,
      });
    });

    it("refuses the work from anywhere other than Holo Hollow", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await move(character.id, LOCATION_IDS.theJag);
      await addRefinedFerrite(character.id, [5]);

      const refused = await contribute(userId, character.id, 5);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "wrong_location" });
      expect(await carriedRefinedFerrite(character.id)).toBe(5);
    });
  });

  describe("twenty Refined Ferrite, no Slag, consumed exactly once", () => {
    it("accepts partial contributions across several visits and totals exactly twenty", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);

      await addRefinedFerrite(character.id, [5, 3]);
      expect((await contribute(userId, character.id, 8)).repair).toMatchObject({
        status: "committed",
        refinedFerrite: 8,
        slag: 0,
      });
      expect(await carriedRefinedFerrite(character.id)).toBe(0);
      expect(await crewStopRow(character.id)).toMatchObject({ refinedFerriteContributed: 8 });

      // Leave, gather more, come back.
      await addRefinedFerrite(character.id, [5, 5, 5]);
      expect((await contribute(userId, character.id, 12)).repair).toMatchObject({
        status: "committed",
        refinedFerrite: 12,
      });
      // Only the twelve still needed were taken; the surplus stays carried.
      expect(await carriedRefinedFerrite(character.id)).toBe(3);
      expect(await crewStopRow(character.id)).toMatchObject({
        refinedFerriteContributed: crewStop.refinedFerriteRequired,
        slagContributed: 0,
      });
    });

    it("never asks for Slag, and never consumes any", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [5, 5, 5, 5]);
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.slag, quantity: 9 });

      expect((await contribute(userId, character.id, 20)).repair).toMatchObject({
        status: "committed",
        refinedFerrite: 20,
        slag: 0,
      });
      const slag = (
        await db
          .select({ quantity: rune.inventoryStacks.quantity })
          .from(rune.inventoryStacks)
          .where(
            and(
              eq(rune.inventoryStacks.characterId, character.id),
              eq(rune.inventoryStacks.itemId, ITEM_IDS.slag),
            ),
          )
      ).reduce((sum, row) => sum + row.quantity, 0);
      expect(slag).toBe(9);
    });

    it("cannot double-consume under concurrent identical requests", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [5, 5, 5, 5]);

      const [first, second] = await Promise.all([
        contribute(userId, character.id, 20),
        contribute(userId, character.id, 20),
      ]);
      const statuses = [first.repair.status, second.repair.status].sort();
      expect(statuses).toEqual(["committed", "refused"]);
      expect(await carriedRefinedFerrite(character.id)).toBe(0);
      expect(await crewStopRow(character.id)).toMatchObject({ refinedFerriteContributed: 20 });
    });

    it("refuses cleanly when the expected quantity no longer matches", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [5]);

      const refused = await contribute(userId, character.id, 20);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "materials_changed" });
      expect(await carriedRefinedFerrite(character.id)).toBe(5);
    });
  });

  describe("ten genuine Welding increments, 500 Welding XP, exactly once", () => {
    async function readyToWeld() {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.crewStop, {
        refinedFerriteContributed: crewStop.refinedFerriteRequired,
        slagContributed: 0,
        weldingProgress: 0,
        completedAt: null,
        updatedAt: now,
      });
      return { userId, character };
    }

    it("refuses to start Welding before the twenty are in the brace", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.crewStop, {
        refinedFerriteContributed: crewStop.refinedFerriteRequired - 1,
      });

      const refused = await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );
      expect(refused.weldingError).toBe("welding_locked");
      expect(refused.activeAction).toBeUndefined();
    });

    it("pays exactly 500 Welding XP for ten increments and completes the repair", async () => {
      const { userId, character } = await readyToWeld();
      const started = await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.crewStopWelding);

      const finished = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, crewStop.repairIncrements * WELD_TICKS),
        deterministicRandom(),
      );
      expect(finished.repairs[REPAIR_TARGET_IDS.crewStop]).toMatchObject({
        weldingProgress: 10,
        weldingIncrements: 10,
        complete: true,
      });
      expect(await weldingXp(character.id)).toBe(500);
      // The action stopped on completion rather than continuing to accrue.
      expect(finished.activeAction).toBeUndefined();
    });

    it("banks only whole passes and never re-awards on repeated resolution", async () => {
      const { userId, character } = await readyToWeld();
      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );

      // Four whole passes plus a partial fifth.
      const partial = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 4 * WELD_TICKS + 4),
        deterministicRandom(),
      );
      expect(partial.repairs[REPAIR_TARGET_IDS.crewStop]?.weldingProgress).toBe(4);
      expect(await weldingXp(character.id)).toBe(200);

      // Interrupt, then resume: nothing already banked is paid twice.
      await repairs.stopWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        tick(now, 4 * WELD_TICKS + 4),
        deterministicRandom(),
      );
      expect(await weldingXp(character.id)).toBe(200);

      const restartAt = tick(now, 100);
      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        restartAt,
        deterministicRandom(),
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(restartAt, 6 * WELD_TICKS),
        deterministicRandom(),
      );
      expect(done.repairs[REPAIR_TARGET_IDS.crewStop]?.complete).toBe(true);
      expect(await weldingXp(character.id)).toBe(500);

      // Resolving again far in the future adds nothing at all.
      await play.getPlayGameplayState(
        userId,
        character.id,
        tick(restartAt, 10_000),
        deterministicRandom(),
      );
      expect(await weldingXp(character.id)).toBe(500);
    });

    it("cannot be started twice concurrently", async () => {
      const { userId, character } = await readyToWeld();
      await Promise.all([
        repairs.startWelding(
          userId,
          character.id,
          REPAIR_TARGET_IDS.crewStop,
          now,
          deterministicRandom(),
        ),
        repairs.startWelding(
          userId,
          character.id,
          REPAIR_TARGET_IDS.crewStop,
          now,
          deterministicRandom(),
        ),
      ]);
      const rows = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, character.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("Renn's turn-in adds exactly 250 more, exactly once", () => {
    async function repairedCharacter() {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.crewStop, {
        refinedFerriteContributed: crewStop.refinedFerriteRequired,
        weldingProgress: crewStop.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
      await db
        .update(rune.characterSkillXp)
        .set({ totalXp: 500 })
        .where(
          and(
            eq(rune.characterSkillXp.characterId, character.id),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        );
      return { userId, character };
    }

    it("refuses completion while the Crew Stop is still broken", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);

      const refused = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.outOfTheWeather,
        NPC_IDS.rennCalder,
        now,
        deterministicRandom(),
      );
      expect(refused.mission).toMatchObject({
        status: "refused",
        reason: "repair_target_complete",
      });
    });

    it("takes Welding XP from 500 to 750 and never again", async () => {
      const { userId, character } = await repairedCharacter();
      const completed = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.outOfTheWeather,
        NPC_IDS.rennCalder,
        now,
        deterministicRandom(),
      );
      expect(completed.mission.status).toBe("completed");
      expect(await weldingXp(character.id)).toBe(750);

      const again = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.outOfTheWeather,
        NPC_IDS.rennCalder,
        now,
        deterministicRandom(),
      );
      expect(again.mission.status).toBe("already_completed");
      expect(await weldingXp(character.id)).toBe(750);
    });

    it("cannot be completed twice concurrently", async () => {
      const { userId, character } = await repairedCharacter();
      await Promise.all([
        missions.completeMission(
          userId,
          character.id,
          MISSION_IDS.outOfTheWeather,
          NPC_IDS.rennCalder,
          now,
          deterministicRandom(),
        ),
        missions.completeMission(
          userId,
          character.id,
          MISSION_IDS.outOfTheWeather,
          NPC_IDS.rennCalder,
          now,
          deterministicRandom(),
        ),
      ]);
      expect(await weldingXp(character.id)).toBe(750);
    });

    it("pays no Credits and presents the XP beat through authored dialogue", async () => {
      const { userId, character } = await repairedCharacter();
      const before = await creditsOf(character.id);
      await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.outOfTheWeather,
        NPC_IDS.rennCalder,
        now,
        deterministicRandom(),
      );
      expect(await creditsOf(character.id)).toBe(before);
      const { getDialogue } = await import("@/game/content/dialogue");
      expect(
        getDialogue(DIALOGUE_IDS.rennOutOfTheWeatherCompletion)?.beats.some(
          (beat) => beat.kind === "skill_xp" && beat.amount === 250,
        ),
      ).toBe(true);
    });
  });

  describe("the Mission Log tracks the real phases of the job", () => {
    async function materialsInstalled() {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.crewStop, {
        refinedFerriteContributed: crewStop.refinedFerriteRequired,
        slagContributed: 0,
        weldingProgress: 0,
        completedAt: null,
        updatedAt: now,
      });
      return { userId, character };
    }

    async function crewStopObjective(userId: string, characterId: string) {
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      const mission = state.missions.find(
        (entry) => entry.missionId === MISSION_IDS.outOfTheWeather,
      );
      return { mission, requirement: mission?.requirements?.[0] };
    }

    it("counts only durably installed material, never what is carried or stored", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [10]);
      await contribute(userId, character.id, 10);
      // Carried afterwards, and deliberately never contributed.
      await addRefinedFerrite(character.id, [6]);

      const { mission, requirement } = await crewStopObjective(userId, character.id);
      expect(requirement?.objective).toBe("Install Refined Ferrite at the Crew Stop — 10 / 20");
      expect(requirement?.progress).toEqual({ current: 10, target: 20 });
      // Six carried on top of ten installed is 10 / 20 — never 16 / 20.
      expect(requirement?.detail).toBe("Carrying: 6 Refined Ferrite");
      expect(mission?.currentObjective).toBe("Install Refined Ferrite at the Crew Stop — 10 / 20");
    });

    it("counts nothing stored in the Cargo Hold either", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [10]);
      await contribute(userId, character.id, 10);
      // Stored at the Crash Site, not installed in the brace and not carried.
      await db.insert(rune.cargoHoldStacks).values({
        characterId: character.id,
        itemId: ITEM_IDS.refinedFerrite,
        quantity: 40,
      });

      const { mission, requirement } = await crewStopObjective(userId, character.id);
      expect(requirement?.objective).toBe("Install Refined Ferrite at the Crew Stop — 10 / 20");
      expect(requirement?.progress).toEqual({ current: 10, target: 20 });
      expect(requirement?.detail).toBeUndefined();
      // Storage is not carrying, so it does not restore guidance either.
      expect(mission?.guidance).toBeUndefined();
    });

    it("gives no destination while the player carries none of what is missing", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await acceptSideMission(userId, character.id);
      await addRefinedFerrite(character.id, [10]);
      await contribute(userId, character.id, 10);

      const empty = await crewStopObjective(userId, character.id);
      expect(empty.mission?.guidance).toBeUndefined();
      // The objective still names the material properly with none carried: the
      // recipe's own items are named from the item registry, not from what
      // happens to be in the player's hands.
      expect(empty.requirement?.objective).toBe(
        "Install Refined Ferrite at the Crew Stop — 10 / 20",
      );
      expect(empty.requirement?.detail).toBeUndefined();

      // One useful unit is enough to make the shelter worth walking to again.
      await addRefinedFerrite(character.id, [1]);
      const carrying = await crewStopObjective(userId, character.id);
      expect(carrying.mission?.guidance).toMatchObject({
        repairTargetId: REPAIR_TARGET_IDS.crewStop,
      });
    });

    it("turns to Welding progress once the last unit is installed", async () => {
      const { userId, character } = await materialsInstalled();
      const beforeWelding = await crewStopObjective(userId, character.id);
      expect(beforeWelding.requirement?.objective).toBe("Weld the Crew Stop — 0 / 10 welds");
      expect(beforeWelding.mission?.guidance).toMatchObject({
        repairTargetId: REPAIR_TARGET_IDS.crewStop,
      });

      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );
      await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, balance.welding.attemptDurationTicks * 3),
        deterministicRandom(),
      );
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, balance.welding.attemptDurationTicks * 3),
        deterministicRandom(),
      );
      const requirement = state.missions.find(
        (entry) => entry.missionId === MISSION_IDS.outOfTheWeather,
      )?.requirements?.[0];
      expect(requirement?.objective).toBe("Weld the Crew Stop — 3 / 10 welds");
      expect(requirement?.progress).toEqual({ current: 3, target: 10 });
      expect(requirement?.detail).toBeUndefined();
    });

    it("hands off to Renn, and to nothing else, the moment the tenth weld lands", async () => {
      const { userId, character } = await materialsInstalled();
      await repairs.startWelding(
        userId,
        character.id,
        REPAIR_TARGET_IDS.crewStop,
        now,
        deterministicRandom(),
      );
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, balance.welding.attemptDurationTicks * crewStop.repairIncrements),
        deterministicRandom(),
      );
      const mission = state.missions.find(
        (entry) => entry.missionId === MISSION_IDS.outOfTheWeather,
      );
      expect(mission?.state).toBe("ready_for_completion");
      expect(mission?.guidance).toMatchObject({ npcId: NPC_IDS.rennCalder, turnIn: true });
      expect(mission?.guidance?.repairTargetId).toBeUndefined();
      expect(state.repairs[REPAIR_TARGET_IDS.crewStop]).toMatchObject({ complete: true });
    });
  });

  describe("the Crew Hauler fare and Journey", () => {
    async function riderAt(locationId: string, credits = 10) {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await db.insert(rune.characterMissions).values({
        characterId: character.id,
        missionId: MISSION_IDS.outOfTheWeather,
        acceptedAt: now,
        completedAt: now,
      });
      await move(character.id, locationId);
      await setCredits(character.id, credits);
      return { userId, character };
    }

    it("refuses the ride before the Mission is completed, charging nothing", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await move(character.id, LOCATION_IDS.holoHollow);
      await setCredits(character.id, 10);

      const refused = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      expect(refused.travelError).toBe("route_locked");
      expect(refused.travelState).toBeUndefined();
      expect(await creditsOf(character.id)).toBe(10);
    });

    it("charges exactly 5 Credits and starts a real Journey out to The Jag", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow, 10);
      const started = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      expect(await creditsOf(character.id)).toBe(5);
      expect(started.travelState).toMatchObject({
        originLocationId: LOCATION_IDS.holoHollow,
        destinationLocationId: LOCATION_IDS.theJag,
        mode: "crew_hauler",
      });
      // A real Journey, not a teleport: still at the origin until arrival.
      expect(started.location.currentLocationId).toBe(LOCATION_IDS.holoHollow);

      const arrived = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, balance.travel.crewHaulerDurationTicks),
        deterministicRandom(),
      );
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.theJag);
      expect(arrived.travelState).toBeUndefined();
    });

    it("refuses the ride home outright, even for a rider who just paid to come out", async () => {
      // The hauler goes back loaded with shale. No route is authored, so the
      // refusal is the server's, not a hidden button's — and it costs nothing.
      const { userId, character } = await riderAt(LOCATION_IDS.theJag, 10);
      const refused = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        now,
        deterministicRandom(),
      );
      expect(refused.travelError).toBe("unknown_route");
      expect(refused.travelState).toBeUndefined();
      expect(await creditsOf(character.id)).toBe(10);
      expect(
        await db
          .select()
          .from(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id)),
      ).toHaveLength(0);
    });

    it("leaves the walk home exactly as it was: free, two legs, and scavengeable", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.theJag, 10);
      const walking = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.theLongScramble,
        now,
        deterministicRandom(),
      );
      expect(walking.travelState).toMatchObject({
        originLocationId: LOCATION_IDS.theJag,
        destinationLocationId: LOCATION_IDS.theLongScramble,
        mode: "walk",
      });
      expect(await creditsOf(character.id)).toBe(10);
      expect(walking.travelState?.scavenge).toBeDefined();

      const arrived = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 40),
        deterministicRandom(),
      );
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);
    });

    it("arrives in 20 ticks, where the same trip on foot is two 40-tick legs", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow);
      await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      const early = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 19),
        deterministicRandom(),
      );
      expect(early.location.currentLocationId).toBe(LOCATION_IDS.holoHollow);

      const onTime = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 20),
        deterministicRandom(),
      );
      expect(onTime.location.currentLocationId).toBe(LOCATION_IDS.theJag);
    });

    it("refuses an unaffordable fare without charging or starting anything", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow, 4);
      const refused = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      expect(refused.travelError).toBe("insufficient_credits");
      expect(await creditsOf(character.id)).toBe(4);
      expect(
        await db
          .select()
          .from(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id)),
      ).toHaveLength(0);
    });

    it("never double-charges a retried or concurrent boarding", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow, 10);
      await Promise.all([
        play.beginTransportTravel(
          userId,
          character.id,
          LOCATION_IDS.theJag,
          now,
          deterministicRandom(),
        ),
        play.beginTransportTravel(
          userId,
          character.id,
          LOCATION_IDS.theJag,
          now,
          deterministicRandom(),
        ),
      ]);
      expect(await creditsOf(character.id)).toBe(5);

      // An idempotent retry of the ride already under way charges nothing more.
      await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        tick(now, 5),
        deterministicRandom(),
      );
      expect(await creditsOf(character.id)).toBe(5);
    });

    it("refuses a forged origin/destination pair server-side", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.crashSite, 10);
      const refused = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      expect(refused.travelError).toBe("unknown_route");
      expect(await creditsOf(character.id)).toBe(10);
    });

    it("persists and projects no Scavenge window at all, and refuses a forged claim", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow);
      const started = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        now,
        deterministicRandom(),
      );
      expect(started.travelState?.scavenge).toBeUndefined();

      const row = (
        await db
          .select()
          .from(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id))
      )[0];
      expect(row?.mode).toBe("crew_hauler");
      expect(row?.scavengeOpportunityStartTick).toBeNull();

      const claim = await play.claimScavenge(
        userId,
        character.id,
        tick(now, 5),
        deterministicRandom(),
      );
      expect(claim.scavenge).toMatchObject({
        status: "refused",
        reason: "no_scavenge_on_this_journey",
      });
    });

    it("leaves ordinary walking free, 40 ticks, and still scavengeable", async () => {
      const { userId, character } = await riderAt(LOCATION_IDS.holoHollow, 10);
      const walked = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.theLongScramble,
        now,
        deterministicRandom(),
      );
      expect(await creditsOf(character.id)).toBe(10);
      expect(walked.travelState).toMatchObject({ mode: "walk" });
      expect(walked.travelState?.scavenge).toBeDefined();

      const row = (
        await db
          .select()
          .from(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id))
      )[0];
      expect(row?.scavengeOpportunityStartTick).not.toBeNull();

      const early = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 39),
        deterministicRandom(),
      );
      expect(early.location.currentLocationId).toBe(LOCATION_IDS.holoHollow);
      const arrived = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, 40),
        deterministicRandom(),
      );
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);
    });
  });

  describe("the Cargo Hold survived the generic-persistence move", () => {
    it("projects its own unchanged recipe from the shared boundary", async () => {
      const { userId, character } = await makeCharacter();
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.cargoHold]).toMatchObject({
        refinedFerriteRequired: 15,
        slagRequired: 6,
        weldingIncrements: 12,
      });
      // The Cargo panel's own projection is the same object.
      expect(state.cargoHold.repair).toEqual(state.repairs[REPAIR_TARGET_IDS.cargoHold]);
    });

    it("keeps the two targets' progress completely independent", async () => {
      const { userId, character } = await makeCharacter();
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.cargoHold, {
        refinedFerriteContributed: 15,
        slagContributed: 6,
        weldingProgress: 12,
        completedAt: now,
      });
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.cargoHold]?.complete).toBe(true);
      expect(state.repairs[REPAIR_TARGET_IDS.crewStop]?.complete).toBe(false);
      expect(state.repairs[REPAIR_TARGET_IDS.crewStop]?.weldingProgress).toBe(0);
    });
  });
});
