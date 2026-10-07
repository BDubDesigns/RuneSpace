/**
 * Same-location player trading: request and session rules (issue #266, the
 * first slice of the #225 contract) and the offer/consent rules of an accepted
 * session (#267). Pure and framework-free; the server loads the stored facts
 * and the request clock and asks these questions. Settlement planning — the
 * hypothetical post-trade inventories — is `game/domain/player-trade-settlement.ts`.
 *
 * Expiry and movement are never scheduled. Like a sanction, a request's or a
 * session's effective state is derived from stored facts and `now` on every
 * check, so a 20-second expiry or a recipient walking away applies on the very
 * next request with no job. The server writes the derived outcome down only
 * when it matters (before reusing a character's outgoing slot or claim, and at
 * acceptance).
 */

import {
  getEffectiveGameBalance,
  getItemDefinition,
  type EffectiveGameBalance,
} from "@/game/config/balance";

/**
 * Whether this item TYPE may take part in a player trade at all (#326): the one
 * durable, item-level eligibility rule.
 *
 * It answers "can this kind of item be traded in principle", never "can this
 * character offer it right now". Where a particular copy is — equipped, in the
 * Cargo Hold, installed at a site stash — and whether it is carried stay with
 * the offer and settlement checks, because they are facts about one character's
 * current state. Both those enforcement points and the item-source reference's
 * "Player trade" entry ask this predicate, so a future bound, restricted or
 * Mission-only item is excluded from both by changing only this rule.
 *
 * Today every item with an authoritative inventory definition is transferable;
 * an item with no definition is not an item at all.
 */
export function isItemTransferable(
  itemId: string,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): boolean {
  return getItemDefinition(itemId, balance) !== undefined;
}

/** Every tunable number in the request/session contract lives here. */
export const PLAYER_TRADE_POLICY = {
  /** An untouched pending request expires after 20 seconds. */
  requestTtlMs: 20_000,
  /** One Player account may create at most 4 requests per rolling 30 seconds. */
  requestBudget: { maxRequests: 4, windowMs: 30_000 },
  /**
   * 4 requests from one sender account to one recipient account inside the
   * same rolling window make Block Player / Decline & Block prominent for the
   * recipient. Never an automatic Block or sanction.
   */
  repeatedRecipientThreshold: 4,
  /** An accepted session expires after 5 minutes of trade inactivity. */
  sessionInactivityMs: 5 * 60_000,
} as const;

export const TRADE_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "canceled",
  "declined",
  "expired",
  "invalidated",
] as const;
export type TradeRequestStatus = (typeof TRADE_REQUEST_STATUSES)[number];

/** `completed` is the one terminal status in which assets moved (#267). */
export const TRADE_SESSION_STATUSES = ["active", "canceled", "expired", "completed"] as const;
export type TradeSessionStatus = (typeof TRADE_SESSION_STATUSES)[number];

export function tradeRequestExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PLAYER_TRADE_POLICY.requestTtlMs);
}

export type TradeRequestFacts = {
  status: TradeRequestStatus;
  /** The World Location both characters shared when the request was made. */
  locationId: string;
  expiresAt: Date;
};

/**
 * A request's effective status at `now`. A stored `pending` request is only
 * still pending while it has not expired and both characters remain at the
 * World Location it was made in; otherwise it is effectively `expired` or
 * `invalidated`. Expiry wins when both apply, since it needs no other fact.
 */
export function effectiveTradeRequestStatus(
  request: TradeRequestFacts,
  locations: { requesterLocationId: string; recipientLocationId: string },
  now: Date,
): TradeRequestStatus {
  if (request.status !== "pending") return request.status;
  if (now.getTime() >= request.expiresAt.getTime()) return "expired";
  if (
    locations.requesterLocationId !== request.locationId ||
    locations.recipientLocationId !== request.locationId
  ) {
    return "invalidated";
  }
  return "pending";
}

export function tradeSessionExpiresAt(lastActivityAt: Date): Date {
  return new Date(lastActivityAt.getTime() + PLAYER_TRADE_POLICY.sessionInactivityMs);
}

