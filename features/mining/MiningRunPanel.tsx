"use client";

import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { COLLAPSE_KEYS, useSyncedCollapse } from "@/features/shared/use-synced-collapse";
import { CollapseButton } from "@/features/shared/CollapseButton";
import { miningNearMissBasisPoints } from "@/game/domain/mining";
import type { MiningRunAttempt, MiningRunState } from "@/server/mining";
import type { EffectiveGameBalance } from "@/game/config/balance";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/**
 * Bounded Mining run history + summary, shown beneath the Ferrite Shale Mining activity.
 * Collapse state is synced with the Refining run panel (and any future run
 * panels) via a single localStorage key — collapsing one collapses all.
 */
export function MiningRunPanel({
  run,
  balance,
}: {
  run: MiningRunState;
  balance: EffectiveGameBalance;
}) {
  const { collapsed, toggle } = useSyncedCollapse(COLLAPSE_KEYS.runHistory);
  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <SectionHeader eyebrow="Server-resolved">This mining run</SectionHeader>
        <CollapseButton collapsed={collapsed} label="mining run" onToggle={toggle} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <p>
          <strong>{run.attempts}</strong> attempts
        </p>
        <p>
          <strong>{run.successes}</strong> successful
        </p>
        <p>
          <strong>{run.failures}</strong> failed
        </p>
        <p>
          <strong>{run.shaleGained}</strong> shale gained
        </p>
        <p>
          <strong>{run.xpGained}</strong> Mining XP
        </p>
      </div>
      {!collapsed ? (
        <div
          className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1"
          aria-label="Mining attempt history"
        >
          {[...run.recentAttempts].reverse().map((attempt) => (
            <MiningAttemptRow attempt={attempt} balance={balance} key={attempt.sequence} />
          ))}
          {run.recentAttempts.length === 0 ? (
            <p className="text-sm text-[color:var(--rs-text-muted)]">
              No resolved attempts in this run yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function MiningAttemptRow({
  attempt,
  balance,
}: {
  attempt: MiningRunAttempt;
  balance: EffectiveGameBalance;
}) {
  return (
    <article className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm">
      <p className="font-display uppercase tracking-wide">
        Attempt {attempt.sequence} - {attempt.success ? "Success" : "Failed"}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
        {percentage(attempt.thresholdBasisPoints)}
      </p>
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {attempt.boosted
          ? `Boosted · ${attempt.durationTicks} ticks · charge consumed: ${attempt.chargeConsumed ? "yes" : "no"} · ${attempt.remainingCharge} / ${balance.items.salvageCutter.maximumCharge} remaining`
          : `Normal · ${attempt.durationTicks} ticks`}
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
      </p>
      {attempt.success ? (
        <p>
          {attempt.shaleAwarded} Ferrite Shale | {attempt.xpAwarded} Mining XP
        </p>
      ) : (
        <p>
          Missed by{" "}
          {percentage(
            miningNearMissBasisPoints(attempt.rolledBasisPoints, attempt.thresholdBasisPoints),
          )}
        </p>
      )}
    </article>
  );
}
