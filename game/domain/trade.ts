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

/**
 * How many units of an item this merchant sells each character per Pacific
 * reset date (#230), or undefined when that line authors no daily limit.
 */
export function merchantDailySellLimit(
  merchant: MerchantDefinition,
  itemId: string,
): number | undefined {
  return merchant.prices.find((candidate) => candidate.itemId === itemId)?.dailySellLimit;
}

/** One merchant line's allowance for the current reset date. */
export type DailyPurchaseAllowance = {
  limit: number;
  purchased: number;
  remaining: number;
};

/**
 * Today's allowance from the authored limit and what this character has
 * already bought from that line today. Owning, selling back, or receiving the
 * item from anywhere else never enters into it.
 */
export function dailyPurchaseAllowance(limit: number, purchased: number): DailyPurchaseAllowance {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError("Daily limit must be positive");
  if (!Number.isInteger(purchased) || purchased < 0) {
    throw new RangeError("Purchased quantity must be non-negative");
  }
  return { limit, purchased, remaining: Math.max(0, limit - purchased) };
}

/**
 * Every daily-limited line's allowance for one character and one reset date,
 * keyed by merchant then item. A line with no ledger row today has its whole
 * limit; lines that author no limit are absent.
 */
export function merchantDailyAllowances(
  merchants: readonly MerchantDefinition[],
  purchasedToday: readonly { merchantId: string; itemId: string; quantityPurchased: number }[],
): Record<string, Record<string, DailyPurchaseAllowance>> {
  const allowances: Record<string, Record<string, DailyPurchaseAllowance>> = {};
  for (const merchant of merchants) {
    for (const price of merchant.prices) {
      if (price.dailySellLimit === undefined) continue;
      const purchased =
        purchasedToday.find((row) => row.merchantId === merchant.id && row.itemId === price.itemId)
          ?.quantityPurchased ?? 0;
      (allowances[merchant.id] ??= {})[price.itemId] = dailyPurchaseAllowance(
        price.dailySellLimit,
        purchased,
      );
    }
  }
  return allowances;
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
 * The directions this merchant actually trades in, in Buy-then-Sell order.
 *
 * A merchant whose authored price table only names sell prices has nothing to
 * buy from the player, and offering that direction would open an empty surface.
 * Deriving it here keeps the rule with the catalog rather than in a panel, so
 * every merchant — Wade's Scrap counter included — is presented from content.
 */
export function merchantTradeDirections(merchant: MerchantDefinition): readonly TradeDirection[] {
  const directions: TradeDirection[] = [];
  if (merchantPurchasableItemIds(merchant).length > 0) directions.push("buy");
  if (merchantSellableItemIds(merchant).length > 0) directions.push("sell");
  return directions;
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
 * to what is left of a daily-limited line's allowance and to what the carried
 * Inventory can actually accept.
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
  /** What is left of today's allowance on a daily-limited line (#230). */
  dailyRemaining?: number;
}): number {
  const affordable = Math.min(
    maximumAffordableQuantity(input.credits, input.unitPrice),
    input.dailyRemaining ?? Number.POSITIVE_INFINITY,
  );
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