/** A session's effective status at `now`: an idle `active` session has expired. */
export function effectiveTradeSessionStatus(
  session: { status: TradeSessionStatus; lastActivityAt: Date },
  now: Date,
): TradeSessionStatus {
  if (session.status !== "active") return session.status;
  return now.getTime() >= tradeSessionExpiresAt(session.lastActivityAt).getTime()
    ? "expired"
    : "active";
}

/** The start of the rolling request window ending at `now` (exclusive). */
export function tradeRequestWindowStart(now: Date): Date {
  return new Date(now.getTime() - PLAYER_TRADE_POLICY.requestBudget.windowMs);
}

export type TradeRequestBudgetDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Whether one more request fits the account's rolling budget, given the
 * creation instants of its requests still inside the window. Only requests the
 * server actually created count, so a refused attempt never spends allowance.
 */
export function decideTradeRequestBudget(
  createdAtsInWindow: readonly Date[],
  now: Date,
): TradeRequestBudgetDecision {
  const { maxRequests, windowMs } = PLAYER_TRADE_POLICY.requestBudget;
  const inWindow = createdAtsInWindow
    .map((createdAt) => createdAt.getTime())
    .filter((time) => time > now.getTime() - windowMs && time <= now.getTime())
    .sort((a, b) => a - b);
  if (inWindow.length < maxRequests) return { allowed: true };
  // The oldest request that keeps the window full must age out first.
  const oldestBlocking = inWindow[inWindow.length - maxRequests]!;
  return { allowed: false, retryAfterMs: oldestBlocking + windowMs - now.getTime() };
}

/** Whether a sender account's requests to one recipient account warrant prominent Block. */
export function isRepeatedTradeRequester(requestsInWindow: number): boolean {
  return requestsInWindow >= PLAYER_TRADE_POLICY.repeatedRecipientThreshold;
}

/**
 * The consent recorded on an accepted session (#267). Ready and Confirm are
 * per participant and always belong to the session's current offer version:
 * every change to either offer advances the version and clears all four.
 */
export type TradeConsent = {
  requesterReady: boolean;
  recipientReady: boolean;
  requesterConfirmed: boolean;
  recipientConfirmed: boolean;
};

export const NO_TRADE_CONSENT: TradeConsent = {
  requesterReady: false,
  recipientReady: false,
  requesterConfirmed: false,
  recipientConfirmed: false,
};

export type TradeSide = "requester" | "recipient";

export function otherTradeSide(side: TradeSide): TradeSide {
  return side === "requester" ? "recipient" : "requester";
}

/**
 * `compose` while either participant can still edit; `review` once both are
 * Ready, when the offers are frozen into the exact proposal both reviewed and
 * only Confirm, Change Offer, or Cancel apply.
 */
export type TradeOfferPhase = "compose" | "review";

export function tradeOfferPhase(consent: TradeConsent): TradeOfferPhase {
  return consent.requesterReady && consent.recipientReady ? "review" : "compose";
}

export function hasTradeConsent(consent: TradeConsent): boolean {
  return (
    consent.requesterReady ||
    consent.recipientReady ||
    consent.requesterConfirmed ||
    consent.recipientConfirmed
  );
}

export function sideReady(consent: TradeConsent, side: TradeSide): boolean {
  return side === "requester" ? consent.requesterReady : consent.recipientReady;
}

export function sideConfirmed(consent: TradeConsent, side: TradeSide): boolean {
  return side === "requester" ? consent.requesterConfirmed : consent.recipientConfirmed;
}

/**
 * A Credit offer is a whole, non-negative number of Credits no larger than the
 * offering character's authoritative balance. Anything else — negative,
 * fractional, non-finite, or not a number at all — is malformed.
 */
export function isValidCreditOffer(credits: unknown, balance: number): credits is number {
  return (
    typeof credits === "number" &&
    Number.isSafeInteger(credits) &&
    credits >= 0 &&
    credits <= balance
  );
}

/** A stack quantity to add or remove is a positive whole number. */
export function isValidStackQuantity(quantity: unknown): quantity is number {
  return typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity > 0;
}
