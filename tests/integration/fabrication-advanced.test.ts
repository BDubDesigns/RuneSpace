import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import { resolveNpcConversation } from "@/game/domain/conversation";
import type { MiningRandom } from "@/game/domain/mining";
import type { PlayGameplayState } from "@/server/play";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #233 — Fabrication 5 and 8, the Loadsteel Cutter and the Freight
 * Harness against real PostgreSQL, through the real commands.
 *
 * What only the database proves: the recipes open by Fabrication level alone;
 * Power Cells come off the machine two to a batch; a fabricated Loadsteel
 * Cutter starts at 0/10; Mining 5 is enforced when equipping and when mining;
 * a Loadsteel run — live, charged (no faster, one more ore per success),
 * depleted and resolved offline — uses the tool really in the slot, and a swap
 * can never leave a stale effect behind;
 * the Freight Harness adds its six slots and its nine kilograms; advanced
 * Tinkering takes complete batches and guards the last usable Cutter; and A
 * Cut Above (shown, carried or equipped, and kept) and Cutting Costs (handed
 * over unequipped) each pay exactly once.
 */
suite("issue #233 Fabrication 5 and 8 (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let fabrication: typeof import("@/server/fabrication-commands");
  let tinkering: typeof import("@/server/tinkering-commands");
  let mining: typeof import("@/server/mining-commands");
  let equipment: typeof import("@/server/equipment");
  let missions: typeof import("@/server/missions");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-27T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const recipes = balance.fabrication.recipes;
  const thresholds = standardSkillLevelThresholds(balance);
  const at = (tick: number) => new Date(start.getTime() + tick * GAME_TICK_MS);
  /** Every Mining roll succeeds, on the high side of the yield range. */
  const high = (): MiningRandom => ({ nextBasisPoints: () => 0, nextUnit: () => 0.5 });
  const toolSlot = { assignmentKind: "gear" as const, suitSlotId: "mining_tool" };

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
    mining = await import("@/server/mining-commands");
    equipment = await import("@/server/equipment");
    missions = await import("@/server/missions");
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

  async function instancesOf(characterId: string, itemId: string) {
    return db
      .select()
      .from(rune.itemInstances)
      .where(
        and(eq(rune.itemInstances.characterId, characterId), eq(rune.itemInstances.itemId, itemId)),
      );
  }

  async function addInstance(characterId: string, itemId: string, currentCharge: number | null) {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId, itemId, currentCharge })
      .returning();
    return row!;
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

  async function credits(characterId: string) {
    const [row] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row!.credits;
  }

  async function moveTo(characterId: string, locationId: LocationId) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  const recipeOf = (state: PlayGameplayState, actionId: string) =>
    state.fabricationStation.recipes.find((recipe) => recipe.actionId === actionId)!;
  const targetOf = (state: PlayGameplayState, actionId: string) =>
    state.tinkering.targets.find((target) => target.actionId === actionId)!;
  const mission = (state: PlayGameplayState, missionId: string) =>
    state.missions.find((candidate) => candidate.missionId === missionId)!;

  describe("recipes open by Fabrication level alone", () => {
    it("keeps the level-5 recipes locked at 4, opens them at 5, and the Harness only at 8", async () => {
      const four = await veteran("Fab four", { fabrication: 4 });
      let state = await play.getPlayGameplayState(four.userId, four.character.id, at(0));
      for (const actionId of [
        ACTION_IDS.galvanicScrapFabrication,
        ACTION_IDS.galvanicWireSpoolFabrication,
        ACTION_IDS.powerCellFabrication,
        ACTION_IDS.loadsteelCutterFabrication,
      ]) {
        expect(recipeOf(state, actionId)).toMatchObject({ unlocked: false, minimumLevel: 5 });
      }
      await give(four.character.id, ITEM_IDS.galvanicStock, 1);
      state = await fabrication.startFabrication(
        four.userId,
        four.character.id,
        ACTION_IDS.powerCellFabrication,
        1,
        at(1),
      );
      expect(state.fabricationError).toBe("fabrication_recipe_locked");

      const five = await veteran("Fab five", { fabrication: 5 });
      state = await play.getPlayGameplayState(five.userId, five.character.id, at(0));
      expect(recipeOf(state, ACTION_IDS.loadsteelCutterFabrication).unlocked).toBe(true);
      expect(recipeOf(state, ACTION_IDS.freightHarnessFabrication)).toMatchObject({
        unlocked: false,
        minimumLevel: 8,
      });

      const eight = await veteran("Fab eight", { fabrication: 8 });
      state = await play.getPlayGameplayState(eight.userId, eight.character.id, at(0));
      expect(recipeOf(state, ACTION_IDS.freightHarnessFabrication).unlocked).toBe(true);
    });

    it("needs no Refining: a Refining 1 character turns acquired Galvanic Stock into Cells", async () => {
      const { userId, character } = await veteran("No refining", { fabrication: 5 });
      await give(character.id, ITEM_IDS.galvanicStock, 2);
      const started = await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.powerCellFabrication,
        2,
        at(0),
      );
      expect(started.refining.level).toBe(1);
      expect(started.fabricationError).toBeUndefined();
      expect(recipeOf(started, ACTION_IDS.powerCellFabrication).outputQuantity).toBe(2);

      // Two batches of two: four ordinary, usable Cells, and the batch count is 2.
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(recipes.powerCells.durationTicks * 2),
      );
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(4);
      expect(await carried(character.id, ITEM_IDS.galvanicStock)).toBe(0);
      expect(done.fabricationStation.run).toMatchObject({
        batches: 2,
        outputsGained: { [ITEM_IDS.powerCell]: 4 },
      });
      expect(recipeOf(done, ACTION_IDS.powerCellFabrication).outputQuantity).toBe(2);
      expect(await xp(character.id, SKILL_IDS.fabrication)).toBe(
        thresholds.find((threshold) => threshold.level === 5)!.totalXp + 150,
      );
    });

    it("makes Direct Galvanic Scrap and a Wire Spool from Galvanic Stock", async () => {
      const { userId, character } = await veteran("Galvanic", { fabrication: 5 });
      await give(character.id, ITEM_IDS.galvanicStock, 2);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.galvanicScrapFabrication,
        1,
        at(0),
      );
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(recipes.galvanicScrap.durationTicks),
      );
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(2);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.galvanicWireSpoolFabrication,
        1,
        at(100),
      );
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(100 + recipes.galvanicWireSpool.durationTicks),
      );
      expect(await carried(character.id, ITEM_IDS.galvanicWireSpool)).toBe(1);
      expect(await carried(character.id, ITEM_IDS.galvanicStock)).toBe(0);
    });
  });

  describe("the Loadsteel Cutter and the Freight Harness come off the machine", () => {
    it("fabricates a Loadsteel Cutter at 0/10 — its Power Cell is no stored charge", async () => {
      const { userId, character } = await veteran("Loadsteel made", { fabrication: 5 });
      await give(character.id, ITEM_IDS.galvaferrite, 2);
      await give(character.id, ITEM_IDS.galvanicWireSpool, 1);
      await give(character.id, ITEM_IDS.powerCell, 1);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.loadsteelCutterFabrication,
        1,
        at(0),
      );
      const midway = await play.getPlayGameplayState(userId, character.id, at(44));
      expect(midway.carriedByItemId[ITEM_IDS.galvaferrite]).toBe(2);
      const done = await play.getPlayGameplayState(userId, character.id, at(45));
      const [made] = await instancesOf(character.id, ITEM_IDS.loadsteelCutter);
      expect(made).toMatchObject({ currentCharge: 0 });
      expect(done.inventory.uniqueItems.find((item) => item.id === made!.id)).toMatchObject({
        name: "Loadsteel Cutter",
        massGrams: 8_000,
        currentCharge: 0,
      });
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(0);
    });

    it("fabricates a Freight Harness that adds six slots and carries its nine kilograms", async () => {
      const { userId, character } = await veteran("Harness", { fabrication: 8 });
      await give(character.id, ITEM_IDS.galvaferrite, 3);
      await give(character.id, ITEM_IDS.galvaferrite, 1);
      await give(character.id, ITEM_IDS.mountingBracket, 2);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.freightHarnessFabrication,
        1,
        at(0),
      );
      const before = await play.getPlayGameplayState(userId, character.id, at(60));
      const [harness] = await instancesOf(character.id, ITEM_IDS.freightHarness);
      expect(harness).toMatchObject({ currentCharge: null });
      const slot = before.equipment.slots.find(
        (candidate) => candidate.target.suitSlotId === "container_attachment_2",
      )!;
      expect(slot.eligibleItems).toEqual([
        expect.objectContaining({ itemId: ITEM_IDS.freightHarness, slotCapacity: 6 }),
      ]);
      const equipped = await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: harness!.id, target: slot.target },
        at(61),
      );
      expect(equipped.equipment.aggregateContainerSlots).toBe(
        before.equipment.aggregateContainerSlots + 6,
      );
      // Equipped, it leaves the Inventory grid but not the carried mass.
      expect(equipped.inventory.massGrams).toBe(before.inventory.massGrams);
      expect(equipped.inventory.slotsUsed).toBe(before.inventory.slotsUsed - 1);
    });
  });

  describe("equipping and mining with the Loadsteel Cutter", () => {
    it("refuses to equip it below Mining 5, and names why", async () => {
      const { userId, character } = await veteran("Mining four", { mining: 4 });
      const loadsteel = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 0);
      const state = await play.getPlayGameplayState(userId, character.id, at(0));
      const tool = state.equipment.slots.find((slot) => slot.target.suitSlotId === "mining_tool")!;
      expect(tool.eligibleItems.find((item) => item.itemInstanceId === loadsteel.id)).toMatchObject(
        { requiredMiningLevel: 5 },
      );
      await expect(
        equipment.changeEquipment(
          userId,
          character.id,
          { kind: "equip", itemInstanceId: loadsteel.id, target: toolSlot },
          at(1),
        ),
      ).rejects.toThrow("Requires Mining 5 to equip.");
      const after = await play.getPlayGameplayState(userId, character.id, at(2));
      expect(after.equipment.miningTool?.itemId).toBe(ITEM_IDS.salvageCutter);
    });

    it("refuses to mine with one below Mining 5 even when it is already in the slot", async () => {
      const { userId, character } = await veteran("Slotted low", {
        mining: 4,
        location: LOCATION_IDS.theJag,
      });
      const loadsteel = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 10);
      await db
        .update(rune.equippedItems)
        .set({ itemInstanceId: loadsteel.id })
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.suitSlotId, "mining_tool"),
          ),
        );
      const state = await mining.startMining(userId, character.id, at(0), high());
      expect(state.stop).toEqual({ activity: "mining", reason: "compatible_mining_tool_missing" });
      expect(state.activeAction).toBeUndefined();
      expect(state.equipment.miningTool).toMatchObject({
        itemId: ITEM_IDS.loadsteelCutter,
        usable: false,
        requiredMiningLevel: 5,
      });
      const [row] = await instancesOf(character.id, ITEM_IDS.loadsteelCutter);
      expect(row!.currentCharge).toBe(10);
    });

    it("mines at 8 ticks charged or not; each charged success adds one ore to the ordinary roll", async () => {
      const { userId, character } = await veteran("Loadsteel run", {
        mining: 5,
        location: LOCATION_IDS.theJag,
      });
      const loadsteel = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 0);
      const equipped = await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: loadsteel.id, target: toolSlot },
        at(0),
      );
      expect(equipped.equipment.miningTool).toMatchObject({
        itemId: ITEM_IDS.loadsteelCutter,
        name: "Loadsteel Cutter",
        currentCharge: 0,
        maximumCharge: 10,
        usable: true,
        attemptDurationTicks: 8,
        boostedAttemptDurationTicks: 8,
        chargedEffect: { kind: "extra_yield", units: 1 },
      });
      expect(equipped.miningSource).toMatchObject({
        attemptDurationTicks: 8,
        boostedAttemptDurationTicks: 8,
        yieldMinimum: 1,
        yieldMaximum: 2,
        chargedYieldMinimum: 2,
        chargedYieldMaximum: 3,
      });

      const started = await mining.startMining(userId, character.id, at(0), high());
      expect(started.activeAction?.nextAttemptDurationTicks).toBe(8);
      const uncharged = await play.getPlayGameplayState(userId, character.id, at(8), high());
      expect(uncharged.run.recentAttempts).toEqual([
        expect.objectContaining({ boosted: false, durationTicks: 8, quantityAwarded: 2 }),
      ]);

      await give(character.id, ITEM_IDS.powerCell, 1);
      const loaded = await mining.loadMiningToolPowerCell(userId, character.id, at(8), high());
      expect(loaded.load).toEqual({ status: "loaded", remainingCharge: 10 });
      expect(loaded.state.equipment.miningTool?.currentCharge).toBe(10);
      // Charge buys ore, not speed: the next attempt is still 8 ticks.
      expect(loaded.state.activeAction).toMatchObject({
        nextAttemptBoosted: true,
        nextAttemptDurationTicks: 8,
      });

      // Resolved offline in one go: ten charged attempts, then one uncharged.
      const later = await play.getPlayGameplayState(
        userId,
        character.id,
        at(8 + 10 * 8 + 8),
        high(),
      );
      expect(later.run.attempts).toBe(12);
      expect(later.run.recentAttempts.map((attempt) => attempt.durationTicks)).toEqual(
        Array(10).fill(8),
      );
      expect(
        later.run.recentAttempts.filter((attempt) => attempt.boosted).map((a) => a.quantityAwarded),
      ).toEqual(Array(9).fill(3));
      expect(later.run.recentAttempts.at(-1)).toMatchObject({
        boosted: false,
        chargeConsumed: false,
        quantityAwarded: 2,
      });
      expect(later.run.itemsGained[ITEM_IDS.ferriteShale]).toBe(2 + 10 * 3 + 2);
      // XP is per attempt and unchanged by the extra ore.
      expect(later.run.xpGained).toBe(12 * 15);
      expect(later.equipment.miningTool?.currentCharge).toBe(0);
      const [row] = await instancesOf(character.id, ITEM_IDS.loadsteelCutter);
      expect(row!.currentCharge).toBe(0);
    });

    it("uses whichever Cutter is really equipped: a swap stops the run and leaves no stale effect", async () => {
      const { userId, character } = await veteran("Swapper", {
        mining: 5,
        location: LOCATION_IDS.theJag,
      });
      const [salvage] = await instancesOf(character.id, ITEM_IDS.salvageCutter);
      const loadsteel = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 10);
      await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: loadsteel.id, target: toolSlot },
        at(0),
      );
      await mining.startMining(userId, character.id, at(0), high());

      // Two charged Loadsteel attempts are due; the swap resolves them first,
      // then stops the run before the Salvage Cutter is ever read.
      const swapped = await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: salvage!.id, target: toolSlot },
        at(17),
        high(),
      );
      expect(swapped.stop).toEqual({ activity: "mining", reason: "mining_tool_replaced" });
      expect(swapped.activeAction).toBeUndefined();
      expect(swapped.run.recentAttempts).toEqual([
        expect.objectContaining({ durationTicks: 8, quantityAwarded: 3, remainingCharge: 9 }),
        expect.objectContaining({ durationTicks: 8, quantityAwarded: 3, remainingCharge: 8 }),
      ]);
      expect(swapped.equipment.miningTool).toMatchObject({
        itemId: ITEM_IDS.salvageCutter,
        attemptDurationTicks: 10,
        boostedAttemptDurationTicks: 5,
        chargedEffect: { kind: "speed" },
      });
      // Time passing afterwards resolves nothing, and the stored Loadsteel
      // Cutter keeps exactly the charge it had.
      const idle = await play.getPlayGameplayState(userId, character.id, at(1_000), high());
      expect(idle.run.attempts).toBe(2);
      expect((await instancesOf(character.id, ITEM_IDS.loadsteelCutter))[0]!.currentCharge).toBe(8);

      // A new run with the Salvage Cutter is the Salvage Cutter's, unchanged:
      // 10 ticks uncharged, and charged it is faster — 5 ticks — never richer.
      await mining.startMining(userId, character.id, at(1_000), high());
      const salvageRun = await play.getPlayGameplayState(userId, character.id, at(1_010), high());
      expect(salvageRun.run.recentAttempts).toEqual([
        expect.objectContaining({ boosted: false, durationTicks: 10, quantityAwarded: 2 }),
      ]);
      await give(character.id, ITEM_IDS.powerCell, 1);
      await mining.loadMiningToolPowerCell(userId, character.id, at(1_010), high());
      const chargedSalvage = await play.getPlayGameplayState(
        userId,
        character.id,
        at(1_015),
        high(),
      );
      expect(chargedSalvage.run.recentAttempts.at(-1)).toMatchObject({
        boosted: true,
        durationTicks: 5,
        quantityAwarded: 2,
        remainingCharge: 9,
      });
      expect((await instancesOf(character.id, ITEM_IDS.loadsteelCutter))[0]!.currentCharge).toBe(8);
    });
  });

  describe("advanced Tinkering", () => {
    it("takes Power Cells two at a time and never half a batch", async () => {
      const { userId, character } = await veteran("Cell Tinker", { fabrication: 5 });
      await give(character.id, ITEM_IDS.powerCell, 3);
      const state = await play.getPlayGameplayState(userId, character.id, at(0));
      expect(targetOf(state, ACTION_IDS.powerCellTinkering)).toMatchObject({
        batchQuantity: 2,
        affordableBatches: 1,
        durationTicks: 60,
        xp: 75,
        scrap: 1,
      });
      const refused = await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.powerCellTinkering,
        2,
        at(1),
      );
      expect(refused.tinkeringError).toBe("tinkering_quantity_unavailable");
      const before = await xp(character.id, SKILL_IDS.fabrication);
      await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.powerCellTinkering,
        BOUNDED_RUN_MAX,
        at(2),
      );
      await play.getPlayGameplayState(userId, character.id, at(2 + 60 * 3));
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(1);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(1);
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(75);
    });

    it("guards the last usable Cutter, whichever kind it is", async () => {
      const { userId, character } = await veteran("Last Loadsteel", { fabrication: 5, mining: 5 });
      // The only Cutter is a carried Loadsteel Cutter.
      await db
        .delete(rune.equippedItems)
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.suitSlotId, "mining_tool"),
          ),
        );
      await db
        .delete(rune.itemInstances)
        .where(
          and(
            eq(rune.itemInstances.characterId, character.id),
            eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
          ),
        );
      await addInstance(character.id, ITEM_IDS.loadsteelCutter, 0);
      const state = await play.getPlayGameplayState(userId, character.id, at(0));
      expect(targetOf(state, ACTION_IDS.loadsteelCutterTinkering)).toMatchObject({
        carriedBatches: 1,
        affordableBatches: 0,
        lastCutterBlocked: true,
        durationTicks: 90,
        xp: 180,
        scrap: 2,
      });
      const refused = await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.loadsteelCutterTinkering,
        1,
        at(1),
      );
      expect(refused.tinkeringError).toBe("tinkering_last_cutter");
      expect(await instancesOf(character.id, ITEM_IDS.loadsteelCutter)).toHaveLength(1);

      // A Salvage Cutter in the Cargo Hold is another usable Cutter.
      const spare = await addInstance(character.id, ITEM_IDS.salvageCutter, null);
      await db
        .insert(rune.cargoHoldItemInstances)
        .values({ characterId: character.id, itemInstanceId: spare.id });
      await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.loadsteelCutterTinkering,
        1,
        at(2),
      );
      await play.getPlayGameplayState(userId, character.id, at(2 + 90));
      expect(await instancesOf(character.id, ITEM_IDS.loadsteelCutter)).toHaveLength(0);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(2);
    });

    it("dismantles a Freight Harness at Fabrication 8 for 270 XP and 3 Scrap over 120 ticks", async () => {
      const { userId, character } = await veteran("Harness Tinker", { fabrication: 8 });
      await addInstance(character.id, ITEM_IDS.freightHarness, null);
      const before = await xp(character.id, SKILL_IDS.fabrication);
      await tinkering.startTinkering(
        userId,
        character.id,
        ACTION_IDS.freightHarnessTinkering,
        1,
        at(0),
      );
      const midway = await play.getPlayGameplayState(userId, character.id, at(119));
      expect(midway.tinkering.cycle).toMatchObject({ ticksCompleted: 119, durationTicks: 120 });
      await play.getPlayGameplayState(userId, character.id, at(120));
      expect((await xp(character.id, SKILL_IDS.fabrication)) - before).toBe(270);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(3);
    });
  });

  describe("A Cut Above", () => {
    const tansyEntry = (state: PlayGameplayState) =>
      resolveNpcConversation(NPC_IDS.tansyRusk, state.missions).find(
        (entry) => entry.kind === "mission" && entry.missionId === MISSION_IDS.aCutAbove,
      );

    it("is not offered before Brace Yourself or below Fabrication 5", async () => {
      const noBrace = await veteran("No brace", { fabrication: 5, location: LOCATION_IDS.theJag });
      let state = await play.getPlayGameplayState(noBrace.userId, noBrace.character.id, at(0));
      expect(mission(state, MISSION_IDS.aCutAbove).prerequisiteSatisfied).toBe(false);
      const low = await veteran("Fab four brace", {
        fabrication: 4,
        brace: true,
        location: LOCATION_IDS.theJag,
      });
      state = await play.getPlayGameplayState(low.userId, low.character.id, at(0));
      expect(mission(state, MISSION_IDS.aCutAbove).prerequisiteSatisfied).toBe(false);
      expect(tansyEntry(state)).toBeUndefined();
      const refused = await missions.acceptMission(
        low.userId,
        low.character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(1),
      );
      expect(refused.mission.status).toBe("refused");
    });

    it("is satisfied at once by a Cutter made before accepting, keeps it, and pays 500 XP once", async () => {
      const { userId, character } = await veteran("Cut above", {
        fabrication: 5,
        brace: true,
        location: LOCATION_IDS.ruskRecovery,
      });
      // The recipe is open at Fabrication 5 before the Mission is ever offered.
      let state = await play.getPlayGameplayState(userId, character.id, at(0));
      expect(recipeOf(state, ACTION_IDS.loadsteelCutterFabrication).unlocked).toBe(true);
      await give(character.id, ITEM_IDS.galvaferrite, 2);
      await give(character.id, ITEM_IDS.galvanicWireSpool, 1);
      await give(character.id, ITEM_IDS.powerCell, 1);
      await fabrication.startFabrication(
        userId,
        character.id,
        ACTION_IDS.loadsteelCutterFabrication,
        1,
        at(1),
      );
      await play.getPlayGameplayState(userId, character.id, at(1 + 45));
      expect(await instancesOf(character.id, ITEM_IDS.loadsteelCutter)).toHaveLength(1);

      await moveTo(character.id, LOCATION_IDS.theJag);
      state = await play.getPlayGameplayState(userId, character.id, at(100));
      expect(tansyEntry(state)).toMatchObject({
        role: "offer",
        dialogueId: DIALOGUE_IDS.tansyACutAboveOffer,
      });
      const accepted = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(101),
      );
      expect(accepted.mission.status).toBe("accepted");
      expect(recipeOf(accepted.state, ACTION_IDS.loadsteelCutterFabrication).unlocked).toBe(true);
      // The Cutter already carried satisfies the objective immediately.
      expect(mission(accepted.state, MISSION_IDS.aCutAbove)).toMatchObject({
        state: "ready_for_completion",
        requirements: [
          expect.objectContaining({
            kind: "carried_unique_item",
            objective: "Show Tansy a Loadsteel Cutter",
            satisfied: true,
          }),
        ],
      });
      expect(tansyEntry(accepted.state)).toMatchObject({
        role: "turn_in",
        dialogueId: DIALOGUE_IDS.tansyACutAboveTurnIn,
        action: { kind: "complete_mission" },
      });

      const xpBefore = await xp(character.id, SKILL_IDS.fabrication);
      const completed = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(102),
      );
      expect(completed.mission.status).toBe("completed");
      expect((await xp(character.id, SKILL_IDS.fabrication)) - xpBefore).toBe(500);
      // Tansy keeps nothing.
      expect(await instancesOf(character.id, ITEM_IDS.loadsteelCutter)).toHaveLength(1);
      const retried = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(103),
      );
      expect(retried.mission.status).toBe("already_completed");
      expect((await xp(character.id, SKILL_IDS.fabrication)) - xpBefore).toBe(500);
    });

    it("counts a Cutter in hand, of any source or charge, but never one left in the Cargo Hold", async () => {
      const { userId, character } = await veteran("Shown in hand", {
        fabrication: 5,
        mining: 5,
        brace: true,
        location: LOCATION_IDS.theJag,
      });
      // Bought or given — nothing records where it came from — and stowed.
      const stowed = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 7);
      await db
        .insert(rune.cargoHoldItemInstances)
        .values({ characterId: character.id, itemInstanceId: stowed.id });
      const accepted = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(0),
      );
      expect(accepted.mission.status).toBe("accepted");
      expect(mission(accepted.state, MISSION_IDS.aCutAbove).requirements?.[0]?.satisfied).toBe(
        false,
      );
      expect(tansyEntry(accepted.state)).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.tansyACutAboveReminder,
      });
      expect(tansyEntry(accepted.state)).not.toHaveProperty("action");
      const refused = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(1),
      );
      expect(refused.mission.status).toBe("refused");

      // Taken out of the Cargo Hold and equipped: in the player's hand, it counts.
      await db
        .delete(rune.cargoHoldItemInstances)
        .where(eq(rune.cargoHoldItemInstances.itemInstanceId, stowed.id));
      const inHand = await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: stowed.id, target: toolSlot },
        at(2),
      );
      expect(inHand.equipment.miningTool?.itemId).toBe(ITEM_IDS.loadsteelCutter);
      expect(inHand.inventory.uniqueItems.some((item) => item.id === stowed.id)).toBe(false);
      expect(mission(inHand, MISSION_IDS.aCutAbove).requirements?.[0]?.satisfied).toBe(true);
      const completed = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.aCutAbove,
        NPC_IDS.tansyRusk,
        at(3),
      );
      expect(completed.mission.status).toBe("completed");
      // Still equipped, still charged: showing it took nothing.
      expect(completed.state.equipment.miningTool).toMatchObject({
        itemId: ITEM_IDS.loadsteelCutter,
        currentCharge: 7,
      });
    });
  });

  describe("Cutting Costs", () => {
    const rennEntry = (state: PlayGameplayState) =>
      resolveNpcConversation(NPC_IDS.rennCalder, state.missions).find(
        (entry) => entry.kind === "mission" && entry.missionId === MISSION_IDS.cuttingCosts,
      );

    it("is offered after Brace Yourself at Fabrication 1, and not before", async () => {
      const early = await veteran("Renn early", { location: LOCATION_IDS.holoHollow });
      let state = await play.getPlayGameplayState(early.userId, early.character.id, at(0));
      expect(mission(state, MISSION_IDS.cuttingCosts).prerequisiteSatisfied).toBe(false);
      const ready = await veteran("Renn ready", {
        brace: true,
        location: LOCATION_IDS.holoHollow,
      });
      state = await play.getPlayGameplayState(ready.userId, ready.character.id, at(0));
      expect(state.fabrication.level).toBe(1);
      expect(mission(state, MISSION_IDS.cuttingCosts).prerequisiteSatisfied).toBe(true);
      expect(mission(state, MISSION_IDS.aCutAbove).state).toBe("not_accepted");
      expect(rennEntry(state)).toMatchObject({
        role: "offer",
        dialogueId: DIALOGUE_IDS.rennCuttingCostsOffer,
      });
    });

    it("takes any unequipped Loadsteel Cutter, never the equipped one, and pays 500 Credits once", async () => {
      const { userId, character } = await veteran("Renn buys", {
        mining: 5,
        brace: true,
        location: LOCATION_IDS.holoHollow,
      });
      const accepted = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.cuttingCosts,
        NPC_IDS.rennCalder,
        at(0),
      );
      expect(accepted.mission.status).toBe("accepted");
      // Cutting Costs pays on completion only (#290).
      expect(accepted.mission).not.toHaveProperty("creditsPaid");
      expect(rennEntry(accepted.state)).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.rennCuttingCostsReminder,
      });

      // The only Loadsteel Cutter is in the player's hand.
      const inHand = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 4);
      await equipment.changeEquipment(
        userId,
        character.id,
        { kind: "equip", itemInstanceId: inHand.id, target: toolSlot },
        at(1),
      );
      const creditsBefore = await credits(character.id);
      const refused = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cuttingCosts,
        NPC_IDS.rennCalder,
        at(2),
      );
      expect(refused.mission.status).toBe("refused");
      expect(refused.mission).not.toHaveProperty("creditsPaid");
      expect(await instancesOf(character.id, ITEM_IDS.loadsteelCutter)).toHaveLength(1);
      expect(await credits(character.id)).toBe(creditsBefore);

      // Any other legitimately held Loadsteel Cutter will do — no provenance.
      const acquired = await addInstance(character.id, ITEM_IDS.loadsteelCutter, 0);
      const state = await play.getPlayGameplayState(userId, character.id, at(3));
      expect(rennEntry(state)).toMatchObject({
        role: "turn_in",
        dialogueId: DIALOGUE_IDS.rennCuttingCostsTurnIn,
        action: { kind: "complete_mission" },
      });
      const completed = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cuttingCosts,
        NPC_IDS.rennCalder,
        at(4),
      );
      expect(completed.mission.status).toBe("completed");
      expect(completed.mission).toMatchObject({ creditsPaid: 500 });
      expect((await credits(character.id)) - creditsBefore).toBe(500);
      const remaining = await instancesOf(character.id, ITEM_IDS.loadsteelCutter);
      expect(remaining.map((row) => row.id)).toEqual([inHand.id]);
      expect(remaining.map((row) => row.id)).not.toContain(acquired.id);
      expect(completed.state.equipment.miningTool?.itemId).toBe(ITEM_IDS.loadsteelCutter);

      const retried = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cuttingCosts,
        NPC_IDS.rennCalder,
        at(5),
      );
      expect(retried.mission.status).toBe("already_completed");
      expect(retried.mission).not.toHaveProperty("creditsPaid");
      expect((await credits(character.id)) - creditsBefore).toBe(500);
    });
  });
});
