import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #89 Cargo Hold repair and Welding (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let cargo: typeof import("@/server/cargo-hold");
  let equipment: typeof import("@/server/equipment");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const deterministicRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  };

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    cargo = await import("@/server/cargo-hold");
    equipment = await import("@/server/equipment");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Cargo Hold Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Cargo ${userId.slice(0, 8)}`,
    );
    const now = new Date("2026-08-21T18:00:00.000Z");
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom);
    return { userId, character, now };
  }

  async function installRepairMaterials(userId: string, characterId: string, now: Date) {
    await db.insert(rune.inventoryStacks).values([
      {
        characterId,
        itemId: ITEM_IDS.refinedFerrite,
        quantity: balance.cargoHold.refinedFerriteRequired,
      },
      { characterId, itemId: ITEM_IDS.slag, quantity: balance.cargoHold.slagRequired },
    ]);
    const contribution = await cargo.contributeCargoHoldMaterials(
      userId,
      characterId,
      {
        expectedRefinedFerrite: balance.cargoHold.refinedFerriteRequired,
        expectedSlag: balance.cargoHold.slagRequired,
      },
      now,
      deterministicRandom,
    );
    expect(contribution.cargo).toEqual({
      status: "committed",
      refinedFerrite: balance.cargoHold.refinedFerriteRequired,
      slag: balance.cargoHold.slagRequired,
    });
    return contribution.state;
  }

  async function restoreCargoHold(userId: string, characterId: string, now: Date) {
    await installRepairMaterials(userId, characterId, now);
    const started = await cargo.startCargoHoldWelding(
      userId,
      characterId,
      now,
      deterministicRandom,
    );
    expect(started.activeAction?.actionId).toBe(ACTION_IDS.cargoHoldWelding);
    return play.getPlayGameplayState(
      userId,
      characterId,
      new Date(
        now.getTime() +
          balance.welding.repairIncrements * balance.welding.attemptDurationTicks * 600,
      ),
      deterministicRandom,
    );
  }

  async function inventoryAndCargoRows(characterId: string) {
    const [stacks, instances, cargoStacks, cargoItems] = await Promise.all([
      db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, characterId)),
      db.select().from(rune.itemInstances).where(eq(rune.itemInstances.characterId, characterId)),
      db
        .select()
        .from(rune.cargoHoldStacks)
        .where(eq(rune.cargoHoldStacks.characterId, characterId)),
      db
        .select()
        .from(rune.cargoHoldItemInstances)
        .where(eq(rune.cargoHoldItemInstances.characterId, characterId)),
    ]);
    return { stacks, instances, cargoStacks, cargoItems };
  }

  it("commits useful material exactly once under concurrent requests", async () => {
    const { userId, character, now } = await makeCharacter();
    await db.insert(rune.inventoryStacks).values([
      { characterId: character.id, itemId: ITEM_IDS.refinedFerrite, quantity: 20 },
      { characterId: character.id, itemId: ITEM_IDS.slag, quantity: 10 },
    ]);

    const requests = await Promise.all([
      cargo.contributeCargoHoldMaterials(
        userId,
        character.id,
        { expectedRefinedFerrite: 15, expectedSlag: 6 },
        now,
        deterministicRandom,
      ),
      cargo.contributeCargoHoldMaterials(
        userId,
        character.id,
        { expectedRefinedFerrite: 15, expectedSlag: 6 },
        now,
        deterministicRandom,
      ),
    ]);

    expect(requests.map((request) => request.cargo.status).sort()).toEqual([
      "committed",
      "refused",
    ]);
    const repair = (
      await db
        .select()
        .from(rune.characterCargoHoldRepair)
        .where(eq(rune.characterCargoHoldRepair.characterId, character.id))
    )[0]!;
    expect(repair).toMatchObject({ refinedFerriteContributed: 15, slagContributed: 6 });
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(stacks).toHaveLength(2);
    expect(stacks.reduce((total, stack) => total + stack.quantity, 0)).toBe(9);
  });

  it("resolves only whole Welding passes, preserves a partial stop, and hard-stops at completion", async () => {
    const { userId, character, now } = await makeCharacter();
    await installRepairMaterials(userId, character.id, now);
    const started = await cargo.startCargoHoldWelding(
      userId,
      character.id,
      now,
      deterministicRandom,
    );
    expect(started.welding.totalXp).toBe(0);

    const partialAt = new Date(now.getTime() + 4 * 600);
    const partial = await play.getPlayGameplayState(
      userId,
      character.id,
      partialAt,
      deterministicRandom,
    );
    expect(partial.cargoHold.repair.weldingProgress).toBe(0);
    expect(partial.welding.totalXp).toBe(0);
    expect(partial.activeAction?.actionId).toBe(ACTION_IDS.cargoHoldWelding);

    const stopped = await cargo.stopCargoHoldWelding(
      userId,
      character.id,
      partialAt,
      deterministicRandom,
    );
    expect(stopped.activeAction).toBeUndefined();
    expect(stopped.cargoHold.repair.weldingProgress).toBe(0);

    const restartAt = new Date(partialAt.getTime() + 600);
    await cargo.startCargoHoldWelding(userId, character.id, restartAt, deterministicRandom);
    const completed = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date(restartAt.getTime() + 12 * 5 * 600),
      deterministicRandom,
    );
    expect(completed.activeAction).toBeUndefined();
    expect(completed.cargoHold.repair).toMatchObject({
      weldingProgress: 12,
      weldingIncrements: 12,
      complete: true,
    });
    expect(completed.cargoHold.repair.completedAt).toBeTruthy();
    expect(completed.welding).toMatchObject({ totalXp: 600, level: 2 });
    expect(
      (
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, character.id),
              eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
            ),
          )
      )[0]?.totalXp,
    ).toBe(600);

    const repeated = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date(restartAt.getTime() + 60 * 600),
      deterministicRandom,
    );
    expect(repeated.welding.totalXp).toBe(600);
    expect(repeated.cargoHold.repair.weldingProgress).toBe(12);
    const refusedRestart = await cargo.startCargoHoldWelding(
      userId,
      character.id,
      new Date(restartAt.getTime() + 60 * 600),
      deterministicRandom,
    );
    expect(refusedRestart.weldingError).toBe("repair_complete");
  });

  it("replaces an incomplete Welding pass when Travel begins", async () => {
    const { userId, character, now } = await makeCharacter();
    await installRepairMaterials(userId, character.id, now);
    await cargo.startCargoHoldWelding(userId, character.id, now, deterministicRandom);

    const partialAt = new Date(now.getTime() + 4 * 600);
    const travel = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      partialAt,
      deterministicRandom,
    );

    expect(travel.travelState?.destinationLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    expect(
      (
        await db
          .select()
          .from(rune.activeActions)
          .where(eq(rune.activeActions.characterId, character.id))
      )[0]?.actionId,
    ).toBe(ACTION_IDS.travel);
    expect(travel.cargoHold.repair.weldingProgress).toBe(0);
    expect(travel.welding.totalXp).toBe(0);
  });

  it("transfers stack and unique identities without bypassing carried capacity", async () => {
    const { userId, character, now } = await makeCharacter();
    const restored = await restoreCargoHold(userId, character.id, now);

    const carriedStack = (
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 3 })
        .returning()
    )[0]!;
    const extraCutter = (
      await db
        .insert(rune.itemInstances)
        .values({ characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 7 })
        .returning()
    )[0]!;
    const extraContainer = (
      await db
        .insert(rune.itemInstances)
        .values({ characterId: character.id, itemId: ITEM_IDS.mykeaSchleppraum8 })
        .returning()
    )[0]!;
    const equippedCutter = (
      await db
        .select({ itemInstanceId: rune.equippedItems.itemInstanceId })
        .from(rune.equippedItems)
        .where(
          and(
            eq(rune.equippedItems.characterId, character.id),
            eq(rune.equippedItems.assignmentKind, "gear"),
          ),
        )
    )[0]!.itemInstanceId;

    const depositedOne = await cargo.depositCargoStack(
      userId,
      character.id,
      { stackId: carriedStack.id, mode: "one", expectedQuantity: 3 },
      now,
      deterministicRandom,
    );
    expect(depositedOne.cargo).toMatchObject({ status: "transferred", quantity: 1 });
    const cargoStack = depositedOne.state.cargoHold.stacks[0]!;
    expect(cargoStack.quantity).toBe(1);

    const depositedRest = await cargo.depositCargoStack(
      userId,
      character.id,
      { stackId: carriedStack.id, mode: "stack", expectedQuantity: 2 },
      now,
      deterministicRandom,
    );
    expect(depositedRest.cargo).toMatchObject({ status: "transferred", quantity: 2 });
    expect(depositedRest.state.cargoHold.stacks).toHaveLength(1);
    expect(depositedRest.state.cargoHold.stacks[0]?.quantity).toBe(3);

    const withdrawnOne = await cargo.withdrawCargoStack(
      userId,
      character.id,
      { stackId: cargoStack.id, mode: "one", expectedQuantity: 3 },
      now,
      deterministicRandom,
    );
    expect(withdrawnOne.cargo).toMatchObject({ status: "transferred", quantity: 1 });
    const reducedCargoStack = withdrawnOne.state.cargoHold.stacks[0]!;
    const withdrawnRest = await cargo.withdrawCargoStack(
      userId,
      character.id,
      { stackId: reducedCargoStack.id, mode: "stack", expectedQuantity: 2 },
      now,
      deterministicRandom,
    );
    expect(withdrawnRest.cargo).toMatchObject({ status: "transferred", quantity: 2 });
    expect(withdrawnRest.state.cargoHold.stacks).toEqual([]);
    expect(withdrawnRest.state.inventory.stacks).toHaveLength(1);
    expect(withdrawnRest.state.inventory.stacks[0]).toMatchObject({
      itemId: ITEM_IDS.ferriteShale,
      quantity: 3,
    });

    const equippedRefusal = await cargo.depositCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: equippedCutter },
      now,
      deterministicRandom,
    );
    expect(equippedRefusal.cargo).toMatchObject({ status: "refused", reason: "equipped_item" });

    const storedUnique = await cargo.depositCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: extraCutter.id },
      now,
      deterministicRandom,
    );
    expect(storedUnique.cargo).toMatchObject({
      status: "transferred",
      itemInstanceId: extraCutter.id,
    });
    expect(storedUnique.state.cargoHold.uniqueItems).toMatchObject([
      { id: extraCutter.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 7 },
    ]);
    const storedContainer = await cargo.depositCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: extraContainer.id },
      now,
      deterministicRandom,
    );
    expect(storedContainer.cargo).toMatchObject({
      status: "transferred",
      itemInstanceId: extraContainer.id,
    });
    expect(storedContainer.state.cargoHold.uniqueItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: extraCutter.id,
          itemId: ITEM_IDS.salvageCutter,
          currentCharge: 7,
          massGrams: 5_000,
        }),
        expect.objectContaining({
          id: extraContainer.id,
          itemId: ITEM_IDS.mykeaSchleppraum8,
          massGrams: 10_000,
        }),
      ]),
    );
    expect(storedContainer.state.inventory.slotsUsed).toBe(restored.inventory.slotsUsed + 1);
    expect(storedContainer.state.inventory.massGrams).toBe(
      restored.inventory.massGrams + 3 * balance.items.ferriteShale.massGrams,
    );
    expect(storedContainer.state.inventory.uniqueItems.map((item) => item.id)).not.toContain(
      extraCutter.id,
    );
    expect(storedContainer.state.inventory.uniqueItems.map((item) => item.id)).not.toContain(
      extraContainer.id,
    );

    await expect(
      equipment.changeEquipment(
        userId,
        character.id,
        {
          kind: "equip",
          itemInstanceId: extraCutter.id,
          target: {
            assignmentKind: "gear",
            suitSlotId: balance.items.salvageCutter.suitSlotId,
          },
        },
        now,
        deterministicRandom,
      ),
    ).rejects.toThrow(/currently carried/i);
    expect(
      await db
        .select()
        .from(rune.cargoHoldItemInstances)
        .where(eq(rune.cargoHoldItemInstances.itemInstanceId, extraCutter.id)),
    ).toHaveLength(1);

    const withdrawnUnique = await cargo.withdrawCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: extraCutter.id },
      now,
      deterministicRandom,
    );
    expect(withdrawnUnique.cargo).toMatchObject({
      status: "transferred",
      itemInstanceId: extraCutter.id,
    });
    expect(withdrawnUnique.state.inventory.uniqueItems).toMatchObject([
      { id: extraCutter.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 7 },
    ]);
    expect(
      (
        await db.select().from(rune.itemInstances).where(eq(rune.itemInstances.id, extraCutter.id))
      )[0]?.currentCharge,
    ).toBe(7);
  });

  it("refuses a complete stack withdrawal when carried slots are full without partial transfer", async () => {
    const { userId, character, now } = await makeCharacter();
    await restoreCargoHold(userId, character.id, now);
    await db.insert(rune.cargoHoldStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 3,
    });
    await db.insert(rune.itemInstances).values(
      Array.from({ length: 8 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.salvageCutter,
        currentCharge: 0,
      })),
    );
    const before = await inventoryAndCargoRows(character.id);

    const result = await cargo.withdrawCargoStack(
      userId,
      character.id,
      {
        stackId: before.cargoStacks[0]!.id,
        mode: "stack",
        expectedQuantity: 3,
      },
      now,
      deterministicRandom,
    );
    expect(result.cargo).toMatchObject({ status: "refused", reason: "carried_capacity" });
    expect(await inventoryAndCargoRows(character.id)).toEqual(before);
  });

  it("refuses a complete stack withdrawal when carried mass is insufficient, while WITHDRAW 1 remains explicit", async () => {
    const { userId, character, now } = await makeCharacter();
    await restoreCargoHold(userId, character.id, now);
    await db.insert(rune.cargoHoldStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.powerCell,
      quantity: 5,
    });
    await db.insert(rune.itemInstances).values(
      Array.from({ length: 3 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.mykeaSchleppraum8,
      })),
    );
    await db.insert(rune.inventoryStacks).values([
      { characterId: character.id, itemId: ITEM_IDS.powerCell, quantity: 5 },
      { characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 5 },
    ]);
    const before = await inventoryAndCargoRows(character.id);

    const result = await cargo.withdrawCargoStack(
      userId,
      character.id,
      {
        stackId: before.cargoStacks[0]!.id,
        mode: "stack",
        expectedQuantity: 5,
      },
      now,
      deterministicRandom,
    );
    expect(result.cargo).toMatchObject({ status: "refused", reason: "carried_capacity" });
    expect(await inventoryAndCargoRows(character.id)).toEqual(before);

    const smaller = await cargo.withdrawCargoStack(
      userId,
      character.id,
      {
        stackId: before.cargoStacks[0]!.id,
        mode: "one",
        expectedQuantity: 5,
      },
      now,
      deterministicRandom,
    );
    expect(smaller.cargo).toMatchObject({ status: "transferred", quantity: 1 });
  });

  it("refuses a unique withdrawal when no carried slot is available without changing either location", async () => {
    const { userId, character, now } = await makeCharacter();
    await restoreCargoHold(userId, character.id, now);
    const stored = (
      await db
        .insert(rune.itemInstances)
        .values({ characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 4 })
        .returning()
    )[0]!;
    await db.insert(rune.cargoHoldItemInstances).values({
      characterId: character.id,
      itemInstanceId: stored.id,
      storedAt: now,
    });
    await db.insert(rune.itemInstances).values(
      Array.from({ length: 8 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.salvageCutter,
        currentCharge: 0,
      })),
    );
    const before = await inventoryAndCargoRows(character.id);

    const result = await cargo.withdrawCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: stored.id },
      now,
      deterministicRandom,
    );
    expect(result.cargo).toMatchObject({ status: "refused", reason: "carried_capacity" });
    expect(await inventoryAndCargoRows(character.id)).toEqual(before);
  });

  it("refuses a unique withdrawal when carried mass is insufficient without changing either location", async () => {
    const { userId, character, now } = await makeCharacter();
    await restoreCargoHold(userId, character.id, now);
    const stored = (
      await db
        .insert(rune.itemInstances)
        .values({ characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 4 })
        .returning()
    )[0]!;
    await db.insert(rune.cargoHoldItemInstances).values({
      characterId: character.id,
      itemInstanceId: stored.id,
      storedAt: now,
    });
    await db.insert(rune.itemInstances).values(
      Array.from({ length: 7 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.salvageCutter,
        currentCharge: 0,
      })),
    );
    const before = await inventoryAndCargoRows(character.id);

    const result = await cargo.withdrawCargoUniqueItem(
      userId,
      character.id,
      { itemInstanceId: stored.id },
      now,
      deterministicRandom,
    );
    expect(result.cargo).toMatchObject({ status: "refused", reason: "carried_capacity" });
    expect(await inventoryAndCargoRows(character.id)).toEqual(before);
  });

  it("refuses storage outside stationary Crash Site and rejects a full occupied hold", async () => {
    const { userId, character, now } = await makeCharacter();
    await restoreCargoHold(userId, character.id, now);
    const carriedStack = (
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 1 })
        .returning()
    )[0]!;

    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    const away = await cargo.depositCargoStack(
      userId,
      character.id,
      { stackId: carriedStack.id, mode: "stack", expectedQuantity: 1 },
      now,
      deterministicRandom,
    );
    expect(away.cargo).toMatchObject({ status: "refused", reason: "not_at_crash_site" });

    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.cargoHoldStacks).values(
      Array.from({ length: balance.cargoHold.capacitySlots }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.slag,
        quantity: 1,
      })),
    );
    const full = await cargo.depositCargoStack(
      userId,
      character.id,
      { stackId: carriedStack.id, mode: "stack", expectedQuantity: 1 },
      now,
      deterministicRandom,
    );
    expect(full.cargo).toMatchObject({ status: "refused", reason: "cargo_capacity" });

    await db.delete(rune.cargoHoldStacks).where(eq(rune.cargoHoldStacks.characterId, character.id));
    const travel = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      now,
      deterministicRandom,
    );
    expect(travel.travelState?.destinationLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    const inTransit = await cargo.depositCargoStack(
      userId,
      character.id,
      { stackId: carriedStack.id, mode: "stack", expectedQuantity: 1 },
      now,
      deterministicRandom,
    );
    expect(inTransit.cargo).toMatchObject({ status: "refused", reason: "in_transit" });
  });
});
