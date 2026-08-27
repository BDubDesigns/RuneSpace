import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import { consumeStackableItem, removeFromSelectedStack } from "@/server/carried-inventory";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #112 carried stack mutation adapter (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Carried Stack Adapter Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Adapter ${userId.slice(0, 8)}`,
    );
    return character;
  }

  it("consumes exact 5 / 5 / 1 rows in quantity, creation, and ID order", async () => {
    const character = await makeCharacter();
    const createdAt = {
      olderFive: new Date("2026-08-01T00:00:00.000Z"),
      newerFive: new Date("2026-08-02T00:00:00.000Z"),
      one: new Date("2026-08-03T00:00:00.000Z"),
    };
    await db.insert(rune.inventoryStacks).values([
      {
        characterId: character.id,
        itemId: ITEM_IDS.powerCell,
        quantity: 5,
        createdAt: createdAt.newerFive,
      },
      {
        characterId: character.id,
        itemId: ITEM_IDS.powerCell,
        quantity: 1,
        createdAt: createdAt.one,
      },
      {
        characterId: character.id,
        itemId: ITEM_IDS.powerCell,
        quantity: 5,
        createdAt: createdAt.olderFive,
      },
    ]);
    const before = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const olderFive = before.find(
      (stack) => stack.createdAt.getTime() === createdAt.olderFive.getTime(),
    )!;
    const newerFive = before.find(
      (stack) => stack.createdAt.getTime() === createdAt.newerFive.getTime(),
    )!;
    const one = before.find((stack) => stack.createdAt.getTime() === createdAt.one.getTime())!;

    const result = await db.transaction((transaction) =>
      consumeStackableItem(transaction, {
        characterId: character.id,
        itemId: ITEM_IDS.powerCell,
        quantity: 6,
        now: new Date("2026-08-04T00:00:00.000Z"),
      }),
    );

    expect(result).toEqual({
      ok: true,
      updatedStacks: [],
      deletedStackIds: [one.id, olderFive.id],
    });
    await expect(
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id)),
    ).resolves.toMatchObject([{ id: newerFive.id, quantity: 5 }]);
  });

  it("refuses an insufficient exact consumption without changing rows", async () => {
    const character = await makeCharacter();
    await db.insert(rune.inventoryStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.powerCell,
      quantity: 2,
    });
    const before = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));

    const result = await db.transaction((transaction) =>
      consumeStackableItem(transaction, {
        characterId: character.id,
        itemId: ITEM_IDS.powerCell,
        quantity: 3,
        now: new Date("2026-08-04T00:00:00.000Z"),
      }),
    );

    expect(result).toEqual({ ok: false, missingQuantity: 1 });
    await expect(
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id)),
    ).resolves.toEqual(before);
  });

  it("refuses a stale selected row without substituting another Power Cell stack", async () => {
    const character = await makeCharacter();
    const rows = await db
      .insert(rune.inventoryStacks)
      .values([
        { characterId: character.id, itemId: ITEM_IDS.powerCell, quantity: 2 },
        { characterId: character.id, itemId: ITEM_IDS.powerCell, quantity: 1 },
      ])
      .returning();
    await db
      .update(rune.inventoryStacks)
      .set({ quantity: 3 })
      .where(eq(rune.inventoryStacks.id, rows[0]!.id));

    const result = await db.transaction((transaction) =>
      removeFromSelectedStack(transaction, {
        characterId: character.id,
        stackId: rows[0]!.id,
        expectedQuantity: 2,
        expectedItemId: ITEM_IDS.powerCell,
        quantity: 1,
        now: new Date("2026-08-04T00:00:00.000Z"),
      }),
    );

    expect(result).toEqual({ ok: false, reason: "changed" });
    const after = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(after).toHaveLength(rows.length);
    expect(after).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rows[0]!.id, quantity: 3 }),
        expect.objectContaining({ id: rows[1]!.id, quantity: 1 }),
      ]),
    );
  });
});
