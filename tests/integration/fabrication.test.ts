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
  SKILL_IDS,
} from "@/game/config/foundations";
import type { OverrideRandom } from "@/game/domain/manual-override";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #232 — Tier-1 Fabrication against real PostgreSQL.
 *
 * What only the database proves: that Start is binding and revalidated in the
 * character lock, that a workpiece's reserved inputs stay in the real rows and
 * cannot be taken, that success and bust each commit as one transaction, that
 * capacity is judged after the inputs leave, that numeric and Max runs decide
 * each next workpiece from the inventory the last one actually left, and that
 * nothing about Manual Override can be rerolled by a refresh or a retry.
 */
suite("issue #232 Fabrication (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let commands: typeof import("@/server/fabrication-commands");
  let inventory: typeof import("@/server/inventory");
  let equipment: typeof import("@/server/equipment");
  let reservation: typeof import("@/server/fabrication-reservation");
  let admin: typeof import("@/server/admin-command-seams");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-20T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const recipes = balance.fabrication.recipes;
  const ticks = (count: number) => count * GAME_TICK_MS;
  const at = (ms: number) => new Date(start.getTime() + ms);

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    commands = await import("@/server/fabrication-commands");
    inventory = await import("@/server/inventory");
    equipment = await import("@/server/equipment");
    reservation = await import("@/server/fabrication-reservation");
    admin = await import("@/server/admin-command-seams");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  /** Replays the given Override draws, then keeps answering the last one. */
  function overrideScript(...draws: number[]): OverrideRandom {
    const queue = [...draws];
    return { nextInt: (n) => Math.min(n - 1, queue.length > 1 ? queue.shift()! : (queue[0] ?? 0)) };
  }

  /** A character standing at Rusk Recovery with Return the Favor accepted. */
  async function station(label: string, options: { accepted?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Fab ${userId.slice(0, 6)}`,
    );
    await play.getPlayGameplayState(userId, character.id, start, certain());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    const missionIds = [
      MISSION_IDS.walkItOff,
      MISSION_IDS.cutYourTeeth,
      MISSION_IDS.wasteNot,
      MISSION_IDS.holdItTogether,
      MISSION_IDS.keepTheChange,
      MISSION_IDS.tenThousandHours,
    ];
    await db.insert(rune.characterMissions).values(
      missionIds.map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    if (options.accepted !== false) {
      await db.insert(rune.characterMissions).values({
        characterId: character.id,
        missionId: MISSION_IDS.returnTheFavor,
        acceptedAt: start,
      });
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

  async function instances(characterId: string, itemId: string) {
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

  async function action(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
    return row;
  }

  async function stationRow(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterFabricationState)
      .where(eq(rune.characterFabricationState.characterId, characterId));
    return row;
  }

  /** Fill every free carried slot with single Ferrite Shale pieces. */
  async function fillSlots(userId: string, characterId: string, when: Date) {
    const state = await play.getPlayGameplayState(userId, characterId, when, certain());
    for (let slot = 0; slot < state.inventory.slotsAvailable; slot += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
    }
  }

  describe("Start is authoritative", () => {
    it("is Tansy's to open: refused until Return the Favor is accepted", async () => {
      const { userId, character } = await station("Unopened", { accepted: false });
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      const state = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
      );
      expect(state.fabricationError).toBe("fabrication_locked");
      expect(state.fabricationStation.unlocked).toBe(false);
      expect(await action(character.id)).toBeUndefined();
    });

    it("only happens at Rusk Recovery", async () => {
      const { userId, character } = await station("Elsewhere");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow })
        .where(eq(rune.characters.id, character.id));
      const state = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
      );
      expect(state.fabricationError).toBe("fabrication_unavailable_here");
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(2);
    });

    it("refuses a stale or forged number rather than shortening it, and an unknown recipe", async () => {
      const { userId, character } = await station("Forged");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      const forged = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        3,
        start,
      );
      expect(forged.fabricationError).toBe("fabrication_quantity_unavailable");
      const bracket = forged.fabricationStation.recipes.find(
        (recipe) => recipe.actionId === ACTION_IDS.mountingBracketFabrication,
      )!;
      expect(bracket.affordableBatches).toBe(2);
      expect(await action(character.id)).toBeUndefined();
      expect(await stationRow(character.id)).toBeUndefined();

      const unknown = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.refining,
        1,
        start,
      );
      expect(unknown.fabricationError).toBe("fabrication_unknown_recipe");
    });

    it("refuses with no inputs at all, even for Max", async () => {
      const { userId, character } = await station("Empty");
      const state = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        BOUNDED_RUN_MAX,
        start,
      );
      expect(state.fabricationError).toBe("fabrication_insufficient_inputs");
      expect(await action(character.id)).toBeUndefined();
    });

    it("is idempotent for a retried Start and refuses a second activity", async () => {
      const { userId, character } = await station("Retried");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      const [first, second] = await Promise.all([
        commands.startFabrication(
          userId,
          character.id,
          ACTION_IDS.mountingBracketFabrication,
          2,
          start,
        ),
        commands.startFabrication(
          userId,
          character.id,
          ACTION_IDS.mountingBracketFabrication,
          2,
          start,
        ),
      ]);
      expect(first.fabricationError).toBeUndefined();
      expect(second.fabricationError).toBeUndefined();
      expect((await action(character.id))?.actionId).toBe(ACTION_IDS.mountingBracketFabrication);
      const other = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.scrapMetalFabrication,
        1,
        start,
      );
      expect(other.commandError).toBe("another_action_active");
    });
  });

  describe("a workpiece resolves atomically", () => {
    it("reserves inputs in place, then consumes them and makes the output together", async () => {
      const { userId, character } = await station("Atomic");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      const started = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        2,
        start,
      );
      // Reserved, not removed: the inputs still count for mass and slots.
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(4);
      expect(started.fabricationStation.workpiece).toMatchObject({
        recipeActionId: ACTION_IDS.mountingBracketFabrication,
        sequence: 1,
      });
      // Part-way through: nothing has moved.
      const midway = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.mountingBracket.durationTicks) - 1),
      );
      expect(midway.carriedByItemId[ITEM_IDS.refinedFerrite]).toBe(4);
      expect(midway.carriedByItemId[ITEM_IDS.mountingBracket]).toBeUndefined();

      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.mountingBracket.durationTicks * 2)),
      );
      expect(done.carriedByItemId[ITEM_IDS.refinedFerrite]).toBeUndefined();
      expect(done.carriedByItemId[ITEM_IDS.mountingBracket]).toBe(2);
      expect(await fabricationXp(character.id)).toBe(2 * recipes.mountingBracket.baseXp);
      expect(await action(character.id)).toBeUndefined();
      expect(done.fabricationStation.lastStopReason).toBe("run_completed");
      expect(done.fabricationStation.run).toMatchObject({ batches: 2, successes: 2, busts: 0 });
    });

    it("creates another ordinary, uncharged Salvage Cutter instance", async () => {
      const { userId, character } = await station("Cutter");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await setCarried(character.id, ITEM_IDS.powerCell, [1]);
      const before = await instances(character.id, ITEM_IDS.salvageCutter);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        start,
      );
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.salvageCutter.durationTicks)),
      );
      const after = await instances(character.id, ITEM_IDS.salvageCutter);
      expect(after).toHaveLength(before.length + 1);
      const made = after.find((row) => !before.some((old) => old.id === row.id))!;
      expect(made.currentCharge).toBe(0);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(0);
      expect(await fabricationXp(character.id)).toBe(recipes.salvageCutter.baseXp);
    });

    it("makes a Scrap Box that equips as a second container for three more slots", async () => {
      const { userId, character } = await station("Box");
      await setCarried(character.id, ITEM_IDS.mountingBracket, [1]);
      await setCarried(character.id, ITEM_IDS.scrapMetal, [2]);
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [3]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.scrapBoxFabrication,
        1,
        start,
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.scrapBox.durationTicks)),
      );
      const [box] = await instances(character.id, ITEM_IDS.scrapBox);
      expect(box?.currentCharge).toBeNull();
      expect(done.inventory.uniqueItems.map((item) => item.itemId)).toContain(ITEM_IDS.scrapBox);
      const slots = done.equipment.aggregateContainerSlots;
      const equipped = await equipment.changeEquipment(userId, character.id, {
        kind: "equip",
        itemInstanceId: box!.id,
        target: { assignmentKind: "container", suitSlotId: "container_attachment_2" },
      });
      expect(equipped.equipment.aggregateContainerSlots).toBe(
        slots + balance.items.scrapBox.equipment.slotCapacity,
      );
    });

    it("judges room after the inputs are gone: a full inventory can still make its output", async () => {
      const { userId, character } = await station("Tight");
      // Five Ferrite in one stack and one Cell: removing them frees two slots.
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await setCarried(character.id, ITEM_IDS.powerCell, [1]);
      await fillSlots(userId, character.id, start);
      const full = await play.getPlayGameplayState(userId, character.id, start, certain());
      expect(full.inventory.slotsAvailable).toBe(0);
      const started = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        start,
      );
      expect(started.fabricationError).toBeUndefined();
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.salvageCutter.durationTicks)),
      );
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
      expect((await instances(character.id, ITEM_IDS.salvageCutter)).length).toBeGreaterThan(1);
    });
  });

  describe("numeric and Max runs decide each next workpiece from real state", () => {
    it("runs Max until the inputs cannot pay for another, never 'run completed'", async () => {
      const { userId, character } = await station("Max");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5, 2]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.scrapMetalFabrication,
        BOUNDED_RUN_MAX,
        start,
      );
      expect((await stationRow(character.id))?.runSelectedBatches).toBeNull();
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.scrapMetal.durationTicks * 10)),
      );
      expect(done.carriedByItemId[ITEM_IDS.scrapMetal]).toBe(3);
      expect(done.carriedByItemId[ITEM_IDS.refinedFerrite]).toBe(1);
      expect(done.fabricationStation.lastStopReason).toBe("insufficient_inputs");
      expect(done.fabricationStation.run.selection).toBe(BOUNDED_RUN_MAX);
    });

    it("reserves only the workpiece on the machine: a numeric run stops early with the ordinary reason", async () => {
      const { userId, character } = await station("Spare");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2, 2]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        2,
        start,
      );
      // The second batch's Ferrite is not reserved yet, so it may be dropped —
      // and then the second workpiece simply cannot begin.
      const spare = (
        await db
          .select()
          .from(rune.inventoryStacks)
          .where(
            and(
              eq(rune.inventoryStacks.characterId, character.id),
              eq(rune.inventoryStacks.itemId, ITEM_IDS.refinedFerrite),
            ),
          )
      )[0]!;
      const dropped = await inventory.discardInventoryStack(
        userId,
        character.id,
        { stackId: spare.id, mode: "stack", expectedQuantity: 2 },
        at(ticks(1)),
      );
      expect(dropped.discard.status).toBe("discarded");
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(100)));
      expect(done.fabricationStation.run.batches).toBe(1);
      expect(done.carriedByItemId[ITEM_IDS.mountingBracket]).toBe(1);
      expect(done.fabricationStation.lastStopReason).toBe("insufficient_inputs");
    });

    it("Finish Current completes the workpiece on the machine and starts no other", async () => {
      const { userId, character } = await station("Finish");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5, 1]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        BOUNDED_RUN_MAX,
        start,
      );
      await commands.finishCurrentFabrication(userId, character.id, at(ticks(3)));
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(200)));
      expect(done.carriedByItemId[ITEM_IDS.mountingBracket]).toBe(1);
      expect(done.carriedByItemId[ITEM_IDS.refinedFerrite]).toBe(4);
      expect(done.fabricationStation.lastStopReason).toBe("finished_current");
      expect((await stationRow(character.id))?.finishCurrent).toBe(false);
    });

    it("resolves the same way lazily after reconnecting, with the workpiece identity intact", async () => {
      const { userId, character } = await station("Offline");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5, 5]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        3,
        start,
      );
      const partway = at(ticks(recipes.mountingBracket.durationTicks + 4));
      const first = await play.getPlayGameplayState(userId, character.id, partway);
      const second = await play.getPlayGameplayState(userId, character.id, partway);
      expect(second.fabricationStation.workpiece).toEqual(first.fabricationStation.workpiece);
      expect(second.fabricationStation.workpiece?.sequence).toBe(2);
      const done = await play.getPlayGameplayState(userId, character.id, at(ticks(1_000)));
      expect(done.carriedByItemId[ITEM_IDS.mountingBracket]).toBe(3);
      expect(done.carriedByItemId[ITEM_IDS.refinedFerrite]).toBe(4);
    });
  });

  describe("a started workpiece is binding", () => {
    it("cannot be travelled away from or replaced", async () => {
      const { userId, character } = await station("Bound");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
      );
      const travel = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        at(ticks(2)),
      );
      expect(travel.commandError).toBe("another_action_active");
      expect(travel.location.currentLocationId).toBe(LOCATION_IDS.ruskRecovery);
      expect((await action(character.id))?.actionId).toBe(ACTION_IDS.mountingBracketFabrication);
    });

    it("keeps its reserved inputs: dropping them is refused and rolled back, spare units are not", async () => {
      const { userId, character } = await station("Reserved");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [3]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
      );
      const [stack] = await db
        .select()
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, character.id),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.refinedFerrite),
          ),
        );
      await expect(
        inventory.discardInventoryStack(
          userId,
          character.id,
          { stackId: stack!.id, mode: "stack", expectedQuantity: 3 },
          at(ticks(1)),
        ),
      ).rejects.toBeInstanceOf(reservation.FabricationReservationError);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(3);
      // The one spare unit the workpiece does not need can still go.
      const dropped = await inventory.discardInventoryStack(
        userId,
        character.id,
        { stackId: stack!.id, mode: "one", expectedQuantity: 3 },
        at(ticks(2)),
      );
      expect(dropped.discard.status).toBe("discarded");
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(2);
    });

    it("refuses a reserved Power Cell to the Cutter it would charge", async () => {
      const { userId, character } = await station("Cell");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await setCarried(character.id, ITEM_IDS.powerCell, [1]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        start,
      );
      const mining = await import("@/server/mining-commands");
      await expect(
        mining.loadMiningToolPowerCell(userId, character.id, at(ticks(1))),
      ).rejects.toBeInstanceOf(reservation.FabricationReservationError);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(1);
    });

    it("gives operators the same answer, and their Stop clears it without consuming anything", async () => {
      const { userId, character } = await station("Operator");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
      );
      const [stack] = await db
        .select()
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, character.id),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.refinedFerrite),
          ),
        );
      const adminUserId = await createTestUser(db, authSchema, "Fab Operator");
      createdUsers.push(adminUserId);
      await expect(
        admin.removeCarriedStackQuantityAsAdmin(
          adminUserId,
          character.id,
          stack!.id,
          "stack",
          2,
          at(ticks(1)),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const stopped = await admin.stopCurrentActionAsAdmin(adminUserId, character.id, at(ticks(2)));
      expect(stopped.outcome).toEqual({
        kind: "interrupted",
        actionId: ACTION_IDS.mountingBracketFabrication,
      });
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(2);
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(0);
    });
  });

  describe("Manual Override is durable and server-authoritative", () => {
    it("rolls one machine when enabled, and a refresh never rerolls it", async () => {
      const { userId, character } = await station("Machine");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await setCarried(character.id, ITEM_IDS.powerCell, [1]);
      await commands.setManualOverride(userId, character.id, true, start);
      // Load 2 + 4 = 6, Trend LOWER.
      const started = await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        start,
        certain(),
        overrideScript(4, 1),
      );
      expect(started.fabricationStation.workpiece?.override).toMatchObject({
        load: 6,
        trend: "lower",
        pushes: 0,
        locked: false,
        multiplierLabel: "1.00×",
      });
      const again = await play.getPlayGameplayState(userId, character.id, at(ticks(1)));
      const toggled = await commands.setManualOverride(
        userId,
        character.id,
        true,
        at(ticks(2)),
        certain(),
        overrideScript(0, 0),
      );
      expect(again.fabricationStation.workpiece?.override?.load).toBe(6);
      expect(toggled.fabricationStation.workpiece?.override).toMatchObject({
        load: 6,
        trend: "lower",
      });
    });

    it("holds a finished Override workpiece at 0, blocking travel, until Lock In resolves it", async () => {
      const { userId, character } = await station("Hold");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [5]);
      await setCarried(character.id, ITEM_IDS.powerCell, [1]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        start,
        certain(),
        overrideScript(2, 0), // Load 4, HIGHER
      );
      // Push with Feed 5; the next Load rolls 5..10 and draw 0 gives 5: exact.
      const pushed = await commands.pushFabricationOverride(
        userId,
        character.id,
        5,
        1,
        0,
        at(ticks(2)),
        certain(),
        overrideScript(0, 0),
      );
      expect(pushed.fabricationStation.workpiece?.override).toMatchObject({
        load: 5,
        pushes: 1,
        multiplierLabel: "1.30×",
        lastPush: { feed: 5, load: 5, outcome: "exact" },
      });
      const held = await play.getPlayGameplayState(userId, character.id, at(ticks(500)));
      expect(held.fabricationStation.workpiece?.recipeActionId).toBe(
        ACTION_IDS.salvageCutterFabrication,
      );
      expect(held.carriedByItemId[ITEM_IDS.refinedFerrite]).toBe(5);
      const travel = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        at(ticks(501)),
      );
      expect(travel.commandError).toBe("another_action_active");

      const locked = await commands.lockInFabricationOverride(
        userId,
        character.id,
        1,
        at(ticks(502)),
      );
      expect(locked.fabricationStation.workpiece).toBeUndefined();
      expect(await fabricationXp(character.id)).toBe(84); // floor(65 × 1.30)
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
      expect(locked.fabricationStation.run.recentWorkpieces.at(-1)).toMatchObject({
        result: "success",
        xpAwarded: 84,
        usedOverride: true,
      });
    });

    it("locks in before timer 0 and lets the timer run out normally", async () => {
      const { userId, character } = await station("Early lock");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
        certain(),
        overrideScript(0, 0), // Load 2, HIGHER
      );
      // Feed 4 against a rolled 3 (draw 0 of 3..10): safe, ×1.20.
      await commands.pushFabricationOverride(
        userId,
        character.id,
        4,
        1,
        0,
        at(ticks(1)),
        certain(),
        overrideScript(0, 0),
      );
      const locked = await commands.lockInFabricationOverride(
        userId,
        character.id,
        1,
        at(ticks(2)),
      );
      expect(locked.fabricationStation.workpiece?.override?.locked).toBe(true);
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(0);
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.mountingBracket.durationTicks)),
      );
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(1);
      expect(await fabricationXp(character.id)).toBe(30); // 25 × 1.20
    });

    it("treats switching Override off as Lock In, resolving at once after timer 0", async () => {
      const { userId, character } = await station("Switch off");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        2,
        start,
        certain(),
        overrideScript(0, 0),
      );
      const off = await commands.setManualOverride(
        userId,
        character.id,
        false,
        at(ticks(recipes.mountingBracket.durationTicks + 3)),
      );
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(1);
      expect(await fabricationXp(character.id)).toBe(25);
      // The next workpiece is an ordinary 1.00× one: Override stays off.
      expect(off.fabricationStation.manualOverrideEnabled).toBe(false);
      expect(off.fabricationStation.workpiece?.sequence).toBe(2);
      expect(off.fabricationStation.workpiece?.override).toBeUndefined();
    });

    it("busts atomically — every input gone, nothing made, no XP — and the run carries on", async () => {
      const { userId, character } = await station("Bust");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        2,
        start,
        certain(),
        overrideScript(0, 0), // Load 2, HIGHER
      );
      // The next Load rolls 3 (draw 0); a Feed of 10 is far outside 1..5.
      const busted = await commands.pushFabricationOverride(
        userId,
        character.id,
        10,
        1,
        0,
        at(ticks(1)),
        certain(),
        overrideScript(0, 0),
      );
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(2);
      expect(await carried(character.id, ITEM_IDS.mountingBracket)).toBe(0);
      expect(await fabricationXp(character.id)).toBe(0);
      expect(busted.fabricationStation.run.recentWorkpieces.at(-1)).toMatchObject({
        result: "bust",
        xpAwarded: 0,
        bust: { feed: 10, load: 3 },
      });
      // The second of two begins now, with a fresh machine because Override is on.
      expect(busted.fabricationStation.workpiece).toMatchObject({ sequence: 2 });
      expect(busted.fabricationStation.workpiece?.override).toMatchObject({
        pushes: 0,
        locked: false,
      });
    });

    it("never pushes twice for a retried request, nor onto the next workpiece", async () => {
      const { userId, character } = await station("Retry push");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [4]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        2,
        start,
        certain(),
        overrideScript(0, 0),
      );
      const first = await commands.pushFabricationOverride(
        userId,
        character.id,
        3,
        1,
        0,
        at(ticks(1)),
        certain(),
        overrideScript(0, 0),
      );
      const retried = await commands.pushFabricationOverride(
        userId,
        character.id,
        3,
        1,
        0,
        at(ticks(1)),
        certain(),
        overrideScript(0, 0),
      );
      expect(retried.fabricationError).toBe("fabrication_stale_push");
      expect(retried.fabricationStation.workpiece?.override).toEqual(
        first.fabricationStation.workpiece?.override,
      );
      // A bust moves the machine to workpiece 2; a stale Lock In for workpiece 1 changes nothing.
      await commands.pushFabricationOverride(
        userId,
        character.id,
        10,
        1,
        1,
        at(ticks(2)),
        certain(),
        overrideScript(0, 0),
      );
      const stale = await commands.lockInFabricationOverride(userId, character.id, 1, at(ticks(3)));
      expect(stale.fabricationError).toBe("fabrication_stale_push");
      expect(stale.fabricationStation.workpiece?.override?.locked).toBe(false);
    });

    it("locks in by itself on the fifth successful push", async () => {
      const { userId, character } = await station("Five");
      await setCarried(character.id, ITEM_IDS.refinedFerrite, [2]);
      await commands.setManualOverride(userId, character.id, true, start);
      await commands.startFabrication(
        userId,
        character.id,
        ACTION_IDS.mountingBracketFabrication,
        1,
        start,
        certain(),
        overrideScript(0, 0), // Load 2, HIGHER
      );
      // Always draw 0: each push rolls Load + 1 and a Feed on it is exact.
      let state = undefined as
        | Awaited<ReturnType<typeof commands.pushFabricationOverride>>
        | undefined;
      for (let push = 0; push < 5; push += 1) {
        state = await commands.pushFabricationOverride(
          userId,
          character.id,
          3 + push,
          1,
          push,
          at(ticks(1 + push)),
          certain(),
          overrideScript(0, 0),
        );
      }
      expect(state?.fabricationStation.workpiece?.override).toMatchObject({
        pushes: 5,
        locked: true,
        canPush: false,
        multiplierLabel: "3.71×",
      });
      await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(recipes.mountingBracket.durationTicks)),
      );
      expect(await fabricationXp(character.id)).toBe(92); // floor(25 × 1.3^5)
    });
  });

  it("starts Fabrication XP at level 1 on the shared curve", async () => {
    const { userId, character } = await station("Curve");
    const state = await play.getPlayGameplayState(userId, character.id, start, certain());
    expect(state.fabrication).toMatchObject({ level: 1, totalXp: 0, xpToNextLevel: 500 });
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId: character.id,
        skillId: SKILL_IDS.fabrication,
        awardedXp: 2_320,
        thresholds: standardSkillLevelThresholds(balance),
      });
    });
    const level5 = await play.getPlayGameplayState(userId, character.id, start, certain());
    expect(level5.fabrication.level).toBe(5);
    expect(level5.progression.skills.map((skill) => skill.displayName)).toContain("Fabrication");
  });
});
