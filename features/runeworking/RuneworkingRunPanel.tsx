"use client";

import { XpAmount, XpMark } from "@/components/ui/XpAmount";
import { describeQuantities } from "@/features/refining/attempt-copy";
import { RunSummary } from "@/features/shared/RunSummary";
import { SKILL_IDS } from "@/game/config/foundations";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import type { RuneworkingRunCycle, RuneworkingRunState } from "@/server/runeworking";

/**
 * A Runeworking run's totals and bounded cycle history, in the shared run
 * summary (#193, #391). A numeric run shows how far through it is; Max shows
 * only what it has done, with no invented denominator (#229).
 */
export function RuneworkingRunPanel({ run }: { run: RuneworkingRunState }) {
  if (run.cycles === 0 && run.recentCycles.length === 0) return null;
  const made = Object.entries(run.outputsGained).map(([itemId, quantity]) => ({
    itemId,
    name: resolveItemPresentation(itemId, itemId).displayName,
    quantity,
  }));
  return (
    <RunSummary
      historyLabel="Runeworking attunement history"
      stats={[
        run.selection === BOUNDED_RUN_MAX
          ? { label: "attunements · Max", value: run.cycles }
          : { label: "attunements", value: `${run.cycles} of ${run.selection}` },
        ...(made.length > 0 ? [{ label: "made", value: describeQuantities(made, ", ") }] : []),
        {
          id: "xp",
          label: (
            <>
              Runeworking <XpMark skillId={SKILL_IDS.runeworking} />
            </>
          ),
          value: run.xpGained,
        },
      ]}
      title="This attunement run"
      {...(run.recentCycles.length > 0
        ? {
            history: [...run.recentCycles]
              .reverse()
              .map((cycle) => <CycleRow cycle={cycle} key={cycle.sequence} />),
          }
        : {})}
    />
  );
}

function CycleRow({ cycle }: { cycle: RuneworkingRunCycle }) {
  return (
    <article
      className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm"
      data-rig-cycle-result
    >
      <p className="font-display uppercase tracking-wide">
        Attunement {cycle.sequence} &middot; Made
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        <XpAmount
          amount={cycle.xpAwarded}
          skillId={SKILL_IDS.runeworking}
          skillName="Runeworking"
        />
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(cycle.resolvedAt).toLocaleTimeString()}
      </p>
    </article>
  );
}
