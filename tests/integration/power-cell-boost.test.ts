import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";

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
    for (const userId of createdUsers.splice(0)) await cleanupUser(userId);
  });

  async function makeCharacter() {
    const userId = randomUUID();
    createdUsers.push(userId);
    await db.insert(authSchema.user).values({
      id: userId,
      name: "Power Cell Tester",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const account = await ownership.ensurePlayerAccount(userId);
    const character = await characters.createCharacter(account.id, `Boost ${userId.slice(0, 8)}`);
    return { userId, character };
  }

  async function cleanupUser(userId: string) {
    const accounts = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    for (const account of accounts) {
      const owned = await db
        .select({ id: rune.characters.id })
        .from(rune.characters)
        .where(eq(rune.characters.playerAccountId, account.id));
      for (const character of owned) {
        await db
          .delete(rune.characterPowerCellDailyClaims)
          .where(eq(rune.characterPowerCellDailyClaims.characterId, character.id));
        await db
          .delete(rune.characterMiningState)
          .where(eq(rune.characterMiningState.characterId, character.id));
        await db
          .delete(rune.characterStarterProvisioning)
          .where(eq(rune.characterStarterProvisioning.characterId, character.id));
        await db
          .delete(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id));
        await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, character.id));
        await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, character.id));
        await db
          .delete(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id));
        await db
          .delete(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id));
        await db.delete(rune.itemInstances).where(eq(rune.itemInstances.characterId, character.id));
      }
      await db.delete(rune.characters).where(eq(rune.characters.playerAccountId, account.id));
    }
    await db.delete(rune.playerAccounts).where(eq(rune.playerAccounts.userId, userId));
    await db.delete(authSchema.user).where(eq(authSchema.user.id, userId));
  }

  async function provision(userId: string, characterId: string, now: Date) {
    await mining.getMiningGameplayState(userId, characterId, now, {
      nextBasisPoints: () => 9_999,
      nextUnit: () => 0,
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
});
