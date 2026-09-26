/**
 * The shared bounded-run selection rule (#229).
 *
 * Wherever the player chooses how long a repeatable run should be before
 * starting — Refining batches and Practice welds today, Fabrication and
 * Tinkering later — RuneSpace uses one interaction: the selection starts at 1,
 * − / + move it by one, and Max chooses to keep going until the activity is
 * blocked.
 *
 * A number is a bounded run: attempt up to exactly that many, unless the
 * activity naturally becomes unable to continue first. Start revalidates it
 * against authoritative state and refuses one that no longer fits rather than
 * silently running a smaller amount.
 *
 * Max is not a number. It is a run-until-blocked mode: the activity's ordinary
 * resolver re-evaluates real authoritative state after every attempt and
 * continues while another one can begin, so how long a Max run lasts depends
 * on the actual results. Nothing predicts it ahead of time.
 *
 * This module owns only that selection language. What an activity's inputs,
 * capacity rules and stop reasons are belongs to that activity's own domain
 * rule, never here.
 */

import {
  BOUNDED_RUN_MAX,
  BOUNDED_RUN_MINIMUM_QUANTITY,
  BOUNDED_RUN_QUANTITY_CEILING,
} from "@/game/config/foundations";

export { BOUNDED_RUN_MAX };

/** The quantity a fresh selector shows. */
export const BOUNDED_RUN_DEFAULT_QUANTITY = BOUNDED_RUN_MINIMUM_QUANTITY;

/** A bounded run's selection: a whole number of units, or Max. */
export type BoundedRunSelection = number | typeof BOUNDED_RUN_MAX;

export type BoundedRunSelectionCheck =
  | { ok: true; selection: BoundedRunSelection }
  | {
      ok: false;
      /**
       * `unavailable`: nothing can start at all right now. `exceeds_affordable`:
       * the number was valid once, but the inputs carried have since shrunk.
       */
      reason: "invalid_quantity" | "unavailable" | "exceeds_affordable";
      affordable: number;
    };

/**
 * Start's revalidation. `affordable` is how many units the inputs carried
 * right now pay for — the ceiling a number may ask for, never a prediction of
 * what Max will do. A number above it is refused, not reduced: the player
 * chose that number, and running a different one without asking would be the
 * game deciding for them. Max needs only that one unit can be paid for; the
 * activity's own preflight decides whether it can actually begin.
 */
export function checkBoundedRunSelection(
  requested: BoundedRunSelection,
  affordable: number,
): BoundedRunSelectionCheck {
  if (
    requested !== BOUNDED_RUN_MAX &&
    (!Number.isInteger(requested) ||
      requested < BOUNDED_RUN_MINIMUM_QUANTITY ||
      requested > BOUNDED_RUN_QUANTITY_CEILING)
  ) {
    return { ok: false, reason: "invalid_quantity", affordable };
  }
  if (affordable < BOUNDED_RUN_MINIMUM_QUANTITY) {
    return { ok: false, reason: "unavailable", affordable };
  }
  if (requested !== BOUNDED_RUN_MAX && requested > affordable) {
    return { ok: false, reason: "exceeds_affordable", affordable };
  }
  return { ok: true, selection: requested };
}

/**
 * The selector's own − / + step. A number never goes below one or above what
 * the inputs carried pay for; with nothing affordable it rests at one. Stepping
 * down from Max lands on the largest number, and + never turns a number into
 * Max — Max is its own explicit choice.
 */
export function stepBoundedRunSelection(
  current: BoundedRunSelection,
  delta: number,
  affordable: number,
): BoundedRunSelection {
  const upper = Math.max(BOUNDED_RUN_MINIMUM_QUANTITY, affordable);
  if (current === BOUNDED_RUN_MAX) return delta < 0 ? upper : BOUNDED_RUN_MAX;
  return Math.min(upper, Math.max(BOUNDED_RUN_MINIMUM_QUANTITY, current + delta));
}

/**
 * Why a run stopped because its selection, rather than its materials, ran out.
 * `run_completed` is a numeric selection fully attempted. `run_safety_limit`
 * is a Max run reaching the internal ceiling: that never happens under
 * today's inventories, so it is reported as its own reason rather than
 * dressed up as the activity running out.
 */
export type BoundedRunExhaustedReason = "run_completed" | "run_safety_limit";

/**
 * How many more units a running selection may START, and what reaching that
 * means. A number allows what is left of it. Max allows up to the internal
 * ceiling, which exists only so a defect can never keep a run going forever;
 * the activity's ordinary rules are what end a Max run.
 */
export type BoundedRunAllowance = {
  remaining: number;
  exhaustedReason: BoundedRunExhaustedReason;
};

export function boundedRunAllowance(
  selection: BoundedRunSelection,
  completed: number,
): BoundedRunAllowance {
  const done = Math.max(0, completed);
  return selection === BOUNDED_RUN_MAX
    ? {
        remaining: Math.max(0, BOUNDED_RUN_QUANTITY_CEILING - done),
        exhaustedReason: "run_safety_limit",
      }
    : { remaining: Math.max(0, selection - done), exhaustedReason: "run_completed" };
}

/**
 * The durable form: the selected count, or `null` for Max. One nullable column
 * on each activity's existing run row is the whole representation.
 */
export function boundedRunSelectionToColumn(selection: BoundedRunSelection): number | null {
  return selection === BOUNDED_RUN_MAX ? null : selection;
}

export function boundedRunSelectionFromColumn(value: number | null): BoundedRunSelection {
  return value === null ? BOUNDED_RUN_MAX : value;
}

/** Where a running selection stands, for the active-run progress line. */
export type BoundedRunProgress =
  | { mode: "count"; selected: number; completed: number; remaining: number }
  /** Max has no denominator: only what has been done so far. */
  | { mode: "max"; completed: number };

export function boundedRunProgress(
  selection: BoundedRunSelection,
  completed: number,
): BoundedRunProgress {
  const done = Math.max(0, completed);
  if (selection === BOUNDED_RUN_MAX) return { mode: "max", completed: done };
  const capped = Math.min(done, selection);
  return {
    mode: "count",
    selected: selection,
    completed: capped,
    remaining: Math.max(0, selection - capped),
  };
}
