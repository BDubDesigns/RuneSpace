import { describe, expect, it } from "vitest";
import { STARTING_CREDITS } from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS, MERCHANT_IDS, NPC_IDS } from "@/game/config/foundations";
import { getMerchant } from "@/game/content/merchants";
import {
  maximumAffordableQuantity,
  merchantPurchasableItemIds,
  merchantSellableItemIds,
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
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "sell")).toBe(3);
    expect(merchantUnitPrice(bix, ITEM_IDS.powerCell, "buy")).toBe(8);
  });

  it("stocks Power Cells and nothing else", () => {
    expect(merchantPurchasableItemIds(bix)).toEqual([ITEM_IDS.powerCell]);
    expect([...merchantSellableItemIds(bix)].sort()).toEqual(
      [ITEM_IDS.powerCell, ITEM_IDS.refinedFerrite, ITEM_IDS.ferriteShale, ITEM_IDS.slag].sort(),
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
        unitPrice: 8,
        quantity: 3,
        totalCredits: 24,
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
    expect(quoted.ok && quoted.quote.totalCredits).toBe(12);
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
