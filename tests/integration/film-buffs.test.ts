import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  practiceSectionXp,
  standardSkillLevelThresholds,
  workOrderSectionXp,
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
  THEATRE_FILM_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
  WORK_ORDER_IDS,
  type WorkOrderId,
} from "@/game/config/foundations";
import { getWorkOrder } from "@/game/content/work-orders";
import { getTheatreScreen } from "@/game/content/theatre";
import { BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import type { CleanPassOpportunity } from "@/game/domain/clean-pass";
import {
  applyMiningXpBonus,
  miningAwardFacts,
  secondaryFindRollSize,
  type MiningRandom,
} from "@/game/domain/mining";
import { showingAt } from "@/game/domain/theatre";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  systemAnnouncementsBy,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #491, slice 3 — the film buffs' effects against real PostgreSQL.
 *
 * Mining (That Mines Mine!): +5% added to worn gear, one blank-secondary bonus roll, one charge
 * per completed extraction attempt including failures. Welding (Rare or Weld Done?): +10% and one
 * charge per completed section of every kind of Welding, a successfully claimed Clean Pass section
 * included. What only the database proves: the charge is spent in the same transaction as the XP,
 * finds and run history it earned; offline batches run out partway exactly; retries and concurrent
 * resolutions spend once; a failure rolls the whole resolution back; and nothing a ticket sells is
 * reachable by players yet (the purchase is exercised here through the server command only).
 */
suite("issue #491 film buff effects (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let miningCommands: typeof import("@/server/mining-commands");
  let equipment: typeof import("@/server/equipment");
  let practiceCommands: typeof import("@/server/practice-commands");
  let repairCommands: typeof import("@/server/repair-commands");
  let workOrderCommands: typeof import("@/server/work-order-commands");
  let cleanPass: typeof import("@/server/clean-pass");
  let theatreCommands: typeof import("@/server/theatre-commands");
  const createdUsers: string[] = [];
  const finders: string[] = [];
  const balance = getEffectiveGameBalance();
  const jag = balance.mining.sources.ferriteShale;
  const thresholds = standardSkillLevelThresholds(balance);
  const miningStartXp = thresholds.find((entry) => entry.level === 1)!.totalXp;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = jag.attemptDurationTicks;
  const feet = { assignmentKind: "gear", suitSlotId: balance.carrying.feetSuitSlotId } as const;
  const hands = { assignmentKind: "gear", suitSlotId: balance.carrying.handsSuitSlotId } as const;
  const MINING = SKILL_IDS.mining;
  const WELDING = SKILL_IDS.welding;

  const sectionMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const start = new Date("2026-09-15T00:00:00.000Z");
  const at = (ms: number) => new Date(start.getTime() + ms);
  const practiceXp = practiceSectionXp(balance);
  const workOrderXp = workOrderSectionXp(balance);
  const repairXp = balance.welding.xpPerIncrement;
  const bonus = (base: number) => Math.ceil((base * 11_000) / 10_000);
  const MIXED_JOB = WORK_ORDER_IDS.tansyCutterHousing;
  const mixed = getWorkOrder(MIXED_JOB)!;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    miningCommands = await import("@/server/mining-commands");
    equipment = await import("@/server/equipment");
    practiceCommands = await import("@/server/practice-commands");
    repairCommands = await import("@/server/repair-commands");
    workOrderCommands = await import("@/server/work-order-commands");
    cleanPass = await import("@/server/clean-pass");
    theatreCommands = await import("@/server/theatre-commands");
  });

  afterEach(async () => {
    if (finders.length > 0)
      await db.delete(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));
    finders.splice(0);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  // ---------------------------------------------------------------- shared helpers

  async function grantBuff(characterId: string, skillId: string, remainingCharges: number) {
    await db
      .insert(rune.characterTheatreBuffs)
      .values({ characterId, skillId, remainingCharges, updatedAt: now })
      .onConflictDoUpdate({
        target: [rune.characterTheatreBuffs.characterId, rune.characterTheatreBuffs.skillId],
        set: { remainingCharges },
      });
  }

  /** The skill's remaining charges, or undefined when the character has no row at all. */
  async function buff(characterId: string, skillId: string) {
    const [row] = await db
      .select({ remaining: rune.characterTheatreBuffs.remainingCharges })
      .from(rune.characterTheatreBuffs)
      .where(
        and(
          eq(rune.characterTheatreBuffs.characterId, characterId),
          eq(rune.characterTheatreBuffs.skillId, skillId),
        ),
      );
    return row?.remaining;
  }

  async function skillXp(characterId: string, skillId: string) {
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

  async function injectFailure(table: string, characterId: string, label: string) {
    const trigger = `film_buff_${label}_${characterId.replaceAll("-", "_")}`.slice(0, 62);
    await db.execute(
      sql.raw(`
        CREATE FUNCTION ${trigger}() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated failure'; END;
        $$ LANGUAGE plpgsql
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW WHEN (NEW.character_id = '${characterId}')
        EXECUTE FUNCTION ${trigger}()
      `),
    );
    return async () => {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger}()`));
    };
  }

  // ---------------------------------------------------------------- Mining

  /** Scripted draws: basis points per attempt, a coin flip and the secondary table's one roll. */
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
  const jagTable = miningAwardFacts(balance, jag).secondaryFinds;
  const jagRollSize = secondaryFindRollSize(jagTable);
  const BLANK = jagRollSize - 1;
  const rollFor = (itemId: string) => {
    let startAt = 0;
    for (const entry of jagTable) {
      if (entry.itemId === itemId) return startAt;
      startAt += jagRollSize / entry.oneIn;
    }
    throw new Error(`${itemId} is not in the Jag table`);
  };
  const TOPAZ = rollFor(ITEM_IDS.uncutTopaz);
  const QUARTZ = rollFor(ITEM_IDS.uncutQuartz);
  const topazXp = jagTable.find((entry) => entry.itemId === ITEM_IDS.uncutTopaz)!.bonusXp;
  const quartzXp = jagTable.find((entry) => entry.itemId === ITEM_IDS.uncutQuartz)!.bonusXp;

  async function makeMiner() {
    const userId = await createTestUser(db, authSchema, "Film Miner");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Film${userId.slice(0, 5)}`,
    );
    finders.push(character.displayName);
    await play.getPlayGameplayState(userId, character.id, now, script());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }
  type Miner = Awaited<ReturnType<typeof makeMiner>>;

  async function wear(miner: Miner, pieces: readonly ("boots" | "gloves")[]) {
    for (const piece of pieces) {
      const [row] = await db
        .insert(rune.itemInstances)
        .values({
          characterId: miner.characterId,
          itemId: piece === "boots" ? ITEM_IDS.minersBoots : ITEM_IDS.minersGloves,
        })
        .returning({ id: rune.itemInstances.id });
      await equipment.changeEquipment(
        miner.userId,
        miner.characterId,
        { kind: "equip", itemInstanceId: row!.id, target: piece === "boots" ? feet : hands },
        now,
      );
    }
  }

  /** Start Mining at The Jag and resolve `attempts` whole attempts under the given draws. */
  async function mine(
    miner: Miner,
    attempts: number,
    draws: Parameters<typeof script>[0] = {},
    extraTicks = 0,
  ) {
    await miningCommands.startMining(miner.userId, miner.characterId, now, script());
    return play.getPlayGameplayState(
      miner.userId,
      miner.characterId,
      tick(now, ATTEMPT * attempts + extraTicks),
      script(draws),
    );
  }

  const miningAttempts = async (characterId: string) => {
    const [row] = await db
      .select()
      .from(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, characterId));
    return (row?.recentAttempts ?? []) as Record<string, unknown>[];
  };

  describe("Mining: That Mines Mine!", () => {
    it("pays +5%, rolls the bonus table on a blank first roll, and spends one charge, all in one commit", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 5);
      const state = await mine(miner, 1, { integers: [BLANK, QUARTZ] });

      const expectedXp = applyMiningXpBonus(jag.successXp + quartzXp, 500);
      expect(state.run).toMatchObject({ attempts: 1, successes: 1, xpGained: expectedXp });
      expect(await skillXp(miner.characterId, MINING)).toBe(miningStartXp + expectedXp);
      // The bonus roll's find is real: it is in the pack and in the run's items.
      expect(await carried(miner.characterId, ITEM_IDS.uncutQuartz)).toBe(1);
      expect(state.run?.itemsGained[ITEM_IDS.uncutQuartz]).toBe(1);
      expect(await buff(miner.characterId, MINING)).toBe(4);
      const [attempt] = await miningAttempts(miner.characterId);
      expect(attempt).toMatchObject({
        success: true,
        filmBuffed: true,
        filmBonusRoll: true,
        xpAwarded: expectedXp,
      });
    });

    it("makes no bonus roll when the first roll already found something", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 5);
      await mine(miner, 1, { integers: [QUARTZ, TOPAZ] });
      // Only the first roll's find: never a second item, never the second roll's.
      expect(await carried(miner.characterId, ITEM_IDS.uncutQuartz)).toBe(1);
      expect(await carried(miner.characterId, ITEM_IDS.uncutTopaz)).toBe(0);
      const [attempt] = await miningAttempts(miner.characterId);
      expect(attempt).toMatchObject({ filmBuffed: true, filmBonusRoll: false });
      expect(await buff(miner.characterId, MINING)).toBe(4);
    });

    it("stacks additively with both Legendary pieces and rounds once: 15 XP becomes 18", async () => {
      const miner = await makeMiner();
      await wear(miner, ["boots", "gloves"]);
      await grantBuff(miner.characterId, MINING, 3);
      const state = await mine(miner, 1);
      // Gear alone is +10% (17); with the film's +5% the sum is +15%: ceil(15 * 1.15) = 18.
      expect(state.run?.xpGained).toBe(18);
      expect(applyMiningXpBonus(jag.successXp, 1_000)).toBe(17);
      expect(await skillXp(miner.characterId, MINING)).toBe(miningStartXp + 18);
    });

    it("spends a charge on a failed extraction too, with no XP and no bonus roll", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 5);
      const state = await mine(miner, 1, { basisPoints: [9_999], integers: [TOPAZ] });
      expect(state.run).toMatchObject({ attempts: 1, successes: 0, xpGained: 0 });
      expect(await carried(miner.characterId, ITEM_IDS.uncutTopaz)).toBe(0);
      const [attempt] = await miningAttempts(miner.characterId);
      expect(attempt).toMatchObject({ success: false, filmBuffed: true, filmBonusRoll: false });
      expect(await buff(miner.characterId, MINING)).toBe(4);
    });

    it("runs out partway through an offline batch: buffed to the last charge, ordinary after, never negative", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 2);
      // Five attempts completed while away, resolved together on the next read.
      const state = await mine(miner, 5);
      expect(state.run?.attempts).toBe(5);
      const buffed = applyMiningXpBonus(jag.successXp, 500);
      expect(state.run?.xpGained).toBe(2 * buffed + 3 * jag.successXp);
      expect(await buff(miner.characterId, MINING)).toBe(0);
      const attempts = await miningAttempts(miner.characterId);
      expect(attempts.map((attempt) => attempt.filmBuffed)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    });

    it("spends nothing for an unfinished attempt, and exactly one when it completes", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 5);
      await miningCommands.startMining(miner.userId, miner.characterId, now, script());
      // Nine of ten ticks: the attempt has not completed.
      await play.getPlayGameplayState(
        miner.userId,
        miner.characterId,
        tick(now, ATTEMPT - 1),
        script(),
      );
      expect(await buff(miner.characterId, MINING)).toBe(5);
      expect(await skillXp(miner.characterId, MINING)).toBe(miningStartXp);
      // Stopping with the attempt unfinished spends nothing either.
      await miningCommands.stopMining(
        miner.userId,
        miner.characterId,
        tick(now, ATTEMPT - 1),
        script(),
      );
      expect(await buff(miner.characterId, MINING)).toBe(5);
    });

    it("spends once however many times the same window is read, retried or raced", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 10);
      await miningCommands.startMining(miner.userId, miner.characterId, now, script());
      const later = tick(now, ATTEMPT * 3);
      const reads = await Promise.all(
        Array.from({ length: 4 }, () =>
          play.getPlayGameplayState(miner.userId, miner.characterId, later, script()),
        ),
      );
      expect(reads.every((read) => read.run?.attempts === 3)).toBe(true);
      // A later retry of the very same instant finds nothing left to resolve.
      await play.getPlayGameplayState(miner.userId, miner.characterId, later, script());
      expect(await buff(miner.characterId, MINING)).toBe(7);
      expect(await skillXp(miner.characterId, MINING)).toBe(
        miningStartXp + 3 * applyMiningXpBonus(jag.successXp, 500),
      );
    });

    it("leaves a character with no buff row exactly as before, and never creates one", async () => {
      const miner = await makeMiner();
      const state = await mine(miner, 2);
      expect(state.run?.xpGained).toBe(2 * jag.successXp);
      expect(await buff(miner.characterId, MINING)).toBeUndefined();
      const [attempt] = await miningAttempts(miner.characterId);
      expect(attempt).toMatchObject({ filmBuffed: false, filmBonusRoll: false });
    });

    it("keeps the Welding buff out of Mining and the Mining buff out of Welding", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, WELDING, 10);
      const state = await mine(miner, 1);
      expect(state.run?.xpGained).toBe(jag.successXp);
      expect(await buff(miner.characterId, WELDING)).toBe(10);
    });

    it("announces a rare find from the bonus roll through the ordinary announcement path", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 1);
      await mine(miner, 1, { integers: [BLANK, TOPAZ] });
      expect(await carried(miner.characterId, ITEM_IDS.uncutTopaz)).toBe(1);
      const lines = await db
        .select()
        .from(rune.chatMessages)
        .where(systemAnnouncementsBy(rune, finders));
      // The Jag's Topaz is an announced find: one line, in the same transaction as the item.
      expect(lines).toHaveLength(1);
      expect(lines[0]!.body).toContain("Topaz");
    });

    it("rolls the whole resolution back, charge included, when a write part-way fails, and resolves once afterwards", async () => {
      const miner = await makeMiner();
      await grantBuff(miner.characterId, MINING, 5);
      await miningCommands.startMining(miner.userId, miner.characterId, now, script());
      const undo = await injectFailure("character_skill_xp", miner.characterId, "mining");
      try {
        await expect(
          play.getPlayGameplayState(
            miner.userId,
            miner.characterId,
            tick(now, ATTEMPT * 2),
            script(),
          ),
        ).rejects.toThrow();
        // Nothing of the resolution committed: not the charges, the XP, the items or the history.
        expect(await buff(miner.characterId, MINING)).toBe(5);
        expect(await skillXp(miner.characterId, MINING)).toBe(miningStartXp);
        expect(await miningAttempts(miner.characterId)).toEqual([]);
      } finally {
        await undo();
      }
      const state = await play.getPlayGameplayState(
        miner.userId,
        miner.characterId,
        tick(now, ATTEMPT * 2),
        script(),
      );
      expect(state.run?.attempts).toBe(2);
      expect(await buff(miner.characterId, MINING)).toBe(3);
    });

    it("is bought and spent end to end: a real ticket's 20 charges become 19 after one attempt", async () => {
      const miner = await makeMiner();
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoDriveIn, credits: 100 })
        .where(eq(rune.characters.id, miner.characterId));
      const screen = getTheatreScreen(THEATRE_SCREEN_IDS.main)!;
      const showing = showingAt(screen, now.getTime());
      // 2026-10-01T00:00Z is an even UTC hour: That Mines Mine!
      expect(showing.filmId).toBe(THEATRE_FILM_IDS.thatMinesMine);
      const bought = await theatreCommands.buyTheatreTicket(
        miner.userId,
        miner.characterId,
        { showingId: showing.showingId, tierId: THEATRE_TICKET_TIER_IDS.film },
        now,
      );
      expect(bought.purchase).toMatchObject({ status: "purchased", buff: { remainingAfter: 20 } });
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.theJag })
        .where(eq(rune.characters.id, miner.characterId));
      const state = await mine(miner, 1);
      expect(state.run?.xpGained).toBe(applyMiningXpBonus(jag.successXp, 500));
      expect(await buff(miner.characterId, MINING)).toBe(19);
    });
  });

  // ---------------------------------------------------------------- Welding

  async function apprentice(options: { accepted?: boolean; scrap?: number } = {}) {
    const userId = await createTestUser(db, authSchema, "Film Welder");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Weld ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, script());
    await db.insert(rune.characterMissions).values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
      ].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    if (options.accepted !== false) {
      await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandHours,
        NPC_IDS.wadeRusk,
        start,
        script(),
      );
    }
    if (options.scrap !== undefined) {
      await db
        .delete(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, character.id),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
          ),
        );
      for (let piece = 0; piece < options.scrap; piece += 1) {
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId: character.id, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
      }
    }
    return { userId, character };
  }

  const refresh = (userId: string, characterId: string, ms: number) =>
    play.getPlayGameplayState(userId, characterId, at(ms), script());

  const startPractice = (userId: string, characterId: string, ms = 0) =>
    practiceCommands.startPracticeWelding(userId, characterId, at(ms), script(), BOUNDED_RUN_MAX);

  const practiceRow = async (characterId: string) =>
    (
      await db
        .select()
        .from(rune.characterPracticeWelds)
        .where(eq(rune.characterPracticeWelds.characterId, characterId))
    )[0];

  /** An apprentice at the Crash Site with the Cargo Hold's materials installed, ready to weld. */
  async function repairBench() {
    const fixture = await apprentice({ accepted: false });
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, fixture.character.id));
    await db.insert(rune.characterRepairTargets).values({
      characterId: fixture.character.id,
      targetId: REPAIR_TARGET_IDS.cargoHold,
      materials: installedMaterials(balance.repairTargets.cargoHold),
    });
    return fixture;
  }
  const startRepair = (userId: string, characterId: string, ms = 0) =>
    repairCommands.startWelding(userId, characterId, REPAIR_TARGET_IDS.cargoHold, at(ms), script());
  const repairRow = async (characterId: string) =>
    (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.cargoHold),
          ),
        )
    )[0];

  /** An apprentice who finished 10,000 Hours with a seeded board and the mixed job accepted. */
  async function workOrderBench() {
    const userId = await createTestUser(db, authSchema, "Film Order");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Order ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, script());
    await db.insert(rune.characterMissions).values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    const level = balance.workOrders.requiredWeldingLevel;
    const totalXp = thresholds.find((threshold) => threshold.level === level)!.totalXp;
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId: character.id, skillId: WELDING, totalXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp },
      });
    await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandOneHours,
      NPC_IDS.wadeRusk,
      start,
      script(),
    );
    await db
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, character.id));
    const board: readonly WorkOrderId[] = [
      MIXED_JOB,
      WORK_ORDER_IDS.rennCarryFrame,
      WORK_ORDER_IDS.vossHeaterHousing,
    ];
    await db.insert(rune.characterWorkOrderPostings).values(
      board.map((workOrderId, slotIndex) => ({
        characterId: character.id,
        slotIndex,
        workOrderId,
        postedAt: start,
        updatedAt: start,
      })),
    );
    for (const material of mixed.materials) {
      let remaining = material.quantity;
      const limit = balance.items as unknown as Record<
        string,
        { itemId: string; stackLimit?: number }
      >;
      const definition = Object.values(limit).find((item) => item.itemId === material.itemId)!;
      while (remaining > 0) {
        const quantity = Math.min(remaining, definition.stackLimit ?? remaining);
        remaining -= quantity;
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId: character.id, itemId: material.itemId, quantity });
      }
    }
    await workOrderCommands.acceptWorkOrder(userId, character.id, MIXED_JOB, at(0), script());
    return { userId, character };
  }
  const activePosting = async (characterId: string) =>
    (
      await db
        .select()
        .from(rune.characterWorkOrderPostings)
        .where(eq(rune.characterWorkOrderPostings.characterId, characterId))
    ).find((row) => row.acceptedAt !== null);

  describe("Welding: Rare or Weld Done?", () => {
    it("pays 55 per completed repair section and spends one charge each", async () => {
      const { userId, character } = await repairBench();
      await grantBuff(character.id, WELDING, 10);
      await startRepair(userId, character.id);
      await refresh(userId, character.id, sectionMs * 4 + sectionMs - 1);
      expect((await repairRow(character.id))?.weldingProgress).toBe(4);
      expect(await skillXp(character.id, WELDING)).toBe(4 * bonus(repairXp));
      expect(bonus(repairXp)).toBe(55);
      expect(await buff(character.id, WELDING)).toBe(6);
    });

    it("runs out partway through a repair batch: the bonus to the last charge, ordinary XP after", async () => {
      const { userId, character } = await repairBench();
      await grantBuff(character.id, WELDING, 3);
      await startRepair(userId, character.id);
      await refresh(userId, character.id, sectionMs * 5);
      expect(await skillXp(character.id, WELDING)).toBe(3 * bonus(repairXp) + 2 * repairXp);
      expect(await buff(character.id, WELDING)).toBe(0);
      // The sections themselves are untouched by the buff: five were welded.
      expect((await repairRow(character.id))?.weldingProgress).toBe(5);
    });

    it("pays 11 per completed Practice section, in the weld's own record and the character's XP", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      await startPractice(userId, character.id);
      await refresh(userId, character.id, sectionMs * 4 + sectionMs - 1);
      expect(await skillXp(character.id, WELDING)).toBe(4 * bonus(practiceXp));
      expect(bonus(practiceXp)).toBe(11);
      expect(await buff(character.id, WELDING)).toBe(16);
      expect((await practiceRow(character.id))?.runXpGained).toBe(44);
    });

    it("runs out mid-weld in Practice, with the finished weld's XP showing exactly what it paid", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      const sections = balance.practiceWelding.sectionsPerWeld;
      await grantBuff(character.id, WELDING, 4);
      await startPractice(userId, character.id);
      await refresh(userId, character.id, sectionMs * sections);
      const row = await practiceRow(character.id);
      expect(row?.runWelds).toBe(1);
      const expected = 4 * bonus(practiceXp) + (sections - 4) * practiceXp;
      expect(await skillXp(character.id, WELDING)).toBe(expected);
      expect(row?.runXpGained).toBe(expected);
      expect((row?.recentWelds as { xpGained: number }[])[0]!.xpGained).toBe(expected);
      expect(await buff(character.id, WELDING)).toBe(0);
    });

    it("pays the Work Order share plus 10% per completed section and spends one charge each", async () => {
      const { userId, character } = await workOrderBench();
      await grantBuff(character.id, WELDING, 10);
      const xpBefore = await skillXp(character.id, WELDING);
      await workOrderCommands.startWorkOrderWelding(userId, character.id, at(0), script());
      await refresh(userId, character.id, sectionMs * 3 + sectionMs - 1);
      expect((await activePosting(character.id))?.sectionsCompleted).toBe(3);
      expect(await skillXp(character.id, WELDING)).toBe(xpBefore + 3 * bonus(workOrderXp));
      expect(await buff(character.id, WELDING)).toBe(7);
    });

    it("finishes a Work Order across the last charge, paying the job itself unchanged", async () => {
      const { userId, character } = await workOrderBench();
      await grantBuff(character.id, WELDING, 2);
      const creditsBefore = (
        await db
          .select({ credits: rune.characters.credits })
          .from(rune.characters)
          .where(eq(rune.characters.id, character.id))
      )[0]!.credits;
      const xpBefore = await skillXp(character.id, WELDING);
      await workOrderCommands.startWorkOrderWelding(userId, character.id, at(0), script());
      await refresh(userId, character.id, sectionMs * mixed.sections);
      expect(await activePosting(character.id)).toBeUndefined();
      expect(await skillXp(character.id, WELDING)).toBe(
        xpBefore + 2 * bonus(workOrderXp) + (mixed.sections - 2) * workOrderXp,
      );
      expect(await buff(character.id, WELDING)).toBe(0);
      // The film buff touches XP only: the customer's payout is exactly the job's.
      const creditsAfter = (
        await db
          .select({ credits: rune.characters.credits })
          .from(rune.characters)
          .where(eq(rune.characters.id, character.id))
      )[0]!.credits;
      expect(creditsAfter - creditsBefore).toBe(mixed.payoutCredits);
    });

    it("spends nothing and pays ordinary XP for a character with no Welding charges", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await startPractice(userId, character.id);
      await refresh(userId, character.id, sectionMs * 3);
      expect(await skillXp(character.id, WELDING)).toBe(3 * practiceXp);
      expect(await buff(character.id, WELDING)).toBeUndefined();
    });

    it("keeps the Mining buff out of Welding, and never spends a charge on a partial section", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, MINING, 10);
      await grantBuff(character.id, WELDING, 5);
      await startPractice(userId, character.id);
      await refresh(userId, character.id, sectionMs * 2 + sectionMs - 1);
      expect(await skillXp(character.id, WELDING)).toBe(2 * bonus(practiceXp));
      expect(await buff(character.id, WELDING)).toBe(3);
      expect(await buff(character.id, MINING)).toBe(10);
    });

    it("spends once however often the same window is read, retried or raced", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 10);
      await startPractice(userId, character.id);
      await Promise.all(
        Array.from({ length: 4 }, () => refresh(userId, character.id, sectionMs * 3)),
      );
      await refresh(userId, character.id, sectionMs * 3);
      expect(await buff(character.id, WELDING)).toBe(7);
      expect(await skillXp(character.id, WELDING)).toBe(3 * bonus(practiceXp));
    });

    it("rolls the whole resolution back, charge included, when a write part-way fails", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 10);
      await startPractice(userId, character.id);
      const undo = await injectFailure("character_skill_xp", character.id, "welding");
      try {
        await expect(refresh(userId, character.id, sectionMs * 3)).rejects.toThrow();
        expect(await buff(character.id, WELDING)).toBe(10);
        expect(await skillXp(character.id, WELDING)).toBe(0);
      } finally {
        await undo();
      }
      await refresh(userId, character.id, sectionMs * 3);
      expect(await buff(character.id, WELDING)).toBe(7);
    });
  });

  describe("Welding: Clean Pass", () => {
    const opportunityOf = (cleanPassJson: unknown) =>
      (cleanPassJson as CleanPassOpportunity[])[0]!.section;

    it("a claimed Practice section pays 11 and spends exactly one more charge", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      await startPractice(userId, character.id);
      const opportunity = opportunityOf((await practiceRow(character.id))!.cleanPass);
      const claimed = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(sectionMs * (opportunity - 1) + 100),
        script(),
      );
      expect(claimed.cleanPass).toEqual({ status: "claimed", awardedXp: bonus(practiceXp) });
      // The sections that resolved before the claim, plus the claimed one: one charge each.
      expect(await buff(character.id, WELDING)).toBe(20 - opportunity);
      expect(await skillXp(character.id, WELDING)).toBe(opportunity * bonus(practiceXp));
      expect((await practiceRow(character.id))?.sectionsCompleted).toBe(opportunity);
    });

    it("a claimed repair section pays 55, and a claimed Work Order section the share plus 10%", async () => {
      const repair = await repairBench();
      await grantBuff(repair.character.id, WELDING, 20);
      await startRepair(repair.userId, repair.character.id);
      const repairOpportunity = opportunityOf((await repairRow(repair.character.id))!.cleanPass);
      const repairClaim = await cleanPass.claimCleanPass(
        repair.userId,
        repair.character.id,
        at(sectionMs * (repairOpportunity - 1) + 100),
        script(),
      );
      expect(repairClaim.cleanPass).toEqual({ status: "claimed", awardedXp: bonus(repairXp) });
      expect(await buff(repair.character.id, WELDING)).toBe(20 - repairOpportunity);
      expect(await skillXp(repair.character.id, WELDING)).toBe(repairOpportunity * bonus(repairXp));

      const order = await workOrderBench();
      await grantBuff(order.character.id, WELDING, 20);
      const xpBefore = await skillXp(order.character.id, WELDING);
      await workOrderCommands.startWorkOrderWelding(
        order.userId,
        order.character.id,
        at(0),
        script(),
      );
      const posting = await activePosting(order.character.id);
      const orderOpportunity = opportunityOf(
        (posting!.cleanPass as { opportunities?: unknown })?.opportunities ?? posting!.cleanPass,
      );
      const orderClaim = await cleanPass.claimCleanPass(
        order.userId,
        order.character.id,
        at(sectionMs * (orderOpportunity - 1) + 100),
        script(),
      );
      expect(orderClaim.cleanPass).toEqual({ status: "claimed", awardedXp: bonus(workOrderXp) });
      expect(await buff(order.character.id, WELDING)).toBe(20 - orderOpportunity);
      expect(await skillXp(order.character.id, WELDING)).toBe(
        xpBefore + orderOpportunity * bonus(workOrderXp),
      );
    });

    it("spends the very last charge on the claimed section, and pays ordinary XP with none left", async () => {
      // Charges for exactly the resolved sections plus the claim: the claim takes the last one.
      const exact = await apprentice({ scrap: 2 });
      await startPractice(exact.userId, exact.character.id);
      const opportunity = opportunityOf((await practiceRow(exact.character.id))!.cleanPass);
      await grantBuff(exact.character.id, WELDING, opportunity);
      const last = await cleanPass.claimCleanPass(
        exact.userId,
        exact.character.id,
        at(sectionMs * (opportunity - 1) + 100),
        script(),
      );
      expect(last.cleanPass).toEqual({ status: "claimed", awardedXp: bonus(practiceXp) });
      expect(await buff(exact.character.id, WELDING)).toBe(0);

      // One charge short: the resolved sections use them all and the claimed section is ordinary.
      const short = await apprentice({ scrap: 2 });
      await startPractice(short.userId, short.character.id);
      await grantBuff(short.character.id, WELDING, opportunity - 1);
      const ordinary = await cleanPass.claimCleanPass(
        short.userId,
        short.character.id,
        at(sectionMs * (opportunity - 1) + 100),
        script(),
      );
      expect(ordinary.cleanPass).toEqual({ status: "claimed", awardedXp: practiceXp });
      expect(await buff(short.character.id, WELDING)).toBe(0);
      expect(await skillXp(short.character.id, WELDING)).toBe(
        (opportunity - 1) * bonus(practiceXp) + practiceXp,
      );
    });

    it("never spends a charge for a refused claim: none open, already claimed, or no Welding at all", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      // No Welding is happening: refused with nothing spent or paid.
      const idle = await cleanPass.claimCleanPass(userId, character.id, start, script());
      expect(idle.cleanPass).toMatchObject({ status: "refused", reason: "no_welding" });
      expect(await buff(character.id, WELDING)).toBe(20);

      await startPractice(userId, character.id);
      const opportunity = opportunityOf((await practiceRow(character.id))!.cleanPass);
      const claimAt = sectionMs * (opportunity - 1) + 100;
      await cleanPass.claimCleanPass(userId, character.id, at(claimAt), script());
      const afterFirst = await buff(character.id, WELDING);
      const xpAfterFirst = await skillXp(character.id, WELDING);
      // A second claim on the same opportunity is refused: no charge, no extra section, no XP.
      const again = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(claimAt + 50),
        script(),
      );
      expect(again.cleanPass).toMatchObject({ status: "refused" });
      expect(await buff(character.id, WELDING)).toBe(afterFirst);
      expect(await skillXp(character.id, WELDING)).toBe(xpAfterFirst);
    });

    it("an expired window grants no extra section, XP or charge: only the ordinarily welded sections spend any", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      await startPractice(userId, character.id);
      const opportunities = (await practiceRow(character.id))!.cleanPass as CleanPassOpportunity[];
      const [first, second] = [opportunities[0]!.section, opportunities[1]!.section];
      // The gap between the two windows: the first has long expired and the second has not
      // yet opened, so nothing can be claimed however late the player is.
      const gapMs = sectionMs * (second - 1) - 200;
      const completed = Math.floor(gapMs / sectionMs);
      expect(completed).toBeGreaterThan(first);
      const refused = await cleanPass.claimCleanPass(userId, character.id, at(gapMs), script());
      expect(refused.cleanPass).toMatchObject({ status: "refused" });
      // Exactly the ordinarily completed sections were charged and paid, and no claimed one.
      expect(await buff(character.id, WELDING)).toBe(20 - completed);
      expect(await skillXp(character.id, WELDING)).toBe(completed * bonus(practiceXp));
      expect((await practiceRow(character.id))?.sectionsCompleted).toBe(completed);
    });

    it("a window closed as missed by Stop spends nothing extra and a claim afterwards is refused", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      await startPractice(userId, character.id);
      const opportunity = opportunityOf((await practiceRow(character.id))!.cleanPass);
      // Stop while standing inside the opportunity's section.
      await practiceCommands.stopPracticeWelding(
        userId,
        character.id,
        at(sectionMs * (opportunity - 1) + 100),
        script(),
      );
      const completed = opportunity - 1;
      expect(await buff(character.id, WELDING)).toBe(20 - completed);
      const refused = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(sectionMs * (opportunity - 1) + 200),
        script(),
      );
      expect(refused.cleanPass).toMatchObject({ status: "refused", reason: "no_welding" });
      expect(await buff(character.id, WELDING)).toBe(20 - completed);
      expect(await skillXp(character.id, WELDING)).toBe(completed * bonus(practiceXp));
    });

    it("rolls a claim back whole when its XP write fails: the charge, the section and the XP all stay put", async () => {
      const { userId, character } = await apprentice({ scrap: 2 });
      await grantBuff(character.id, WELDING, 20);
      await startPractice(userId, character.id);
      const opportunity = opportunityOf((await practiceRow(character.id))!.cleanPass);
      const undo = await injectFailure("character_skill_xp", character.id, "claim");
      try {
        await expect(
          cleanPass.claimCleanPass(
            userId,
            character.id,
            at(sectionMs * (opportunity - 1) + 100),
            script(),
          ),
        ).rejects.toThrow();
        expect(await buff(character.id, WELDING)).toBe(20);
        expect((await practiceRow(character.id))?.sectionsCompleted).toBe(0);
      } finally {
        await undo();
      }
    });
  });

  describe("the exposure gate", () => {
    it("lets a character with no ticket and no buff play both skills exactly as before", async () => {
      const miner = await makeMiner();
      const state = await mine(miner, 1);
      expect(state.run?.xpGained).toBe(jag.successXp);
      const welder = await apprentice({ scrap: 2 });
      await startPractice(welder.userId, welder.character.id);
      await refresh(welder.userId, welder.character.id, sectionMs * 2);
      expect(await skillXp(welder.character.id, WELDING)).toBe(2 * practiceXp);
      const rows = await db
        .select()
        .from(rune.characterTheatreBuffs)
        .where(eq(rune.characterTheatreBuffs.characterId, welder.character.id));
      expect(rows).toEqual([]);
      expect(ACTION_IDS.practiceWelding).toBeDefined();
    });
  });
});
