"use client";

import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { COLLAPSE_KEYS, useSyncedCollapse } from "@/features/shared/use-synced-collapse";
import { CollapseButton } from "@/features/shared/CollapseButton";
import type { RefiningRunAttempt, RefiningRunState } from "@/server/refining";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/**
 * Bounded Refining run history + summary, shown beneath the Processing Yard
 * activity (mirrors Mining's "This mining run" panel). Server-resolved data
 * only — no client-side computation.
 */
export function RefiningRunPanel({
  run,
  ferriteQuantity,
  slagQuantity,
}: {
  run: RefiningRunState;
  ferriteQuantity: number;
  slagQuantity: number;
}) {
  const { collapsed, toggle } = useSyncedCollapse(COLLAPSE_KEYS.runHistory);
  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <SectionHeader eyebrow="Server-resolved">This refining run</SectionHeader>
        <CollapseButton collapsed={collapsed} label="refining run" onToggle={toggle} />
      </div>
      {!collapsed ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <p>
              <strong>{run.attempts}</strong> attempts
            </p>
            <p>
              <strong>{run.successes}</strong> Refined Ferrite
            </p>
            <p>
              <strong>{run.failures}</strong> Slag
            </p>
            <p>
              <strong>{run.xpGained}</strong> Refining XP
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <p>
              <strong>{run.shaleConsumed}</strong> shale consumed
            </p>
            <p>
              <strong>{ferriteQuantity}</strong> Refined Ferrite carried
            </p>
            <p>
              <strong>{slagQuantity}</strong> Slag carried
            </p>
          </div>
          <div
            className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1"
            aria-label="Refining attempt history"
          >
            {[...run.recentAttempts].reverse().map((attempt) => (
              <RefiningAttemptRow attempt={attempt} key={attempt.sequence} />
            ))}
            {run.recentAttempts.length === 0 ? (
              <p className="text-sm text-[color:var(--rs-text-muted)]">
                No resolved attempts in this run yet.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </Panel>
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
        7 ticks &middot; 2 Ferrite Shale consumed
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
