import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #57 carried unique items in Inventory (real PostgreSQL)", () => {
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
    const userId = await createTestUser(db, authSchema, "Carried Item Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Carry ${userId.slice(0, 8)}`,
    );
    return { userId, character };
  }

  const noYield: MiningRandom = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };

  async function provision(userId: string, characterId: string, now: Date) {
    await mining.getMiningGameplayState(userId, characterId, now, noYield);
  }

  async function cutterInstance(characterId: string) {
    const rows = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, characterId),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    return rows[0]!;
  }

  async function fillSlots(characterId: string, quantity: number, stackQuantity = 1) {
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: quantity }, () => ({
        characterId,
        itemId: ITEM_IDS.ferriteShale,
        quantity: stackQuantity,
      })),
    );
  }

  const miningToolTarget = {
    assignmentKind: "gear" as const,
    suitSlotId: "mining_tool",
  };

  it("projects an unequipped Cutter as one carried inventory slot with identity, mass, and charge", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const cutter = await cutterInstance(character.id);
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 4 })
      .where(eq(rune.itemInstances.id, cutter.id));
    // Seven stacks use seven of the eight aggregate slots; one slot remains.
    await fillSlots(character.id, 7);

    const unequipped = await equipment.changeEquipment(
      userId,
      character.id,
      { kind: "unequip", target: miningToolTarget },
      now,
      noYield,
    );

    expect(unequipped.inventory.slotsUsed).toBe(8);
    expect(unequipped.inventory.slotsAvailable).toBe(0);
    expect(unequipped.inventory.stacks).toHaveLength(7);
    // The occupied count equals the rendered entries (stacks + carried unique items).
    expect(unequipped.inventory.stacks.length + unequipped.inventory.uniqueItems.length).toBe(
      unequipped.inventory.slotsUsed,
    );
    // The exact unequipped Cutter instance appears once, with player-facing fields only.
    expect(unequipped.inventory.uniqueItems).toEqual([
      {
        id: cutter.id,
        itemId: ITEM_IDS.salvageCutter,
        name: "Salvage Cutter",
        massGrams: 5_000,
        currentCharge: 4,
      },
    ]);
    // The equipped MYKEA container must not appear as a carried entry.
    const equippedContainer = (
      await db
        .select()
        .from(rune.equippedItems)
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.assignmentKind, "container"),
          ),
        )
    )[0]!;
    expect(
      unequipped.inventory.uniqueItems.some((item) => item.id === equippedContainer.itemInstanceId),
    ).toBe(false);
    // Carried mass covers the seven stacks, the carried Cutter, and the equipped container.
    expect(unequipped.inventory.massGrams).toBe(15_700);
  });

  it("re-equipping the same Cutter removes it from carried inventory and preserves identity and charge", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const cutter = await cutterInstance(character.id);
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 6 })
      .where(eq(rune.itemInstances.id, cutter.id));
    await fillSlots(character.id, 7);

    await equipment.changeEquipment(
      userId,
      character.id,
      { kind: "unequip", target: miningToolTarget },
      now,
      noYield,
    );
    const reequipped = await equipment.changeEquipment(
      userId,
      character.id,
      { kind: "equip", itemInstanceId: cutter.id, target: miningToolTarget },
      now,
      noYield,
    );

    expect(reequipped.inventory.uniqueItems).toHaveLength(0);
    expect(reequipped.inventory.slotsUsed).toBe(7);
    expect(reequipped.equipment.salvageCutter).toMatchObject({
      currentCharge: 6,
      maximumCharge: 10,
    });
    const assignments = await db
      .select()
      .from(rune.equippedItems)
      .where(eq(rune.equippedItems.characterId, character.id));
    const toolAssignment = assignments.find(
      (assignment) =>
        assignment.assignmentKind === "gear" && assignment.suitSlotId === "mining_tool",
    );
    expect(toolAssignment?.itemInstanceId).toBe(cutter.id);
    const persisted = await cutterInstance(character.id);
    expect(persisted.currentCharge).toBe(6);
  });

  it("refuses a full-inventory unequip atomically, rolling back resolved Mining work", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = new Date("2026-01-01T00:00:06.000Z");
    await provision(userId, character.id, startedAt);
    const successRandom: MiningRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await mining.startCrashSiteMining(userId, character.id, startedAt, successRandom);
    const cutter = await cutterInstance(character.id);
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 7 })
      .where(eq(rune.itemInstances.id, cutter.id));
    // Seven FULL stacks leave one slot free: the due successful attempt creates
    // the eighth stack, so the refused unequip must roll back resolved work.
    await fillSlots(character.id, 7, 10);

    async function snapshotState() {
      const [assignments, stacks, instances, action, miningState, skillXp] = await Promise.all([
        db
          .select()
          .from(rune.equippedItems)
          .where(eq(rune.equippedItems.characterId, character.id)),
        db
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id)),
        db
          .select()
          .from(rune.itemInstances)
          .where(eq(rune.itemInstances.characterId, character.id)),
        db
          .select()
          .from(rune.activeActions)
          .where(eq(rune.activeActions.characterId, character.id)),
        db
          .select()
          .from(rune.characterMiningState)
          .where(eq(rune.characterMiningState.characterId, character.id)),
        db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id)),
      ]);
      const sortRows = <T>(rows: readonly T[], key: (row: T) => string) =>
        [...rows].sort((a, b) => key(a).localeCompare(key(b)));
      return JSON.stringify({
        assignments: sortRows(assignments, (a) => `${a.assignmentKind}:${a.suitSlotId}`),
        stacks: sortRows(stacks, (s) => s.id),
        instances: sortRows(instances, (i) => i.id),
        action,
        miningState,
        skillXp: sortRows(skillXp, (s) => s.skillId),
      });
    }

    const before = await snapshotState();
    await expect(
      equipment.changeEquipment(
        userId,
        character.id,
        { kind: "unequip", target: miningToolTarget },
        dueAt,
        successRandom,
      ),
    ).rejects.toThrow(/would not fit/i);
    const after = await snapshotState();
    expect(after).toBe(before);
    // The pending Mining work stayed uncommitted: the cursor did not advance.
    const action = (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, character.id))
    )[0]!;
    expect(action.resolvedThroughAt.toISOString()).toBe(startedAt.toISOString());

    // The rolled-back attempts are neither lost nor duplicated: the boosted
    // Cutter resolves both due attempts exactly once when retried at the same
    // due time, filling the eighth stack.
    const retried = await mining.getMiningGameplayState(userId, character.id, dueAt, successRandom);
    expect(retried.run).toMatchObject({ attempts: 2, successes: 2, shaleGained: 2, xpGained: 30 });
    expect(retried.inventory.stacks).toHaveLength(8);
    expect(retried.ferriteShaleQuantity).toBe(72);
  });
});
