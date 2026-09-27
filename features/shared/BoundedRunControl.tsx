"use client";

import type { ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import {
  BOUNDED_RUN_MAX,
  boundedRunProgress,
  stepBoundedRunSelection,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";

/**
 * The one bounded-run selector (#229).
 *
 * Refining batches and Practice welds choose a run the same way, and
 * Fabrication and Tinkering will too: the selection starts at 1, − and + move
 * it by one, and Max chooses to keep going until the activity is blocked. Max
 * is shown as Max, never as a number — how long a Max run lasts depends on
 * the real results, and nothing here predicts it.
 *
 * The selector never decides anything. `affordable` is the server's count of
 * how many units the inputs carried right now pay for: the largest number +
 * offers, and what Start revalidates a number against. A number that count has
 * since shrunk below is shown as unavailable, never quietly lowered: the
 * player chooses again.
 *
 * What a unit costs or yields stays with the activity, passed in as `summary`.
 */
export function BoundedRunSelector({
  affordable,
  disabled = false,
  onChange,
  selection,
  summary,
  unit,
}: {
  /** How many units the inputs carried pay for, from the server projection. */
  affordable: number;
  disabled?: boolean;
  onChange: (selection: BoundedRunSelection) => void;
  selection: BoundedRunSelection;
  /** The selected run, in the activity's own terms. */
  summary?: ReactNode;
  unit: { singular: string; plural: string };
}) {
  const noun = (count: number) => (count === 1 ? unit.singular : unit.plural);
  const isMax = selection === BOUNDED_RUN_MAX;
  const unavailable = affordable < 1;
  const exceeds = !unavailable && !isMax && selection > affordable;
  const step = (delta: number) => onChange(stepBoundedRunSelection(selection, delta, affordable));
  return (
    <fieldset
      className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-bounded-run
      data-bounded-run-affordable={affordable}
      data-bounded-run-quantity={selection}
      disabled={disabled || unavailable}
    >
      <legend className="px-1 font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        Run size
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          aria-label={`Fewer ${unit.plural}`}
          className="w-11 px-0"
          data-bounded-run-decrease
          disabled={!isMax && selection <= 1}
          intent="secondary"
          onClick={() => step(-1)}
          type="button"
        >
          &minus;
        </ActionButton>
        <output
          aria-live="polite"
          className="min-w-[4.5rem] text-center font-display text-lg tabular-nums"
          data-bounded-run-value
        >
          {isMax ? "Max" : selection}
          <span className="sr-only">
            {isMax ? ` selected: run until blocked` : ` ${noun(selection)} selected`}
          </span>
        </output>
        <ActionButton
          aria-label={`More ${unit.plural}`}
          className="w-11 px-0"
          data-bounded-run-increase
          disabled={isMax || selection >= affordable}
          intent="secondary"
          onClick={() => step(1)}
          type="button"
        >
          +
        </ActionButton>
        <ActionButton
          aria-label="Max: run until materials or space run out"
          aria-pressed={isMax}
          data-bounded-run-max
          disabled={unavailable}
          intent="secondary"
          onClick={() => onChange(BOUNDED_RUN_MAX)}
          type="button"
        >
          Max
        </ActionButton>
        <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          {unavailable
            ? `No ${unit.plural} available`
            : isMax
              ? "Runs until blocked"
              : `Materials for ${affordable} ${noun(affordable)}`}
        </p>
      </div>
      {exceeds ? (
        <p
          className="text-sm text-[color:var(--rs-accent-danger)]"
          data-bounded-run-exceeds
          role="status"
        >
          Your materials cover {affordable} {noun(affordable)} right now. Choose again.
        </p>
      ) : null}
      {summary && !unavailable ? (
        <div className="text-xs text-[color:var(--rs-text-secondary)]" data-bounded-run-summary>
          {summary}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Where a running selection stands: the counterpart of the selector. A number
 * shows how far through it the run is; Max has no denominator to show, so it
 * shows only what has been done and that it continues until blocked.
 */
export function BoundedRunProgress({
  completed,
  selection,
  unit,
}: {
  completed: number;
  selection: BoundedRunSelection;
  unit: { singular: string; plural: string };
}) {
  const progress = boundedRunProgress(selection, completed);
  if (progress.mode === "max") {
    const noun = progress.completed === 1 ? unit.singular : unit.plural;
    return (
      <p
        className="flex items-center justify-between gap-2 text-xs text-[color:var(--rs-text-secondary)]"
        data-bounded-run-mode="max"
        data-bounded-run-progress
      >
        <span>
          Run — {progress.completed} {noun} · Max
        </span>
        <span>Until blocked</span>
      </p>
    );
  }
  const current = Math.min(progress.selected, progress.completed + 1);
  return (
    <div data-bounded-run-mode="count" data-bounded-run-progress>
      <StatusMeter
        detail={`${progress.completed} / ${progress.selected} done · ${progress.remaining} left`}
        label={`Run — ${unit.singular} ${current} of ${progress.selected}`}
        value={progress.selected === 0 ? 0 : (progress.completed / progress.selected) * 100}
      />
    </div>
  );
}
