import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  systemAnnouncementsBy,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #380 — Stillreach's Dry Seam runs the one canonical Oil Shale Mining.
 *
 * The balance and resolver are #342's and are tested there; this proves what is
 * specific to a second planet: the server authorizes Mining by the character's
 * physical location, the Mining 5 gate holds, a success pays the shared numbers,
 * and the public ULTRA RARE FIND names the place the slab was actually cut.
 */
suite("issue #380 The Dry Seam Oil Shale Mining (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  const createdUsers: string[] = [];
  const finders: string[] = [];
  const balance = getEffectiveGameBalance();
  const oil = balance.mining.sources.oilShale;
  const thresholds = standardSkillLevelThresholds(balance);
  const xpForLevel = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = oil.attemptDurationTicks;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
  });

  // A foreign announcement standing in for another concurrently running suite's
  // row: every read and cleanup here is scoped to this test's own finders.
  const bystander = {
    kind: "ultra_rare_find",
    channel: "general",
    body: `Bystander${randomUUID().slice(0, 8)} just found Motherlode Slab at The South Cut!`,
  };
  beforeAll(async () => {
    await db.insert(rune.chatMessages).values(bystander);
  });
  afterAll(async () => {
    const survivors = await db
      .select({ body: rune.chatMessages.body })
      .from(rune.chatMessages)
      .where(inArray(rune.chatMessages.body, [bystander.body]));
    await db.delete(rune.chatMessages).where(inArray(rune.chatMessages.body, [bystander.body]));
    expect(survivors).toHaveLength(1);
  });

  afterEach(async () => {
    if (finders.length > 0)
      await db.delete(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));
    finders.splice(0);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Scripted draws: basis points per attempt, then yield and secondary draws. */
  function script(draws: { basisPoints?: number[]; integers?: number[] } = {}) {
    const basisPoints = [...(draws.basisPoints ?? [])];
    const integers = [...(draws.integers ?? [])];
    const random: MiningRandom = {
      nextBasisPoints: () => basisPoints.shift() ?? 0,
      nextUnit: () => 0,
      nextInteger: (exclusiveMaximum) => integers.shift() ?? exclusiveMaximum - 1,
    };
    return random;
  }
  const SAPPHIRE_ROLL = 0;
  const SLAB_ROLL = 15;
  const FRAGMENT_ROLL = 18;
  const NEEDS_LOW_YIELD = 9_999;

  async function makeCharacter(miningLevel = 5, at: string = LOCATION_IDS.theDrySeam) {
    const userId = await createTestUser(db, authSchema, "Seamer");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Seamer${userId.slice(0, 5)}`,
    );
    finders.push(character.displayName);
    await play.getPlayGameplayState(userId, character.id, now, script());
    await db
      .update(rune.characterSkillXp)
      .set({ totalXp: xpForLevel(miningLevel) })
      .where(
        and(
          eq(rune.characterSkillXp.characterId, character.id),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    await db
      .update(rune.characters)
      .set({ currentLocationId: at })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  async function mineOnce(userId: string, characterId: string, random: MiningRandom) {
    await miningCommands.startMining(userId, characterId, now, random);
    return play.getPlayGameplayState(userId, characterId, tick(now, ATTEMPT), random);
  }

  const announcements = (kind: "rare_find" | "ultra_rare_find") =>
    db
      .select()
      .from(rune.chatMessages)
      .where(and(eq(rune.chatMessages.kind, kind), systemAnnouncementsBy(rune, finders)))
      .orderBy(desc(rune.chatMessages.seq));

  async function miningXp(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    return row?.totalXp ?? 0;
  }

  describe("server-side location authorization", () => {
    it("projects Mining and the shared source only at The Dry Seam", async () => {
      const { userId, character } = await makeCharacter();
      const state = await play.getPlayGameplayState(userId, character.id, now, script());
      expect(state.locationStates[LOCATION_IDS.theDrySeam]).toMatchObject({
        availableActionIds: [oil.actionId],
        mapStatus: "Mining",
      });
      expect(state.miningSource?.itemId).toBe(ITEM_IDS.oilShale);
      for (const other of [
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.harmonicWorkings,
      ]) {
        expect(state.locationStates[other]?.availableActionIds).not.toContain(oil.actionId);
      }
    });

    it("refuses Mining 4 with no action, time, roll or XP, however often it is asked", async () => {
      const { userId, character } = await makeCharacter(4);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await miningCommands.startMining(userId, character.id, now, script());
        expect(state.miningError).toBe("mining_level_required");
        expect(state.activeAction).toBeUndefined();
      }
      expect(
        await db
          .select()
          .from(rune.activeActions)
          .where(eq(rune.activeActions.characterId, character.id)),
      ).toEqual([]);
      expect(await miningXp(character.id)).toBe(xpForLevel(4));
    });

    it("lets Mining 5 start at 40.30% on the shared 100-tick attempt", async () => {
      const { userId, character } = await makeCharacter(5);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBeUndefined();
      expect(state.activeAction?.actionId).toBe(oil.actionId);
      expect(state.miningSource).toMatchObject({
        itemId: ITEM_IDS.oilShale,
        successChanceBps: 4_030,
        attemptDurationTicks: 100,
        yieldMinimum: 2,
        yieldMaximum: 4,
        lowYield: { quantity: 1, xp: 20 },
      });
    });

    it("refuses Mining anywhere else on Stillreach, and from The South Cut's neighbours", async () => {
      // Harmonic Workings (#383) is a Mining site of its own now, so it is not an
      // "elsewhere": its Mining-8 gate is covered in harmonic-mining.test.ts.
      for (const elsewhere of [
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.southAccessTrack,
      ]) {
        const { userId, character } = await makeCharacter(5, elsewhere);
        const state = await miningCommands.startMining(userId, character.id, now, script());
        expect(state.travelError).toBe("mining_unavailable_here");
        expect(state.activeAction).toBeUndefined();
        expect(await miningXp(character.id)).toBe(xpForLevel(5));
      }
    });
  });

  describe("outcomes", () => {
    it("pays a full success the shared shale and 100 XP, and a Sapphire's 30 more, silently", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [1, SAPPHIRE_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(3);
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(5) + 100 + 30);
      expect(await announcements("rare_find")).toEqual([]);
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });

    it("stores a Rune Fragment beside the shale with +20 XP and no announcement", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [0, FRAGMENT_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.runeFragment]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(5) + 100 + 20);
      expect(await announcements("rare_find")).toEqual([]);
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });

    it("pays a low yield exactly one shale and 20 XP, with no secondary", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(
        userId,
        character.id,
        script({ basisPoints: [NEEDS_LOW_YIELD], integers: [SLAB_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab] ?? 0).toBe(0);
      expect(await miningXp(character.id)).toBe(xpForLevel(5) + 20);
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });
  });

  describe("the Motherlode Slab", () => {
    it("posts exactly one ULTRA RARE FIND that names The Dry Seam, not The South Cut", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [0, SLAB_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(5) + 250);
      const rows = await announcements("ultra_rare_find");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toBe(
        `${character.displayName} just found Motherlode Slab at The Dry Seam!`,
      );
      expect(rows[0]!.body).not.toContain("South Cut");
    });

    it("still names The South Cut for a Skatboll success", async () => {
      const { userId, character } = await makeCharacter(5, LOCATION_IDS.theSouthCut);
      await mineOnce(userId, character.id, script({ integers: [0, SLAB_ROLL] }));
      const rows = await announcements("ultra_rare_find");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toBe(
        `${character.displayName} just found Motherlode Slab at The South Cut!`,
      );
    });

    it("announces nothing and awards nothing when the slab has no room (priority On is #342's; Off refuses to start)", async () => {
      const { userId, character } = await makeCharacter();
      await db.insert(rune.inventoryStacks).values(
        Array.from({ length: 7 }, () => ({
          characterId: character.id,
          itemId: ITEM_IDS.ferriteShale,
          quantity: 10,
        })),
      );
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
      expect(state.activeAction).toBeUndefined();
      expect(await announcements("ultra_rare_find")).toEqual([]);
      expect(await miningXp(character.id)).toBe(xpForLevel(5));
    });
  });
});
