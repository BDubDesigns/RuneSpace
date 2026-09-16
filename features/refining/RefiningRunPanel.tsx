"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import type { RefiningRunAttempt, RefiningRunState } from "@/server/refining";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/**
 * Refining's run totals and bounded history, in the shared run summary (#193).
 *
 * It no longer restates the carried Refined Ferrite and Slag: the activity's
 * context row directly above shows both, and showing them twice on one phone
 * screen was one of the duplications this issue set out to remove.
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
        { label: "Refined Ferrite", value: run.successes },
        { label: "Slag", value: run.failures },
        { label: "shale used", value: run.shaleConsumed },
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
        Attempt {attempt.sequence} — {attempt.success ? "Refined Ferrite" : "Slag"}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
        {percentage(attempt.thresholdBasisPoints)}
      </p>
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {attempt.durationTicks} ticks &middot; {attempt.shaleConsumed} Ferrite Shale consumed
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
      </p>
      <p>
        {attempt.success
          ? `${attempt.ferriteAwarded} Refined Ferrite`
          : `${attempt.slagAwarded} Slag`}{" "}
        | {attempt.xpAwarded} Refining XP
      </p>
    </article>
  );
}
