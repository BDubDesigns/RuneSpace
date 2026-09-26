import { describe, expect, it } from "vitest";
import { STARTING_CREDITS } from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS, MERCHANT_IDS, NPC_IDS } from "@/game/config/foundations";
import {
  getMerchant,
  MERCHANTS,
  merchantBuybackPrice,
  merchantRetailPrice,
} from "@/game/content/merchants";
import { MerchantPriceSchema } from "@/game/schemas/merchants";
import {
  dailyPurchaseAllowance,
  maximumAffordableQuantity,
  merchantDailyAllowances,
  merchantDailySellLimit,
  maximumPurchasableQuantity,
  merchantPurchasableItemIds,
  merchantSellableItemIds,
  merchantTradeDirections,
  merchantUnitPrice,
  quoteTrade,
} from "@/game/domain/trade";

const bix = getMerchant(MERCHANT_IDS.bixWeller)!;

describe("issue #159 Credits", () => {
  it("keeps the persistence default and the authoritative balance value in lockstep", () => {
    // db/ deliberately imports no game content, so the column default mirrors
    // the balance value. This is the guard that they never drift.
    expect(STARTING_CREDITS).toBe(getEffectiveGameBalance().credits.startingBalance);
    expect(STARTING_CREDITS).toBe(10);
  });
});

describe("issue #159 Bix merchant catalog", () => {
  it("authors exactly the approved playtest prices", () => {
    expect(bix.npcId).toBe(NPC_IDS.bixWeller);
    expect(merchantUnitPrice(bix, ITEM_IDS.ferriteShale, "sell")).toBe(2);
    expect(merchantUnitPrice(bix, ITEM_IDS.refinedFerrite, "sell")).toBe(10);
    expect(merchantUnitPrice(bix, ITEM_IDS.slag, "sell")).toBe(1);
    // Power Cells were repriced ahead of Fabrication (#230): 12 to buy, 4 back.
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "sell")).toBe(4);
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "buy")).toBe(12);
  });

  it("stocks Power Cells and nothing else", () => {
    expect(merchantPurchasableItemIds(bix)).toEqual([ITEM_IDS.powerCell]);
    // Bix takes raw ore and rough stock as well now (#209); the finished alloy
    // is Wade's trade, not his.
    expect([...merchantSellableItemIds(bix)].sort()).toEqual(
      [
        ITEM_IDS.powerCell,
        ITEM_IDS.refinedFerrite,
        ITEM_IDS.ferriteShale,
        ITEM_IDS.slag,
        ITEM_IDS.galvanite,
        ITEM_IDS.galvanicStock,
      ].sort(),
    );
  });

  it("refuses to buy back materials it does not stock", () => {
    for (const itemId of [ITEM_IDS.ferriteShale, ITEM_IDS.refinedFerrite, ITEM_IDS.slag]) {
      expect(merchantUnitPrice(bix, itemId, "buy")).toBeUndefined();
      expect(quoteTrade({ merchant: bix, itemId, direction: "buy", quantity: 1 })).toEqual({
        ok: false,
        reason: "not_traded",
      });
    }
  });

  it("only trades items that are real carried stacks", () => {
    for (const price of bix.prices) {
      expect(getItemDefinition(price.itemId)?.kind).toBe("stack");
    }
  });

  it("never trades an item the merchant has not authored", () => {
    expect(
      quoteTrade({
        merchant: bix,
        itemId: ITEM_IDS.salvageCutter,
        direction: "sell",
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: "not_traded" });
  });
});

describe("issue #159 trade arithmetic", () => {
  it("prices a whole transaction from the authored unit price", () => {
    const quoted = quoteTrade({
      merchant: bix,
      itemId: ITEM_IDS.powerCell,
      direction: "buy",
      quantity: 3,
    });
    expect(quoted).toEqual({
      ok: true,
      quote: {
        itemId: ITEM_IDS.powerCell,
        direction: "buy",
        unitPrice: 12,
        quantity: 3,
        totalCredits: 36,
      },
    });
  });

  it("prices selling from the merchant's buy price, not its sell price", () => {
    const quoted = quoteTrade({
      merchant: bix,
      itemId: ITEM_IDS.powerCell,
      direction: "sell",
      quantity: 4,
    });
    expect(quoted.ok && quoted.quote.totalCredits).toBe(16);
  });

  it("rejects quantities that are not whole positive counts", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        quoteTrade({ merchant: bix, itemId: ITEM_IDS.powerCell, direction: "buy", quantity }),
      ).toEqual({ ok: false, reason: "invalid_quantity" });
    }
  });

  it("caps the Max purchase at what the balance can actually pay for", () => {
    expect(maximumAffordableQuantity(10, 8)).toBe(1);
    expect(maximumAffordableQuantity(24, 8)).toBe(3);
    expect(maximumAffordableQuantity(7, 8)).toBe(0);
    expect(maximumAffordableQuantity(0, 8)).toBe(0);
  });

  it("refuses to derive a maximum from impossible inputs", () => {
    expect(() => maximumAffordableQuantity(-1, 8)).toThrow(RangeError);
    expect(() => maximumAffordableQuantity(10, 0)).toThrow(RangeError);
  });
});

