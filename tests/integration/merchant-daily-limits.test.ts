import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
} from "@/game/config/foundations";
import { POWER_ANNEX_REWARD_SOURCE_ID } from "@/game/domain/power-annex";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #230 — Wade's Scrap and Bix's Power Cells, each limited to twelve per
 * character per Pacific reset date, against real PostgreSQL.
 *
 * What a unit test cannot prove: that the allowance is read and consumed in
 * the same transaction as the Credits and inventory, that a refused or
 * rolled-back purchase spends none of it, that concurrent requests cannot take
 * a line past twelve, that the next Pacific date starts fresh without anything
 * being cleared, and that each line's ledger is independent of the other and
 * of the Annex and ForceSales records.
 */
suite("issue #230 merchant daily purchase limits (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let trade: typeof import("@/server/trade");
  let ledger: typeof import("@/server/merchant-daily-purchases");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  // 11:00 PDT on 2026-09-12; the Pacific date turns at 07:00Z on the 13th.
  const today = new Date("2026-09-12T18:00:00.000Z");
  const lastMinuteToday = new Date("2026-09-13T06:59:59.000Z");
  const tomorrow = new Date("2026-09-13T07:00:00.000Z");
  const todayDate = "2026-09-12";

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    trade = await import("@/server/trade");
    ledger = await import("@/server/merchant-daily-purchases");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  type Line = {
    label: string;
    merchantId: string;
    itemId: string;
    locationId: string;
    localPlaceId?: string;
    price: number;
    buyback: number;
  };

  const wadeScrap: Line = {
    label: "Wade's Scrap Metal",
    merchantId: MERCHANT_IDS.wadeRusk,
    itemId: ITEM_IDS.scrapMetal,
    locationId: LOCATION_IDS.ruskRecovery,
    price: 4,
    buyback: 1,
  };
  const bixCells: Line = {
    label: "Bix's Power Cells",
    merchantId: MERCHANT_IDS.bixWeller,
    itemId: ITEM_IDS.powerCell,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    price: 12,
    buyback: 4,
  };

  /**
   * A provisioned character standing where both counters can be reached in
   * turn, with Wade's counter opened by an accepted 10,000 Hours and room
   * enough to carry a full day's allowance of either line.
   */
  async function makeShopper(options?: { credits?: number }) {
    const userId = await createTestUser(db, authSchema, "Daily Limit Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Limit ${userId.slice(0, 8)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, today, deterministicRandom);
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: MISSION_IDS.tenThousandHours,
      acceptedAt: today,
    });
    await db
      .update(rune.characters)
      .set({ credits: options?.credits ?? 1_000 })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function standAt(characterId: string, line: Line) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: line.locationId })
      .where(eq(rune.characters.id, characterId));
  }

  function tradeLine(
    userId: string,
    characterId: string,
    line: Line,
    direction: "buy" | "sell",
    quantity: number,
    now = today,
  ) {
    return trade.tradeWithMerchant(
      userId,
      characterId,
      {
        ...(line.localPlaceId ? { localPlaceId: line.localPlaceId } : {}),
        itemId: line.itemId,
        direction,
        quantity,
      },
      now,
    );
  }

  async function creditsOf(characterId: string) {
    const rows = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return rows[0]?.credits;
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((total, row) => total + row.quantity, 0);
  }

  async function ledgerRows(characterId: string) {
    return db
      .select()
      .from(rune.characterMerchantDailyPurchases)
      .where(eq(rune.characterMerchantDailyPurchases.characterId, characterId));
  }

  for (const line of [wadeScrap, bixCells]) {
    describe(line.label, () => {
      it(`sells at ${line.price} and buys back at ${line.buyback}`, async () => {
        const { userId, characterId } = await makeShopper({ credits: 100 });
        await standAt(characterId, line);

        const bought = await tradeLine(userId, characterId, line, "buy", 1);
        expect(bought.trade).toMatchObject({ status: "traded", totalCredits: line.price });
        const sold = await tradeLine(userId, characterId, line, "sell", 1);
        expect(sold.trade).toMatchObject({ status: "traded", totalCredits: line.buyback });
        expect(await creditsOf(characterId)).toBe(100 - line.price + line.buyback);
      });

      it("sells twelve in a Pacific day across partial purchases, and refuses the thirteenth", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);

        for (const quantity of [5, 4, 3]) {
          const result = await tradeLine(userId, characterId, line, "buy", quantity);
          expect(result.trade).toMatchObject({ status: "traded", quantity });
        }
        expect(await carried(characterId, line.itemId)).toBe(12);

        const thirteenth = await tradeLine(userId, characterId, line, "buy", 1);
        expect(thirteenth.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
        expect(await creditsOf(characterId)).toBe(1_000 - 12 * line.price);
        expect(await carried(characterId, line.itemId)).toBe(12);
        expect(thirteenth.state.merchantDailyPurchases[line.merchantId]?.[line.itemId]).toEqual({
          limit: 12,
          purchased: 12,
          remaining: 0,
        });
      });

      it("refuses a request larger than what is left, consuming none of it", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);
        await tradeLine(userId, characterId, line, "buy", 9);

        // A forged or stale client quantity is simply refused by the server.
        const tooMany = await tradeLine(userId, characterId, line, "buy", 4);
        expect(tooMany.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
        expect(tooMany.trade.status === "refused" && tooMany.trade.message).toContain(
          "Only 3 more",
        );
        const exact = await tradeLine(userId, characterId, line, "buy", 3);
        expect(exact.trade).toMatchObject({ status: "traded", quantity: 3 });
        expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(12);
      });

      it("restores all twelve on the next Pacific date without clearing anything", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);
        await tradeLine(userId, characterId, line, "buy", 12);

        // One second before local midnight it is still the same day.
        const lateToday = await tradeLine(userId, characterId, line, "buy", 1, lastMinuteToday);
        expect(lateToday.trade).toMatchObject({ status: "refused", reason: "daily_limit" });

        // Sell some back so the carried stock has room; it restores nothing.
        await tradeLine(userId, characterId, line, "sell", 12, lastMinuteToday);
        const nextDay = await tradeLine(userId, characterId, line, "buy", 12, tomorrow);
        expect(nextDay.trade).toMatchObject({ status: "traded", quantity: 12 });

        const rows = await ledgerRows(characterId);
        expect(rows.map((row) => [row.resetDate, row.quantityPurchased]).sort()).toEqual([
          ["2026-09-12", 12],
          ["2026-09-13", 12],
        ]);
      });

      it("does not restore the allowance when the player sells back to the merchant", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);
        await tradeLine(userId, characterId, line, "buy", 12);

        const sold = await tradeLine(userId, characterId, line, "sell", 12);
        expect(sold.trade).toMatchObject({ status: "traded", quantity: 12 });
        expect(await carried(characterId, line.itemId)).toBe(0);

        const again = await tradeLine(userId, characterId, line, "buy", 1);
        expect(again.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
        expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(12);
      });

      it("limits units bought from the line, not units owned", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);
        // Stock that came from anywhere else never counts against the line.
        await db.insert(rune.inventoryStacks).values({
          characterId,
          itemId: line.itemId,
          quantity: 1,
          createdAt: today,
          updatedAt: today,
        });
        const result = await tradeLine(userId, characterId, line, "buy", 12);
        expect(result.trade).toMatchObject({ status: "traded", quantity: 12 });
        expect(await carried(characterId, line.itemId)).toBe(13);
      });

      it("never exceeds twelve under concurrent requests", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);

        const results = await Promise.all(
          Array.from({ length: 15 }, () => tradeLine(userId, characterId, line, "buy", 1)),
        );
        const traded = results.filter((result) => result.trade.status === "traded");
        const refused = results.filter((result) => result.trade.status === "refused");
        expect(traded).toHaveLength(12);
        expect(refused).toHaveLength(3);
        for (const result of refused) {
          expect(result.trade).toMatchObject({ reason: "daily_limit" });
        }
        expect(await carried(characterId, line.itemId)).toBe(12);
        expect(await creditsOf(characterId)).toBe(1_000 - 12 * line.price);
        expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(12);
      });

      it("never exceeds twelve under concurrent multi-unit requests or retries", async () => {
        const { userId, characterId } = await makeShopper();
        await standAt(characterId, line);

        const results = await Promise.all([
          tradeLine(userId, characterId, line, "buy", 5),
          tradeLine(userId, characterId, line, "buy", 5),
          tradeLine(userId, characterId, line, "buy", 5),
        ]);
        expect(results.filter((result) => result.trade.status === "traded")).toHaveLength(2);
        // A retried request is just another purchase; it still has to fit.
        const retry = await tradeLine(userId, characterId, line, "buy", 5);
        expect(retry.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
        expect(await carried(characterId, line.itemId)).toBe(10);
        expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(10);
      });

      it("spends no allowance on a purchase refused for Credits or for room", async () => {
        const { userId, characterId } = await makeShopper({ credits: line.price - 1 });
        await standAt(characterId, line);

        const broke = await tradeLine(userId, characterId, line, "buy", 1);
        expect(broke.trade).toMatchObject({ status: "refused", reason: "insufficient_credits" });

        await db
          .update(rune.characters)
          .set({ credits: 1_000 })
          .where(eq(rune.characters.id, characterId));
        const state = await play.getPlayGameplayState(
          userId,
          characterId,
          today,
          deterministicRandom,
        );
        for (let index = 0; index < state.inventory.slotsAvailable; index += 1) {
          await db.insert(rune.inventoryStacks).values({
            characterId,
            itemId: ITEM_IDS.slag,
            quantity: 10,
            createdAt: today,
            updatedAt: today,
          });
        }
        const full = await tradeLine(userId, characterId, line, "buy", 1);
        expect(full.trade.status === "refused" && full.trade.reason).toMatch(/slots|mass/);

        expect(await ledgerRows(characterId)).toHaveLength(0);
        expect(full.state.merchantDailyPurchases[line.merchantId]?.[line.itemId]?.remaining).toBe(
          12,
        );
      });
    });
  }

  describe("ledger independence", () => {
    it("keeps Wade's Scrap and Bix's Cells as separate allowances", async () => {
      const { userId, characterId } = await makeShopper();
      await standAt(characterId, wadeScrap);
      await tradeLine(userId, characterId, wadeScrap, "buy", 12);

      await standAt(characterId, bixCells);
      const cells = await tradeLine(userId, characterId, bixCells, "buy", 12);
      expect(cells.trade).toMatchObject({ status: "traded", quantity: 12 });
      expect(cells.state.merchantDailyPurchases).toEqual({
        [MERCHANT_IDS.bixWeller]: {
          [ITEM_IDS.powerCell]: { limit: 12, purchased: 12, remaining: 0 },
        },
        [MERCHANT_IDS.wadeRusk]: {
          [ITEM_IDS.scrapMetal]: { limit: 12, purchased: 12, remaining: 0 },
        },
      });
      expect((await ledgerRows(characterId)).map((row) => row.merchantId).sort()).toEqual(
        [MERCHANT_IDS.bixWeller, MERCHANT_IDS.wadeRusk].sort(),
      );
    });

    it("is untouched by the Annex claim and the ForceSales refresh, and touches neither", async () => {
      const { userId, characterId } = await makeShopper();
      // Today's Annex allotment and ForceSales refresh are both already spent.
      await db.insert(rune.characterPowerCellDailyClaims).values({
        characterId,
        rewardSourceId: POWER_ANNEX_REWARD_SOURCE_ID,
        resetDate: todayDate,
        claimedAt: today,
      });
      await db
        .insert(rune.characterWorkOrderBoardRefreshes)
        .values({ characterId, resetDate: todayDate, refreshedAt: today });

      await standAt(characterId, bixCells);
      const cells = await tradeLine(userId, characterId, bixCells, "buy", 12);
      expect(cells.trade).toMatchObject({ status: "traded", quantity: 12 });

      const [claims, refreshes] = await Promise.all([
        db
          .select()
          .from(rune.characterPowerCellDailyClaims)
          .where(eq(rune.characterPowerCellDailyClaims.characterId, characterId)),
        db
          .select()
          .from(rune.characterWorkOrderBoardRefreshes)
          .where(eq(rune.characterWorkOrderBoardRefreshes.characterId, characterId)),
      ]);
      expect(claims).toHaveLength(1);
      expect(refreshes).toHaveLength(1);
    });

    it("keeps each character's allowance to that character", async () => {
      const first = await makeShopper();
      const second = await makeShopper();
      await standAt(first.characterId, bixCells);
      await standAt(second.characterId, bixCells);
      await tradeLine(first.userId, first.characterId, bixCells, "buy", 12);

      const other = await tradeLine(second.userId, second.characterId, bixCells, "buy", 12);
      expect(other.trade).toMatchObject({ status: "traded", quantity: 12 });
    });
  });

  describe("the guarded ledger write", () => {
    it("rolls back with the transaction that consumed it", async () => {
      const { characterId } = await makeShopper();
      await expect(
        db.transaction(async (transaction) => {
          const consumed = await ledger.consumeMerchantDailyAllowance(transaction, {
            characterId,
            merchantId: bixCells.merchantId,
            itemId: bixCells.itemId,
            resetDate: todayDate,
            quantity: 5,
            limit: 12,
            now: today,
          });
          expect(consumed).toBe(true);
          throw new Error("purchase failed after the allowance was consumed");
        }),
      ).rejects.toThrow("purchase failed");
      expect(await ledgerRows(characterId)).toHaveLength(0);
    });

    it("refuses an increment past the limit and leaves the row as it was", async () => {
      const { characterId } = await makeShopper();
      const consume = (quantity: number) =>
        db.transaction((transaction) =>
          ledger.consumeMerchantDailyAllowance(transaction, {
            characterId,
            merchantId: wadeScrap.merchantId,
            itemId: wadeScrap.itemId,
            resetDate: todayDate,
            quantity,
            limit: 12,
            now: today,
          }),
        );
      expect(await consume(10)).toBe(true);
      expect(await consume(3)).toBe(false);
      expect(await consume(13)).toBe(false);
      expect(await consume(2)).toBe(true);
      expect(await consume(1)).toBe(false);
      expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(12);
    });

    it("rejects a non-positive purchased quantity at the database", async () => {
      const { characterId } = await makeShopper();
      await expect(
        db.insert(rune.characterMerchantDailyPurchases).values({
          characterId,
          merchantId: wadeScrap.merchantId,
          itemId: wadeScrap.itemId,
          resetDate: todayDate,
          quantityPurchased: 0,
        }),
      ).rejects.toThrow();
    });
  });
});
