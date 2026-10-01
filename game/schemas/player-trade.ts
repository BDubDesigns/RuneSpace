import { z } from "zod";
import type { TradeRequestStatus } from "@/game/domain/player-trade";
import { CharacterTargetSchema } from "@/game/schemas/whispers";

/**
 * Player trade request and session contracts (issue #266), shared by
 * `server/player-trades.ts`, its route and actions, and the browser.
 *
 * Requests name only the acting character and, per command, the target
 * character or the request/session id. Ids are identifiers, never secrets:
 * the server proves the acting character is the right participant on every
 * read and mutation. Account identity never leaves the server.
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

export type TradeSessionView = {
  id: string;
  counterpart: TradeCounterpart;
  startedAt: string;
  /** When the session expires unless trade activity refreshes it. */
  expiresAt: string;
};

/** One character's authoritative trade state: what the request/session UI renders. */
export type TradeStateView = {
  /** The character's own pending request, which holds it idle. */
  outgoing: TradeRequestView | null;
  /** Pending requests other characters have sent this character. */
  incoming: IncomingTradeRequestView[];
  /** The accepted session this character is in, if any. */
  session: TradeSessionView | null;
};

export type TradeRefusalReason =
  | "unavailable"
  | "blocked_by_you"
  | "socially_restricted"
  | "rate_limited"
  | "already_requesting"
  | "busy"
  | "in_trade"
  | "already_accepted";

export type TradeCommandResult =
  | { status: "ok"; state: TradeStateView }
  | { status: "refused"; reason: TradeRefusalReason; error: string; retryAfterMs?: number };

/** How a request changed; `pending` is never published. */
export type TradeRequestChange = "created" | Exclude<TradeRequestStatus, "pending">;

export type TradeSessionChange = "started" | "canceled" | "expired";

// Register trade invalidations on the shared realtime registry (#245). Both
// are prompts only, sent to both participant characters after commit; each
// tab re-reads `GET /api/trade` for the durable state.
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    "trade.request": { requestId: string; change: TradeRequestChange };
    "trade.session": { sessionId: string; change: TradeSessionChange };
  }
}
