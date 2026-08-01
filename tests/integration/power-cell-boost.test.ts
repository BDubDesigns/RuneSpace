import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { createPlayResolver } from "@/server/mining";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #24 Salvage Cutter Power Cell boosting (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let mining: typeof import("@/server/mining");
  let equipment: typeof import("@/server/equipment");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    mining = await import("@/server/mining");
    equipment = await import("@/server/equipment");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Power Cell Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Boost ${userId.slice(0, 8)}`,
    );
    return { userId, character };
  }

  async function provision(userId: string, characterId: string, now: Date, random?: MiningRandom) {
    await mining.getMiningGameplayState(userId, characterId, now, {
      nextBasisPoints: () => 9_999,
      nextUnit: () => 0,
      ...random,
    });
  }

  async function addCells(characterId: string, quantity = 1) {
    await db.insert(rune.inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.powerCell,
      quantity,
    });
  }

  async function cutter(characterId: string) {
    const assignments = await db
      .select()
      .from(rune.equippedItems)
      .where(eq(rune.equippedItems.characterId, characterId));
    const tool = assignments.find(
      (assignment) =>
        assignment.assignmentKind === "gear" && assignment.suitSlotId === "mining_tool",
    );
    const rows = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, characterId),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    return rows.find((instance) => instance.id === tool?.itemInstanceId)!;
  }

  it("loads one cell, persists ten charge, and deletes a one-cell stack", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-06-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    await addCells(character.id);

    const result = await mining.loadSalvageCutterPowerCell(userId, character.id, now);
    expect(result.load).toEqual({ status: "loaded", remainingCharge: 10 });
    expect(result.state.equipment.salvageCutter).toMatchObject({ currentCharge: 10 });
    await expect(
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id)),
    ).resolves.toEqual([]);
    const cutterRows = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, character.id));
    expect(
      cutterRows.find((instance) => instance.itemId === ITEM_IDS.salvageCutter)?.currentCharge,
    ).toBe(10);
  });

  it("resolves due Mining before loading and preserves partial cursor progress", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-01T00:00:00.000Z");
    const dueAt = new Date("2026-06-01T00:00:06.000Z");
    await provision(userId, character.id, startedAt);
    await mining.startCrashSiteMining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    await addCells(character.id);

    const loaded = await mining.loadSalvageCutterPowerCell(userId, character.id, dueAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.state.run).toMatchObject({ attempts: 1, successes: 1, xpGained: 15 });
    expect(loaded.state.equipment.salvageCutter?.currentCharge).toBe(10);
    expect(loaded.state.activeAction?.nextAttemptDurationTicks).toBe(5);
  });

  it("preserves partial normal progress when loading during active Mining", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-01T01:00:00.000Z");
    const partialAt = new Date("2026-06-01T01:00:05.400Z");
    await provision(userId, character.id, startedAt);
    await mining.startCrashSiteMining(userId, character.id, startedAt);
    await addCells(character.id);

    const loaded = await mining.loadSalvageCutterPowerCell(userId, character.id, partialAt);
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.state.activeAction?.progressStartedAt).toBe(startedAt.toISOString());
    expect(loaded.state.activeAction?.nextAttemptDurationTicks).toBe(5);
    expect(loaded.state.run.attempts).toBe(0);

    const resolved = await mining.getMiningGameplayState(userId, character.id, partialAt, {
      nextBasisPoints: () => 9_999,
      nextUnit: () => 0,
    });
    expect(resolved.run).toMatchObject({ attempts: 1, failures: 1 });
    expect(resolved.activeAction?.resolvedThroughAt).toBe(
      new Date(startedAt.getTime() + 5 * 600).toISOString(),
    );
  });

  it("serializes retries so only one concurrent load consumes a cell", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-06-02T00:00:00.000Z");
    await provision(userId, character.id, now);
    await addCells(character.id, 2);

    const results = await Promise.all([
      mining.loadSalvageCutterPowerCell(userId, character.id, now),
      mining.loadSalvageCutterPowerCell(userId, character.id, now),
    ]);
    expect(results.map((result) => result.load.status).sort()).toEqual([
      "already_loaded",
      "loaded",
    ]);
    const cells = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(
      cells.filter((stack) => stack.itemId === ITEM_IDS.powerCell).map((stack) => stack.quantity),
    ).toEqual([1]);
  });

  it("switches a persisted active batch from boosted to normal timing", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-03T00:00:00.000Z");
    const now = new Date("2026-06-03T00:00:36.000Z");
    await provision(userId, character.id, startedAt);
    await mining.startCrashSiteMining(userId, character.id, startedAt);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, startedAt);
    const cutterRow = await cutter(character.id);
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 2 })
      .where(eq(rune.itemInstances.id, cutterRow.id));

    const resolved = await mining.getMiningGameplayState(userId, character.id, now, {
      nextBasisPoints: () => 9_999,
      nextUnit: () => 0,
    });
    expect(resolved.run).toMatchObject({ attempts: 7, failures: 7 });
    expect(resolved.run.recentAttempts.map((attempt) => attempt.durationTicks)).toEqual([
      5, 5, 10, 10, 10, 10, 10,
    ]);
    expect(resolved.run.recentAttempts.slice(0, 2).every((attempt) => attempt.boosted)).toBe(true);
    expect(resolved.run.recentAttempts.slice(2).every((attempt) => !attempt.boosted)).toBe(true);
    expect(resolved.run.recentAttempts.map((attempt) => attempt.resolvedAt)).toEqual([
      new Date(startedAt.getTime() + 3_000).toISOString(),
      new Date(startedAt.getTime() + 6_000).toISOString(),
      new Date(startedAt.getTime() + 12_000).toISOString(),
      new Date(startedAt.getTime() + 18_000).toISOString(),
      new Date(startedAt.getTime() + 24_000).toISOString(),
      new Date(startedAt.getTime() + 30_000).toISOString(),
      new Date(startedAt.getTime() + 36_000).toISOString(),
    ]);
    expect(resolved.equipment.salvageCutter?.currentCharge).toBe(0);
    expect(resolved.activeAction?.nextAttemptDurationTicks).toBe(10);
  });

  it("keeps charge on the same Cutter when it is re-equipped", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-06-04T00:00:00.000Z");
    await provision(userId, character.id, now);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, now);
    const cutterId = (await cutter(character.id)).id;
    await equipment.changeEquipment(
      userId,
      character.id,
      { kind: "unequip", target: { assignmentKind: "gear", suitSlotId: "mining_tool" } },
      now,
    );
    const reequipped = await equipment.changeEquipment(
      userId,
      character.id,
      {
        kind: "equip",
        itemInstanceId: cutterId,
        target: { assignmentKind: "gear", suitSlotId: "mining_tool" },
      },
      now,
    );
    expect(reequipped.equipment.salvageCutter?.currentCharge).toBe(10);
  });

  it("commits charge, reward, XP, history, and cursor together for a boosted success", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-05T00:00:00.000Z");
    const resolvedAt = new Date("2026-06-05T00:00:03.500Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await provision(userId, character.id, startedAt, random);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, startedAt, random);
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);

    const resolved = await mining.getMiningGameplayState(userId, character.id, resolvedAt, random);
    expect(resolved.run).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
    expect(resolved.run).toMatchObject({ shaleGained: 1, xpGained: 15 });
    expect(resolved.activeAction?.resolvedThroughAt).toBe(
      new Date("2026-06-05T00:00:03.000Z").toISOString(),
    );
    expect(resolved.activeAction?.nextAttemptAt).toBe(
      new Date("2026-06-05T00:00:06.000Z").toISOString(),
    );
    expect(resolved.run.recentAttempts).toMatchObject([
      {
        sequence: 1,
        success: true,
        boosted: true,
        durationTicks: 5,
        chargeConsumed: true,
        remainingCharge: 9,
      },
    ]);
    expect(resolved.equipment.salvageCutter?.currentCharge).toBe(9);
    expect(resolved.ferriteShaleQuantity).toBe(1);
    expect(resolved.mining.totalXp).toBe(15);
  });

  it("consumes charge atomically for a boosted failure without reward or XP", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-06T00:00:00.000Z");
    const resolvedAt = new Date("2026-06-06T00:00:03.500Z");
    const alwaysFail = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };
    await provision(userId, character.id, startedAt, alwaysFail);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, startedAt, alwaysFail);
    await mining.startCrashSiteMining(userId, character.id, startedAt, alwaysFail);

    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      resolvedAt,
      alwaysFail,
    );
    expect(resolved.run).toMatchObject({ attempts: 1, successes: 0, failures: 1 });
    expect(resolved.run).toMatchObject({ shaleGained: 0, xpGained: 0 });
    expect(resolved.run.recentAttempts).toMatchObject([
      {
        sequence: 1,
        success: false,
        boosted: true,
        durationTicks: 5,
        chargeConsumed: true,
        remainingCharge: 9,
      },
    ]);
    expect(resolved.equipment.salvageCutter?.currentCharge).toBe(9);
    expect(resolved.ferriteShaleQuantity).toBe(0);
    expect(resolved.mining.totalXp).toBe(0);
    expect(resolved.activeAction?.nextAttemptAt).toBe(
      new Date("2026-06-06T00:00:06.000Z").toISOString(),
    );
  });

  it("rolls back charge, reward, XP, history, and cursor when persistence fails after the charge mutation", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-07T00:00:00.000Z");
    const resolvedAt = new Date("2026-06-07T00:00:03.500Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await provision(userId, character.id, startedAt, random);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, startedAt, random);
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);
    const cutterId = (await cutter(character.id)).id;

    // Force a persistence failure after the resolver has already written the
    // charge mutation. Everything — charge, reward, XP, history, cursor — must
    // roll back as one unit. The wrapped persist reads the mutated charge
    // through the same transaction before throwing.
    let mutationTransaction: DatabaseTransaction | undefined;
    let chargeAtMutation: number | null = null;
    const play = createPlayResolver(random);
    const forcedFailure = {
      ...play,
      persist: async (transaction: DatabaseTransaction, outcome: unknown) => {
        mutationTransaction = transaction;
        await play.persist(transaction, outcome as Parameters<typeof play.persist>[1]);
        const rows = await mutationTransaction
          .select()
          .from(rune.itemInstances)
          .where(eq(rune.itemInstances.id, cutterId));
        chargeAtMutation = rows[0]?.currentCharge ?? null;
        throw new Error("forced persistence failure after charge mutation");
      },
    };

    await expect(
      withResolvedOwnedCharacter(
        userId,
        character.id,
        forcedFailure,
        async () => undefined,
        resolvedAt,
      ),
    ).rejects.toThrow(/forced persistence failure/i);
    expect(chargeAtMutation).toBe(9);

    const cutterRows = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(eq(rune.itemInstances.id, cutterId), eq(rune.itemInstances.characterId, character.id)),
      );
    expect(cutterRows[0]?.currentCharge).toBe(10);
    await expect(
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id)),
    ).resolves.toEqual([]);
    const xpRows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp).toBe(0);
    const stateRows = await db
      .select()
      .from(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, character.id));
    expect(stateRows[0]).toMatchObject({
      runAttempts: 0,
      runSuccesses: 0,
      runShaleGained: 0,
      runXpGained: 0,
    });
    expect(stateRows[0]?.recentAttempts).toEqual([]);
    const actionRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actionRows[0]?.resolvedThroughAt).toEqual(startedAt);

    // The same window can still be resolved once and commits normally.
    const retried = await mining.getMiningGameplayState(userId, character.id, resolvedAt, random);
    expect(retried.run).toMatchObject({ attempts: 1, successes: 1, shaleGained: 1, xpGained: 15 });
    expect(retried.equipment.salvageCutter?.currentCharge).toBe(9);
  });

  it("never charges an unequipped spare Cutter", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-06-08T00:00:00.000Z");
    await provision(userId, character.id, now);
    const spareCutter = (
      await db
        .insert(rune.itemInstances)
        .values({ characterId: character.id, itemId: ITEM_IDS.salvageCutter })
        .returning()
    )[0]!;
    await addCells(character.id);

    const loaded = await mining.loadSalvageCutterPowerCell(userId, character.id, now);
    expect(loaded.load.status).toBe("loaded");
    const equippedCutter = await cutter(character.id);
    expect(equippedCutter.id).not.toBe(spareCutter.id);
    expect(equippedCutter.currentCharge).toBe(10);
    const spareRows = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.id, spareCutter.id));
    expect(spareRows[0]?.currentCharge).toBeNull();
  });

  it("keeps the charged Cutter through stop/start, a Travel round trip, and re-equipping", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-06-09T00:00:00.000Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await provision(userId, character.id, startedAt, random);
    await addCells(character.id);
    await mining.loadSalvageCutterPowerCell(userId, character.id, startedAt, random);

    await mining.startCrashSiteMining(userId, character.id, startedAt, random);
    expect((await cutter(character.id)).currentCharge).toBe(10);
    await mining.stopMining(userId, character.id, startedAt, random);
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);
    expect((await cutter(character.id)).currentCharge).toBe(10);

    // Round trip to the adjacent Power Annex: 40 ticks (24 s) per leg.
    await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.emergencyPowerAnnex,
      startedAt,
      random,
    );
    const atAnnex = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-06-09T00:00:24.600Z"),
      random,
    );
    expect(atAnnex.location.currentLocationId).toBe(LOCATION_IDS.emergencyPowerAnnex);
    expect((await cutter(character.id)).currentCharge).toBe(10);
    await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      new Date("2026-06-09T00:00:24.600Z"),
      random,
    );
    const backAtCrashSite = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-06-09T00:00:49.200Z"),
      random,
    );
    expect(backAtCrashSite.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
    expect((await cutter(character.id)).currentCharge).toBe(10);

    const cutterId = (await cutter(character.id)).id;
    await equipment.changeEquipment(
      userId,
      character.id,
      { kind: "unequip", target: { assignmentKind: "gear", suitSlotId: "mining_tool" } },
      new Date("2026-06-09T00:00:49.200Z"),
      random,
    );
    const reequipped = await equipment.changeEquipment(
      userId,
      character.id,
      {
        kind: "equip",
        itemInstanceId: cutterId,
        target: { assignmentKind: "gear", suitSlotId: "mining_tool" },
      },
      new Date("2026-06-09T00:00:49.200Z"),
      random,
    );
    expect(reequipped.equipment.salvageCutter?.currentCharge).toBe(10);
  });
});
