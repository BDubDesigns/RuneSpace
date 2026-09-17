import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  WORK_ORDER_IDS,
  type WorkOrderId,
} from "@/game/config/foundations";
import { TEN_THOUSAND_ONE_HOURS } from "@/game/content/missions";
import { getWorkOrder } from "@/game/content/work-orders";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #207 — 10,001 Hours' authoritative boundaries, against real PostgreSQL.
 *
 * The Mission that opens client work, and the rules only a database proves:
 * that its Welding gate holds against the authoritative command rather than
 * only against the surface that renders it, that its one requirement counts
 * finished jobs and nothing else on the journey to one, that accepting it is
 * what unlocks the board permanently — before the turn-in as much as after —
 * and that Wade's shop bundle is handed over whole or not at all.
 */
suite("issue #207 10,001 Hours (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let workOrderCommands: typeof import("@/server/work-order-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-15T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const sectionMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;

  /** Slot 0 is welded in these tests; slot 1 proves the board stays usable. */
  const FIRST_JOB = WORK_ORDER_IDS.tansyCutterHousing;
  const SECOND_JOB = WORK_ORDER_IDS.rennCarryFrame;
  const BOARD: readonly WorkOrderId[] = [FIRST_JOB, SECOND_JOB, WORK_ORDER_IDS.vossHeaterHousing];
  const first = getWorkOrder(FIRST_JOB)!;
  const second = getWorkOrder(SECOND_JOB)!;
  const bundle = TEN_THOUSAND_ONE_HOURS.reward!;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    workOrderCommands = await import("@/server/work-order-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  const at = (msFromStart: number) => new Date(start.getTime() + msFromStart);

  /**
   * An apprentice standing in Wade's yard with the chain behind them.
   *
   * `predecessorComplete` is the only interesting variation: 10,000 Hours
   * accepted-but-unfinished is exactly the state in which the terminal is
   * visible and the Mission behind it must still be out of reach.
   */
  async function apprentice(
    options: { predecessorComplete?: boolean; weldingLevel?: number } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Ten Thousand One Hours Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Client ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, deterministicRandom());
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
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: MISSION_IDS.tenThousandHours,
      acceptedAt: start,
      completedAt: options.predecessorComplete === false ? null : start,
    });
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    await setWeldingLevel(
      character.id,
      options.weldingLevel ?? balance.workOrders.requiredWeldingLevel,
    );
    return { userId, character };
  }

  async function setWeldingLevel(characterId: string, level: number) {
    const totalXp = standardSkillLevelThresholds(balance).find(
      (threshold) => threshold.level === level,
    )!.totalXp;
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId, skillId: SKILL_IDS.welding, totalXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp },
      });
  }

  /** The board the Work Order tests weld against, chosen rather than drawn. */
  async function seedBoard(characterId: string) {
    await db
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    await db.insert(rune.characterWorkOrderPostings).values(
      BOARD.map((workOrderId, slotIndex) => ({
        characterId,
        slotIndex,
        workOrderId,
        postedAt: start,
        updatedAt: start,
      })),
    );
  }

  async function giveMaterials(
    characterId: string,
    materials: readonly { itemId: string; quantity: number }[],
  ) {
    for (const material of materials) {
      const definition = getItemDefinition(material.itemId, balance);
      if (definition?.kind !== "stack") {
        throw new Error(`${material.itemId} is not a stackable Work Order material`);
      }
      let remaining = material.quantity;
      while (remaining > 0) {
        const quantity = Math.min(remaining, definition.stackLimit);
        remaining -= quantity;
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId, itemId: material.itemId, quantity });
      }
    }
  }

  const acceptMission = (userId: string, characterId: string, ms = 0) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.tenThousandOneHours,
      NPC_IDS.wadeRusk,
      at(ms),
      deterministicRandom(),
    );

  const completeMission = (userId: string, characterId: string, ms = 0) =>
    missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.tenThousandOneHours,
      NPC_IDS.wadeRusk,
      at(ms),
      deterministicRandom(),
    );

  const refresh = (userId: string, characterId: string, ms: number) =>
    play.getPlayGameplayState(userId, characterId, at(ms), deterministicRandom());

  async function missionRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, MISSION_IDS.tenThousandOneHours),
          ),
        )
    )[0];
  }

  async function workOrdersCompleted(characterId: string) {
    return (
      (
        await db
          .select({ progress: rune.characterMissionProgress.progress })
          .from(rune.characterMissionProgress)
          .where(
            and(
              eq(rune.characterMissionProgress.characterId, characterId),
              eq(rune.characterMissionProgress.missionId, MISSION_IDS.tenThousandOneHours),
              eq(rune.characterMissionProgress.progressKey, "work-orders-completed"),
            ),
          )
      )[0]?.progress ?? 0
    );
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

  /** Weld the accepted job at slot 0 through to its completion transaction. */
  async function finishFirstJob(userId: string, characterId: string) {
    await workOrderCommands.startWorkOrderWelding(
      userId,
      characterId,
      start,
      deterministicRandom(),
    );
    await refresh(userId, characterId, sectionMs * first.sections);
  }

  /** A character whose Work Order is done and whose Mission is not yet turned in. */
  async function readyForTurnIn() {
    const { userId, character } = await apprentice();
    expect((await acceptMission(userId, character.id)).mission.status).toBe("accepted");
    await seedBoard(character.id);
    await giveMaterials(character.id, first.materials);
    await workOrderCommands.acceptWorkOrder(
      userId,
      character.id,
      FIRST_JOB,
      start,
      deterministicRandom(),
    );
    await finishFirstJob(userId, character.id);
    expect(await workOrdersCompleted(character.id)).toBe(1);
    return { userId, character };
  }

  it("is neither offered nor accepted before 10,000 Hours is complete", async () => {
    const { userId, character } = await apprentice({ predecessorComplete: false });

    const state = await refresh(userId, character.id, 0);
    const projected = state.missions.find(
      (mission) => mission.missionId === MISSION_IDS.tenThousandOneHours,
    );
    expect(projected?.state).toBe("not_accepted");
    expect(projected?.prerequisiteSatisfied).toBe(false);

    const refused = await acceptMission(userId, character.id);
    expect(refused.mission.status).toBe("refused");
    expect(await missionRow(character.id)).toBeUndefined();
  });

  it("holds its Welding gate against the authoritative command, not just the surface", async () => {
    const { userId, character } = await apprentice({
      weldingLevel: TEN_THOUSAND_ONE_HOURS.prerequisiteSkillLevel!.level - 1,
    });

    // Submitted straight to the command, with no surface involved at all.
    const refused = await acceptMission(userId, character.id);
    expect(refused.mission.status).toBe("refused");
    if (refused.mission.status !== "refused") throw new Error("gate fixture failed");
    expect(refused.mission.message).toMatch(/Welding level 5/);
    expect(await missionRow(character.id)).toBeUndefined();

    // And the very same submission is accepted the moment the level is real.
    await setWeldingLevel(character.id, TEN_THOUSAND_ONE_HOURS.prerequisiteSkillLevel!.level);
    const accepted = await acceptMission(userId, character.id, 1_000);
    expect(accepted.mission.status).toBe("accepted");
    expect((await missionRow(character.id))?.acceptedAt).not.toBeNull();
  });

  it("unlocks the board on acceptance and keeps it usable at 1/1, before the turn-in", async () => {
    const { userId, character } = await apprentice();
    await seedBoard(character.id);
    await giveMaterials(character.id, first.materials);

    // Locked beforehand: the board is the Mission's, not the level's.
    const locked = await workOrderCommands.acceptWorkOrder(
      userId,
      character.id,
      FIRST_JOB,
      start,
      deterministicRandom(),
    );
    expect(locked.workOrder).toMatchObject({ status: "refused", reason: "work_orders_locked" });

    await acceptMission(userId, character.id);
    expect(locked.state.workOrders.unlocked).toBe(false);
    const unlocked = await workOrderCommands.acceptWorkOrder(
      userId,
      character.id,
      FIRST_JOB,
      at(1_000),
      deterministicRandom(),
    );
    expect(unlocked.workOrder).toMatchObject({ status: "accepted" });
    expect(unlocked.state.workOrders.unlocked).toBe(true);

    // Finish it, so the objective reads 1/1 with the Mission still open.
    await finishFirstJob(userId, character.id);
    expect(await workOrdersCompleted(character.id)).toBe(1);
    expect((await missionRow(character.id))?.completedAt).toBeNull();

    // The board is still the player's: a second job goes on the bench.
    await giveMaterials(character.id, second.materials);
    const again = await workOrderCommands.acceptWorkOrder(
      userId,
      character.id,
      SECOND_JOB,
      at(sectionMs * first.sections + 1_000),
      deterministicRandom(),
    );
    expect(again.workOrder).toMatchObject({ status: "accepted", workOrderId: SECOND_JOB });
    expect(again.state.workOrders.unlocked).toBe(true);
  });

  it("advances the requirement only on a finished job, and only once", async () => {
    const { userId, character } = await apprentice();
    await acceptMission(userId, character.id);
    await seedBoard(character.id);
    await giveMaterials(character.id, first.materials);
    expect(await workOrdersCompleted(character.id)).toBe(0);

    // Taking the job is not doing the job.
    await workOrderCommands.acceptWorkOrder(
      userId,
      character.id,
      FIRST_JOB,
      start,
      deterministicRandom(),
    );
    expect(await workOrdersCompleted(character.id)).toBe(0);

    // Neither is lighting the torch.
    await workOrderCommands.startWorkOrderWelding(
      userId,
      character.id,
      start,
      deterministicRandom(),
    );
    expect(await workOrdersCompleted(character.id)).toBe(0);

    // Nor is any number of individual sections short of the last one.
    for (const sections of [1, 4, first.sections - 1]) {
      await refresh(userId, character.id, sectionMs * sections);
      expect(await workOrdersCompleted(character.id)).toBe(0);
    }

    // The completion transaction is the one writer, and it writes once.
    await refresh(userId, character.id, sectionMs * first.sections);
    expect(await workOrdersCompleted(character.id)).toBe(1);
    await refresh(userId, character.id, sectionMs * first.sections * 4);
    expect(await workOrdersCompleted(character.id)).toBe(1);
  });

  it("grants Wade's whole shop bundle at the turn-in", async () => {
    const { userId, character } = await readyForTurnIn();

    const completed = await completeMission(userId, character.id, sectionMs * first.sections + 1);
    expect(completed.mission.status).toBe("completed");
    expect((await missionRow(character.id))?.completedAt).not.toBeNull();

    if (bundle.kind !== "stack_bundle") throw new Error("reward fixture failed");
    for (const entry of bundle.items) {
      expect(await carried(character.id, entry.itemId)).toBe(entry.quantity);
    }
    expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(10);
    expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(5);
  });

  it("refuses the whole bundle without the slots for it, leaving nothing behind", async () => {
    const { userId, character } = await readyForTurnIn();
    // Six of eight slots occupied: the bundle needs three free and gets two.
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 6 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 1,
      })),
    );

    const refused = await completeMission(userId, character.id, sectionMs * first.sections + 1);
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "slots",
    });
    expect((await missionRow(character.id))?.completedAt).toBeNull();
    expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
    expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(0);
  });

  it("refuses the whole bundle over carried mass, leaving nothing behind", async () => {
    const { userId, character } = await readyForTurnIn();
    const state = await refresh(userId, character.id, sectionMs * first.sections);
    // One dense stack, in one slot: the refusal must be about mass, not room.
    const freeGrams = state.inventory.capacityGrams - state.inventory.massGrams;
    await db.insert(rune.inventoryStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: Math.ceil((freeGrams - 100) / balance.items.ferriteShale.massGrams),
    });

    const refused = await completeMission(userId, character.id, sectionMs * first.sections + 1);
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "mass",
    });
    expect((await missionRow(character.id))?.completedAt).toBeNull();
    expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
    expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(0);
  });

  it("completes cleanly on the retry once the player has made room, and only once", async () => {
    const { userId, character } = await readyForTurnIn();
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 6 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 1,
      })),
    );
    expect((await completeMission(userId, character.id, 1)).mission.status).toBe("refused");

    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, character.id),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      );

    const retried = await completeMission(userId, character.id, 2);
    expect(retried.mission.status).toBe("completed");

    // Retried and concurrent turn-ins hand over no second bundle.
    const [again, alsoAgain] = await Promise.all([
      completeMission(userId, character.id, 3),
      completeMission(userId, character.id, 4),
    ]);
    expect(again.mission.status).toBe("already_completed");
    expect(alsoAgain.mission.status).toBe("already_completed");
    expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(10);
    expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(5);
  });
});
