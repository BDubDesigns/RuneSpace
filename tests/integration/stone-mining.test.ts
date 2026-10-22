import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
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
 * Issue #379 — Stillreach Prospecting Quarry Stone Mining and the Stillreach
 * terminal's Stone buyback against real PostgreSQL: what is committed to
 * Inventory, XP, run history and public chat always agrees, a forfeited Boulder
 * leaves no trace, and the buyback exists at the terminal alone.
 */
suite("issue #379 Stone Mining and terminal buyback (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let preferences: typeof import("@/server/character-preference-commands");
  let trade: typeof import("@/server/trade");
  const createdUsers: string[] = [];
  const finders: string[] = [];
  const balance = getEffectiveGameBalance();
  const stone = balance.mining.sources.stone;
  const thresholds = standardSkillLevelThresholds(balance);
  const xpForLevel = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = stone.attemptDurationTicks;

  // Rolls of the one 600-outcome secondary table.
  const FRAGMENT_ROLL = 0;
  const QUARTZ_ROLL = 150;
  const TOPAZ_ROLL = 250;
  const BOULDER_ROLL = 300;
  const NO_FIND = 599;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    preferences = await import("@/server/character-preference-commands");
    trade = await import("@/server/trade");
  });

  afterEach(async () => {
    if (finders.length > 0)
      await db.delete(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));
    finders.splice(0);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Scripted draws: basis points per attempt, a coin flip, and the 600-wide table. */
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

  async function makeCharacter(miningLevel = 1, at: string = LOCATION_IDS.prospectingQuarry) {
    const userId = await createTestUser(db, authSchema, "Quarry");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Quarry${userId.slice(0, 5)}`,
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

  /** Start Mining and resolve exactly one 33-tick attempt. */
  async function mineOnce(userId: string, characterId: string, random: MiningRandom) {
    await miningCommands.startMining(userId, characterId, now, random);
    return play.getPlayGameplayState(userId, characterId, tick(now, ATTEMPT), random);
  }

  const announcements = () =>
    db
      .select()
      .from(rune.chatMessages)
      .where(
        and(eq(rune.chatMessages.kind, "ultra_rare_find"), systemAnnouncementsBy(rune, finders)),
      )
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
    it("starts at the Quarry at Mining 1 with no Runestone, Mission or Mining-8 gate", async () => {
      const { userId, character } = await makeCharacter(1);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBeUndefined();
      expect(state.activeAction?.actionId).toBe(stone.actionId);
      expect(state.miningSource).toMatchObject({
        itemId: ITEM_IDS.stone,
        successChanceBps: 3_500,
        attemptDurationTicks: 33,
        yieldMinimum: 1,
        yieldMaximum: 2,
        requiredMiningLevel: 1,
      });
    });

    it("refuses anywhere else on Stillreach, with no action started", async () => {
      const { userId, character } = await makeCharacter(1, LOCATION_IDS.windwardTrack);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.travelError).toBe("mining_unavailable_here");
      expect(state.activeAction).toBeUndefined();
    });
  });

  describe("outcomes", () => {
    it("pays one Stone and 45 XP for a plain success, with no announcement", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [NO_FIND] }));
      expect(state.carriedByItemId[ITEM_IDS.stone]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(1) + 45);
      expect(state.run).toMatchObject({
        attempts: 1,
        successes: 1,
        xpGained: 45,
        itemsGained: { [ITEM_IDS.stone]: 1 },
      });
      expect(await anyAnnouncements()).toEqual([]);
    });

    it("pays two Stone on the other side of the coin flip", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(
        userId,
        character.id,
        script({ units: [0.5], integers: [NO_FIND] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.stone]).toBe(2);
    });

    it("is a dead miss: no Stone, no find, no XP", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(
        userId,
        character.id,
        script({ basisPoints: [3_500], integers: [BOULDER_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.stone] ?? 0).toBe(0);
      expect(state.carriedByItemId[ITEM_IDS.boulder] ?? 0).toBe(0);
      expect(await miningXp(character.id)).toBe(xpForLevel(1));
      expect(state.run).toMatchObject({ attempts: 1, successes: 0, failures: 1, xpGained: 0 });
      expect(await anyAnnouncements()).toEqual([]);
    });

    it.each([
      ["Rune Fragment", FRAGMENT_ROLL, ITEM_IDS.runeFragment, 65],
      ["Uncut Quartz", QUARTZ_ROLL, ITEM_IDS.uncutQuartz, 55],
      ["Uncut Topaz", TOPAZ_ROLL, ITEM_IDS.uncutTopaz, 65],
    ])(
      "stores a %s beside the Stone with its own bonus XP and no announcement",
      async (_n, roll, itemId, xp) => {
        const { userId, character } = await makeCharacter();
        const state = await mineOnce(userId, character.id, script({ integers: [roll] }));
        expect(state.carriedByItemId[ITEM_IDS.stone]).toBe(1);
        expect(state.carriedByItemId[itemId]).toBe(1);
        expect(await miningXp(character.id)).toBe(xpForLevel(1) + xp);
        expect(await anyAnnouncements()).toEqual([]);
      },
    );
  });

  describe("the Boulder", () => {
    it("stores one 5 kg Boulder, 195 XP in all, and posts one ULTRA RARE FIND row for the Quarry", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [BOULDER_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.boulder]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.stone]).toBe(1);
      expect(await miningXp(character.id)).toBe(xpForLevel(1) + 195);
      const rows = await announcements();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "ultra_rare_find",
        channel: "general",
        senderCharacterId: null,
        body: `${character.displayName} just found Boulder at Prospecting Quarry!`,
      });
    });

    it("never announces twice when the same completed attempt is read again", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({ integers: [BOULDER_ROLL, BOULDER_ROLL] });
      await mineOnce(userId, character.id, random);
      await play.getPlayGameplayState(userId, character.id, tick(now, ATTEMPT + 1), random);
      await play.getPlayGameplayState(userId, character.id, tick(now, ATTEMPT + 5), random);
      expect(await announcements()).toHaveLength(1);
    });

    it("forfeits a Boulder with no room under Prioritize primary resources: no item, XP or chat", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        now,
        script(),
      );
      const state = await mineOnce(userId, character.id, script({ integers: [BOULDER_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.stone]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.boulder] ?? 0).toBe(0);
      // The retained Stone keeps its real 45 XP and nothing more.
      expect(await miningXp(character.id)).toBe(xpForLevel(1) + 45);
      expect(state.run.itemsGained[ITEM_IDS.boulder] ?? 0).toBe(0);
      expect(await anyAnnouncements()).toEqual([]);
    });

    it("refuses to start with the protective default when a Boulder could not be kept", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.activeAction).toBeUndefined();
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
    });
  });

  describe("the Stillreach terminal's Stone buyback", () => {
    const dayOne = new Date("2026-10-14T19:00:00.000Z");

    async function trader(options: { thrust?: boolean } = {}) {
      const who = await makeCharacter(1, LOCATION_IDS.stillreachLandingStation);
      await db
        .update(rune.characters)
        .set({ credits: 100 })
        .where(eq(rune.characters.id, who.character.id));
      if (options.thrust !== false)
        await db.insert(rune.characterMissions).values({
          characterId: who.character.id,
          missionId: MISSION_IDS.thrustIssues,
          acceptedAt: dayOne,
          completedAt: dayOne,
        });
      return who;
    }
    const give = (characterId: string, itemId: string, quantity: number) =>
      db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    const creditsOf = async (characterId: string) =>
      (
        await db
          .select({ credits: rune.characters.credits })
          .from(rune.characters)
          .where(eq(rune.characters.id, characterId))
      )[0]?.credits;
    const sell = (
      who: { userId: string; character: { id: string } },
      direction: "buy" | "sell",
      itemId: string,
      quantity: number,
      localPlaceId: string | undefined = LOCAL_PLACE_IDS.stillreachFuelTerminal,
    ) =>
      trade.tradeWithMerchant(
        who.userId,
        who.character.id,
        { ...(localPlaceId ? { localPlaceId } : {}), itemId, direction, quantity },
        dayOne,
      );

    it("pays 2 Credits a Stone from carried Inventory", async () => {
      const who = await trader();
      await give(who.character.id, ITEM_IDS.stone, 5);
      const sold = await sell(who, "sell", ITEM_IDS.stone, 3);
      expect(sold.trade).toMatchObject({ status: "traded", totalCredits: 6, credits: 106 });
      expect(await creditsOf(who.character.id)).toBe(106);
      expect(sold.state.carriedByItemId[ITEM_IDS.stone]).toBe(2);
    });

    it("refuses more Stone than is carried, changing nothing", async () => {
      const who = await trader();
      await give(who.character.id, ITEM_IDS.stone, 1);
      const refused = await sell(who, "sell", ITEM_IDS.stone, 2);
      expect(refused.trade).toMatchObject({ status: "refused", reason: "insufficient_items" });
      expect(await creditsOf(who.character.id)).toBe(100);
    });

    it("never sells Stone to the player and never buys or sells Boulder", async () => {
      const who = await trader();
      await give(who.character.id, ITEM_IDS.boulder, 1);
      expect((await sell(who, "buy", ITEM_IDS.stone, 1)).trade).toMatchObject({
        status: "refused",
        reason: "not_traded",
      });
      expect((await sell(who, "sell", ITEM_IDS.boulder, 1)).trade).toMatchObject({
        status: "refused",
        reason: "not_traded",
      });
      expect((await sell(who, "buy", ITEM_IDS.boulder, 1)).trade).toMatchObject({
        status: "refused",
        reason: "not_traded",
      });
      expect(await creditsOf(who.character.id)).toBe(100);
    });

    it("keeps the Thrust Issues gate for this character", async () => {
      const who = await trader({ thrust: false });
      await give(who.character.id, ITEM_IDS.stone, 1);
      const refused = await sell(who, "sell", ITEM_IDS.stone, 1);
      expect(refused.trade).toMatchObject({ status: "refused", reason: "merchant_locked" });
      expect(await creditsOf(who.character.id)).toBe(100);
    });

    it("is not offered by Toll's counter at Holo Hollow Landing", async () => {
      const who = await trader();
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollowLanding })
        .where(eq(rune.characters.id, who.character.id));
      await give(who.character.id, ITEM_IDS.stone, 1);
      const refused = await sell(who, "sell", ITEM_IDS.stone, 1, LOCAL_PLACE_IDS.lastLegTrading);
      expect(refused.trade).toMatchObject({ status: "refused", reason: "not_traded" });
      expect(await creditsOf(who.character.id)).toBe(100);
    });

    it("leaves the shared canister allowance and prices unchanged by a Stone sale", async () => {
      const who = await trader();
      await db
        .update(rune.characters)
        .set({ credits: 500 })
        .where(eq(rune.characters.id, who.character.id));
      await give(who.character.id, ITEM_IDS.stone, 5);
      await sell(who, "sell", ITEM_IDS.stone, 5);
      const bought = await sell(who, "buy", ITEM_IDS.emptySmallFuelCanister, 5);
      expect(bought.trade).toMatchObject({ status: "traded", totalCredits: 200 });
      const over = await sell(who, "buy", ITEM_IDS.emptySmallFuelCanister, 1);
      expect(over.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
    });

    it("does not oversell under concurrent requests", async () => {
      const who = await trader();
      await give(who.character.id, ITEM_IDS.stone, 5);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => sell(who, "sell", ITEM_IDS.stone, 3)),
      );
      const sold = results.filter((result) => result.trade.status === "traded");
      expect(sold).toHaveLength(1);
      expect(await creditsOf(who.character.id)).toBe(106);
    });
  });
});
