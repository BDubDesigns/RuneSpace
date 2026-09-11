import { planStackAddition, type StackState } from "@/game/domain/inventory";
import type { MerchantDefinition } from "@/game/schemas/merchants";

/**
 * Trade direction, always from the player's point of view.
 *
 * Merchant price lines are authored from the merchant's point of view, because
 * that is how the approved price table reads ("Bix buys" / "Bix sells"). The
 * two are deliberately mirrored in exactly one place — `merchantUnitPrice` —
 * so no caller has to remember which way round a price is.
 */
export type TradeDirection = "buy" | "sell";

export type TradeQuote = {
  itemId: string;
  direction: TradeDirection;
  unitPrice: number;
  quantity: number;
  totalCredits: number;
};

export type TradeQuoteResult =
  | { ok: true; quote: TradeQuote }
  | { ok: false; reason: "not_traded" | "invalid_quantity" };

/**
 * The authoritative unit price for one item in one direction, or undefined
 * when this merchant does not trade that item that way. An item the merchant
 * only buys has no purchase price, which is how Ferrite Shale, Refined Ferrite,
 * and Slag stay unavailable to buy without a separate stock list.
 */
export function merchantUnitPrice(
  merchant: MerchantDefinition,
  itemId: string,
  direction: TradeDirection,
): number | undefined {
  const price = merchant.prices.find((candidate) => candidate.itemId === itemId);
  if (!price) return undefined;
  return direction === "buy" ? price.sellPrice : price.buyPrice;
}

/** Items the player may buy from this merchant, in authored order. */
export function merchantPurchasableItemIds(merchant: MerchantDefinition): readonly string[] {
  return merchant.prices
    .filter((price) => price.sellPrice !== undefined)
    .map((price) => price.itemId);
}

/** Items the player may sell to this merchant, in authored order. */
export function merchantSellableItemIds(merchant: MerchantDefinition): readonly string[] {
  return merchant.prices
    .filter((price) => price.buyPrice !== undefined)
    .map((price) => price.itemId);
}

/**
 * Price one complete transaction against the authoritative catalog.
 *
 * Both the Trade surface and the authoritative command quote through this same
 * function, so the total a player sees is computed by the same rule the server
 * charges — the client never supplies a price or a total.
 */
export function quoteTrade(input: {
  merchant: MerchantDefinition;
  itemId: string;
  direction: TradeDirection;
  quantity: number;
}): TradeQuoteResult {
  const unitPrice = merchantUnitPrice(input.merchant, input.itemId, input.direction);
  if (unitPrice === undefined) return { ok: false, reason: "not_traded" };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, reason: "invalid_quantity" };
  }
  return {
    ok: true,
    quote: {
      itemId: input.itemId,
      direction: input.direction,
      unitPrice,
      quantity: input.quantity,
      totalCredits: unitPrice * input.quantity,
    },
  };
}

/**
 * How many units a balance alone can pay for, ignoring what the player can
 * actually carry. Callers presenting a purchase cap want
 * `maximumPurchasableQuantity`, which also respects carried capacity.
 */
export function maximumAffordableQuantity(credits: number, unitPrice: number): number {
  if (!Number.isInteger(credits) || credits < 0)
    throw new RangeError("Credits must be non-negative");
  if (!Number.isInteger(unitPrice) || unitPrice <= 0)
    throw new RangeError("Unit price must be positive");
  return Math.floor(credits / unitPrice);
}

/**
 * The largest genuinely useful purchase: what the balance can pay for, reduced
 * to what the carried Inventory can actually accept.
 *
 * Stack filling, free slots, and carried mass are not re-derived here — the
 * quantity is handed to the ordinary inventory planner, whose partial result
 * reports exactly how much would not fit. That keeps one set of capacity rules
 * for Mining, instantaneous rewards, and merchant purchases alike.
 *
 * This is a client-side preview only. The authoritative command re-plans the
 * submitted quantity under the character lock and still refuses anything that
 * no longer fits.
 */
export function maximumPurchasableQuantity(input: {
  credits: number;
  unitPrice: number;
  existingStacks: readonly StackState<string>[];
  itemId: string;
  stackLimit: number;
  availableSlots: number;
  availableWeight: number;
  itemWeight: number;
}): number {
  const affordable = maximumAffordableQuantity(input.credits, input.unitPrice);
  if (affordable === 0) return 0;
  const plan = planStackAddition(
    input.existingStacks,
    input.itemId,
    affordable,
    input.stackLimit,
    input.availableSlots,
    input.availableWeight,
    input.itemWeight,
  );
  return affordable - plan.remainingQuantity;
}
