import { getItemMaximumCharge } from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { isItemTransferable } from "@/game/domain/player-trade";
import type {
  TradeExchangeLines,
  TradeRequestChange,
  TradeSessionView,
} from "@/game/schemas/player-trade";

/**
 * Presentation-only helpers for the player trade UI (#268). Nothing here is
 * authority: they turn the server's trade state and the active character's
 * Play inventory into what the trade surface shows, and the server re-proves
 * every offer, Ready, and Confirm.
 */

/**
 * Where the acting character is in an accepted session, from the server's
 * phase and consent:
 *
 * - `compose`: editing its own offer;
 * - `ready`: Ready on the current offers, waiting for the other side's Ready;
 * - `review`: both Ready, the frozen You Give / You Receive review;
 * - `confirmed`: Confirmed, waiting for the other side's Confirm.
 */
export type TradeStage = "compose" | "ready" | "review" | "confirmed";

export function tradeStage(session: Pick<TradeSessionView, "phase" | "yours">): TradeStage {
  if (session.phase === "review") return session.yours.confirmed ? "confirmed" : "review";
  return session.yours.ready ? "ready" : "compose";
}

export function itemDisplayName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

/**
 * The mutable state that matters to a unique item's value or function, such
 * as a Cutter's charge against its own authored maximum. Undefined for an
 * item with no such state, or when the state is not known (`undefined`); a
 * stored `null` charge is an empty Cutter.
 */
export function itemStateLabel(itemId: string, currentCharge: number | null | undefined) {
  const maximum = getItemMaximumCharge(itemId);
  if (maximum === undefined || currentCharge === undefined) return undefined;
  return `Charge ${currentCharge ?? 0}/${maximum}`;
}

export function formatCredits(credits: number): string {
  return `${credits.toLocaleString("en-US")} ${credits === 1 ? "Credit" : "Credits"}`;
}

export function isEmptyOfferLines(offer: TradeExchangeLines): boolean {
  return offer.credits === 0 && offer.stacks.length === 0 && offer.items.length === 0;
}

export type OfferableStack = {
  itemId: string;
  name: string;
  /** Carried in total across every stack of the item. */
  carried: number;
  /** Already in the acting character's offer. */
  offered: number;
};

/**
 * The carried stackable items the acting character can offer, merged by item
 * (a character may carry several stacks of one item; the offer names the item
 * and a quantity), with how many are already offered.
 */
export function offerableStacks(
  carried: readonly { itemId: string; quantity: number }[],
  offered: readonly { itemId: string; quantity: number }[],
): OfferableStack[] {
  const totals = new Map<string, number>();
  for (const stack of carried) {
    totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.quantity);
  }
  return [...totals]
    .filter(([itemId]) => isItemTransferable(itemId))
    .map(([itemId, quantity]) => ({
      itemId,
      name: itemDisplayName(itemId),
      carried: quantity,
      offered: offered.find((line) => line.itemId === itemId)?.quantity ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Why the requester's outgoing request stopped waiting, in the player's
 * words. The realtime prompt's change is only a hint for this wording; when it
 * was missed, the generic line is still true.
 */
export function endedRequestNote(name: string, change: TradeRequestChange | undefined) {
  switch (change) {
    case "declined":
      return `${name} declined your trade request.`;
    case "expired":
      return `${name} didn't answer your trade request in time.`;
    case "invalidated":
      return `Your trade request to ${name} ended because one of you moved or started another trade.`;
    case "canceled":
      return undefined;
    default:
      return `${name} isn't waiting on your trade request anymore.`;
  }
}
