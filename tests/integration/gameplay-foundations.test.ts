import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { LevelThreshold } from "@/game/domain/progression";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const thresholds: readonly LevelThreshold[] = [
  { level: 1, totalXp: 0 },
  { level: 2, totalXp: 10 },
];

suite("gameplay foundations (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let mining: typeof import("@/server/mining");
  let resolution: typeof import("@/server/action-resolution");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    mining = await import("@/server/mining");
    resolution = await import("@/server/action-resolution");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0)) await cleanupUser(userId);
  });

  async function makeCharacter() {
    const userId = randomUUID();
    createdUsers.push(userId);
    await db.insert(authSchema.user).values({
      id: userId,
      name: "Gameplay Tester",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const account = await ownership.ensurePlayerAccount(userId);
    const character = await characters.createCharacter(account.id, `Game ${userId.slice(0, 6)}`);
    return { userId, character };
  }

  async function cleanupUser(userId: string) {
    const accounts = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    for (const account of accounts) {
      const characterRows = await db
        .select({ id: rune.characters.id })
        .from(rune.characters)
        .where(eq(rune.characters.playerAccountId, account.id));
      for (const character of characterRows) {
        await db
          .delete(rune.characterMiningState)
          .where(eq(rune.characterMiningState.characterId, character.id));
        await db
          .delete(rune.characterStarterProvisioning)
          .where(eq(rune.characterStarterProvisioning.characterId, character.id));
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

  it("enforces gameplay persistence constraints created by the migration", async () => {
    const { character } = await makeCharacter();
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId: character.id, skillId: SKILL_IDS.mining });
    await expect(
      db
        .insert(rune.characterSkillXp)
        .values({ characterId: character.id, skillId: SKILL_IDS.mining }),
    ).rejects.toThrow();
    await expect(
      db.insert(rune.inventoryStacks).values({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 0,
      }),
    ).rejects.toThrow();

    const instance = await db
      .insert(rune.itemInstances)
      .values({ characterId: character.id, itemId: ITEM_IDS.salvageCutter })
      .returning();
    const itemInstance = instance[0]!;
    await db.insert(rune.equippedItems).values({
      characterId: character.id,
      assignmentKind: "container",
      suitSlotId: "future_suit_slot",
      itemInstanceId: itemInstance.id,
    });
    const secondInstance = await db
      .insert(rune.itemInstances)
      .values({ characterId: character.id, itemId: ITEM_IDS.powerCell })
      .returning();
    await expect(
      db.insert(rune.equippedItems).values({
        characterId: character.id,
        assignmentKind: "container",
        suitSlotId: "future_suit_slot",
        itemInstanceId: secondInstance[0]!.id,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(rune.equippedItems).values({
        characterId: character.id,
        assignmentKind: "container",
        suitSlotId: "other_future_suit_slot",
        itemInstanceId: itemInstance.id,
      }),
    ).rejects.toThrow();

    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });
    await expect(
      db.insert(rune.activeActions).values({
        characterId: character.id,
        actionId: "test_action",
        startedAt,
        resolvedThroughAt: startedAt,
      }),
    ).rejects.toThrow();
  });

  it("authorizes ownership and resolves a concurrent deterministic outcome exactly once", async () => {
    const { userId, character } = await makeCharacter();
    const outsider = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:00.600Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });

    let resolverCalls = 0;
    let enteredFirstPersistence: (() => void) | undefined;
    const firstPersistenceEntered = new Promise<void>((resolve) => {
      enteredFirstPersistence = resolve;
    });
    let releaseFirstPersistence: (() => void) | undefined;
    const firstPersistenceGate = new Promise<void>((resolve) => {
      releaseFirstPersistence = resolve;
    });
    const resolver = {
      load: () => ({ source: "test" }),
      resolve: () => ({ outcome: 5, transition: { kind: "continue" as const, consumedTicks: 1 } }),
      persist: async (transaction: DatabaseTransaction, award: number) => {
        resolverCalls += 1;
        if (resolverCalls === 1) {
          enteredFirstPersistence?.();
          await firstPersistenceGate;
        }
        await grantCharacterSkillXp(transaction, {
          characterId: character.id,
          skillId: SKILL_IDS.mining,
          awardedXp: award,
          thresholds,
        });
        await transaction.insert(rune.inventoryStacks).values({
          characterId: character.id,
          itemId: ITEM_IDS.ferriteShale,
          quantity: 1,
        });
      },
    };

    await expect(
      resolution.withResolvedOwnedCharacter(
        outsider.userId,
        character.id,
        resolver,
        async () => undefined,
        now,
      ),
    ).rejects.toThrow(/not found/i);

    const firstRequest = resolution.withResolvedOwnedCharacter(
      userId,
      character.id,
      resolver,
      async () => undefined,
      now,
    );
    await firstPersistenceEntered;
    const secondRequest = resolution.withResolvedOwnedCharacter(
      userId,
      character.id,
      resolver,
      async () => undefined,
      now,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(resolverCalls).toBe(1);
    releaseFirstPersistence?.();
    await Promise.all([firstRequest, secondRequest]);

    const xpRows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    const stackRows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const actionRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(xpRows).toHaveLength(1);
    expect(resolverCalls).toBe(1);
    expect(xpRows[0]?.totalXp).toBe(5);
    expect(stackRows).toHaveLength(1);
    expect(actionRows[0]?.resolvedThroughAt).toEqual(now);
  });

  it("loads a transaction-locked snapshot and advances only through consumed partial attempts", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:06.600Z");
    await db.insert(rune.inventoryStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 1,
    });
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });

    const resolver = {
      load: async (transaction: DatabaseTransaction) => {
        const stacks = await transaction
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id))
          .for("update");
        return { stackCount: stacks.length };
      },
      resolve: ({ snapshot }: { snapshot: { readonly stackCount: number } }) => {
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(snapshot.stackCount).toBe(1);
        return { outcome: undefined, transition: { kind: "continue" as const, consumedTicks: 10 } };
      },
      persist: async () => undefined,
    };

    const actionAfterResolution = await resolution.withResolvedOwnedCharacter(
      userId,
      character.id,
      resolver,
      async (_transaction, context) => context.action,
      now,
    );
    expect(actionAfterResolution?.resolvedThroughAt).toEqual(new Date("2026-01-01T00:00:06.000Z"));
  });

  it("returns the replacement action with its consumed cursor to the command", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:00.600Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });

    const actionAfterResolution = await resolution.withResolvedOwnedCharacter(
      userId,
      character.id,
      {
        load: () => ({}),
        resolve: () => ({
          outcome: undefined,
          transition: {
            kind: "replace" as const,
            consumedTicks: 1,
            action: {
              actionId: "replacement_action",
              startedAt,
            },
          },
        }),
        persist: async () => undefined,
      },
      async (_transaction, context) => context.action,
      now,
    );
    expect(actionAfterResolution).toMatchObject({
      actionId: "replacement_action",
      resolvedThroughAt: now,
    });
  });

  it("returns an absent action to the command after resolution stops it", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:00.600Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });

    const actionAfterResolution = await resolution.withResolvedOwnedCharacter(
      userId,
      character.id,
      {
        load: () => ({}),
        resolve: () => ({
          outcome: undefined,
          transition: { kind: "stop" as const, consumedTicks: 1 },
        }),
        persist: async () => undefined,
      },
      async (_transaction, context) => context.action,
      now,
    );
    expect(actionAfterResolution).toBeUndefined();
    await expect(
      db.select().from(rune.activeActions).where(eq(rune.activeActions.characterId, character.id)),
    ).resolves.toEqual([]);
  });

  it("rolls back XP, inventory, and cursor when resolution fails before commit", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:00.600Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "test_action",
      startedAt,
      resolvedThroughAt: startedAt,
    });

    const failingResolver = {
      load: () => ({}),
      resolve: () => ({
        outcome: undefined,
        transition: { kind: "continue" as const, consumedTicks: 1 },
      }),
      persist: async (transaction: DatabaseTransaction) => {
        await transaction.insert(rune.characterSkillXp).values({
          characterId: character.id,
          skillId: SKILL_IDS.mining,
          totalXp: 5,
        });
        await transaction.insert(rune.inventoryStacks).values({
          characterId: character.id,
          itemId: ITEM_IDS.ferriteShale,
          quantity: 1,
        });
        throw new Error("intentional transaction failure");
      },
    };

    await expect(
      resolution.withResolvedOwnedCharacter(
        userId,
        character.id,
        failingResolver,
        async () => undefined,
        now,
      ),
    ).rejects.toThrow(/intentional/i);
    await expect(
      db
        .select()
        .from(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, character.id)),
    ).resolves.toEqual([]);
    await expect(
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id)),
    ).resolves.toEqual([]);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions[0]?.resolvedThroughAt).toEqual(startedAt);
  });

  it("provisions a starter loadout once and resolves a retried Mining attempt once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await mining.getMiningGameplayState(userId, character.id, startedAt, random);
    await Promise.all([
      mining.startCrashSiteMining(userId, character.id, startedAt, random),
      mining.startCrashSiteMining(userId, character.id, startedAt, random),
    ]);
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
      random,
    );
    expect(resolved.ferriteShaleQuantity).toBe(1);
    expect(resolved.mining.totalXp).toBe(15);
    expect(resolved.run).toMatchObject({
      attempts: 1,
      successes: 1,
      failures: 0,
      shaleGained: 1,
      xpGained: 15,
    });
    expect(resolved.run.recentAttempts).toMatchObject([
      {
        sequence: 1,
        success: true,
        rolledBasisPoints: 0,
        thresholdBasisPoints: 3500,
        shaleAwarded: 1,
        xpAwarded: 15,
      },
    ]);
    const repeat = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
      random,
    );
    expect(repeat.ferriteShaleQuantity).toBe(1);
    expect(repeat.run.attempts).toBe(1);
    const starterItems = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, character.id));
    expect(starterItems).toHaveLength(2);
  });

  it("retains only the latest ten details while run totals preserve an offline batch", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const random = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };
    await mining.getMiningGameplayState(userId, character.id, startedAt, random);
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:01:12.000Z"),
      random,
    );
    expect(resolved.run).toMatchObject({
      attempts: 12,
      successes: 0,
      failures: 12,
      shaleGained: 0,
      xpGained: 0,
    });
    expect(resolved.run.recentAttempts).toHaveLength(10);
    expect(resolved.run.recentAttempts.map((attempt) => attempt.sequence)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    await mining.stopMining(userId, character.id, new Date("2026-01-01T00:01:12.000Z"), random);
    const stopped = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:01:12.000Z"),
      random,
    );
    expect(stopped.run.attempts).toBe(12);
    const restarted = await mining.startCrashSiteMining(
      userId,
      character.id,
      new Date("2026-01-01T00:01:13.000Z"),
      random,
    );
    expect(restarted.run).toMatchObject({
      attempts: 0,
      successes: 0,
      failures: 0,
      shaleGained: 0,
      xpGained: 0,
      recentAttempts: [],
    });
  });

  it("creates one persisted stack after a full Ferrite Shale stack without replaying it", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await mining.getMiningGameplayState(userId, character.id, startedAt, random);
    await db.insert(rune.inventoryStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 10,
    });
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
      random,
    );
    expect(resolved.inventory.stacks.map((stack) => stack.quantity).sort((a, b) => b - a)).toEqual([
      10, 1,
    ]);
    expect(resolved.inventory.slotsUsed).toBe(2);
    expect(resolved.run).toMatchObject({
      attempts: 1,
      successes: 1,
      shaleGained: 1,
      xpGained: 15,
    });
    const retry = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
      random,
    );
    expect(retry.inventory.stacks.map((stack) => stack.quantity).sort((a, b) => b - a)).toEqual([
      10, 1,
    ]);
    expect(retry.run.attempts).toBe(1);
    const rows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(rows.map((stack) => stack.quantity).sort((a, b) => b - a)).toEqual([10, 1]);
  });

  it("preserves an unsupported active action during Mining commands", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const resolvedThroughAt = new Date("2026-01-01T00:00:03.000Z");
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "future_activity",
      startedAt,
      resolvedThroughAt,
    });

    const state = await mining.startCrashSiteMining(
      userId,
      character.id,
      new Date("2026-01-01T00:01:00.000Z"),
    );
    expect(state.commandError).toBe("another_action_active");
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions[0]).toMatchObject({ actionId: "future_activity", startedAt, resolvedThroughAt });
  });

  it("does not create a Mining action when the preflight has no compatible tool", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await mining.getMiningGameplayState(userId, character.id, now);
    await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, character.id));

    const state = await mining.startCrashSiteMining(userId, character.id, now);
    expect(state.stoppingReason).toBe("compatible_mining_tool_missing");
    await expect(
      db.select().from(rune.activeActions).where(eq(rune.activeActions.characterId, character.id)),
    ).resolves.toEqual([]);
  });
});
