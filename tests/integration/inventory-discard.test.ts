import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { discardInventoryStack, discardInventoryStackInTransaction } from "@/server/inventory";
import { createPlayResolver, ensurePlayProvisioning } from "@/server/play";
import { OwnershipError } from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #58 authoritative inventory stack discard (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  const createdUsers: string[] = [];

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

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Discard Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Discard ${userId.slice(0, 8)}`,
    );
    return { userId, character };
  }

  const noYield: MiningRandom = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };
  const successYield: MiningRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  async function provision(userId: string, characterId: string, now: Date) {
    await play.getPlayGameplayState(userId, characterId, now, noYield);
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, characterId));
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

  it("another user cannot discard the character's stack", async () => {
    const { userId, character } = await makeCharacter();
    const other = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 3);

    await expect(
      discardInventoryStack(other.userId, character.id, {
        stackId,
        mode: "stack",
        expectedQuantity: 3,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("an invalid or foreign stack ID changes nothing", async () => {
    const { userId, character } = await makeCharacter();
    const foreign = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 3);
    const foreignStackId = await addStack(foreign.character.id, ITEM_IDS.powerCell, 2);
    const missingId = "00000000-0000-4000-8000-000000000000";

    for (const targetId of [missingId, foreignStackId]) {
      const result = await discardInventoryStack(userId, character.id, {
        stackId: targetId,
        mode: "stack",
        expectedQuantity: 3,
      });
      expect(result.discard).toMatchObject({
        status: "refused",
        message: "Inventory changed. Review the stack and try again.",
      });
    }
    const rows = await stackRows(character.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: stackId, quantity: 3 });
    const foreignRows = await stackRows(foreign.character.id);
    expect(foreignRows[0]).toMatchObject({ id: foreignStackId, quantity: 2 });
  });

  it("Drop 1 decrements exactly once and updates returned mass while preserving the occupied slot", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 5);

    const result = await discardInventoryStack(userId, character.id, {
      stackId,
      mode: "one",
      expectedQuantity: 5,
    });
    expect(result.discard).toEqual({ status: "discarded", discardedQuantity: 1 });
    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ id: stackId, quantity: 4 }]);
    expect(result.state.inventory.stacks).toMatchObject([{ id: stackId, quantity: 4 }]);
    expect(result.state.inventory.slotsUsed).toBe(1);
    expect(result.state.inventory.slotsAvailable).toBe(7);
    // 15,400 g = 10,000 g equipped container + 5,000 g equipped Cutter + 400 g stack.
    expect(result.state.inventory.massGrams).toBe(15_400);
  });

  it("dropping the final item deletes the stack and frees one slot", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 1);

    const result = await discardInventoryStack(userId, character.id, {
      stackId,
      mode: "one",
      expectedQuantity: 1,
    });
    expect(result.discard).toEqual({ status: "discarded", discardedQuantity: 1 });
    await expect(stackRows(character.id)).resolves.toEqual([]);
    expect(result.state.inventory.stacks).toHaveLength(0);
    expect(result.state.inventory.slotsUsed).toBe(0);
    expect(result.state.inventory.slotsAvailable).toBe(8);
  });

  it("Drop stack deletes exactly the confirmed authoritative quantity", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 5);

    const result = await discardInventoryStack(userId, character.id, {
      stackId,
      mode: "stack",
      expectedQuantity: 5,
    });
    expect(result.discard).toEqual({ status: "discarded", discardedQuantity: 5 });
    await expect(stackRows(character.id)).resolves.toEqual([]);
    // Only the equipped container and Cutter remain in carried mass.
    expect(result.state.inventory.massGrams).toBe(15_000);
  });

  it("dropping from a full inventory produces one available slot", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackIds: string[] = [];
    for (let index = 0; index < 8; index += 1)
      stackIds.push(await addStack(character.id, ITEM_IDS.ferriteShale, 2));
    const full = await play.getPlayGameplayState(userId, character.id, now, noYield);
    expect(full.inventory.slotsUsed).toBe(8);
    expect(full.inventory.slotsAvailable).toBe(0);

    const result = await discardInventoryStack(userId, character.id, {
      stackId: stackIds[0]!,
      mode: "stack",
      expectedQuantity: 2,
    });
    expect(result.discard.status).toBe("discarded");
    expect(result.state.inventory.slotsUsed).toBe(7);
    expect(result.state.inventory.slotsAvailable).toBe(1);
    expect(result.state.inventory.stacks).toHaveLength(7);
  });

  it("Power Cell and Ferrite Shale stacks can both be discarded through the same command", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const ferriteId = await addStack(character.id, ITEM_IDS.ferriteShale, 4);
    const cellId = await addStack(character.id, ITEM_IDS.powerCell, 3);

    const ferriteResult = await discardInventoryStack(userId, character.id, {
      stackId: ferriteId,
      mode: "one",
      expectedQuantity: 4,
    });
    expect(ferriteResult.discard.status).toBe("discarded");
    const cellResult = await discardInventoryStack(userId, character.id, {
      stackId: cellId,
      mode: "stack",
      expectedQuantity: 3,
    });
    expect(cellResult.discard.status).toBe("discarded");
    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ id: ferriteId, quantity: 3 }]);
    expect(rows).toHaveLength(1);
    // 15,300 g = equipped container + Cutter + 300 g of remaining Ferrite Shale.
    expect(cellResult.state.inventory.massGrams).toBe(15_300);
  });

  it("unique item instances cannot be discarded through this command", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const instanceRows = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, character.id),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    const cutterInstance = instanceRows[0]!;
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 4 })
      .where(eq(rune.itemInstances.id, cutterInstance.id));

    const result = await discardInventoryStack(userId, character.id, {
      stackId: cutterInstance.id,
      mode: "stack",
      expectedQuantity: 1,
    });
    expect(result.discard.status).toBe("refused");
    const persisted = (
      await db.select().from(rune.itemInstances).where(eq(rune.itemInstances.id, cutterInstance.id))
    )[0]!;
    expect(persisted.currentCharge).toBe(4);
    await expect(stackRows(character.id)).resolves.toEqual([]);
  });

  it("a stale expected quantity is refused without deleting anything", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 5);

    const result = await discardInventoryStack(userId, character.id, {
      stackId,
      mode: "stack",
      expectedQuantity: 3,
    });
    expect(result.discard).toMatchObject({
      status: "refused",
      message: "Inventory changed. Review the stack and try again.",
    });
    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ id: stackId, quantity: 5 }]);
    expect(result.state.inventory.stacks).toMatchObject([{ id: stackId, quantity: 5 }]);
  });

  it("concurrent and retried requests cannot over-delete", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-07-01T00:00:00.000Z");
    await provision(userId, character.id, now);
    const stackId = await addStack(character.id, ITEM_IDS.powerCell, 2);
    const untouchedId = await addStack(character.id, ITEM_IDS.ferriteShale, 1);

    const request = { stackId, mode: "stack" as const, expectedQuantity: 2 };
    const results = await Promise.all([
      discardInventoryStack(userId, character.id, request, now),
      discardInventoryStack(userId, character.id, request, now),
    ]);
    expect(results.filter((result) => result.discard.status === "discarded")).toHaveLength(1);
    expect(results.filter((result) => result.discard.status === "refused")).toHaveLength(1);

    const retried = await discardInventoryStack(userId, character.id, request, now);
    expect(retried.discard.status).toBe("refused");

    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ id: untouchedId, quantity: 1 }]);
    expect(rows).toHaveLength(1);
  });

  it("reconciles due Mining work first and refuses before unconfirmed newly mined quantity could be discarded", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-07-02T00:00:00.000Z");
    const dueAt = new Date("2026-07-02T00:00:06.000Z");
    await provision(userId, character.id, startedAt);
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, successYield);
    // The selected stack holds the confirmed quantity; the due successful
    // attempt will add one more shale to the SAME stack.
    const stackId = await addStack(character.id, ITEM_IDS.ferriteShale, 5);

    const result = await discardInventoryStack(
      userId,
      character.id,
      {
        stackId,
        mode: "stack",
        expectedQuantity: 5,
      },
      dueAt,
      successYield,
    );

    expect(result.discard).toMatchObject({
      status: "refused",
      message: "Inventory changed. Review the stack and try again.",
    });
    // The resolved work committed (one successful attempt), and the discard
    // never removed any of the confirmed or newly mined quantity.
    expect(result.state.run).toMatchObject({ attempts: 1, successes: 1, xpGained: 15 });
    expect(result.state.inventory.stacks).toMatchObject([{ id: stackId, quantity: 6 }]);
    const rows = await stackRows(character.id);
    expect(rows).toMatchObject([{ id: stackId, quantity: 6 }]);
    expect(result.state.ferriteShaleQuantity).toBe(6);
    // A renewed confirmation at the new authoritative quantity still works.
    const retried = await discardInventoryStack(
      userId,
      character.id,
      {
        stackId,
        mode: "stack",
        expectedQuantity: 6,
      },
      dueAt,
      successYield,
    );
    expect(retried.discard.status).toBe("discarded");
    await expect(stackRows(character.id)).resolves.toEqual([]);
  });

  it("a forced failure rolls back resolution and the discard together, preserving all state", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-07-03T00:00:00.000Z");
    const dueAt = new Date("2026-07-03T00:00:06.000Z");
    await provision(userId, character.id, startedAt);
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, successYield);
    // The discard target is a Power Cell stack: due Mining work never touches
    // it, so the discard inside the failing transaction genuinely succeeds
    // before the forced throw.
    const stackId = await addStack(character.id, ITEM_IDS.powerCell, 2);
    const cutterRows = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, character.id),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 7 })
      .where(eq(rune.itemInstances.id, cutterRows[0]!.id));

    async function snapshotState() {
      const [stacks, action, miningState, skillXp, instances] = await Promise.all([
        stackRows(character.id),
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
        db
          .select()
          .from(rune.itemInstances)
          .where(eq(rune.itemInstances.characterId, character.id)),
      ]);
      return JSON.stringify({
        stacks,
        action,
        miningState,
        skillXp,
        instances,
      });
    }

    const before = await snapshotState();
    // The real transaction body performs the actual discard and THEN fails, so
    // the proof covers the deletion itself, not only the resolver's rollback.
    await expect(
      withResolvedOwnedCharacter(
        userId,
        character.id,
        createPlayResolver(successYield),
        async (transaction, context) => {
          await ensurePlayProvisioning(transaction, context.character.id);
          const result = await discardInventoryStackInTransaction(
            transaction,
            context.character.id,
            { stackId, mode: "stack", expectedQuantity: 2 },
            dueAt,
            { successes: 0, failures: 0, awardedXp: 0 },
            undefined,
          );
          expect(result.discard.status).toBe("discarded");
          throw new Error("forced failure after discard");
        },
        dueAt,
      ),
    ).rejects.toThrow(/forced failure after discard/);
    expect(await snapshotState()).toBe(before);

    // The same window still resolves exactly once and commits normally: two
    // boosted attempts consume two of the seven charges.
    const retried = await play.getPlayGameplayState(userId, character.id, dueAt, successYield);
    expect(retried.run).toMatchObject({ attempts: 2, successes: 2, shaleGained: 2, xpGained: 30 });
    expect(retried.inventory.stacks).toMatchObject([
      { itemId: ITEM_IDS.powerCell, quantity: 2 },
      { itemId: ITEM_IDS.ferriteShale, quantity: 2 },
    ]);
    const persistedCutter = (
      await db.select().from(rune.itemInstances).where(eq(rune.itemInstances.id, cutterRows[0]!.id))
    )[0]!;
    expect(persistedCutter.currentCharge).toBe(5);
  });
});
