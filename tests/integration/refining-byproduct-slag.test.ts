import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  ITEM_IDS,
  LOCATION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #256 — failure Slag is optional inventory, and Auto-discard Slag is one
 * character-wide preference.
 *
 * Real PostgreSQL, through the same commands the browser calls: the preference
 * is written by the shared command, read back through the shared projection,
 * and applied by the Refining resolver inside its own transaction.
 */
suite("issue #256 Refining byproduct Slag (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let refiningCommands: typeof import("@/server/refining-commands");
  let preferenceCommands: typeof import("@/server/character-preference-commands");
  let progression: typeof import("@/server/progression");

  const createdUsers: string[] = [];
  const start = new Date("2026-09-20T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const tickMs = 600;
  const at = (ticks: number) => new Date(start.getTime() + ticks * tickMs);
  const failing = () => ({ nextBasisPoints: () => 9_999, nextUnit: () => 0 });
  const succeeding = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    refiningCommands = await import("@/server/refining-commands");
    preferenceCommands = await import("@/server/character-preference-commands");
    progression = await import("@/server/progression");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function refiner(level = 1) {
    const userId = await createTestUser(db, authSchema, "Slag Refiner");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Slag ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, succeeding());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    if (level > 1) {
      const threshold = standardSkillLevelThresholds(balance).find(
        (candidate) => candidate.level === level,
      )!;
      await db.transaction((transaction) =>
        progression.grantCharacterSkillXp(transaction, {
          characterId: character.id,
          skillId: SKILL_IDS.refining,
          awardedXp: threshold.totalXp,
          thresholds: standardSkillLevelThresholds(balance),
        }),
      );
    }
    return { userId, character };
  }

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

  /** Fill every free slot with stackable filler, so nothing new can be carried. */
  async function fillEveryFreeSlot(userId: string, characterId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, start, succeeding());
    const free = state.inventory.slotsAvailable;
    for (let index = 0; index < free; index += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
    }
    const full = await play.getPlayGameplayState(userId, characterId, start, succeeding());
    expect(full.inventory.slotsAvailable).toBe(0);
  }

  function startRecipe(
    userId: string,
    characterId: string,
    actionId: string,
    selection: number | typeof BOUNDED_RUN_MAX,
    random: ReturnType<typeof failing>,
  ) {
    return refiningCommands.startRefining(userId, characterId, actionId, start, random, selection);
  }

  describe("the shared preference", () => {
    it("defaults Off and is written by one command whatever the surface", async () => {
      const { userId, character } = await refiner();
      const initial = await play.getPlayGameplayState(userId, character.id, start, succeeding());
      expect(initial.autoDiscardSlag).toBe(false);

      // No Practice Welding, no Refining recipe unlocked: still a valid character setting.
      const on = await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        true,
        at(1),
        succeeding(),
      );
      expect(on.autoDiscardSlag).toBe(true);
      const row = await db
        .select({ autoDiscardSlag: rune.characters.autoDiscardSlag })
        .from(rune.characters)
        .where(eq(rune.characters.id, character.id));
      expect(row[0]?.autoDiscardSlag).toBe(true);

      const reread = await play.getPlayGameplayState(userId, character.id, at(2), succeeding());
      expect(reread.autoDiscardSlag).toBe(true);

      const off = await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        false,
        at(3),
        succeeding(),
      );
      expect(off.autoDiscardSlag).toBe(false);
    });

    it("never crosses characters", async () => {
      const first = await refiner();
      const second = await refiner();
      await preferenceCommands.setAutoDiscardSlagPreference(
        first.userId,
        first.character.id,
        true,
        at(1),
        succeeding(),
      );
      const other = await play.getPlayGameplayState(
        second.userId,
        second.character.id,
        at(2),
        succeeding(),
      );
      expect(other.autoDiscardSlag).toBe(false);
    });

    it("refuses another player's character", async () => {
      const owner = await refiner();
      const stranger = await refiner();
      await expect(
        preferenceCommands.setAutoDiscardSlagPreference(
          stranger.userId,
          owner.character.id,
          true,
          at(1),
          succeeding(),
        ),
      ).rejects.toThrow();
      const state = await play.getPlayGameplayState(
        owner.userId,
        owner.character.id,
        at(2),
        succeeding(),
      );
      expect(state.autoDiscardSlag).toBe(false);
    });
  });

  describe("a failed Refined Ferrite attempt", () => {
    it("starts and completes with no room for its Slag, discarding the overflow", async () => {
      const { userId, character } = await refiner();
      // A partial Refined Ferrite stack, so a success would still fit; every
      // other slot is taken and 3 shale frees none, so the Slag has no room.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [3]);
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      await fillEveryFreeSlot(userId, character.id);

      const started = await startRecipe(
        userId,
        character.id,
        ACTION_IDS.refining,
        BOUNDED_RUN_MAX,
        failing(),
      );
      expect(started.refiningError).toBeUndefined();
      expect(started.stop).toBeUndefined();
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.refining);

      const done = await play.getPlayGameplayState(userId, character.id, at(7), failing());
      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        failures: 1,
        xpGained: 3,
        outputsGained: {},
        outputsDiscarded: { [ITEM_IDS.slag]: 1 },
      });
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(1);
      expect(done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
    });

    it("keeps Slag when it fits (Off) and reports nothing discarded", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [4]);
      await startRecipe(userId, character.id, ACTION_IDS.refining, 1, failing());
      const done = await play.getPlayGameplayState(userId, character.id, at(7), failing());
      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        failures: 1,
        xpGained: 3,
        outputsGained: { [ITEM_IDS.slag]: 1 },
        outputsDiscarded: {},
      });
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(1);
      expect(done.refiningRun.recentAttempts[0]?.discarded).toBeUndefined();
    });

    it("discards all of it with Auto-discard On, and nothing else changes", async () => {
      const { userId, character } = await refiner();
      await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        true,
        start,
        failing(),
      );
      await setCarried(character.id, ITEM_IDS.ferriteShale, [4]);
      await startRecipe(userId, character.id, ACTION_IDS.refining, 1, failing());
      const done = await play.getPlayGameplayState(userId, character.id, at(7), failing());

      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        successes: 0,
        failures: 1,
        xpGained: 3,
        inputsConsumed: { [ITEM_IDS.ferriteShale]: 2 },
        outputsGained: {},
        outputsDiscarded: { [ITEM_IDS.slag]: 1 },
      });
      expect(done.refiningRun.recentAttempts[0]).toMatchObject({
        success: false,
        awarded: [],
        discarded: [{ itemId: ITEM_IDS.slag, quantity: 1 }],
        consumed: [{ itemId: ITEM_IDS.ferriteShale, quantity: 2 }],
        xpAwarded: 3,
      });
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(2);
      expect(done.refining.totalXp).toBe(3);
      expect(done.stop).toEqual({ activity: "refining", reason: "run_completed" });
    });

    it("applies the preference at resolution, so a toggle mid-run affects later attempts only", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      await startRecipe(userId, character.id, ACTION_IDS.refining, 4, failing());

      // Two attempts resolve under Off (the toggle command resolves due work first).
      await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        true,
        at(14),
        failing(),
      );
      const done = await play.getPlayGameplayState(userId, character.id, at(28), failing());
      expect(done.refiningRun).toMatchObject({
        attempts: 4,
        failures: 4,
        outputsGained: { [ITEM_IDS.slag]: 2 },
        outputsDiscarded: { [ITEM_IDS.slag]: 2 },
      });
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(2);
    });

    it("a Max run is not stopped by Slag alone and still counts every failure", async () => {
      const { userId, character } = await refiner();
      // Two Shale stacks keep the run going; every free slot is taken, so no
      // failure's Slag has anywhere to go until a shale stack empties.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      await fillEveryFreeSlot(userId, character.id);
      await startRecipe(userId, character.id, ACTION_IDS.refining, BOUNDED_RUN_MAX, failing());
      const done = await play.getPlayGameplayState(userId, character.id, at(7 * 6), failing());
      expect(done.refiningRun.attempts).toBe(5);
      expect(done.refiningRun.failures).toBe(5);
      expect(done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
      const discarded = done.refiningRun.outputsDiscarded[ITEM_IDS.slag] ?? 0;
      const kept = done.refiningRun.outputsGained[ITEM_IDS.slag] ?? 0;
      expect(kept + discarded).toBe(5);
      expect(discarded).toBeGreaterThan(0);
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(kept);
    });

    it("a successful product still needs ordinary room", async () => {
      const { userId, character } = await refiner();
      // One more shale than a batch, no free slot and no partial Refined Ferrite
      // stack: the product would have nowhere to go, so the attempt is refused.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [3]);
      await fillEveryFreeSlot(userId, character.id);
      const refused = await startRecipe(userId, character.id, ACTION_IDS.refining, 1, succeeding());
      expect(refused.activeAction).toBeUndefined();
      expect(refused.refiningRecentResult.successes).toBe(0);
      expect(refused.stop).toMatchObject({ activity: "refining", reason: "inventory_slots_full" });
    });
  });

  describe("a failed Galvanic Stock attempt", () => {
    it("keeps what fits and discards only the overflow, still completing", async () => {
      const { userId, character } = await refiner(5);
      // 3 Galvanite frees no slot; a partial Galvanic Stock stack lets a success
      // fit; the Slag stack has room for exactly one more.
      await setCarried(character.id, ITEM_IDS.galvanite, [3]);
      await setCarried(character.id, ITEM_IDS.galvanicStock, [4]);
      await setCarried(character.id, ITEM_IDS.slag, [9]);
      await fillEveryFreeSlot(userId, character.id);
      await startRecipe(userId, character.id, ACTION_IDS.galvanicStockRefining, 1, failing());
      const done = await play.getPlayGameplayState(userId, character.id, at(10), failing());

      expect(done.refiningRun).toMatchObject({
        attempts: 1,
        failures: 1,
        xpGained: 5,
        outputsGained: { [ITEM_IDS.slag]: 1 },
        outputsDiscarded: { [ITEM_IDS.slag]: 1 },
      });
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(10);
      expect(await carried(character.id, ITEM_IDS.galvanite)).toBe(1);
    });
  });

  describe("what the preference must not touch", () => {
    it("never discards a Galvaferrite failure's returned input", async () => {
      const { userId, character } = await refiner(8);
      await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        true,
        start,
        failing(),
      );
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [1]);
      await setCarried(character.id, ITEM_IDS.galvanicStock, [1]);
      await startRecipe(userId, character.id, ACTION_IDS.galvaferriteRefining, 1, failing());
      const done = await play.getPlayGameplayState(userId, character.id, at(12), failing());

      expect(done.refiningRun).toMatchObject({ attempts: 1, failures: 1, xpGained: 7 });
      expect(done.refiningRun.outputsDiscarded).toEqual({});
      const returned = done.refiningRun.recentAttempts[0]?.awarded ?? [];
      expect(returned).toHaveLength(1);
      expect(await carried(character.id, returned[0]!.itemId)).toBe(1);
      expect(done.refiningRun.recentAttempts[0]?.discarded).toBeUndefined();
    });

    it("never discards a deliberate Slag recipe's output", async () => {
      const cases = [
        { actionId: ACTION_IDS.ferriteShaleSlagRefining, input: ITEM_IDS.ferriteShale, slag: 3 },
        { actionId: ACTION_IDS.galvaniteSlagRefining, input: ITEM_IDS.galvanite, slag: 6 },
      ];
      for (const { actionId, input, slag } of cases) {
        const { userId, character } = await refiner(5);
        await preferenceCommands.setAutoDiscardSlagPreference(
          userId,
          character.id,
          true,
          start,
          failing(),
        );
        await setCarried(character.id, input, [6]);
        await startRecipe(userId, character.id, actionId, 3, failing());
        const done = await play.getPlayGameplayState(userId, character.id, at(30), failing());
        expect(done.refiningRun).toMatchObject({ attempts: 3, successes: 3, failures: 0 });
        expect(done.refiningRun.outputsDiscarded).toEqual({});
        expect(await carried(character.id, ITEM_IDS.slag)).toBe(slag);
      }
    });

    it("still requires room for a deliberate Slag recipe's output", async () => {
      const { userId, character } = await refiner(5);
      await preferenceCommands.setAutoDiscardSlagPreference(
        userId,
        character.id,
        true,
        start,
        failing(),
      );
      // One shale more than a batch frees no slot, and there is no Slag stack.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [3]);
      await fillEveryFreeSlot(userId, character.id);
      const refused = await startRecipe(
        userId,
        character.id,
        ACTION_IDS.ferriteShaleSlagRefining,
        1,
        failing(),
      );
      expect(refused.activeAction).toBeUndefined();
      expect(refused.stop).toMatchObject({ activity: "refining", reason: "inventory_slots_full" });
    });
  });
});
