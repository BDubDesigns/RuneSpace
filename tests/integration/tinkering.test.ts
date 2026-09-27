import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #232 — Tinkering against real PostgreSQL: the committed-batch cycle,
 * exact Tier-1 recovery / XP / duration, Auto-discard Scrap, Stop / Resume /
 * Finish Current, the shared numeric and Max selection, and the first-alpha
 * last-Cutter guard across equipped gear, Inventory and the Cargo Hold.
 */
suite("issue #232 Tinkering (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let commands: typeof import("@/server/tinkering-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-20T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const recipes = balance.fabrication.recipes;
  const ticks = (count: number) => count * GAME_TICK_MS;
  const at = (ms: number) => new Date(start.getTime() + ms);
  const tinkerTicks = (recipe: { durationTicks: number }) => recipe.durationTicks * 2;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    commands = await import("@/server/tinkering-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  /** At Rusk Recovery with Return the Favor complete; the legacy Cutter equipped. */
  async function bench(label: string, options: { unlocked?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Tink ${userId.slice(0, 6)}`,
    );
    await play.getPlayGameplayState(userId, character.id, start, certain());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    const done = [
      MISSION_IDS.walkItOff,
      MISSION_IDS.cutYourTeeth,
      MISSION_IDS.wasteNot,
      MISSION_IDS.holdItTogether,
      MISSION_IDS.keepTheChange,
      MISSION_IDS.tenThousandHours,
    ];
    await db.insert(rune.characterMissions).values(
      done.map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: MISSION_IDS.returnTheFavor,
      acceptedAt: start,
      completedAt: options.unlocked === false ? null : start,
    });
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

  async function addUnique(
    characterId: string,
    itemId: string,
    currentCharge: number | null = null,
  ) {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId, itemId, currentCharge })
      .returning();
    return row!;
  }

  async function uniques(characterId: string, itemId: string) {
    return db
      .select()
      .from(rune.itemInstances)
      .where(
        and(eq(rune.itemInstances.characterId, characterId), eq(rune.itemInstances.itemId, itemId)),
      );
  }

  async function fabricationXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.fabrication),
        ),
      );
    return row?.totalXp ?? 0;
  }

  it("opens only with Tansy's demonstration: refused until Return the Favor is complete", async () => {
    const { userId, character } = await bench("Locked", { unlocked: false });
    await setCarried(character.id, ITEM_IDS.mountingBracket, [1]);
    const state = await commands.startTinkering(
      userId,
      character.id,
      ACTION_IDS.mountingBracketTinkering,
      1,
      start,
    );
    expect(state.tinkeringError).toBe("tinkering_locked");
    expect(state.tinkering.unlocked).toBe(false);
    expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(1);
  });

  it("commits a Mounting Bracket at once and pays 25 XP and 1 Scrap after 24 ticks", async () => {
    const { userId, character } = await bench("Bracket");
    await setCarried(character.id, ITEM_IDS.mountingBracket, [2]);
    const started = await commands.startTinkering(
      userId,
      character.id,
      ACTION_IDS.mountingBracketTinkering,
      1,
      start,
    );
    // Committed means destroyed: the batch is gone the moment the cycle begins.
    expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(1);
    expect(started.tinkering.cycle).toMatchObject({
      targetActionId: ACTION_IDS.mountingBracketTinkering,
      ticksCompleted: 0,
      durationTicks: 24,
    });
    const midway = await play.getPlayGameplayState(userId, character.id, at(ticks(23)));
    expect(midway.carriedByItemId[ITEM_IDS.scrapMetal]).toBeUndefined();
    const done = await play.getPlayGameplayState(userId, character.id, at(ticks(24)));
    expect(done.carriedByItemId[ITEM_IDS.scrapMetal]).toBe(1);
    expect(await fabricationXp(character.id)).toBe(25);
    expect(done.tinkering.lastStopReason).toBe("run_completed");
    expect(done.tinkering.cycle).toBeUndefined();
  });

  it("dismantles a Scrap Box for exactly 81 XP and 3 Scrap after 72 ticks", async () => {
    const { userId, character } = await bench("Box");
    const box = await addUnique(character.id, ITEM_IDS.scrapBox);
    await commands.startTinkering(userId, character.id, ACTION_IDS.scrapBoxTinkering, 1, start);
    expect(await uniques(character.id, ITEM_IDS.scrapBox)).toEqual([]);
    await play.getPlayGameplayState(
      userId,
      character.id,
      at(ticks(tinkerTicks(recipes.scrapBox) - 1)),
    );
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    await play.getPlayGameplayState(userId, character.id, at(ticks(tinkerTicks(recipes.scrapBox))));
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(3);
    expect(await fabricationXp(character.id)).toBe(81);
    expect(box.id).toBeTruthy();
  });

  it("dismantles a spare Salvage Cutter for 65 XP and 3 Scrap after 24 seconds", async () => {
    const { userId, character } = await bench("Cutter");
    await addUnique(character.id, ITEM_IDS.salvageCutter, 0);
    await commands.startTinkering(
      userId,
      character.id,
      ACTION_IDS.salvageCutterTinkering,
      1,
      start,
    );
    await play.getPlayGameplayState(userId, character.id, at(24_000));
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(3);
    expect(await fabricationXp(character.id)).toBe(65);
    // The equipped Cutter is untouched.
    expect(await uniques(character.id, ITEM_IDS.salvageCutter)).toHaveLength(1);
  });

  describe("the first-alpha last-Cutter guard", () => {
    it("refuses the batch that would leave no usable Mining Cutter", async () => {
      const { userId, character } = await bench("Last");
      // Unequip the legacy Cutter so the only one is a carried one.
      await db
        .delete(rune.equippedItems)
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.assignmentKind, "gear"),
          ),
        );
      const state = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.salvageCutterTinkering,
        1,
        start,
      );
      expect(state.tinkeringError).toBe("tinkering_last_cutter");
      const target = state.tinkering.targets.find(
        (candidate) => candidate.actionId === ACTION_IDS.salvageCutterTinkering,
      )!;
      expect(target).toMatchObject({
        carriedBatches: 1,
        affordableBatches: 0,
        lastCutterBlocked: true,
      });
      expect(await uniques(character.id, ITEM_IDS.salvageCutter)).toHaveLength(1);
    });

    it("counts a Cutter in the Cargo Hold, and never selects the equipped one", async () => {
      const { userId, character } = await bench("Cargo");
      await db
        .delete(rune.equippedItems)
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.assignmentKind, "gear"),
          ),
        );
      const stored = await addUnique(character.id, ITEM_IDS.salvageCutter, 10);
      await db.insert(rune.cargoHoldItemInstances).values({
        characterId: character.id,
        itemInstanceId: stored.id,
      });
      const allowed = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.salvageCutterTinkering,
        1,
        start,
      );
      expect(allowed.tinkeringError).toBeUndefined();
      // The carried one went; the stored one stays.
      expect((await uniques(character.id, ITEM_IDS.salvageCutter)).map((row) => row.id)).toEqual([
        stored.id,
      ]);
    });

    it("stops a Max run with its own reason before the last Cutter", async () => {
      const { userId, character } = await bench("Max cutters");
      await addUnique(character.id, ITEM_IDS.salvageCutter, 0);
      await addUnique(character.id, ITEM_IDS.salvageCutter, 0);
      // One equipped plus two carried: two batches may run, never a third.
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.salvageCutterTinkering,
        BOUNDED_RUN_MAX,
        start,
      );
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(500)));
      expect(done.tinkering.run.batches).toBe(2);
      expect(await uniques(character.id, ITEM_IDS.salvageCutter)).toHaveLength(1);
      expect(done.tinkering.lastStopReason).toBe("no_eligible_items");
    });
  });

  describe("Auto-discard Scrap", () => {
    it("is off by default and refuses a cycle whose Scrap cannot be kept; on, keeps none and still pays", async () => {
      const { userId, character } = await bench("Discard");
      // A full stack of Brackets and a full inventory: committing one frees no
      // slot, so the Scrap has nowhere to go.
      await setCarried(character.id, ITEM_IDS.mountingBracket, [5]);
      const state = await play.getPlayGameplayState(userId, character.id, start, certain());
      for (let slot = 0; slot < state.inventory.slotsAvailable; slot += 1) {
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
      }
      const refused = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        1,
        start,
      );
      expect(refused.tinkering.autoDiscardScrap).toBe(false);
      expect(refused.tinkeringError).toBe("tinkering_no_room");
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(5);

      await commands.setTinkeringScrapPreference(userId, character.id, true, start);
      const started = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        1,
        at(1),
      );
      expect(started.tinkeringError).toBeUndefined();
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(24) + 1));
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
      expect(await fabricationXp(character.id)).toBe(25);
      expect(done.tinkering.run).toMatchObject({ scrapKept: 0, scrapDiscarded: 1 });
      // Persistent: still on for the next visit.
      expect(done.tinkering.autoDiscardScrap).toBe(true);
    });
  });

  describe("Stop, Resume and Finish Current keep the committed batch", () => {
    it("Stop preserves worked ticks; Resume continues the same batch without committing another", async () => {
      const { userId, character } = await bench("Resume");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [3]);
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        2,
        start,
      );
      const stopped = await commands.stopTinkering(userId, character.id, at(ticks(10)));
      expect(stopped.tinkering.active).toBe(false);
      expect(stopped.tinkering.cycle).toMatchObject({ ticksCompleted: 10 });
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
      // Time away does no work, and a reload commits nothing.
      const later = await play.getPlayGameplayState(userId, character.id, at(ticks(500)));
      expect(later.tinkering.cycle).toMatchObject({ ticksCompleted: 10 });
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
      // A different item cannot jump the committed one.
      await setCarried(character.id, ITEM_IDS.scrapMetal, []);
      const other = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.scrapBoxTinkering,
        1,
        at(ticks(501)),
      );
      expect(other.tinkeringError).toBe("tinkering_resume_pending");
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        1,
        at(ticks(502)),
      );
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(502 + 14)));
      expect(done.carriedByItemId[ITEM_IDS.scrapMetal]).toBe(1);
      expect(done.tinkering.run.batches).toBe(1);
      expect(done.tinkering.lastStopReason).toBe("run_completed");
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
    });

    it("Finish Current completes the committed item and commits no other", async () => {
      const { userId, character } = await bench("Finish");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [3]);
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        BOUNDED_RUN_MAX,
        start,
      );
      await commands.finishCurrentTinkering(userId, character.id, at(ticks(5)));
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(200)));
      expect(done.tinkering.run.batches).toBe(1);
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
      expect(done.tinkering.lastStopReason).toBe("finished_current_item");
      expect(done.tinkering.finishCurrent).toBe(false);
    });

    it("walks away like Stop: Travel keeps the committed cycle waiting", async () => {
      const { userId, character } = await bench("Walk");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [1]);
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        1,
        start,
      );
      const travelling = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        at(ticks(6)),
      );
      expect(travelling.travelState).toBeDefined();
      expect(travelling.tinkering.cycle).toMatchObject({ ticksCompleted: 6 });
    });
  });

  describe("the shared selection", () => {
    it("runs a number of complete batches and refuses one the carried items cannot form", async () => {
      const { userId, character } = await bench("Numeric");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [2]);
      const forged = await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        3,
        start,
      );
      expect(forged.tinkeringError).toBe("tinkering_quantity_unavailable");
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(2);
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        2,
        start,
      );
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(48)));
      expect(done.tinkering.run.batches).toBe(2);
      expect(done.carriedByItemId[ITEM_IDS.scrapMetal]).toBe(2);
      expect(await fabricationXp(character.id)).toBe(50);
    });

    it("runs Max until no complete batch is left", async () => {
      const { userId, character } = await bench("Max");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [3]);
      await commands.startTinkering(
        userId,
        character.id,
        ACTION_IDS.mountingBracketTinkering,
        BOUNDED_RUN_MAX,
        start,
      );
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(1_000)));
      expect(done.tinkering.run.batches).toBe(3);
      expect(done.tinkering.lastStopReason).toBe("no_eligible_items");
      expect(done.tinkering.run.selection).toBe(BOUNDED_RUN_MAX);
    });
  });
});
