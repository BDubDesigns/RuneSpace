"use client";
import { RunSummary } from "@/features/shared/RunSummary";
import { describeQuantities } from "@/features/refining/attempt-copy";
import { XpAmount } from "@/components/ui/XpAmount";
import { SKILL_IDS } from "@/game/config/foundations";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { LapidaryWorkbenchProjection } from "@/server/lapidary-state";

export function LapidaryRunPanel({ bench }: { bench: LapidaryWorkbenchProjection }) {
  const { run } = bench;
  if (run.cycles === 0) return null;
  const quantities = (totals: Readonly<Record<string, number>>) =>
    describeQuantities(
      Object.entries(totals).map(([itemId, quantity]) => ({
        itemId,
        quantity,
        name: resolveItemPresentation(itemId, itemId).displayName,
      })),
      ", ",
    );
  return (
    <RunSummary
      title="This Lapidary run"
      historyLabel="Lapidary piece history"
      stats={[
        {
          label: run.selection === "max" ? "pieces · Max" : "pieces",
          value: run.selection === "max" ? run.cycles : `${run.cycles} of ${run.selection}`,
        },
        { label: "consumed", value: quantities(run.inputsConsumed) },
        ...(Object.keys(run.outputsGained).length
          ? [{ label: "made", value: quantities(run.outputsGained) }]
          : []),
        { label: "Lapidary XP", value: run.xpGained },
      ]}
      history={[...run.recentCycles].reverse().map((cycle) => (
        <article
          key={cycle.sequence}
          className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm"
        >
          <p>
            {bench.recipes.find((recipe) => recipe.actionId === cycle.recipeActionId)?.displayName}{" "}
            · piece {cycle.sequence} complete
          </p>
          <XpAmount amount={cycle.xpAwarded} skillId={SKILL_IDS.lapidary} skillName="Lapidary" />
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            Resolved {new Date(cycle.resolvedAt).toLocaleTimeString()}
          </p>
        </article>
      ))}
    />
  );
}
