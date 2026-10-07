"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { PlayGameplayState } from "@/server/play";
import { MissionGuidanceStrips } from "./MissionGuidanceStrips";
import { pinnedGuidanceMissions } from "./mission-pins";

/**
 * Current Missions as the desktop rail's persistent objectives region (#286).
 * The authoritative `MissionGuidanceStrips` are the only content: this adds
 * only the bounds a sidebar needs.
 *
 * - It renders nothing at all with no pinned active Mission (#325), so a
 *   character without one is not given a reserved empty box.
 * - Its height is capped and scrolls inside itself, so many Missions never push
 *   the utility workspace — and Chat's composer — out of the viewport.
 * - With more than one Mission it can be collapsed to a single header row;
 *   collapsing unmounts the strips (and their Equipment shortcut) rather than
 *   hiding them, so there is never a second, invisible interactive copy.
 *
 * The collapsed state is local to the region and the region lives in the rail,
 * which Map ↔ Location and travel never remount.
 */
export function MissionObjectivesRegion({ state }: { state: PlayGameplayState }) {
  const [collapsed, setCollapsed] = useState(false);
  const count = pinnedGuidanceMissions(state).length;
  if (count === 0) return null;
  const collapsible = count > 1;
  const showStrips = !collapsible || !collapsed;
  return (
    <div className="shrink-0" data-objectives-region="">
      {collapsible ? (
        <button
          aria-controls={showStrips ? "objectives-region-body" : undefined}
          aria-expanded={showStrips}
          className="rs-focus mb-2 flex min-h-9 w-full items-center justify-between gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 text-left font-display text-[11px] uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]"
          data-objectives-toggle=""
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          <span>Current Missions · {count}</span>
          {showStrips ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      ) : null}
      {showStrips ? (
        <div
          // The padding (and its matching negative margin) keeps the strips' exterior
          // glow inside the scrolling box instead of clipping it at the edge.
          className="relative -m-1 max-h-[min(24dvh,12rem)] overflow-y-auto overscroll-contain p-1"
          id="objectives-region-body"
        >
          <MissionGuidanceStrips state={state} />
        </div>
      ) : null}
    </div>
  );
}
