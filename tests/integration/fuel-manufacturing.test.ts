import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import type { OverrideRandom } from "@/game/domain/manual-override";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
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
 * Issue #343 — fuel manufacturing against real PostgreSQL, through the same
 * commands the browser calls.
 *
 * What only the database proves: the level gates and the station are enforced
 * on the server; a Refining attempt's inputs, its returned shell and shale, its
 * Full canister and its XP commit as one transaction; lazy, offline and
 * concurrent settlement award each attempt exactly once; and a failed attempt
 * leaves exactly 5 shale and the same shell behind, never a duplicate, never
 * Slag. The two canisters are then ordinary tradable, stashable stacks.
 */
suite("issue #343 fuel manufacturing (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let refiningCommands: typeof import("@/server/refining-commands");
  let preferences: typeof import("@/server/character-preference-commands");
  let fabrication: typeof import("@/server/fabrication-commands");
  let trades: typeof import("@/server/player-trades");
  let stash: typeof import("@/server/site-stash");

  const createdUsers: string[] = [];
  const start = new Date("2026-10-11T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const thresholds = standardSkillLevelThresholds(balance);
  const refine = balance.refining.recipes.smallFuelCanister;
  const fabricate = balance.fabrication.recipes.emptySmallFuelCanister;
  const at = (tick: number) => new Date(start.getTime() + tick * GAME_TICK_MS);
  const SHALE = ITEM_IDS.oilShale;
  const EMPTY = ITEM_IDS.emptySmallFuelCanister;
  const FULL = ITEM_IDS.fullSmallFuelCanister;
  const STOCK = ITEM_IDS.galvanicStock;

  /** Every roll succeeds. */
  const succeeding = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  /** Every roll fails (the worst possible roll is still below a guaranteed 100%). */
  const failing = () => ({ nextBasisPoints: () => 9_999, nextUnit: () => 0 });
  /** Rolls in order — `true` succeeds — then keeps failing. */
  function script(...outcomes: boolean[]) {
    let index = 0;
    return {
      nextBasisPoints: () => (outcomes[index++] ? 0 : 9_999),
      nextUnit: () => 0,
    };
  }

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    refiningCommands = await import("@/server/refining-commands");
    preferences = await import("@/server/character-preference-commands");
    fabrication = await import("@/server/fabrication-commands");
    trades = await import("@/server/player-trades");
    stash = await import("@/server/site-stash");
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
   * A character at the given levels standing at `location` (the Processing Yard
   * unless said otherwise). One at Rusk Recovery is also past Tansy's
   * Fabrication chapter, so the station is theirs.
   */
  async function worker(
    label: string,
    options: { refining?: number; fabrication?: number; location?: LocationId } = {},
  ) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Fuel ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, succeeding());
    await db
      .update(rune.characters)
      .set({ currentLocationId: options.location ?? LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    if (options.location === LOCATION_IDS.ruskRecovery) {
      await db.insert(rune.characterMissions).values(
        CHAPTER.map((missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: start,
          completedAt: start,
        })),
      );
    }
    for (const [skillId, level] of [
      [SKILL_IDS.refining, options.refining ?? 1],
      [SKILL_IDS.fabrication, options.fabrication ?? 1],
    ] as const) {
      if (level > 1) await grantLevel(character.id, skillId, level);
    }
    return { userId, character };
  }

  async function grantLevel(characterId: string, skillId: string, level: number) {
    await db.transaction((transaction) =>
      progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId,
        awardedXp: thresholds.find((threshold) => threshold.level === level)!.totalXp,
        thresholds,
      }),
    );
  }

  /** Carry exactly these stack sizes of an item, replacing whatever was there. */
  async function setCarried(characterId: string, itemId: string, quantities: readonly number[]) {
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  /** `quantity` carried the way a player would carry it: full stacks, then the rest. */
  async function carry(characterId: string, itemId: string, quantity: number, limit: number) {
    const sizes: number[] = [];
    for (let left = quantity; left > 0; left -= limit) sizes.push(Math.min(limit, left));
    await setCarried(characterId, itemId, sizes);
  }

  async function stacksOf(characterId: string, itemId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.map((row) => row.quantity).sort((a, b) => b - a);
  }

  async function carried(characterId: string, itemId: string) {
    return (await stacksOf(characterId, itemId)).reduce((sum, quantity) => sum + quantity, 0);
  }

  /** The whole carried inventory by item, for exact before/after comparisons. */
  async function inventory(characterId: string) {
    const rows = await db
      .select({ itemId: rune.inventoryStacks.itemId, quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    const totals: Record<string, number> = {};
    for (const row of rows) totals[row.itemId] = (totals[row.itemId] ?? 0) + row.quantity;
    return totals;
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

  const levelXp = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;

  function startFuel(
    who: { userId: string; character: { id: string } },
    selection: number | typeof BOUNDED_RUN_MAX,
    random: ReturnType<typeof failing>,
    now = start,
  ) {
    return refiningCommands.startRefining(
      who.userId,
      who.character.id,
      ACTION_IDS.fullSmallFuelCanisterRefining,
      now,
      random,
      selection,
    );
  }

  const refreshAt = (
    who: { userId: string; character: { id: string } },
    tick: number,
    random: ReturnType<typeof failing>,
  ) => play.getPlayGameplayState(who.userId, who.character.id, at(tick), random);

  describe("Recipe A — Fabrication 8 at Rusk Recovery", () => {
    function startEmpty(
      who: { userId: string; character: { id: string } },
      selection: number | typeof BOUNDED_RUN_MAX,
      now = start,
      overrideRandom?: OverrideRandom,
    ) {
      return fabrication.startFabrication(
        who.userId,
        who.character.id,
        ACTION_IDS.emptySmallFuelCanisterFabrication,
        selection,
        now,
        succeeding(),
        overrideRandom,
      );
    }

    it("is locked at Fabrication 7 and spends nothing when refused", async () => {
      const who = await worker("Fab seven", {
        fabrication: 7,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(who.character.id, STOCK, 2, 5);
      const before = await inventory(who.character.id);
      const state = await startEmpty(who, 1);
      expect(state.fabricationError).toBe("fabrication_recipe_locked");
      expect(state.activeAction).toBeUndefined();
      expect(await inventory(who.character.id)).toEqual(before);
      expect(
        state.fabricationStation.recipes.find(
          (recipe) => recipe.actionId === ACTION_IDS.emptySmallFuelCanisterFabrication,
        ),
      ).toMatchObject({ unlocked: false, minimumLevel: 8, durationTicks: 30, baseXp: 75 });
    });

    it("turns 1 Galvanic Stock into 1 Empty canister in 30 ticks for 75 XP, needing no Refining", async () => {
      const who = await worker("Fab eight", {
        fabrication: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(who.character.id, STOCK, 2, 5);
      const started = await startEmpty(who, 2);
      expect(started.fabricationError).toBeUndefined();
      expect(started.refining.level).toBe(1);

      // 29 ticks in: the workpiece is still on the machine, inputs still reserved.
      const midway = await refreshAt(who, 29, succeeding());
      expect(midway.carriedByItemId[EMPTY] ?? 0).toBe(0);
      expect(await carried(who.character.id, STOCK)).toBe(2);

      const done = await refreshAt(who, 60, succeeding());
      expect(await carried(who.character.id, STOCK)).toBe(0);
      expect(await stacksOf(who.character.id, EMPTY)).toEqual([2]);
      expect(done.fabricationStation.run).toMatchObject({
        batches: 2,
        outputsGained: { [EMPTY]: 2 },
      });
      expect(await xp(who.character.id, SKILL_IDS.fabrication)).toBe(levelXp(8) + 150);
    });

    it("stacks canisters to five and refuses a batch with nowhere to put the canister", async () => {
      const who = await worker("Fab room", {
        fabrication: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      // A partly used Stock stack frees no slot; fill every other slot.
      await setCarried(who.character.id, STOCK, [3]);
      const free = (await refreshAt(who, 0, succeeding())).inventory.slotsAvailable;
      for (let index = 0; index < free; index += 1) {
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId: who.character.id, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
      }
      const refused = await startEmpty(who, 1);
      expect(refused.fabricationError).toBe("fabrication_no_room");
      expect(await carried(who.character.id, STOCK)).toBe(3);

      // A carried canister stack with room is room enough: they stack to five.
      // Swap one filler stack for a canister stack so the slot count is unchanged.
      const [filler] = await db
        .select({ id: rune.inventoryStacks.id })
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, who.character.id),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
          ),
        );
      await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.id, filler!.id));
      await setCarried(who.character.id, EMPTY, [4]);
      const ok = await startEmpty(who, 1);
      expect(ok.fabricationError).toBeUndefined();
      await refreshAt(who, 30, succeeding());
      expect(await stacksOf(who.character.id, EMPTY)).toEqual([5]);
      expect(await carried(who.character.id, STOCK)).toBe(2);
    });

    it("keeps Manual Override's risk: a locked safe push pays 1.20×, and a bust makes nothing", async () => {
      const lowest: OverrideRandom = { nextInt: () => 0 };
      const locked = await worker("Override lock", {
        fabrication: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(locked.character.id, STOCK, 1, 5);
      await fabrication.setManualOverride(locked.userId, locked.character.id, true, start);
      // Load 2, trend HIGHER; a Feed of 4 against a rolled 3 is a safe push.
      await startEmpty(locked, 1, start, lowest);
      await fabrication.pushFabricationOverride(
        locked.userId,
        locked.character.id,
        4,
        1,
        0,
        at(2),
        succeeding(),
        lowest,
      );
      const lockedState = await fabrication.lockInFabricationOverride(
        locked.userId,
        locked.character.id,
        1,
        at(3),
      );
      expect(lockedState.fabricationStation.workpiece?.override?.locked).toBe(true);
      // Locked in early, the workpiece still takes its ordinary 30 ticks.
      expect(await carried(locked.character.id, EMPTY)).toBe(0);
      await refreshAt(locked, fabricate.durationTicks, succeeding());
      expect(await stacksOf(locked.character.id, EMPTY)).toEqual([1]);
      expect(await carried(locked.character.id, STOCK)).toBe(0);
      expect(await xp(locked.character.id, SKILL_IDS.fabrication)).toBe(
        levelXp(8) + Math.floor((fabricate.baseXp * 12_000) / 10_000),
      );

      const busted = await worker("Override bust", {
        fabrication: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(busted.character.id, STOCK, 1, 5);
      await fabrication.setManualOverride(busted.userId, busted.character.id, true, start);
      await startEmpty(busted, 1, start, lowest);
      // The next Load rolls 3; a Feed of 10 is far outside the safe range: a bust.
      const pushed = await fabrication.pushFabricationOverride(
        busted.userId,
        busted.character.id,
        10,
        1,
        0,
        at(2),
        succeeding(),
        lowest,
      );
      expect(pushed.fabricationStation.run.recentWorkpieces.at(-1)).toMatchObject({
        result: "bust",
        xpAwarded: 0,
      });
      expect(await carried(busted.character.id, STOCK)).toBe(0);
      expect(await carried(busted.character.id, EMPTY)).toBe(0);
      expect(await xp(busted.character.id, SKILL_IDS.fabrication)).toBe(levelXp(8));
    });

    it("is refused away from Rusk Recovery", async () => {
      const who = await worker("Fab away", {
        fabrication: 8,
        location: LOCATION_IDS.abandonedProcessingYard,
      });
      await carry(who.character.id, STOCK, 1, 5);
      const state = await startEmpty(who, 1);
      expect(state.fabricationError).toBe("fabrication_unavailable_here");
      expect(await carried(who.character.id, STOCK)).toBe(1);
    });

    it("is not a Tinkering target: a carried canister offers no dismantling", async () => {
      const who = await worker("No tinker", {
        fabrication: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(who.character.id, EMPTY, 2, 5);
      const state = await refreshAt(who, 0, succeeding());
      const dismantlable = state.tinkering.targets.map((target) => target.itemId);
      expect(dismantlable).not.toContain(EMPTY);
      expect(dismantlable).not.toContain(FULL);
      // Carrying them makes no target carried or affordable.
      expect(state.tinkering.targets.every((target) => target.affordableBatches === 0)).toBe(true);
    });
  });

  describe("Recipe B — Refining 8 at the Abandoned Processing Yard", () => {
    it("is locked below Refining 8 whatever is carried, and spends nothing", async () => {
      const who = await worker("Ref seven", { refining: 7 });
      await carry(who.character.id, SHALE, 10, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      const before = await inventory(who.character.id);
      const state = await startFuel(who, 1, succeeding());
      expect(state.refiningError).toBe("refining_recipe_locked");
      expect(state.activeAction).toBeUndefined();
      expect(await inventory(who.character.id)).toEqual(before);
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(7));
      expect(
        state.refiningRecipes.find((recipe) => recipe.actionId === refine.actionId),
      ).toMatchObject({ unlocked: false, minimumLevel: 8, affordableBatches: 0 });
    });

    it("is refused at any other location, and without the canister or the shale", async () => {
      const away = await worker("Ref away", {
        refining: 8,
        location: LOCATION_IDS.ruskRecovery,
      });
      await carry(away.character.id, SHALE, 10, 5);
      await carry(away.character.id, EMPTY, 1, 5);
      const awayState = await startFuel(away, 1, succeeding());
      expect(awayState.activeAction).toBeUndefined();
      expect(await carried(away.character.id, SHALE)).toBe(10);

      const noShell = await worker("Ref no shell", { refining: 8 });
      await carry(noShell.character.id, SHALE, 20, 5);
      const noShellState = await startFuel(noShell, 1, succeeding());
      expect(noShellState.activeAction).toBeUndefined();
      expect(noShellState.stop).toMatchObject({
        activity: "refining",
        reason: "insufficient_inputs",
      });

      const noShale = await worker("Ref no shale", { refining: 8 });
      await carry(noShale.character.id, SHALE, 9, 5);
      await carry(noShale.character.id, EMPTY, 3, 5);
      const noShaleState = await startFuel(noShale, 1, succeeding());
      expect(noShaleState.activeAction).toBeUndefined();
      expect(await inventory(noShale.character.id)).toEqual({ [SHALE]: 9, [EMPTY]: 3 });
    });

    it("refuses a forged run size and does not shorten it", async () => {
      const who = await worker("Ref forged", { refining: 8 });
      await carry(who.character.id, SHALE, 20, 5);
      await carry(who.character.id, EMPTY, 3, 5);
      const state = await startFuel(who, 3, succeeding());
      expect(state.refiningError).toBe("refining_quantity_unavailable");
      expect(state.activeAction).toBeUndefined();
      expect(
        state.refiningRecipes.find((recipe) => recipe.actionId === refine.actionId)!
          .affordableBatches,
      ).toBe(2);
    });

    it("settles a success: 10 shale and the canister become one Full canister, 100 XP, nothing else", async () => {
      const who = await worker("Ref win", { refining: 8 });
      await carry(who.character.id, SHALE, 10, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      const started = await startFuel(who, 1, succeeding());
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.fullSmallFuelCanisterRefining);
      expect(
        started.refiningRecipes.find((recipe) => recipe.actionId === refine.actionId),
      ).toMatchObject({
        attemptDurationTicks: 60,
        successChanceBps: 5_068,
        successXp: 100,
        failureXp: 20,
      });

      // 59 ticks: nothing has resolved and nothing has been taken.
      const early = await refreshAt(who, 59, succeeding());
      expect(early.refiningRun.attempts).toBe(0);
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 10, [EMPTY]: 1 });

      const done = await refreshAt(who, 60, succeeding());
      expect(await inventory(who.character.id)).toEqual({ [FULL]: 1 });
      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        successes: 1,
        failures: 0,
        xpGained: 100,
        inputsConsumed: { [SHALE]: 10, [EMPTY]: 1 },
        outputsGained: { [FULL]: 1 },
        outputsDiscarded: {},
      });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 100);
      expect(done.stop).toEqual({ activity: "refining", reason: "run_completed" });
    });

    it("settles a failure: exactly 5 shale and the same canister come back, 20 XP, no Slag", async () => {
      const who = await worker("Ref lose", { refining: 8 });
      await carry(who.character.id, SHALE, 10, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      await startFuel(who, 1, failing());
      const done = await refreshAt(who, 60, failing());

      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 5, [EMPTY]: 1 });
      expect(await carried(who.character.id, FULL)).toBe(0);
      expect(await carried(who.character.id, ITEM_IDS.slag)).toBe(0);
      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        successes: 0,
        failures: 1,
        xpGained: 20,
        outputsGained: { [SHALE]: 5, [EMPTY]: 1 },
        outputsDiscarded: {},
      });
      expect(done.refiningRun.recentAttempts[0]).toMatchObject({
        success: false,
        xpAwarded: 20,
        durationTicks: 60,
        consumed: [
          { itemId: SHALE, quantity: 10 },
          { itemId: EMPTY, quantity: 1 },
        ],
        awarded: [
          { itemId: SHALE, quantity: 5 },
          { itemId: EMPTY, quantity: 1 },
        ],
      });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 20);
    });

    it("returns the canister again and again: repeated failures and a retry never duplicate or lose it", async () => {
      const who = await worker("Ref repeat", { refining: 8 });
      // 30 shale and one shell: fail, fail, fail, then win with what is left.
      await carry(who.character.id, SHALE, 30, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      await startFuel(who, BOUNDED_RUN_MAX, script(false, false, false, true));
      // Offline: far past the end of every attempt, resolved in one window.
      const done = await refreshAt(who, 60 * 20, script(false, false, false, true));

      // 30 → 25 → 20 → 15 → (10 spent) 5 shale; the one shell became the one canister.
      expect(done.refiningRun).toMatchObject({
        attempts: 4,
        successes: 1,
        failures: 3,
        xpGained: 3 * 20 + 100,
      });
      // A fifth attempt could not start: the shell is gone into the canister.
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 5, [FULL]: 1 });
      expect(done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 160);
      // No stray or duplicate stack was left behind by the returns.
      expect(await stacksOf(who.character.id, SHALE)).toEqual([5]);
      expect(await stacksOf(who.character.id, FULL)).toEqual([1]);
    });

    it("runs a bounded number of batches, counting failures, with several shells", async () => {
      const who = await worker("Ref count", { refining: 8 });
      await carry(who.character.id, SHALE, 30, 5);
      await carry(who.character.id, EMPTY, 3, 5);
      await startFuel(who, 2, script(false, true));
      const done = await refreshAt(who, 60 * 10, script(false, true));
      expect(done.refiningRun).toMatchObject({
        selection: 2,
        attempts: 2,
        successes: 1,
        failures: 1,
      });
      expect(done.stop).toMatchObject({ activity: "refining", reason: "run_completed" });
      // 30 − 5 lost (failure) − 10 (success) = 15; 3 shells − 1 used = 2; 1 Full.
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 15, [EMPTY]: 2, [FULL]: 1 });
    });

    it("stacks Full canisters two to a stack, and keeps going on a full inventory", async () => {
      const who = await worker("Ref stacks", { refining: 30 });
      await carry(who.character.id, SHALE, 30, 5);
      await carry(who.character.id, EMPTY, 3, 5);
      // Fill every other slot so only what the attempts free is available.
      const slots = (await refreshAt(who, 0, succeeding())).inventory.slotsAvailable;
      for (let index = 0; index < slots; index += 1) {
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId: who.character.id, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
      }
      expect((await refreshAt(who, 0, succeeding())).inventory.slotsAvailable).toBe(0);
      const started = await startFuel(who, BOUNDED_RUN_MAX, succeeding());
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.fullSmallFuelCanisterRefining);
      const done = await refreshAt(who, 60 * 10, succeeding());
      expect(done.refiningRun).toMatchObject({ attempts: 3, successes: 3, xpGained: 300 });
      expect(await stacksOf(who.character.id, FULL)).toEqual([2, 1]);
      expect(await carried(who.character.id, SHALE)).toBe(0);
      expect(await carried(who.character.id, EMPTY)).toBe(0);
    });

    it("never lets Auto-discard Slag take the returned canister or shale", async () => {
      const who = await worker("Ref discard", { refining: 8 });
      await preferences.setAutoDiscardSlagPreference(
        who.userId,
        who.character.id,
        true,
        start,
        failing(),
      );
      await carry(who.character.id, SHALE, 10, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      await startFuel(who, 1, failing());
      const done = await refreshAt(who, 60, failing());
      expect(done.refiningRun.outputsDiscarded).toEqual({});
      expect(done.refiningRun.recentAttempts[0]?.discarded).toBeUndefined();
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 5, [EMPTY]: 1 });
    });

    it("awards each attempt exactly once across refreshes, retries and concurrent settlement", async () => {
      const who = await worker("Ref once", { refining: 8 });
      await carry(who.character.id, SHALE, 20, 5);
      await carry(who.character.id, EMPTY, 2, 5);
      await startFuel(who, BOUNDED_RUN_MAX, script(false, true));
      // A retried Start of the run already under way changes nothing.
      const again = await startFuel(who, BOUNDED_RUN_MAX, script(false, true));
      expect(again.activeAction?.actionId).toBe(ACTION_IDS.fullSmallFuelCanisterRefining);

      // The same instant, two callers at once: one settlement, one set of awards.
      await Promise.all([
        refreshAt(who, 60 * 3, script(false, true)),
        refreshAt(who, 60 * 3, script(false, true)),
      ]);
      const settled = await inventory(who.character.id);
      // Fail (20→15 shale, shell back), win (15→5 shale, shell used): 5 shale,
      // 1 shell, 1 canister, then a third attempt needs 10 shale: stopped.
      expect(settled).toEqual({ [SHALE]: 5, [EMPTY]: 1, [FULL]: 1 });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 120);

      // A later refresh, and one with an earlier clock, award nothing more.
      await refreshAt(who, 60 * 9, script(true, true, true));
      await refreshAt(who, 60 * 2, script(true, true, true));
      expect(await inventory(who.character.id)).toEqual(settled);
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 120);
    });

    it("settles only completed attempts when Travel begins mid-attempt", async () => {
      const who = await worker("Ref travel", { refining: 8 });
      await carry(who.character.id, SHALE, 30, 5);
      await carry(who.character.id, EMPTY, 3, 5);
      await startFuel(who, BOUNDED_RUN_MAX, script(false, true, true));
      // One attempt is done at tick 60; the second is 30 ticks in at tick 90.
      const traveling = await play.beginTravel(
        who.userId,
        who.character.id,
        LOCATION_IDS.crashSite,
        at(90),
        script(false, true, true),
      );
      expect(traveling.commandError).toBeUndefined();
      // The one failed attempt: 5 lost, shell returned. The partial one took nothing.
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 25, [EMPTY]: 3 });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8) + 20);
    });

    it("stops without spending anything on the attempt under way", async () => {
      const who = await worker("Ref stop", { refining: 8 });
      await carry(who.character.id, SHALE, 10, 5);
      await carry(who.character.id, EMPTY, 1, 5);
      await startFuel(who, 1, succeeding());
      const stopped = await refiningCommands.stopRefining(
        who.userId,
        who.character.id,
        at(40),
        succeeding(),
      );
      expect(stopped.activeAction).toBeUndefined();
      expect(await inventory(who.character.id)).toEqual({ [SHALE]: 10, [EMPTY]: 1 });
      expect(await xp(who.character.id, SKILL_IDS.refining)).toBe(levelXp(8));
    });

    it("cannot run beside another activity: one active action at a time", async () => {
      const who = await worker("Ref one", { refining: 8 });
      await carry(who.character.id, SHALE, 20, 5);
      await carry(who.character.id, EMPTY, 2, 5);
      await startFuel(who, 1, succeeding());
      const second = await refiningCommands.startRefining(
        who.userId,
        who.character.id,
        ACTION_IDS.refining,
        at(1),
        succeeding(),
        1,
      );
      expect(second.activeAction?.actionId).toBe(ACTION_IDS.fullSmallFuelCanisterRefining);
    });

    it("leaves the existing Galvaferrite recipe's own failure shape alone", async () => {
      const who = await worker("Ref galva", { refining: 8 });
      await carry(who.character.id, ITEM_IDS.refinedFerrite, 1, 5);
      await carry(who.character.id, STOCK, 1, 5);
      await refiningCommands.startRefining(
        who.userId,
        who.character.id,
        ACTION_IDS.galvaferriteRefining,
        start,
        failing(),
        1,
      );
      const done = await refreshAt(
        who,
        balance.refining.recipes.galvaferrite.attemptDurationTicks,
        failing(),
      );
      expect(done.refiningRun).toMatchObject({ failures: 1, xpGained: 7 });
      // Exactly one of the two inputs came back.
      const left = await inventory(who.character.id);
      expect(Object.values(left)).toEqual([1]);
    });
  });

  describe("two ordinary stackable items", () => {
    type Player = { userId: string; character: { id: string } };

    function ok(result: TradeCommandResult): TradeStateView {
      if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
      return result.state;
    }

    it("trade between players like any other stack, with no special case", async () => {
      const a: Player = await worker("Trade A", { location: LOCATION_IDS.ruskRecovery });
      const b: Player = await worker("Trade B", { location: LOCATION_IDS.ruskRecovery });
      await carry(a.character.id, FULL, 2, 2);
      await carry(a.character.id, EMPTY, 5, 5);
      const now = new Date("2026-10-11T12:00:00.000Z");
      const sent = ok(
        await trades.createTradeRequest(
          a.userId,
          a.character.id,
          { characterId: b.character.id },
          now,
        ),
      );
      const session = ok(
        await trades.acceptTradeRequest(b.userId, b.character.id, sent.outgoing!.id, now),
      ).session!.id;
      const version = async () => {
        const [row] = await db
          .select({ offerVersion: rune.playerTradeSessions.offerVersion })
          .from(rune.playerTradeSessions)
          .where(eq(rune.playerTradeSessions.id, session));
        return row!.offerVersion;
      };
      ok(
        await trades.addTradeOfferStack(
          a.userId,
          a.character.id,
          session,
          await version(),
          FULL,
          2,
          now,
        ),
      );
      ok(
        await trades.addTradeOfferStack(
          a.userId,
          a.character.id,
          session,
          await version(),
          EMPTY,
          3,
          now,
        ),
      );
      for (const who of [a, b]) {
        ok(
          await trades.readyTradeOffer(who.userId, who.character.id, session, await version(), now),
        );
      }
      ok(await trades.confirmTrade(a.userId, a.character.id, session, await version(), now));
      ok(await trades.confirmTrade(b.userId, b.character.id, session, await version(), now));

      expect(await inventory(a.character.id)).toEqual({ [EMPTY]: 2 });
      expect(await inventory(b.character.id)).toEqual({ [FULL]: 2, [EMPTY]: 3 });
      expect(await stacksOf(b.character.id, FULL)).toEqual([2]);
    });

    it("stash at an installed site stash and come back whole", async () => {
      const who = await worker("Stash", { location: LOCATION_IDS.theJag });
      await seedRepairTarget(db, rune, who.character.id, REPAIR_TARGET_IDS.siteStashTheJag, {
        materials: installedMaterials(
          balance.repairTargets.siteStashTheJag as Parameters<typeof installedMaterials>[0],
        ),
        weldingProgress: balance.repairTargets.siteStashTheJag.repairIncrements,
        completedAt: start,
        updatedAt: start,
      });
      const [container] = await db
        .insert(rune.itemInstances)
        .values({ characterId: who.character.id, itemId: ITEM_IDS.scrapBox })
        .returning();
      await stash.installSiteStashContainer(
        who.userId,
        who.character.id,
        { locationId: LOCATION_IDS.theJag, itemInstanceId: container!.id },
        start,
        succeeding(),
      );
      await carry(who.character.id, FULL, 2, 2);
      await carry(who.character.id, EMPTY, 3, 5);
      const stackIds = await db
        .select({
          id: rune.inventoryStacks.id,
          itemId: rune.inventoryStacks.itemId,
          quantity: rune.inventoryStacks.quantity,
        })
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.character.id));
      for (const stack of stackIds.filter((row) => [FULL, EMPTY].includes(row.itemId as never))) {
        const stored = await stash.depositSiteStashStack(
          who.userId,
          who.character.id,
          {
            locationId: LOCATION_IDS.theJag,
            stackId: stack.id,
            mode: "stack",
            expectedQuantity: stack.quantity,
          },
          start,
          succeeding(),
        );
        expect(stored.stash).toMatchObject({ status: "committed" });
      }
      expect(await carried(who.character.id, FULL)).toBe(0);
      expect(await carried(who.character.id, EMPTY)).toBe(0);
      const stored = await db
        .select()
        .from(rune.siteStashStacks)
        .where(eq(rune.siteStashStacks.characterId, who.character.id));
      expect(Object.fromEntries(stored.map((row) => [row.itemId, row.quantity]))).toEqual({
        [FULL]: 2,
        [EMPTY]: 3,
      });
    });
  });
});
