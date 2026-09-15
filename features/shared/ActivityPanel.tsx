"use client";

import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";

/**
 * The frame a place's primary activity sits in (#193).
 *
 * Before this existed, "the activity here" rendered four different ways: bare
 * unheaded controls inside the location panel (Mining, Refining), a nested
 * panel with its own heading inside it (Cargo Hold, the Power Annex), a bare
 * block inside a Local Place (the Crew Stop repair), and a sibling panel
 * outside the location panel entirely (the Workbench). A player learned a
 * different layout at every location, and two of the six activities never said
 * what they were.
 *
 * This is presentation and nothing else. It takes a heading and children; it
 * has no gameplay props, imports nothing from `server/`, and never learns a
 * location, an action or a skill. An activity's rules, commands, state and
 * copy stay entirely with the feature that owns them — this only guarantees
 * that every activity looks like an activity and sits in the same place. If it
 * ever needs to know which activity it is holding, the abstraction is wrong and
 * the caller should compose a `Panel` directly instead.
 *
 * The frame is a little tighter than a page-level `Panel` — 16px of padding
 * and a 12px rhythm rather than 20px and 16px. That is not decoration: at
 * Rusk Recovery, with 10,000 Hours' two-line Mission strip on screen, those
 * eight pixels are the difference between the Workbench's Start control being
 * fully visible on a 390x844 phone and being clipped by the bottom navigation.
 *
 * Content order inside the frame is the grammar's, and callers follow it:
 * controls first, then active progress, then the compact context and run
 * summary. Explanatory copy goes below the control it explains, not above it —
 * that ordering is most of what moves a primary control above the fold on a
 * 390px screen.
 */
export function ActivityPanel({
  children,
  eyebrow,
  title,
  ...rest
}: {
  children: ReactNode;
  /** Optional in-world context for the activity, e.g. "Workbench". */
  eyebrow?: string;
  /** What the player is doing here, e.g. "Mining". */
  title: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title" | "children">) {
  return (
    <Panel className="space-y-3 !p-4" data-activity-panel tone="raised" {...rest}>
      {/* One line, not the page-level `SectionHeader` stack: the place owns the
          screen's `h1` and its full-size heading, and an activity is a section
          under it. Two lines of heading above every activity cost 18px each
          that the primary control needs on a 390px screen. */}
      <h2 className="flex flex-wrap items-baseline gap-x-2 font-display leading-tight">
        {eyebrow ? (
          <span className="text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {eyebrow}
          </span>
        ) : null}
        <span className="text-xl font-bold tracking-tight text-[color:var(--rs-text-primary)]">
          {title}
        </span>
      </h2>
      {children}
    </Panel>
  );
}
