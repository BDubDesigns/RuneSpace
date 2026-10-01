import { z } from "zod";
import type { TradeOfferPhase, TradeRequestStatus } from "@/game/domain/player-trade";
import { CharacterTargetSchema } from "@/game/schemas/whispers";

/**
 * Player trade request, session, and offer contracts (issues #266 and #267),
 * shared by `server/player-trades.ts`, its route and actions, and the browser.
 *
 * Requests name only the acting character and, per command, the target
 * character or the request/session id. Ids are identifiers, never secrets:
 * the server proves the acting character is the right participant on every
 * read and mutation. Account identity never leaves the server.
 *
 * Offer commands also name the offer version the browser believes it is
 * acting on. That is the browser's claim, not authority: the server applies
 * the command only to that exact current version, and owns the next one.
 * These schemas shape the request; the server re-proves every value itself.
 */

export const CreateTradeRequestSchema = z.object({
  characterId: z.string().uuid(),
  target: CharacterTargetSchema,
});

export const TradeRequestCommandSchema = z.object({
  characterId: z.string().uuid(),
  requestId: z.string().uuid(),
});

export const TradeSessionCommandSchema = z.object({
  characterId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

const TradeOfferCommandBase = {
  characterId: z.string().uuid(),
  sessionId: z.string().uuid(),
  offerVersion: z.number().int().positive(),
};

/** Ready, Change Offer, and Confirm: consent to, or withdrawal from, one exact version. */
export const TradeConsentCommandSchema = z.object(TradeOfferCommandBase);

/** Set the acting character's own Credit offer to an absolute amount. */
export const SetTradeCreditsSchema = z.object({
  ...TradeOfferCommandBase,
  credits: z.number().int().nonnegative(),
});

/** Add or remove a quantity of one of the acting character's own carried stack items. */
export const TradeStackOfferSchema = z.object({
  ...TradeOfferCommandBase,
  itemId: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
});

/** Add or remove one of the acting character's own carried unique item instances. */
export const TradeItemOfferSchema = z.object({
  ...TradeOfferCommandBase,
  itemInstanceId: z.string().uuid(),
});

export const TradeStateQuerySchema = z.object({
  characterId: z.string().uuid(),
});

/** The other character in a request or session. */
export type TradeCounterpart = { characterId: string; name: string };

export type TradeRequestView = {
  id: string;
  counterpart: TradeCounterpart;
  createdAt: string;
  expiresAt: string;
};

export type IncomingTradeRequestView = TradeRequestView & {
  /**
   * The sender's account has made enough requests to this account inside the
   * rolling window that Block Player / Decline & Block should be prominent.
   */
  blockProminent: boolean;
};

/** One participant's offer and consent, as both participants see it. */
export type TradeOfferView = {
  credits: number;
  stacks: { itemId: string; quantity: number }[];
  /** Each offered unique instance with the mutable state that matters to its value. */
  items: { itemInstanceId: string; itemId: string; currentCharge: number | null }[];
  ready: boolean;
  confirmed: boolean;
};

export type TradeSessionView = {
  id: string;
  counterpart: TradeCounterpart;
  startedAt: string;
  /** When the session expires unless trade activity refreshes it. */
  expiresAt: string;
  /** The server-owned version every offer command must name. */
  offerVersion: number;
  phase: TradeOfferPhase;
  /** The acting character's own offer. */
  yours: TradeOfferView;
  /** The counterpart's offer; read-only to the acting character. */
  theirs: TradeOfferView;
  /**
   * Why the latest final Confirm could not settle, in the acting character's
   * words (#268). Present until either offer changes, so the participant who
   * confirmed first also learns what to correct.
   */
  settlementRefusal?: { reason: TradeRefusalReason; message: string };
};

/** The offered lines of one side, without consent: what a finished trade moved. */
export type TradeOfferLines = Omit<TradeOfferView, "ready" | "confirmed">;

/**
 * The acting character's most recent accepted session once it has ended
 * (#268). Durable, so a tab that missed the `trade.session` prompt — or
 * reconnects afterwards — still learns how the trade it was showing ended.
 */
export type EndedTradeView = {
  id: string;
  counterpart: TradeCounterpart;
  outcome: "completed" | "canceled" | "expired";
  endedAt: string;
  /** For a canceled trade: whether the acting character canceled it. */
  canceledByYou: boolean;
  /** For a completed trade: exactly what the acting character gave and received. */
  exchange?: { gave: TradeOfferLines; received: TradeOfferLines };
};

/** A committed trade, as either participant may learn it from Confirm. */
export type CompletedTradeView = {
  tradeId: string;
  completedAt: string;
};

/** One character's authoritative trade state: what the request/session UI renders. */
export type TradeStateView = {
  /** The character's own pending request, which holds it idle. */
  outgoing: TradeRequestView | null;
  /** Pending requests other characters have sent this character. */
  incoming: IncomingTradeRequestView[];
  /** The accepted session this character is in, if any. */
  session: TradeSessionView | null;
  /** The character's latest session, when no session is active and it has ended. */
  ended: EndedTradeView | null;
};

export type TradeRefusalReason =
  | "unavailable"
  | "blocked_by_you"
  | "socially_restricted"
  | "rate_limited"
  | "already_requesting"
  | "busy"
  | "in_trade"
  | "already_accepted"
  /** The command named an offer version that is no longer current. */
  | "stale_offer"
  /** The requested offer change is not the acting character's to make. */
  | "invalid_offer"
  /** Both participants are Ready; the offers are frozen until Change Offer. */
  | "offer_frozen"
  /** Confirm needs both participants Ready on the current version. */
  | "not_ready"
  /** Neither participant offers anything; one-sided gifts are fine. */
  | "empty_trade"
  /**
   * Settlement refusals (#267). Nothing moved, both participants' consent was
   * cleared, and the session is back in compose on a new version.
   */
  | "offer_unavailable"
  | "inventory_full"
  | "too_heavy"
  | "last_cutter"
  /** A participant's Credits after the trade would exceed what a character can hold. */
  | "credit_limit"
  /** A participant is no longer at the trade's World Location or free to trade. */
  | "ineligible";

export type TradeCommandResult =
  | {
      status: "ok";
      state: TradeStateView;
      /** Set when this command's trade has committed, including on a repeated Confirm. */
      completed?: CompletedTradeView;
    }
  | { status: "refused"; reason: TradeRefusalReason; error: string; retryAfterMs?: number };

/** How a request changed; `pending` is never published. */
export type TradeRequestChange = "created" | Exclude<TradeRequestStatus, "pending">;

/** `updated`: either offer or either participant's consent changed (#267). */
export type TradeSessionChange = "started" | "updated" | "canceled" | "expired" | "completed";

// Register trade invalidations on the shared realtime registry (#245). Both
// are prompts only, sent to both participant characters after commit; each
// tab re-reads `GET /api/trade` for the durable state.
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    "trade.request": { requestId: string; change: TradeRequestChange };
    "trade.session": { sessionId: string; change: TradeSessionChange };
  }
}