describe("issue #159 Buy Max respects what the player can carry", () => {
  const powerCell = getItemDefinition(ITEM_IDS.powerCell)!;
  const stackLimit = powerCell.kind === "stack" ? powerCell.stackLimit : 0;
  const itemWeight = powerCell.massGrams;

  function maxPurchase(overrides: {
    credits: number;
    existingStacks?: readonly { id: string; itemId: string; quantity: number }[];
    availableSlots?: number;
    availableWeight?: number;
  }) {
    return maximumPurchasableQuantity({
      credits: overrides.credits,
      unitPrice: 8,
      existingStacks: (overrides.existingStacks ?? []) as never,
      itemId: ITEM_IDS.powerCell,
      stackLimit,
      availableSlots: overrides.availableSlots ?? 8,
      availableWeight: overrides.availableWeight ?? 50_000,
      itemWeight,
    });
  }

  it("caps at affordability when there is room to spare", () => {
    expect(maxPurchase({ credits: 24 })).toBe(3);
    expect(maxPurchase({ credits: 7 })).toBe(0);
  });

  it("caps at free slots rather than promising an impossible purchase", () => {
    // One free slot holds one stack, so an affordable ten cells is capped.
    expect(maxPurchase({ credits: 1_000, availableSlots: 1 })).toBe(stackLimit);
    expect(maxPurchase({ credits: 1_000, availableSlots: 0 })).toBe(0);
  });

  it("fills an existing partial stack before needing a new slot", () => {
    const partial = [{ id: "stack-1", itemId: ITEM_IDS.powerCell, quantity: stackLimit - 1 }];
    // No free slots at all, but the partial stack still has one space.
    expect(maxPurchase({ credits: 1_000, existingStacks: partial, availableSlots: 0 })).toBe(1);
  });

  it("caps at carried mass", () => {
    expect(maxPurchase({ credits: 1_000, availableWeight: itemWeight * 2 })).toBe(2);
    expect(maxPurchase({ credits: 1_000, availableWeight: 0 })).toBe(0);
  });

  it("caps at what is left of today's allowance on a daily-limited line (#230)", () => {
    const withAllowance = (dailyRemaining: number) =>
      maximumPurchasableQuantity({
        credits: 1_000,
        unitPrice: 12,
        existingStacks: [],
        itemId: ITEM_IDS.powerCell,
        stackLimit,
        availableSlots: 8,
        availableWeight: 50_000,
        itemWeight,
        dailyRemaining,
      });
    expect(withAllowance(12)).toBe(12);
    expect(withAllowance(5)).toBe(5);
    expect(withAllowance(0)).toBe(0);
  });

  it("takes whichever limit binds first", () => {
    // Affordable 2, mass allows 4, slots allow plenty — affordability wins.
    expect(maxPurchase({ credits: 16, availableWeight: itemWeight * 4 })).toBe(2);
    // Affordable 4, mass allows 1 — mass wins.
    expect(maxPurchase({ credits: 32, availableWeight: itemWeight })).toBe(1);
  });
});

describe("issue #190 Trade presents only the directions a merchant supports", () => {
  it("offers both directions for a merchant who buys and sells", () => {
    expect(merchantTradeDirections(bix)).toEqual(["buy", "sell"]);
  });

  it("offers Buy only for a merchant with nothing to buy from the player", () => {
    // Wade started buying structural material once Deep Jag opened (#209), so
    // his counter now genuinely supports both directions. The rule under test
    // is the derivation, not Wade: a merchant with nothing to buy from the
    // player still gets a Buy-only counter, which the constructed merchant
    // below proves.
    const wade = getMerchant(MERCHANT_IDS.wadeRusk)!;
    expect([...merchantSellableItemIds(wade)].sort()).toEqual(
      [
        ITEM_IDS.scrapMetal,
        ITEM_IDS.refinedFerrite,
        ITEM_IDS.galvanicStock,
        ITEM_IDS.galvaferrite,
      ].sort(),
    );
    expect(merchantTradeDirections(wade)).toEqual(["buy", "sell"]);

    const sellerOnly = {
      ...wade,
      prices: wade.prices
        .filter((price) => price.sellPrice !== undefined)
        .map((price) => ({ itemId: price.itemId, sellPrice: price.sellPrice })),
    };
    expect(merchantSellableItemIds(sellerOnly)).toEqual([]);
    expect(merchantTradeDirections(sellerOnly)).toEqual(["buy"]);
  });

  it("offers Sell only for a merchant who posts no purchase price", () => {
    const buyerOnly = {
      ...bix,
      prices: bix.prices
        .filter((price) => price.buyPrice !== undefined)
        .map((price) => ({ itemId: price.itemId, buyPrice: price.buyPrice })),
    };
    expect(merchantPurchasableItemIds(buyerOnly)).toEqual([]);
    expect(merchantTradeDirections(buyerOnly)).toEqual(["sell"]);
  });
});

