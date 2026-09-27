"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import { describeQuantities } from "@/features/refining/attempt-copy";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import type { FabricationRunState, FabricationRunWorkpiece } from "@/server/fabrication";
import type { TinkeringRunBatch, TinkeringRunState } from "@/server/tinkering";

const named = (totals: Readonly<Record<string, number>>) =>
  Object.entries(totals).map(([itemId, quantity]) => ({
    itemId,
    name: resolveItemPresentation(itemId, itemId).displayName,
    quantity,
  }));

/**
 * A Fabrication run's totals and bounded workpiece history, in the shared run
 * summary (#193, #232). A numeric run shows how far through it is; Max shows
 * only what it has done, with no invented denominator (#229).
 */
export function FabricationRunPanel({ run }: { run: FabricationRunState }) {
  if (run.batches === 0 && run.recentWorkpieces.length === 0) return null;
  const made = named(run.outputsGained);
  return (
    <RunSummary
      historyLabel="Fabrication workpiece history"
      stats={[
        run.selection === BOUNDED_RUN_MAX
          ? { label: "workpieces · Max", value: run.batches }
          : { label: "workpieces", value: `${run.batches} of ${run.selection}` },
        ...(made.length > 0 ? [{ label: "made", value: describeQuantities(made, ", ") }] : []),
        ...(run.busts > 0 ? [{ label: run.busts === 1 ? "bust" : "busts", value: run.busts }] : []),
        { label: "Fabrication XP", value: run.xpGained },
      ]}
      title="This fabrication run"
      {...(run.recentWorkpieces.length > 0
        ? {
            history: [...run.recentWorkpieces]
              .reverse()
              .map((workpiece) => <WorkpieceRow key={workpiece.sequence} workpiece={workpiece} />),
          }
        : {})}
    />
  );
}

function WorkpieceRow({ workpiece }: { workpiece: FabricationRunWorkpiece }) {
  return (
    <article
      className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm"
      data-workpiece-result={workpiece.result}
    >
      <p className="font-display uppercase tracking-wide">
        Workpiece {workpiece.sequence} &middot; {workpiece.result === "success" ? "Made" : "Bust"}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        {workpiece.result === "bust"
          ? `Fed ${workpiece.bust?.feed ?? "?"}; the Load went to ${workpiece.bust?.load ?? "?"}. Materials lost, no XP.`
          : `${workpiece.xpAwarded} Fabrication XP${workpiece.usedOverride ? " with Manual Override" : ""}`}
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(workpiece.resolvedAt).toLocaleTimeString()}
      </p>
    </article>
  );
}

/** A Tinkering run's totals and bounded batch history (#232). */
export function TinkeringRunPanel({ run }: { run: TinkeringRunState }) {
  if (run.batches === 0 && run.recentBatches.length === 0) return null;
  const taken = named(run.itemsConsumed);
  return (
    <RunSummary
      historyLabel="Tinkering batch history"
      stats={[
        run.selection === BOUNDED_RUN_MAX
          ? { label: "batches · Max", value: run.batches }
          : { label: "batches", value: `${run.batches} of ${run.selection}` },
        ...(taken.length > 0
          ? [{ label: "taken apart", value: describeQuantities(taken, ", ") }]
          : []),
        { label: "Scrap kept", value: run.scrapKept },
        ...(run.scrapDiscarded > 0
          ? [{ label: "Scrap discarded", value: run.scrapDiscarded }]
          : []),
        { label: "Fabrication XP", value: run.xpGained },
      ]}
      title="This Tinkering run"
      {...(run.recentBatches.length > 0
        ? {
            history: [...run.recentBatches]
              .reverse()
              .map((batch) => <TinkeringRow batch={batch} key={batch.sequence} />),
          }
        : {})}
    />
  );
}

function TinkeringRow({ batch }: { batch: TinkeringRunBatch }) {
  const name = resolveItemPresentation(batch.itemId, batch.itemId).displayName;
  return (
    <article className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm">
      <p className="font-display uppercase tracking-wide">
        Batch {batch.sequence} &middot; {batch.quantity} {name}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        {batch.scrapKept} Scrap kept
        {batch.scrapDiscarded > 0 ? ` | ${batch.scrapDiscarded} discarded` : ""} | {batch.xpAwarded}{" "}
        Fabrication XP
      </p>
    </article>
  );
}
