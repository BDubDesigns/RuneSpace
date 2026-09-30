import type { ReactNode } from "react";

/**
 * Presentation state of the Chat/Social shell (issue #245). It holds only what
 * the shell shows; every card and count mirrors durable domain state that its
 * owning feature re-reads on reconcile.
 *
 * Every mutation is keyed and idempotent, so the same realtime delivery seen
 * twice — two tabs, a reconnect racing a reconcile read, or a repeat — leaves
 * the shell unchanged the second time.
 */

/**
 * One pinned actionable social card, for example an incoming trade request
 * (#225). `key` is the owning domain's durable identity for the thing the card
 * represents (such as `trade-request:<id>`), never a delivery ID. The owning
 * feature renders `content` and wires its actions to its own authoritative
 * commands; the shell only places, orders, and counts the card.
 */
export type SocialCard = {
  key: string;
  /** Accessible name of the card within the pinned region. */
  label: string;
  content: ReactNode;
  /**
   * Whether the card still asks for the launcher's attention (default: yes).
   * The owning domain may clear it once the player has seen the card while
   * leaving it pinned — a current moderation notice stays visible for as long
   * as it applies, but lights the launcher only until it has been seen (#248).
   */
  attention?: boolean;
};

export type SocialShellState = {
  /** Newest first. */
  cards: readonly SocialCard[];
  /** Attention contributions by source, e.g. unread Whispers (#247). */
  attention: Readonly<Record<string, number>>;
};

export type SocialShellAction =
  | { type: "upsertCard"; card: SocialCard }
  | { type: "removeCard"; key: string }
  | { type: "setAttention"; source: string; count: number };

export const INITIAL_SOCIAL_SHELL_STATE: SocialShellState = { cards: [], attention: {} };

export function socialShellReducer(
  state: SocialShellState,
  action: SocialShellAction,
): SocialShellState {
  switch (action.type) {
    case "upsertCard": {
      const index = state.cards.findIndex((card) => card.key === action.card.key);
      if (index === -1) return { ...state, cards: [action.card, ...state.cards] };
      if (state.cards[index] === action.card) return state;
      const cards = [...state.cards];
      cards[index] = action.card;
      return { ...state, cards };
    }
    case "removeCard": {
      if (!state.cards.some((card) => card.key === action.key)) return state;
      return { ...state, cards: state.cards.filter((card) => card.key !== action.key) };
    }
    case "setAttention": {
      const count = Math.max(0, Math.floor(action.count));
      if ((state.attention[action.source] ?? 0) === count) return state;
      const attention = { ...state.attention };
      if (count === 0) delete attention[action.source];
      else attention[action.source] = count;
      return { ...state, attention };
    }
  }
}

/**
 * Everything that wants the player's attention: each card that still asks for
 * it, plus every source.
 */
export function socialAttentionCount(state: SocialShellState): number {
  const cards = state.cards.filter((card) => card.attention !== false).length;
  return Object.values(state.attention).reduce((sum, count) => sum + count, cards);
}
