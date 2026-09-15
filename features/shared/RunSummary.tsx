"use client";

import { useState, type ReactNode } from "react";

/**
 * The compact "this run" block every activity with server-resolved attempts
 * carries at the bottom of its own panel (#193).
 *
 * Mining, Refining and Practice each had a full panel for this — 202 to 322px
 * for four or five counters and a bounded history that was almost always empty
 * or irrelevant — and the three files were near-identical apart from their stat
 * labels and the shape of one history row. This owns what was genuinely shared:
 * the header, the stat line, and the disclosure. What a run *is* stays entirely
 * with the activity, which is the point — there is no shared run state, no
 * common backend and no universal `ThisRun` model behind this, only a common
 * way of showing one.
 *
 * The stats are visible by default and deliberately not collapsible: they are
 * what the player is doing right now, and hiding them behind a control would
 * make the screen shorter by making it useless. The prior attempt history is
 * different — it is reference, not status — so it sits behind History.
 *
 * That disclosure renders inline in normal document flow rather than in its own
 * scroller. The old panels capped the list at `max-h-72` and scrolled it, which
 * put a scrolling region inside a scrolling page: on a phone that traps a drag
 * that the player meant for the page. A list they opened deliberately can be as
 * long as it is.
 */
export function RunSummary({
  historyLabel,
  history,
  stats,
  title,
}: {
  /** Accessible name for the disclosed list, e.g. "Mining attempt history". */
  historyLabel: string;
  /** The activity's own history rows. Omit when the activity has none yet. */
  history?: ReactNode;
  stats: readonly { label: string; value: number | string }[];
  /** e.g. "This mining run". */
  title: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <section
      aria-label={title}
      className="border-t border-[color:var(--rs-border-structural)] pt-4"
      data-run-summary
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
          {title}
        </h3>
        <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--rs-text-muted)]">
          Server-resolved
        </p>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[color:var(--rs-text-secondary)]">
        {stats.map((stat) => (
          <span key={stat.label}>
            <strong className="font-display text-[color:var(--rs-text-primary)]">
              {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
            </strong>{" "}
            {stat.label}
          </span>
        ))}
      </p>
      {history ? (
        <div className="mt-3">
          <button
            aria-expanded={historyOpen}
            className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 font-display text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--rs-text-primary)] transition duration-[var(--rs-duration-fast)] hover:border-[color:var(--rs-accent-secondary)]"
            data-run-history-toggle
            onClick={() => setHistoryOpen((open) => !open)}
            type="button"
          >
            {historyOpen ? "Hide history" : "History"}
          </button>
          {historyOpen ? (
            <div aria-label={historyLabel} className="mt-3 space-y-2" data-run-history role="group">
              {history}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