describe("issue #230 Scrap and Power Cell trade terms", () => {
  const wade = getMerchant(MERCHANT_IDS.wadeRusk)!;

  it("has Wade sell Scrap Metal at 4 and buy it back at 1", () => {
    expect(merchantUnitPrice(wade, ITEM_IDS.scrapMetal, "buy")).toBe(4);
    expect(merchantUnitPrice(wade, ITEM_IDS.scrapMetal, "sell")).toBe(1);
  });

  it("has Bix sell Power Cells at 12 and buy them back at 4", () => {
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "buy")).toBe(12);
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "sell")).toBe(4);
  });

  it("limits each of those two lines to twelve a day, and no other line", () => {
    expect(merchantDailySellLimit(wade, ITEM_IDS.scrapMetal)).toBe(12);
    expect(merchantDailySellLimit(bix, ITEM_IDS.powerCell)).toBe(12);
    for (const merchant of MERCHANTS) {
      for (const price of merchant.prices) {
        const limited =
          (merchant.id === MERCHANT_IDS.wadeRusk && price.itemId === ITEM_IDS.scrapMetal) ||
          (merchant.id === MERCHANT_IDS.bixWeller && price.itemId === ITEM_IDS.powerCell);
        expect(price.dailySellLimit !== undefined).toBe(limited);
      }
    }
  });

  it("exposes the retail and buyback prices content quotes from the same lines", () => {
    expect(merchantRetailPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell)).toBe(12);
    expect(merchantBuybackPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell)).toBe(4);
    expect(merchantRetailPrice(MERCHANT_IDS.wadeRusk, ITEM_IDS.scrapMetal)).toBe(4);
    expect(merchantBuybackPrice(MERCHANT_IDS.wadeRusk, ITEM_IDS.scrapMetal)).toBe(1);
    expect(() => merchantRetailPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.slag)).toThrow();
    expect(() => merchantBuybackPrice(MERCHANT_IDS.wadeRusk, ITEM_IDS.slag)).toThrow();
  });

  it("refuses a daily limit on a line the player cannot buy from", () => {
    expect(
      MerchantPriceSchema.safeParse({ itemId: ITEM_IDS.slag, buyPrice: 1, dailySellLimit: 12 })
        .success,
    ).toBe(false);
    expect(
      MerchantPriceSchema.safeParse({ itemId: ITEM_IDS.slag, sellPrice: 1, dailySellLimit: 0 })
        .success,
    ).toBe(false);
  });
});

describe("issue #230 daily purchase allowance", () => {
  it("is the whole limit before anything is bought today", () => {
    expect(dailyPurchaseAllowance(12, 0)).toEqual({ limit: 12, purchased: 0, remaining: 12 });
  });

  it("counts only what was bought, never below zero", () => {
    expect(dailyPurchaseAllowance(12, 7)).toEqual({ limit: 12, purchased: 7, remaining: 5 });
    expect(dailyPurchaseAllowance(12, 12).remaining).toBe(0);
    expect(dailyPurchaseAllowance(12, 13).remaining).toBe(0);
  });

  it("refuses impossible inputs", () => {
    expect(() => dailyPurchaseAllowance(0, 0)).toThrow(RangeError);
    expect(() => dailyPurchaseAllowance(12, -1)).toThrow(RangeError);
    expect(() => dailyPurchaseAllowance(12, 1.5)).toThrow(RangeError);
  });

  it("projects every limited line independently, keyed by merchant then item", () => {
    const allowances = merchantDailyAllowances(MERCHANTS, [
      { merchantId: MERCHANT_IDS.wadeRusk, itemId: ITEM_IDS.scrapMetal, quantityPurchased: 9 },
    ]);
    expect(allowances).toEqual({
      [MERCHANT_IDS.bixWeller]: {
        [ITEM_IDS.powerCell]: { limit: 12, purchased: 0, remaining: 12 },
      },
      [MERCHANT_IDS.wadeRusk]: {
        [ITEM_IDS.scrapMetal]: { limit: 12, purchased: 9, remaining: 3 },
      },
    });
  });
});
