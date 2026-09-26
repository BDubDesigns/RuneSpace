"use client";

import type { ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { boundedRunProgress, stepBoundedRunQuantity } from "@/game/domain/bounded-run";

/**
 * The one bounded-run quantity selector (#229).
 *
 * Refining batches and Practice welds choose a finite run the same way, and
 * Fabrication and Tinkering will too: the quantity starts at 1, − and + move it
 * by one, and Max jumps straight to the server-projected maximum. The selector
 * never decides anything — `maximum` is the authoritative projection, and Start
 * sends the chosen number for the server to revalidate. A selection the
 * maximum has since shrunk below is shown as unavailable, never quietly
 * lowered: the player chooses again.
 *
 * What a unit costs or yields stays with the activity, passed in as `summary`.
 */
export function BoundedRunSelector({
  disabled = false,
  maximum,
  onChange,
  quantity,
  summary,
  unit,
}: {
  disabled?: boolean;
  /** The authoritative maximum from the server projection. */
  maximum: number;
  onChange: (quantity: number) => void;
  quantity: number;
  /** The whole selected run, in the activity's own terms. */
  summary?: ReactNode;
  unit: { singular: string; plural: string };
}) {
  const noun = (count: number) => (count === 1 ? unit.singular : unit.plural);
  const unavailable = maximum < 1;
  const exceeds = !unavailable && quantity > maximum;
  const step = (delta: number) => onChange(stepBoundedRunQuantity(quantity, delta, maximum));
  return (
    <fieldset
      className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-bounded-run
      data-bounded-run-maximum={maximum}
      data-bounded-run-quantity={quantity}
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
          disabled={quantity <= 1}
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
          {quantity}
          <span className="sr-only"> {noun(quantity)} selected</span>
        </output>
        <ActionButton
          aria-label={`More ${unit.plural}`}
          className="w-11 px-0"
          data-bounded-run-increase
          disabled={quantity >= maximum}
          intent="secondary"
          onClick={() => step(1)}
          type="button"
        >
          +
        </ActionButton>
        <ActionButton
          aria-label={`Max: ${maximum} ${noun(maximum)}`}
          data-bounded-run-max
          disabled={unavailable || quantity === maximum}
          intent="secondary"
          onClick={() => onChange(Math.max(1, maximum))}
          type="button"
        >
          Max
        </ActionButton>
        <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          {unavailable ? `No ${unit.plural} available` : `Up to ${maximum} ${noun(maximum)}`}
        </p>
      </div>
      {exceeds ? (
        <p
          className="text-sm text-[color:var(--rs-accent-danger)]"
          data-bounded-run-exceeds
          role="status"
        >
          Only {maximum} {noun(maximum)} can start now. Choose again.
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

/** Where a running bounded run stands: the counterpart of the selector. */
export function BoundedRunProgress({
  completed,
  selected,
  unit,
}: {
  completed: number;
  selected: number;
  unit: { singular: string; plural: string };
}) {
  const progress = boundedRunProgress(selected, completed);
  const current = Math.min(progress.selected, progress.completed + 1);
  return (
    <div data-bounded-run-progress>
      <StatusMeter
        detail={`${progress.completed} / ${progress.selected} done · ${progress.remaining} left`}
        label={`Run — ${unit.singular} ${current} of ${progress.selected}`}
        value={progress.selected === 0 ? 0 : (progress.completed / progress.selected) * 100}
      />
    </div>
  );
}
