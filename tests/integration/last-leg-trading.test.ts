import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
} from "@/game/config/foundations";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #357 Last Leg Trading merchant (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let trade: typeof import("@/server/trade");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };
  // Midday Pacific on two consecutive reset dates.
  const dayOne = new Date("2026-10-14T19:00:00.000Z");
  const dayTwo = new Date("2026-10-15T19:00:00.000Z");

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

  async function makeTrader(options?: {
    credits?: number;
    locationId?: string;
    thrustIssues?: "completed" | "accepted" | "none";
    userId?: string;
    name?: string;
  }) {
    const userId = options?.userId ?? (await createTestUser(db, authSchema, "Landing Tester"));
    if (!options?.userId) createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      options?.name ?? `Landing ${userId.slice(0, 8)}`,
    );
    await play.getPlayGameplayState(userId, character.id, dayOne, deterministicRandom);
    await db
      .update(rune.characters)
      .set({
        currentLocationId: options?.locationId ?? LOCATION_IDS.holoHollowLanding,
        credits: options?.credits ?? 5000,
      })
      .where(eq(rune.characters.id, character.id));
    const thrust = options?.thrustIssues ?? "completed";
    if (thrust !== "none") {
      await db.insert(rune.characterMissions).values({
        characterId: character.id,
        missionId: MISSION_IDS.thrustIssues,
        acceptedAt: dayOne,
        completedAt: thrust === "completed" ? dayOne : null,
      });
    }
    return { userId, characterId: character.id };
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    return rows.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.quantity, 0);
  }

  async function creditsOf(characterId: string) {
    const rows = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return rows[0]?.credits;
  }

  async function give(characterId: string, itemId: string, quantity: number) {
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity, createdAt: dayOne, updatedAt: dayOne });
  }

  function trading(
    who: { userId: string; characterId: string },
    direction: "buy" | "sell",
    itemId: string,
    quantity: number,
    now = dayOne,
    localPlaceId: string | null = LOCAL_PLACE_IDS.lastLegTrading,
  ) {
    return trade.tradeWithMerchant(
      who.userId,
      who.characterId,
      { ...(localPlaceId ? { localPlaceId } : {}), itemId, direction, quantity },
      now,
    );
  }

  it("trades at the authored prices once this character has completed Thrust Issues", async () => {
    const who = await makeTrader({ credits: 1000 });

    const bought = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 2);
    expect(bought.trade).toMatchObject({ status: "traded", totalCredits: 450, credits: 550 });
    expect(await carried(who.characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(2);

    const emptyBought = await trading(who, "buy", ITEM_IDS.emptySmallFuelCanister, 1);
    expect(emptyBought.trade).toMatchObject({ status: "traded", totalCredits: 40, credits: 510 });

    const sold = await trading(who, "sell", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(sold.trade).toMatchObject({ status: "traded", totalCredits: 160, credits: 670 });

    await give(who.characterId, ITEM_IDS.oilShale, 7);
    const shale = await trading(who, "sell", ITEM_IDS.oilShale, 7);
    expect(shale.trade).toMatchObject({ status: "traded", totalCredits: 42, credits: 712 });
  });

  it("never sells Oil Shale", async () => {
    const who = await makeTrader();
    const result = await trading(who, "buy", ITEM_IDS.oilShale, 1);
    expect(result.trade).toMatchObject({ status: "refused", reason: "not_traded" });
    expect(await creditsOf(who.characterId)).toBe(5000);
  });

  it("stays locked, in both directions, until Thrust Issues is completed and reported", async () => {
    const accepted = await makeTrader({ thrustIssues: "accepted" });
    const untouched = await makeTrader({ thrustIssues: "none" });
    // A repaired ship the player has not reported is not a completed Mission.
    const propulsion = getRepairTargetBalance(
      REPAIR_TARGET_IDS.propulsionSystem,
      getEffectiveGameBalance(),
    );
    await seedRepairTarget(db, rune, accepted.characterId, REPAIR_TARGET_IDS.propulsionSystem, {
      materials: installedMaterials(propulsion),
      weldingProgress: propulsion.repairIncrements,
      completedAt: dayOne,
      updatedAt: dayOne,
    });
    await give(accepted.characterId, ITEM_IDS.fullSmallFuelCanister, 1);
    await give(untouched.characterId, ITEM_IDS.oilShale, 1);

    for (const who of [accepted, untouched]) {
      const buy = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
      expect(buy.trade).toMatchObject({
        status: "refused",
        reason: "merchant_locked",
        message:
          "Trading unlocks after you report the completed Thrust Issues repair to Wade at Rusk Recovery.",
      });
      const sellFull = await trading(who, "sell", ITEM_IDS.fullSmallFuelCanister, 1);
      expect(sellFull.trade).toMatchObject({ status: "refused", reason: "merchant_locked" });
      const sellShale = await trading(who, "sell", ITEM_IDS.oilShale, 1);
      expect(sellShale.trade).toMatchObject({ status: "refused", reason: "merchant_locked" });
      expect(await creditsOf(who.characterId)).toBe(5000);
    }
    expect(await carried(accepted.characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(1);
    expect(await carried(untouched.characterId, ITEM_IDS.oilShale)).toBe(1);
  });

  it("does not let another character on the same account open it", async () => {
    const reported = await makeTrader({ name: "Landing Reporter" });
    const second = await makeTrader({
      userId: reported.userId,
      name: "Landing Second",
      thrustIssues: "none",
    });
    const refused = await trading(second, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(refused.trade).toMatchObject({ status: "refused", reason: "merchant_locked" });
    const allowed = await trading(reported, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(allowed.trade).toMatchObject({ status: "traded" });
  });

  it("opens without Move Along accepted and without the ship ever having flown", async () => {
    const who = await makeTrader();
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, who.characterId));
    expect(rows.map((row) => row.missionId)).toEqual([MISSION_IDS.thrustIssues]);
    const result = await trading(who, "buy", ITEM_IDS.emptySmallFuelCanister, 1);
    expect(result.trade).toMatchObject({ status: "traded" });
  });

  it("honors the request only from the Landing, and only for Last Leg Trading's place", async () => {
    const away = await makeTrader({ locationId: LOCATION_IDS.holoHollow });
    const fromTown = await trading(away, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(fromTown.trade).toMatchObject({ status: "refused", reason: "unknown_place" });

    const onPad = await makeTrader();
    // Standing on the pad is not standing inside the shop: the pad hosts no merchant.
    const noPlace = await trading(onPad, "buy", ITEM_IDS.fullSmallFuelCanister, 1, dayOne, null);
    expect(noPlace.trade).toMatchObject({ status: "refused", reason: "no_merchant" });
    expect(await creditsOf(onPad.characterId)).toBe(5000);
  });

  it("refuses a purchase the character cannot afford and charges nothing", async () => {
    const who = await makeTrader({ credits: 224 });
    const result = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(result.trade).toMatchObject({ status: "refused", reason: "insufficient_credits" });
    expect(await creditsOf(who.characterId)).toBe(224);
    expect(await carried(who.characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(0);
  });

  it("limits Full and Empty canisters separately to five a Pacific day, and selling back restores nothing", async () => {
    const who = await makeTrader({ credits: 100_000 });

    expect((await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 5)).trade).toMatchObject({
      status: "traded",
    });
    const sixthFull = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(sixthFull.trade).toMatchObject({ status: "refused", reason: "daily_limit" });

    // The Empty allowance is its own line.
    expect((await trading(who, "buy", ITEM_IDS.emptySmallFuelCanister, 5)).trade).toMatchObject({
      status: "traded",
    });
    const sixthEmpty = await trading(who, "buy", ITEM_IDS.emptySmallFuelCanister, 1);
    expect(sixthEmpty.trade).toMatchObject({ status: "refused", reason: "daily_limit" });

    // Selling a canister back does not give the allowance back.
    expect((await trading(who, "sell", ITEM_IDS.fullSmallFuelCanister, 2)).trade).toMatchObject({
      status: "traded",
    });
    const afterSellback = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    expect(afterSellback.trade).toMatchObject({ status: "refused", reason: "daily_limit" });

    // Another character has an allowance of their own.
    const other = await makeTrader({ credits: 100_000 });
    expect((await trading(other, "buy", ITEM_IDS.fullSmallFuelCanister, 1)).trade).toMatchObject({
      status: "traded",
    });

    // The next Pacific reset date starts a fresh allowance. Carry room is its own
    // server rule, so empty the pack first to isolate the allowance.
    await trading(who, "sell", ITEM_IDS.fullSmallFuelCanister, 3);
    await trading(who, "sell", ITEM_IDS.emptySmallFuelCanister, 5);
    const nextDay = await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 5, dayTwo);
    expect(nextDay.trade).toMatchObject({ status: "traded" });
  });

  it("records the allowance against the Last Leg Trading business, not this counter", async () => {
    const who = await makeTrader();
    await trading(who, "buy", ITEM_IDS.fullSmallFuelCanister, 1);
    const rows = await db
      .select()
      .from(rune.characterMerchantDailyPurchases)
      .where(eq(rune.characterMerchantDailyPurchases.characterId, who.characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      merchantId: MERCHANT_IDS.lastLegTrading,
      itemId: ITEM_IDS.fullSmallFuelCanister,
      quantityPurchased: 1,
    });
  });
});
