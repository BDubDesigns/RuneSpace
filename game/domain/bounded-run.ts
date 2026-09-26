/**
 * The shared bounded-run quantity rule (#229).
 *
 * Wherever the player chooses a finite repeatable run before starting —
 * Refining batches and Practice welds today, Fabrication and Tinkering later —
 * RuneSpace uses one interaction: the quantity starts at 1, − / + move it by
 * one, and Max jumps to the server-authoritative maximum. Start revalidates the
 * selection against authoritative state and refuses one that is no longer
 * valid rather than silently running a smaller amount.
 *
 * This module owns only that quantity language. What an activity's maximum
 * actually is — which inputs, which capacity rules — belongs to that activity's
 * own domain rule, never here.
 */

import {
  BOUNDED_RUN_MINIMUM_QUANTITY,
  BOUNDED_RUN_QUANTITY_CEILING,
} from "@/game/config/foundations";

/** The quantity a fresh selector shows. */
export const BOUNDED_RUN_DEFAULT_QUANTITY = BOUNDED_RUN_MINIMUM_QUANTITY;

export type BoundedRunQuantityCheck =
  | { ok: true; quantity: number }
  | {
      ok: false;
      /**
       * `unavailable`: nothing can start at all right now. `exceeds_maximum`:
       * the selection was valid once, but authoritative state has moved on.
       */
      reason: "invalid_quantity" | "unavailable" | "exceeds_maximum";
      maximum: number;
    };

/**
 * Start's revalidation. A selection above the current maximum is refused, not
 * reduced: the player chose that number, and running a different one without
 * asking would be the game deciding for them.
 */
export function checkBoundedRunQuantity(
  requested: number,
  maximum: number,
): BoundedRunQuantityCheck {
  if (
    !Number.isInteger(requested) ||
    requested < BOUNDED_RUN_MINIMUM_QUANTITY ||
    requested > BOUNDED_RUN_QUANTITY_CEILING
  ) {
    return { ok: false, reason: "invalid_quantity", maximum };
  }
  if (maximum < BOUNDED_RUN_MINIMUM_QUANTITY) return { ok: false, reason: "unavailable", maximum };
  if (requested > maximum) return { ok: false, reason: "exceeds_maximum", maximum };
  return { ok: true, quantity: requested };
}

/**
 * The selector's own − / + step. Never below one, never above the maximum the
 * server last projected; with nothing available it rests at one.
 */
export function stepBoundedRunQuantity(current: number, delta: number, maximum: number): number {
  const upper = Math.max(BOUNDED_RUN_MINIMUM_QUANTITY, maximum);
  return Math.min(upper, Math.max(BOUNDED_RUN_MINIMUM_QUANTITY, current + delta));
}

/** Where a running selection stands, for the active-run progress line. */
export type BoundedRunProgress = {
  selected: number;
  completed: number;
  remaining: number;
};

export function boundedRunProgress(selected: number, completed: number): BoundedRunProgress {
  const done = Math.min(Math.max(0, completed), selected);
  return { selected, completed: done, remaining: Math.max(0, selected - done) };
}
