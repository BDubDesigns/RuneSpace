"use client";

import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CollapseButton } from "@/features/shared/CollapseButton";
import { COLLAPSE_KEYS, useSyncedCollapse } from "@/features/shared/use-synced-collapse";
import type { PracticeRunState, PracticeRunWeld } from "@/server/practice-welding";

/**
 * Bounded Practice run history and summary (#190).
 *
 * The same server-resolved presentation Mining and Refining already use — the
 * totals and the last ten resolved welds, computed nowhere but the server. It
 * deliberately reuses the shared primitives rather than inventing a universal
 * `This Run` subsystem the codebase does not have.
 */
export function PracticeRunPanel({ run }: { run: PracticeRunState }) {
  const { collapsed, toggle } = useSyncedCollapse(COLLAPSE_KEYS.runHistory);
  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <SectionHeader eyebrow="Server-resolved" level={2}>
          This practice run
        </SectionHeader>
        <CollapseButton collapsed={collapsed} label="practice run" onToggle={toggle} />
      </div>
      {!collapsed ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <p>
              <strong>{run.welds}</strong> welds
            </p>
            <p>
              <strong>{run.scrapConsumed}</strong> Scrap consumed
            </p>
            <p>
              <strong>{run.slagKept}</strong> Slag kept
            </p>
            <p>
              <strong>{run.xpGained}</strong> Welding XP
            </p>
          </div>
          {run.slagDiscarded > 0 ? (
            <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
              <strong>{run.slagDiscarded}</strong> Slag discarded
            </p>
          ) : null}
          <div
            className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1"
            aria-label="Practice weld history"
          >
            {[...run.recentWelds].reverse().map((weld) => (
              <PracticeWeldRow key={weld.sequence} weld={weld} />
            ))}
            {run.recentWelds.length === 0 ? (
              <p className="text-sm text-[color:var(--rs-text-muted)]">
                No completed welds in this run yet.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </Panel>
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
