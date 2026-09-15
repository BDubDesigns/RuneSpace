"use client";

import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";

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
    <Panel className="space-y-4" data-activity-panel tone="raised" {...rest}>
      <SectionHeader level={2} {...(eyebrow ? { eyebrow } : {})}>
        {title}
      </SectionHeader>
      {children}
    </Panel>
  );
}
