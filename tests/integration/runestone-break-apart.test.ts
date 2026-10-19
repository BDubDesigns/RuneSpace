import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { breakApartRunestone, breakApartRunestoneInTransaction } from "@/server/inventory";
import { createPlayResolver, ensurePlayProvisioning } from "@/server/play";
import { OwnershipError } from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const { runestone: STONE, runeFragment: FRAGMENT, ferriteShale: SHALE } = ITEM_IDS;
const STALE = "Inventory changed. Review the stack and try again.";

/**
 * Issue #367 — Break Apart against real PostgreSQL: one selected Runestone
 * becomes exactly five Rune Fragments in one transaction, judged against the
 * Inventory the conversion would leave behind, with no duplication or loss
 * under stale, repeated or simultaneous requests.
 */
suite("Issue #367 Runestone Break Apart (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-01T00:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const noYield: MiningRandom = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Stonebreaker");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Stone${userId.slice(0, 8)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, noYield);
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  async function addStack(characterId: string, itemId: string, quantity: number): Promise<string> {
    const rows = await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return rows[0]!.id;
  }

  async function stackRows(characterId: string) {
    return db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
  }

  const total = (rows: { itemId: string; quantity: number }[], itemId: string) =>
    rows.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.quantity, 0);

  /** Fill `count` slots with unrelated full stacks. */
  async function fillSlots(characterId: string, count: number) {
    for (let index = 0; index < count; index += 1) await addStack(characterId, SHALE, 10);
  }

  it("consumes a lone Runestone and creates five Fragments atomically, with mass unchanged", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 1);
    const before = await play.getPlayGameplayState(userId, character.id, now, noYield);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 1 },
      now,
    );
    expect(result.breakApart).toEqual({
      status: "broken",
      consumedQuantity: 1,
      producedQuantity: 5,
    });
    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ itemId: FRAGMENT, quantity: 5 }]);
    expect(rows.some((row) => row.id === stackId)).toBe(false);
    // The authoritative return reconciles the Inventory: one tile in, one out, 1 kg either way.
    expect(result.state.inventory.stacks).toMatchObject([{ itemId: FRAGMENT, quantity: 5 }]);
    expect(result.state.inventory.slotsUsed).toBe(before.inventory.slotsUsed);
    expect(result.state.inventory.massGrams).toBe(before.inventory.massGrams);
    expect(result.state.carriedByItemId[STONE] ?? 0).toBe(0);
    expect(result.state.carriedByItemId[FRAGMENT]).toBe(5);
  });

  it("breaks exactly one stone from a larger stack and leaves the rest", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 3);
    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 3 },
      now,
    );
    expect(result.breakApart.status).toBe("broken");
    const rows = await stackRows(character.id);
    expect(rows.find((row) => row.id === stackId)).toMatchObject({ quantity: 2 });
    expect(total(rows, FRAGMENT)).toBe(5);
    expect(result.state.inventory.slotsUsed).toBe(2);
  });

  it("merges into a partial Fragment stack first and spills the rest into the stone's freed slot", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 1);
    const partial = await addStack(character.id, FRAGMENT, 8);
    await fillSlots(character.id, 6);
    // Eight of eight slots in use: only the stone's own slot can take the 3 that do not merge.
    const full = await play.getPlayGameplayState(userId, character.id, now, noYield);
    expect(full.inventory.slotsAvailable).toBe(0);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 1 },
      now,
    );
    expect(result.breakApart.status).toBe("broken");
    const rows = await stackRows(character.id);
    expect(rows.find((row) => row.id === partial)).toMatchObject({ quantity: 10 });
    expect(
      rows
        .filter((row) => row.itemId === FRAGMENT)
        .map((row) => row.quantity)
        .sort((a, b) => a - b),
    ).toEqual([3, 10]);
    expect(total(rows, STONE)).toBe(0);
    expect(result.state.inventory.slotsUsed).toBe(8);
  });

  it("needs no free slot at all when partial Fragment stacks can absorb every Fragment", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 2);
    await addStack(character.id, FRAGMENT, 5);
    await addStack(character.id, FRAGMENT, 5);
    await fillSlots(character.id, 5);
    const full = await play.getPlayGameplayState(userId, character.id, now, noYield);
    expect(full.inventory.slotsAvailable).toBe(0);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 2 },
      now,
    );
    expect(result.breakApart.status).toBe("broken");
    const rows = await stackRows(character.id);
    expect(total(rows, FRAGMENT)).toBe(15);
    expect(rows.find((row) => row.id === stackId)).toMatchObject({ quantity: 1 });
  });

  it("uses the slot a last stone frees in a completely full Inventory", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 1);
    await fillSlots(character.id, 7);
    const full = await play.getPlayGameplayState(userId, character.id, now, noYield);
    expect(full.inventory.slotsAvailable).toBe(0);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 1 },
      now,
    );
    expect(result.breakApart.status).toBe("broken");
    expect(total(await stackRows(character.id), FRAGMENT)).toBe(5);
    expect(result.state.inventory.slotsAvailable).toBe(0);
  });

  it("refuses with both items unchanged when a stack of stones frees no slot in a full Inventory", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 2);
    await fillSlots(character.id, 7);
    const before = await stackRows(character.id);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 2 },
      now,
    );
    expect(result.breakApart).toMatchObject({ status: "refused", reason: "slots" });
    if (result.breakApart.status === "refused")
      expect(result.breakApart.message).toMatch(/free Inventory slots/);
    const after = await stackRows(character.id);
    expect(after).toHaveLength(before.length);
    expect(after.find((row) => row.id === stackId)).toMatchObject({ itemId: STONE, quantity: 2 });
    expect(total(after, FRAGMENT)).toBe(0);
    expect(result.state.carriedByItemId[STONE]).toBe(2);
  });

  it("refuses a stale quantity without changing either item, then works again once reconfirmed", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 3);

    const stale = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 2 },
      now,
    );
    expect(stale.breakApart).toMatchObject({
      status: "refused",
      reason: "stack_changed",
      message: STALE,
    });
    expect(await stackRows(character.id)).toMatchObject([{ id: stackId, quantity: 3 }]);

    const retried = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 3 },
      now,
    );
    expect(retried.breakApart.status).toBe("broken");
  });

  it("refuses a missing, foreign or non-Runestone stack without touching anything", async () => {
    const { userId, character } = await makeCharacter();
    const foreign = await makeCharacter();
    const fragments = await addStack(character.id, FRAGMENT, 5);
    const foreignStone = await addStack(foreign.character.id, STONE, 1);
    const missing = "00000000-0000-4000-8000-000000000000";

    expect(
      (
        await breakApartRunestone(
          userId,
          character.id,
          { stackId: fragments, expectedQuantity: 5 },
          now,
        )
      ).breakApart,
    ).toMatchObject({ status: "refused", reason: "not_breakable" });
    for (const stackId of [missing, foreignStone]) {
      expect(
        (await breakApartRunestone(userId, character.id, { stackId, expectedQuantity: 1 }, now))
          .breakApart,
      ).toMatchObject({ status: "refused", reason: "stack_not_found", message: STALE });
    }
    expect(await stackRows(character.id)).toMatchObject([{ id: fragments, quantity: 5 }]);
    expect(await stackRows(foreign.character.id)).toMatchObject([
      { id: foreignStone, quantity: 1 },
    ]);
  });

  it("another user cannot break apart the character's Runestone", async () => {
    const { character } = await makeCharacter();
    const other = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 1);
    await expect(
      breakApartRunestone(other.userId, character.id, { stackId, expectedQuantity: 1 }, now),
    ).rejects.toThrow(OwnershipError);
    expect(await stackRows(character.id)).toMatchObject([{ id: stackId, quantity: 1 }]);
  });

  it("cannot duplicate Fragments through simultaneous or replayed requests", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 1);
    const request = { stackId, expectedQuantity: 1 };

    const results = await Promise.all([
      breakApartRunestone(userId, character.id, request, now),
      breakApartRunestone(userId, character.id, request, now),
      breakApartRunestone(userId, character.id, request, now),
    ]);
    expect(results.filter((result) => result.breakApart.status === "broken")).toHaveLength(1);
    expect(results.filter((result) => result.breakApart.status === "refused")).toHaveLength(2);
    const replay = await breakApartRunestone(userId, character.id, request, now);
    expect(replay.breakApart.status).toBe("refused");

    const rows = await stackRows(character.id);
    expect(total(rows, FRAGMENT)).toBe(5);
    expect(total(rows, STONE)).toBe(0);
  });

  it("converts exactly one stone per confirmed quantity when requests race on a larger stack", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 2);
    const request = { stackId, expectedQuantity: 2 };
    const results = await Promise.all([
      breakApartRunestone(userId, character.id, request, now),
      breakApartRunestone(userId, character.id, request, now),
    ]);
    expect(results.filter((result) => result.breakApart.status === "broken")).toHaveLength(1);
    const rows = await stackRows(character.id);
    expect(total(rows, STONE)).toBe(1);
    expect(total(rows, FRAGMENT)).toBe(5);
  });

  it("resolves due Mining first, so capacity and stale checks see the Fragments Mining just found", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-10-02T00:00:00.000Z");
    const dueAt = new Date("2026-10-02T00:00:06.000Z");
    // Every attempt succeeds at minimum yield and finds a Rune Fragment (The Jag's roll 5).
    const findsFragment: MiningRandom = {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
      nextInteger: () => 5,
    };
    await miningCommands.startMining(userId, character.id, startedAt, findsFragment);
    const stackId = await addStack(character.id, STONE, 1);

    const result = await breakApartRunestone(
      userId,
      character.id,
      { stackId, expectedQuantity: 1 },
      dueAt,
      findsFragment,
    );
    expect(result.breakApart.status).toBe("broken");
    // One mined Fragment (+20 XP with its Shale's 15) plus the five from the stone.
    expect(result.state.run).toMatchObject({ attempts: 1, successes: 1, xpGained: 35 });
    expect(total(await stackRows(character.id), FRAGMENT)).toBe(6);
    expect(result.state.carriedByItemId[FRAGMENT]).toBe(6);
  });

  it("a forced failure after the conversion rolls the stone and the Fragments back together", async () => {
    const { userId, character } = await makeCharacter();
    const stackId = await addStack(character.id, STONE, 2);
    await addStack(character.id, FRAGMENT, 4);
    const before = JSON.stringify(
      (await stackRows(character.id)).sort((a, b) => a.id.localeCompare(b.id)),
    );

    await expect(
      withResolvedOwnedCharacter(
        userId,
        character.id,
        createPlayResolver(noYield),
        async (transaction, context) => {
          await ensurePlayProvisioning(transaction, context.character.id);
          const result = await breakApartRunestoneInTransaction(
            transaction,
            context.character.id,
            { stackId, expectedQuantity: 2 },
            now,
            { successes: 0, failures: 0, awardedXp: 0 },
          );
          // The real conversion committed inside the transaction before the failure.
          expect(result.breakApart.status).toBe("broken");
          throw new Error("forced failure after Break Apart");
        },
        now,
      ),
    ).rejects.toThrow("forced failure after Break Apart");

    const after = JSON.stringify(
      (await stackRows(character.id)).sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(after).toBe(before);
    expect(
      await db
        .select()
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, character.id),
            eq(rune.inventoryStacks.itemId, STONE),
          ),
        ),
    ).toMatchObject([{ id: stackId, quantity: 2 }]);
  });
});
