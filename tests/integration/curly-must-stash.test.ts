import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { CURLY_MUST_STASH_PAYMENT_CREDITS } from "@/game/content/missions";
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
 * Issue #292 — Curly Must-Stash, against real PostgreSQL.
 *
 * The two payments are 150 Credits each and must each land exactly once:
 * acceptance pays the first in the acceptance transaction, and only a
 * successful turn-in pays the second. Between them the mount is an ordinary
 * Mission-authorized repair target inside HH B&B — six Refined Ferrite and
 * three Slag, six real Welding sections, 300 Welding XP — that stays locked
 * until the Mission is accepted and never becomes storage the player owns.
 */
suite("issue #292 Curly Must-Stash (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-04T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const mount = getRepairTargetBalance(REPAIR_TARGET_IDS.curlyStashMount, balance);
  const WELD_TICKS = balance.welding.attemptDurationTicks;
  const PAYMENT = CURLY_MUST_STASH_PAYMENT_CREDITS;

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

  async function makeCharacter(options: { keepTheChange?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, "Curly Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Curly ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const chain = [
      MISSION_IDS.walkItOff,
      MISSION_IDS.cutYourTeeth,
      MISSION_IDS.wasteNot,
      MISSION_IDS.holdItTogether,
      ...(options.keepTheChange === false ? [] : [MISSION_IDS.keepTheChange]),
    ];
    await db.insert(rune.characterMissions).values(
      chain.map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: now,
        completedAt: now,
      })),
    );
    await move(character.id, LOCATION_IDS.holoHollow);
    await db
      .update(rune.characters)
      .set({ credits: 0 })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function creditsOf(characterId: string) {
    return (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]?.credits;
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

  async function mountRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.curlyStashMount),
          ),
        )
    )[0];
  }

  async function carry(characterId: string, itemId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  const accept = (userId: string, characterId: string) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.curlyMustStash,
      NPC_IDS.curly,
      now,
      deterministicRandom(),
    );

  const complete = (userId: string, characterId: string, at = now) =>
    missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.curlyMustStash,
      NPC_IDS.curly,
      at,
      deterministicRandom(),
    );

  async function installMount(characterId: string) {
    await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.curlyStashMount, {
      materials: installedMaterials(mount),
      weldingProgress: mount.repairIncrements,
      completedAt: now,
      updatedAt: now,
    });
  }

  describe("acceptance pays the first 150 exactly once", () => {
    it("is not offered before Keep the Change", async () => {
      const { userId, characterId } = await makeCharacter({ keepTheChange: false });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await creditsOf(characterId)).toBe(0);
    });

    it("pays 150 on acceptance and reports that receipt once", async () => {
      const { userId, characterId } = await makeCharacter();
      const first = await accept(userId, characterId);
      expect(first.mission).toEqual({ status: "accepted", creditsPaid: PAYMENT });
      expect(await creditsOf(characterId)).toBe(PAYMENT);

      // Retries, replays and re-entering the conversation never repay.
      const again = await accept(userId, characterId);
      expect(again.mission).toEqual({ status: "already_accepted" });
      expect(await creditsOf(characterId)).toBe(PAYMENT);
    });

    it("pays once under concurrent duplicate acceptances", async () => {
      const { userId, characterId } = await makeCharacter();
      const results = await Promise.all([
        accept(userId, characterId),
        accept(userId, characterId),
        accept(userId, characterId),
      ]);
      const paid = results.filter((result) => "creditsPaid" in result.mission);
      expect(paid).toHaveLength(1);
      expect(await creditsOf(characterId)).toBe(PAYMENT);
    });

    it("refuses acceptance away from Holo Hollow", async () => {
      const { userId, characterId } = await makeCharacter();
      await move(characterId, LOCATION_IDS.theJag);
      expect((await accept(userId, characterId)).mission.status).toBe("refused");
      expect(await creditsOf(characterId)).toBe(0);
    });
  });

  describe("the mount is a Mission-authorized repair, locked until accepted", () => {
    it("shows no repair and refuses every command before acceptance", async () => {
      const { userId, characterId } = await makeCharacter();
      await carry(characterId, ITEM_IDS.refinedFerrite, [5, 1]);
      const refused = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        {
          targetId: REPAIR_TARGET_IDS.curlyStashMount,
          expectedMaterials: { [ITEM_IDS.refinedFerrite]: 6 },
        },
        now,
        deterministicRandom(),
      );
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });
      const refusedWelding = await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.curlyStashMount,
        now,
        deterministicRandom(),
      );
      expect(refusedWelding.weldingError).toBe("welding_locked");
      expect(await mountRow(characterId)).toBeUndefined();
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.curlyStashMount]).toMatchObject({
        repairAvailable: false,
        complete: false,
      });
    });

    it("takes partial materials, refuses the wrong place, then six real welds pay 300 XP", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      const contribute = (expected: Record<string, number>) =>
        repairs.contributeRepairMaterials(
          userId,
          characterId,
          { targetId: REPAIR_TARGET_IDS.curlyStashMount, expectedMaterials: expected },
          now,
          deterministicRandom(),
        );

      await carry(characterId, ITEM_IDS.refinedFerrite, [4]);
      expect((await contribute({ [ITEM_IDS.refinedFerrite]: 4 })).repair.status).toBe("committed");

      // The work is in the B&B: standing anywhere else refuses it.
      await carry(characterId, ITEM_IDS.refinedFerrite, [2]);
      await carry(characterId, ITEM_IDS.slag, [3]);
      await move(characterId, LOCATION_IDS.theJag);
      expect(
        (await contribute({ [ITEM_IDS.refinedFerrite]: 2, [ITEM_IDS.slag]: 3 })).repair,
      ).toMatchObject({ status: "refused", reason: "wrong_location" });
      await move(characterId, LOCATION_IDS.holoHollow);
      expect(
        (await contribute({ [ITEM_IDS.refinedFerrite]: 2, [ITEM_IDS.slag]: 3 })).repair.status,
      ).toBe("committed");
      expect(await mountRow(characterId)).toMatchObject({ materials: installedMaterials(mount) });

      // Not ready to collect until the welding is actually finished.
      expect((await complete(userId, characterId)).mission).toMatchObject({
        status: "refused",
        reason: "repair_target_complete",
      });
      expect(await creditsOf(characterId)).toBe(PAYMENT);

      const started = await repairs.startWelding(
        userId,
        characterId,
        REPAIR_TARGET_IDS.curlyStashMount,
        now,
        deterministicRandom(),
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.curlyStashMountWelding);
      const finished = await play.getPlayGameplayState(
        userId,
        characterId,
        tick(now, mount.repairIncrements * WELD_TICKS),
        deterministicRandom(),
      );
      expect(finished.repairs[REPAIR_TARGET_IDS.curlyStashMount]).toMatchObject({
        weldingProgress: 6,
        weldingIncrements: 6,
        complete: true,
      });
      expect(finished.activeAction).toBeUndefined();
      expect(await weldingXp(characterId)).toBe(300);

      // Installed, not yet paid: the Mission waits for Curly.
      const pending = finished.missions.find(
        (mission) => mission.missionId === MISSION_IDS.curlyMustStash,
      );
      expect(pending?.state).toBe("ready_for_completion");
      expect(await creditsOf(characterId)).toBe(PAYMENT);
    });
  });

  describe("the turn-in pays the second 150 exactly once", () => {
    it("pays 150 once, completes the Mission, and adds no Mission XP", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installMount(characterId);
      const xpBefore = await weldingXp(characterId);

      const first = await complete(userId, characterId);
      expect(first.mission).toEqual({ status: "completed", creditsPaid: PAYMENT });
      expect(await creditsOf(characterId)).toBe(2 * PAYMENT);
      expect(await weldingXp(characterId)).toBe(xpBefore);

      const again = await complete(userId, characterId);
      expect(again.mission).toEqual({ status: "already_completed" });
      // Accepting again after completion pays nothing either.
      expect((await accept(userId, characterId)).mission).toEqual({
        status: "already_completed",
      });
      expect(await creditsOf(characterId)).toBe(2 * PAYMENT);
      // The finished mount stays finished, with no repair controls offered.
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        now,
        deterministicRandom(),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.curlyStashMount]?.complete).toBe(true);
    });

    it("pays once under concurrent duplicate turn-ins", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installMount(characterId);
      const results = await Promise.all([
        complete(userId, characterId),
        complete(userId, characterId),
        complete(userId, characterId),
      ]);
      expect(results.filter((result) => "creditsPaid" in result.mission)).toHaveLength(1);
      expect(await creditsOf(characterId)).toBe(2 * PAYMENT);
    });

    it("refuses the turn-in away from Holo Hollow", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installMount(characterId);
      await move(characterId, LOCATION_IDS.theJag);
      expect((await complete(userId, characterId)).mission.status).toBe("refused");
      expect(await creditsOf(characterId)).toBe(PAYMENT);
    });
  });
});
