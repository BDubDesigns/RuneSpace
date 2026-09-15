"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import type { PracticeRunState, PracticeRunWeld } from "@/server/practice-welding";

/**
 * Practice's run totals and bounded weld history, in the shared run summary
 * (#193) — the same presentation Mining and Refining use, with Practice's own
 * server-resolved numbers and no shared run state behind it.
 */
export function PracticeRunPanel({ run }: { run: PracticeRunState }) {
  return (
    <RunSummary
      historyLabel="Practice weld history"
      stats={[
        { label: "welds", value: run.welds },
        { label: "Scrap used", value: run.scrapConsumed },
        { label: "Slag kept", value: run.slagKept },
        ...(run.slagDiscarded > 0 ? [{ label: "Slag discarded", value: run.slagDiscarded }] : []),
        { label: "Welding XP", value: run.xpGained },
      ]}
      title="This practice run"
      {...(run.recentWelds.length > 0
        ? {
            history: [...run.recentWelds]
              .reverse()
              .map((weld) => <PracticeWeldRow key={weld.sequence} weld={weld} />),
          }
        : {})}
    />
  );
}

function PracticeWeldRow({ weld }: { weld: PracticeRunWeld }) {
  return (
    <article className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm">
      <p className="font-display uppercase tracking-wide">Weld {weld.sequence}</p>
      <p className="text-[color:var(--rs-text-secondary)]">
        {weld.sections} sections welded &middot; {weld.scrapConsumed} Scrap consumed
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(weld.resolvedAt).toLocaleTimeString()}
      </p>
      <p>
        {weld.slagKept} Slag kept
        {weld.slagDiscarded > 0 ? ` | ${weld.slagDiscarded} discarded` : ""} | {weld.xpGained}{" "}
        Welding XP
      </p>
    </article>
  );
}
