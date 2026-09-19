"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { RefiningRunAttempt, RefiningRunState } from "@/server/refining";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/** The item's authoritative display name, by its stable ID. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

/** "2 Galvanite", "1 Refined Ferrite, 1 Galvanic Stock". */
function describeQuantities(quantities: readonly { itemId: string; quantity: number }[]): string {
  if (quantities.length === 0) return "nothing";
  return quantities.map((entry) => `${entry.quantity} ${itemName(entry.itemId)}`).join(", ");
}

/**
 * Refining's run totals and bounded history, in the shared run summary (#193).
 *
 * It no longer restates the carried inputs and outputs: the activity's context
 * row directly above shows them, and showing them twice on one phone screen was
 * one of the duplications this issue set out to remove.
 *
 * For the same reason History holds the attempts *before* the current one: the
 * Refining console above already presents the newest attempt in full.
 */
export function RefiningRunPanel({ run }: { run: RefiningRunState }) {
  // Everything except the newest, which the console itself is showing.
  const priorAttempts = run.recentAttempts.slice(0, -1);
  return (
    <RunSummary
      historyLabel="Refining attempt history"
      stats={[
        { label: "attempts", value: run.attempts },
        { label: "successful", value: run.successes },
        { label: "failed", value: run.failures },
        // Keyed by item, so a run of any recipe reads correctly (#209).
        ...Object.entries(run.inputsConsumed).map(([itemId, quantity]) => ({
          label: `${itemName(itemId)} used`,
          value: quantity,
        })),
        ...Object.entries(run.outputsGained).map(([itemId, quantity]) => ({
          label: `${itemName(itemId)} gained`,
          value: quantity,
        })),
        { label: "Refining XP", value: run.xpGained },
      ]}
      title="This refining run"
      {...(priorAttempts.length > 0
        ? {
            history: [...priorAttempts]
              .reverse()
              .map((attempt) => <RefiningAttemptRow attempt={attempt} key={attempt.sequence} />),
          }
        : {})}
    />
  );
}

function RefiningAttemptRow({ attempt }: { attempt: RefiningRunAttempt }) {
  return (
    <article className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm">
      <p className="font-display uppercase tracking-wide">
        Attempt {attempt.sequence} — {attempt.success ? "Success" : "Failed"}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
        {percentage(attempt.thresholdBasisPoints)}
      </p>
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {attempt.durationTicks} ticks &middot; {describeQuantities(attempt.consumed)} consumed
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
      </p>
      <p>
        {describeQuantities(attempt.awarded)} | {attempt.xpAwarded} Refining XP
      </p>
    </article>
  );
}
