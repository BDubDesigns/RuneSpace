import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
 * Issue #383 — Stillreach Harmonic Workings Rune Fragment Mining against real
 * PostgreSQL: the Mining 8 server gate, one exclusive success-only find roll,
 * the Runestone's silent award with its +130 find XP, the Sapphire's single awarded-only
 * RARE FIND line, and the shared Inventory preflight in both capacity modes.
 */
suite("issue #383 Harmonic Workings Rune Fragment Mining (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let preferences: typeof import("@/server/character-preference-commands");
  const createdUsers: string[] = [];
  const finders: string[] = [];
  const balance = getEffectiveGameBalance();
  const harmonic = balance.mining.sources.harmonicMining;
  const thresholds = standardSkillLevelThresholds(balance);
  const xpForLevel = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;
  const now = new Date("2026-10-22T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = harmonic.attemptDurationTicks;

  // Rolls of the one 40-outcome secondary table.
  const RUNESTONE_ROLL = 0;
  const SAPPHIRE_ROLL = 5;
  const NO_FIND = 39;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    preferences = await import("@/server/character-preference-commands");
  });

  afterEach(async () => {
    if (finders.length > 0)
      await db.delete(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));
    finders.splice(0);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Scripted draws: basis points per attempt, a coin flip, and the 40-wide table. */
  function script(draws: { basisPoints?: number[]; units?: number[]; integers?: number[] } = {}) {
    const basisPoints = [...(draws.basisPoints ?? [])];
    const units = [...(draws.units ?? [])];
    const integers = [...(draws.integers ?? [])];
    const random: MiningRandom = {
      nextBasisPoints: () => basisPoints.shift() ?? 0,
      nextUnit: () => units.shift() ?? 0,
      nextInteger: (exclusiveMaximum) => integers.shift() ?? exclusiveMaximum - 1,
    };
    return random;
  }

  async function makeCharacter(miningLevel = 8, at: string = LOCATION_IDS.harmonicWorkings) {
    const userId = await createTestUser(db, authSchema, "Harmonic");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Harmonic${userId.slice(0, 5)}`,
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

  /** Start Mining and resolve exactly one 75-tick attempt. */
  async function mineOnce(userId: string, characterId: string, random: MiningRandom) {
    await miningCommands.startMining(userId, characterId, now, random);
    return play.getPlayGameplayState(userId, characterId, tick(now, ATTEMPT), random);
  }

  const rareFinds = () =>
    db
      .select()
      .from(rune.chatMessages)
      .where(and(eq(rune.chatMessages.kind, "rare_find"), systemAnnouncementsBy(rune, finders)))
      .orderBy(desc(rune.chatMessages.seq));
  const anyAnnouncements = () =>
    db.select().from(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));

  async function miningXp(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    return rows[0]?.totalXp ?? 0;
  }

  /** Seven full-ish Ferrite stacks leave exactly one free slot in the default pack. */
  async function fillAllButOneSlot(characterId: string) {
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 7 }, () => ({
        characterId,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 10,
      })),
    );
  }

  describe("access", () => {
    it("refuses a character below Mining 8 with a gated reply and no action, time or roll", async () => {
      const { userId, character } = await makeCharacter(7);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBe("mining_level_required");
      expect(state.activeAction).toBeUndefined();
    });

    it("starts at Harmonic Workings at Mining 8 with the Fragment source and its real chance", async () => {
      const { userId, character } = await makeCharacter(8);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBeUndefined();
      expect(state.activeAction?.actionId).toBe(harmonic.actionId);
      expect(state.miningSource).toMatchObject({
        itemId: ITEM_IDS.runeFragment,
        successChanceBps: 4_666,
        attemptDurationTicks: 75,
        yieldMinimum: 1,
        yieldMaximum: 2,
        requiredMiningLevel: 8,
      });
    });

    it("refuses Mining anywhere else on Stillreach, with no action started", async () => {
      const { userId, character } = await makeCharacter(8, LOCATION_IDS.theSurveyLine);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.travelError).toBe("mining_unavailable_here");
      expect(state.activeAction).toBeUndefined();
    });
  });

  describe("outcomes", () => {
    it("pays one or two Fragments and 130 XP for a plain success, with no announcement", async () => {
      const { userId, character } = await makeCharacter(8);
      const state = await mineOnce(
        userId,
        character.id,
        script({ units: [0], integers: [NO_FIND] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.runeFragment]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(8) + 130);
      expect(state.run).toMatchObject({
        attempts: 1,
        successes: 1,
        xpGained: 130,
        itemsGained: { [ITEM_IDS.runeFragment]: 1 },
      });
      expect(await anyAnnouncements()).toEqual([]);
    });

    it("awards an Intact Runestone silently, with its +130 find XP once, on top of the 130 base", async () => {
      const { userId, character } = await makeCharacter(8);
      const state = await mineOnce(
        userId,
        character.id,
        script({ units: [0], integers: [RUNESTONE_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.runestone]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.runeFragment]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(8) + 130 + 130);
      expect(state.run).toMatchObject({ xpGained: 260 });
      expect(await anyAnnouncements()).toEqual([]);
    });

    it("awards an Uncut Sapphire its +30 XP once and posts one RARE FIND naming Harmonic Workings", async () => {
      const { userId, character } = await makeCharacter(8);
      const state = await mineOnce(
        userId,
        character.id,
        script({ units: [0.99], integers: [SAPPHIRE_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(8) + 130 + 30);
      const lines = await rareFinds();
      expect(lines).toHaveLength(1);
      expect(lines[0]?.body).toContain("Harmonic Workings");
      expect(lines[0]?.body).not.toContain("Deep Jag");
    });

    it("awards nothing at all on a miss: no Fragment, no find, no XP, no announcement", async () => {
      const { userId, character } = await makeCharacter(8);
      const state = await mineOnce(
        userId,
        character.id,
        script({ basisPoints: [4_666], integers: [SAPPHIRE_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.runeFragment]).toBeUndefined();
      expect(state.carriedByItemId[ITEM_IDS.runestone]).toBeUndefined();
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire]).toBeUndefined();
      expect(await miningXp(character.id)).toBe(xpForLevel(8));
      expect(await anyAnnouncements()).toEqual([]);
    });
  });

  describe("Inventory preflight", () => {
    it("with the setting Off, refuses to start when the slot for a possible find is missing", async () => {
      const { userId, character } = await makeCharacter(8);
      await fillAllButOneSlot(character.id);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
      expect(state.activeAction).toBeUndefined();
    });

    it("with the setting On, starts with one free slot and forfeits a find that has no room", async () => {
      const { userId, character } = await makeCharacter(8);
      await fillAllButOneSlot(character.id);
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        now,
        script(),
      );
      const state = await mineOnce(
        userId,
        character.id,
        script({ units: [0], integers: [RUNESTONE_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.runeFragment]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.runestone]).toBeUndefined();
      expect(await miningXp(character.id)).toBe(xpForLevel(8) + 130);
      expect(await anyAnnouncements()).toEqual([]);
    });
  });
});
