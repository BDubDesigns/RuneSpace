import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import type { PlayGameplayState } from "@/server/play";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #436 — the Fabrication 12 Resonance Core against real PostgreSQL,
 * through the real shared Fabrication and Tinkering commands: the level gate,
 * exact ingredient consumption, one output and 400 XP exactly once, and its
 * ordinary 160-tick, 400 XP, 2 Scrap Metal Tinkering. No Core-specific path.
 */
suite("issue #436 Resonance Core (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let fabrication: typeof import("@/server/fabrication-commands");
  let tinkering: typeof import("@/server/tinkering-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-27T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const recipes = balance.fabrication.recipes;
  const thresholds = standardSkillLevelThresholds(balance);
  const at = (tick: number) => new Date(start.getTime() + tick * GAME_TICK_MS);
  /** Every Mining roll succeeds, on the high side of the yield range. */
  const high = (): MiningRandom => ({ nextBasisPoints: () => 0, nextUnit: () => 0.5 });

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    fabrication = await import("@/server/fabrication-commands");
    tinkering = await import("@/server/tinkering-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const CHAPTER = [
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
   * A character past Tansy's Fabrication chapter (so the station is theirs),
   * optionally past Brace Yourself, at the given skill levels, standing
   * somewhere. They carry the equipped starter Salvage Cutter.
   */
  async function veteran(
    label: string,
    options: {
      fabrication?: number;
      mining?: number;
      brace?: boolean;
      location?: LocationId;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Adv ${userId.slice(0, 6)}`,
    );
    await play.getPlayGameplayState(userId, character.id, start, high());
    await db
      .update(rune.characters)
      .set({ currentLocationId: options.location ?? LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.characterMissions).values(
      [...CHAPTER, ...(options.brace ? [MISSION_IDS.braceYourself] : [])].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    for (const [skillId, level] of [
      [SKILL_IDS.fabrication, options.fabrication ?? 1],
      [SKILL_IDS.mining, options.mining ?? 1],
    ] as const) {
      if (level > 1) await grantLevel(character.id, skillId, level);
    }
    return { userId, character };
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

  async function give(characterId: string, itemId: string, quantity: number) {
    await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
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

  async function xp(characterId: string, skillId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, skillId),
        ),
      );
    return row?.totalXp ?? 0;
  }

  const recipeOf = (state: PlayGameplayState, actionId: string) =>
    state.fabricationStation.recipes.find((recipe) => recipe.actionId === actionId)!;
  const targetOf = (state: PlayGameplayState, actionId: string) =>
    state.tinkering.targets.find((target) => target.actionId === actionId)!;

  async function stockInputs(characterId: string, batches = 1) {
    for (const input of recipes.resonanceCore.inputs)
      await give(characterId, input.itemId, input.quantity * batches);
  }

  describe("Fabrication", () => {
    it("is locked at Fabrication 11, available at 12, and changes nothing when refused", async () => {
      const eleven = await veteran("Core eleven", { fabrication: 11 });
      await stockInputs(eleven.character.id);
      let state = await play.getPlayGameplayState(eleven.userId, eleven.character.id, at(0));
      expect(recipeOf(state, ACTION_IDS.resonanceCoreFabrication)).toMatchObject({
        unlocked: false,
        minimumLevel: 12,
      });
      state = await fabrication.startFabrication(
        eleven.userId,
        eleven.character.id,
        ACTION_IDS.resonanceCoreFabrication,
        1,
        at(1),
      );
      expect(state.fabricationError).toBe("fabrication_recipe_locked");
      expect(await carried(eleven.character.id, ITEM_IDS.runestone)).toBe(1);
      expect(await carried(eleven.character.id, ITEM_IDS.resonanceCore)).toBe(0);

      const twelve = await veteran("Core twelve", { fabrication: 12 });
      state = await play.getPlayGameplayState(twelve.userId, twelve.character.id, at(0));
      expect(recipeOf(state, ACTION_IDS.resonanceCoreFabrication).unlocked).toBe(true);
    });

    it("consumes exactly its carried inputs and pays one Core and 400 XP once", async () => {
      const { userId, character } = await veteran("Core craft", { fabrication: 12 });
      await stockInputs(character.id);
      const before = await xp(character.id, SKILL_IDS.fabrication);
      const started = await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.resonanceCoreFabrication,
        1,
        at(0),
      );
      expect(started.fabricationError).toBeUndefined();
      // Nothing pays before the 80th tick.
      await play.getPlayGameplayState(userId, character.id, at(79));
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(0);

      await play.getPlayGameplayState(userId, character.id, at(80));
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(1);
      expect(await carried(character.id, ITEM_IDS.runestone)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.galvaferrite)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.galvanicWireSpool)).toBe(0);
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(400);

      // A replayed or later resolution settles nothing twice.
      await play.getPlayGameplayState(userId, character.id, at(500));
      await play.getPlayGameplayState(userId, character.id, at(80));
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(1);
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(400);
    });

    it("refuses to start without the ingredients and never consumes a partial set", async () => {
      const { userId, character } = await veteran("Core short", { fabrication: 12 });
      await give(character.id, ITEM_IDS.runestone, 1);
      await give(character.id, ITEM_IDS.galvaferrite, 2);
      const state = await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.resonanceCoreFabrication,
        1,
        at(0),
      );
      expect(state.fabricationError).toBeDefined();
      await play.getPlayGameplayState(userId, character.id, at(200));
      expect(await carried(character.id, ITEM_IDS.runestone)).toBe(1);
      expect(await carried(character.id, ITEM_IDS.galvaferrite)).toBe(2);
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(0);
    });

    it("stacks a second Core into the existing stack of two", async () => {
      const { userId, character } = await veteran("Core stack", { fabrication: 12 });
      await give(character.id, ITEM_IDS.resonanceCore, 1);
      await stockInputs(character.id);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.resonanceCoreFabrication,
        1,
        at(0),
      );
      await play.getPlayGameplayState(userId, character.id, at(80));
      const stacks = await db
        .select({ quantity: rune.inventoryStacks.quantity })
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, character.id),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.resonanceCore),
          ),
        );
      expect(stacks.map((row) => row.quantity)).toEqual([2]);
    });
  });

  describe("standard Tinkering", () => {
    it("takes 160 ticks and pays 400 XP and 2 Scrap Metal exactly once", async () => {
      const { userId, character } = await veteran("Core tinker", { fabrication: 12 });
      await give(character.id, ITEM_IDS.resonanceCore, 1);
      const state = await play.getPlayGameplayState(userId, character.id, at(0));
      expect(targetOf(state, ACTION_IDS.resonanceCoreTinkering)).toMatchObject({
        batchQuantity: 1,
        affordableBatches: 1,
        durationTicks: 160,
        xp: 400,
        scrap: 2,
      });
      const before = await xp(character.id, SKILL_IDS.fabrication);
      const started = await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.resonanceCoreTinkering,
        1,
        at(1),
      );
      expect(started.tinkeringError).toBeUndefined();
      // The cycle reserves its Core at the start; nothing is recovered or paid until it ends.
      await play.getPlayGameplayState(userId, character.id, at(1 + 159));
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
      expect(await xp(character.id, SKILL_IDS.fabrication)).toBe(before);

      await play.getPlayGameplayState(userId, character.id, at(1 + 160));
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(2);
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(400);

      await play.getPlayGameplayState(userId, character.id, at(1000));
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(2);
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(400);
    });

    it("keeps the shared recipe-level rule and adds no Core-specific gate or warning", async () => {
      const { userId, character } = await veteran("Core low tinker", { fabrication: 11 });
      await give(character.id, ITEM_IDS.resonanceCore, 1);
      const refused = await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.resonanceCoreTinkering,
        1,
        at(0),
      );
      expect(refused.tinkeringError).toBe("tinkering_recipe_locked");
      expect(await carried(character.id, ITEM_IDS.resonanceCore)).toBe(1);
    });
  });
});
