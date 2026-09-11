import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #159 Credits and the Bix merchant loop (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let trade: typeof import("@/server/trade");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };
  const now = new Date("2026-09-11T18:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    trade = await import("@/server/trade");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A provisioned character standing in Holo Hollow, ready to trade. */
  async function makeTrader(options?: { credits?: number; locationId?: string }) {
    const userId = await createTestUser(db, authSchema, "Trade Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Trade ${userId.slice(0, 8)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom);
    await db
      .update(rune.characters)
      .set({
        currentLocationId: options?.locationId ?? LOCATION_IDS.holoHollow,
        ...(options?.credits === undefined ? {} : { credits: options.credits }),
      })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function creditsOf(characterId: string) {
    const rows = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return rows[0]?.credits;
  }

  async function carriedQuantity(characterId: string, itemId: string) {
    const rows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    return rows
      .filter((row) => row.itemId === itemId)
      .reduce((total, row) => total + row.quantity, 0);
  }

  async function giveStack(characterId: string, itemId: string, quantity: number) {
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity, createdAt: now, updatedAt: now });
  }

  function buy(userId: string, characterId: string, itemId: string, quantity: number) {
    return trade.tradeWithMerchant(
      userId,
      characterId,
      {
        localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        itemId,
        direction: "buy",
        quantity,
      },
      now,
    );
  }

  function sell(userId: string, characterId: string, itemId: string, quantity: number) {
    return trade.tradeWithMerchant(
      userId,
      characterId,
      {
        localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        itemId,
        direction: "sell",
        quantity,
      },
      now,
    );
  }

  it("provisions every new character with the approved starting balance", async () => {
    const { userId, characterId } = await makeTrader();
    expect(await creditsOf(characterId)).toBe(rune.STARTING_CREDITS);
    const state = await play.getPlayGameplayState(userId, characterId, now, deterministicRandom);
    expect(state.credits).toBe(rune.STARTING_CREDITS);
  });

  it("commits a purchase as one atomic Credit and inventory change", async () => {
    const { userId, characterId } = await makeTrader({ credits: 20 });
    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 2);

    expect(result.trade).toMatchObject({ status: "traded", totalCredits: 16, credits: 4 });
    expect(await creditsOf(characterId)).toBe(4);
    expect(await carriedQuantity(characterId, ITEM_IDS.powerCell)).toBe(2);
    expect(result.state.credits).toBe(4);
  });

  it("commits a sale as one atomic Credit and inventory change", async () => {
    const { userId, characterId } = await makeTrader({ credits: 10 });
    await giveStack(characterId, ITEM_IDS.refinedFerrite, 3);

    const result = await sell(userId, characterId, ITEM_IDS.refinedFerrite, 3);

    expect(result.trade).toMatchObject({ status: "traded", totalCredits: 30, credits: 40 });
    expect(await creditsOf(characterId)).toBe(40);
    expect(await carriedQuantity(characterId, ITEM_IDS.refinedFerrite)).toBe(0);
  });

  it("pays the approved price for every material Bix buys", async () => {
    for (const [itemId, unitPrice] of [
      [ITEM_IDS.ferriteShale, 2],
      [ITEM_IDS.refinedFerrite, 10],
      [ITEM_IDS.slag, 1],
      [ITEM_IDS.powerCell, 3],
    ] as const) {
      const { userId, characterId } = await makeTrader({ credits: 0 });
      await giveStack(characterId, itemId, 1);
      const result = await sell(userId, characterId, itemId, 1);
      expect(result.trade).toMatchObject({ status: "traded", totalCredits: unitPrice });
      expect(await creditsOf(characterId)).toBe(unitPrice);
    }
  });

  it("refuses an unaffordable purchase without mutating anything", async () => {
    const { userId, characterId } = await makeTrader({ credits: 7 });
    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "insufficient_credits" });
    expect(await creditsOf(characterId)).toBe(7);
    expect(await carriedQuantity(characterId, ITEM_IDS.powerCell)).toBe(0);
  });

  it("refuses selling more than is carried without consuming the stack", async () => {
    const { userId, characterId } = await makeTrader({ credits: 10 });
    await giveStack(characterId, ITEM_IDS.slag, 2);

    const result = await sell(userId, characterId, ITEM_IDS.slag, 5);

    expect(result.trade).toMatchObject({ status: "refused", reason: "insufficient_items" });
    expect(await creditsOf(characterId)).toBe(10);
    expect(await carriedQuantity(characterId, ITEM_IDS.slag)).toBe(2);
  });

  it("refuses to sell an item Bix does not deal in", async () => {
    const { userId, characterId } = await makeTrader({ credits: 10 });

    const result = await sell(userId, characterId, ITEM_IDS.salvageCutter, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "not_traded" });
    expect(await creditsOf(characterId)).toBe(10);
  });

  it("refuses to buy a material Bix does not stock", async () => {
    const { userId, characterId } = await makeTrader({ credits: 100 });
    const result = await buy(userId, characterId, ITEM_IDS.refinedFerrite, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "not_traded" });
    expect(await creditsOf(characterId)).toBe(100);
    expect(await carriedQuantity(characterId, ITEM_IDS.refinedFerrite)).toBe(0);
  });

  it("does not trust a Local Place submitted from the wrong World Location", async () => {
    const { userId, characterId } = await makeTrader({
      credits: 100,
      locationId: LOCATION_IDS.crashSite,
    });

    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "unknown_place" });
    expect(await creditsOf(characterId)).toBe(100);
    expect(await carriedQuantity(characterId, ITEM_IDS.powerCell)).toBe(0);
  });

  it("refuses a locked Local Place even when the character is standing in town", async () => {
    const { userId, characterId } = await makeTrader({ credits: 100 });

    const result = await trade.tradeWithMerchant(
      userId,
      characterId,
      {
        localPlaceId: LOCAL_PLACE_IDS.hhBnb,
        itemId: ITEM_IDS.powerCell,
        direction: "buy",
        quantity: 1,
      },
      now,
    );

    expect(result.trade).toMatchObject({ status: "refused", reason: "place_locked" });
    expect(await creditsOf(characterId)).toBe(100);
  });

  it("refuses a Local Place that hosts no merchant", async () => {
    const { userId, characterId } = await makeTrader({ credits: 100 });

    const result = await trade.tradeWithMerchant(
      userId,
      characterId,
      {
        localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
        itemId: ITEM_IDS.powerCell,
        direction: "buy",
        quantity: 1,
      },
      now,
    );

    expect(result.trade).toMatchObject({ status: "refused", reason: "no_merchant" });
    expect(await creditsOf(characterId)).toBe(100);
  });

  it("refuses to trade while another activity is running", async () => {
    const { userId, characterId } = await makeTrader({ credits: 100 });
    await db.insert(rune.activeActions).values({
      characterId,
      actionId: ACTION_IDS.ferriteShaleMining,
      startedAt: now,
      resolvedThroughAt: now,
    });

    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "active_action" });
    expect(await creditsOf(characterId)).toBe(100);
    expect(await carriedQuantity(characterId, ITEM_IDS.powerCell)).toBe(0);
  });

  it("refuses to trade in transit", async () => {
    const { userId, characterId } = await makeTrader({ credits: 100 });
    await db.insert(rune.activeActions).values({
      characterId,
      actionId: ACTION_IDS.travel,
      startedAt: now,
      resolvedThroughAt: now,
    });
    await db.insert(rune.characterTravelState).values({
      characterId,
      originLocationId: LOCATION_IDS.holoHollow,
      destinationLocationId: LOCATION_IDS.crashSite,
    });

    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 1);

    expect(result.trade).toMatchObject({ status: "refused", reason: "in_transit" });
    expect(await creditsOf(characterId)).toBe(100);
  });

  it("never lets another player's character be traded with", async () => {
    const owner = await makeTrader({ credits: 100 });
    const intruder = await makeTrader({ credits: 0 });

    await expect(buy(intruder.userId, owner.characterId, ITEM_IDS.powerCell, 1)).rejects.toThrow();
    expect(await creditsOf(owner.characterId)).toBe(100);
  });

  it("refuses a purchase that will not fit and leaves Credits untouched", async () => {
    const { userId, characterId } = await makeTrader({ credits: 1_000 });
    // Fill every starter container slot so no new stack can be created.
    const state = await play.getPlayGameplayState(userId, characterId, now, deterministicRandom);
    const freeSlots = state.inventory.slotsAvailable;
    for (let index = 0; index < freeSlots; index += 1) {
      await giveStack(characterId, ITEM_IDS.slag, 10);
    }

    const result = await buy(userId, characterId, ITEM_IDS.powerCell, 1);

    expect(result.trade).toMatchObject({ status: "refused" });
    expect(result.trade.status === "refused" && result.trade.reason).toMatch(/slots|mass/);
    expect(await creditsOf(characterId)).toBe(1_000);
    expect(await carriedQuantity(characterId, ITEM_IDS.powerCell)).toBe(0);
  });

  it("keeps repeated sales consistent with the authoritative balance", async () => {
    const { userId, characterId } = await makeTrader({ credits: 0 });
    await giveStack(characterId, ITEM_IDS.ferriteShale, 10);

    await sell(userId, characterId, ITEM_IDS.ferriteShale, 4);
    const second = await sell(userId, characterId, ITEM_IDS.ferriteShale, 6);

    expect(second.trade).toMatchObject({ status: "traded", credits: 20 });
    expect(await creditsOf(characterId)).toBe(20);
    expect(await carriedQuantity(characterId, ITEM_IDS.ferriteShale)).toBe(0);
  });
});
