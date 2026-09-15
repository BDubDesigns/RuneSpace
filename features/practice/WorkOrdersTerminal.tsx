"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The Work Orders terminal at Rusk Recovery (#190).
 *
 * The beat-up industrial terminal is physically in the scene from the very
 * first visit, and until 10,000 Hours is turned in it is exactly that: scenery.
 * No label, no click target, no disabled state, no teaser — nothing here
 * renders at all.
 *
 * Turning the Mission in reveals it as a real but empty surface. There are no
 * playable Work Orders in this slice: below Welding level 5 it says what it
 * needs, and at level 5 and above it says there is nothing posted. Reaching
 * level 5 first never reveals it early — the Mission is what makes the terminal
 * the player's business.
 */
export function WorkOrdersTerminal() {
  const { state } = usePlay();
  // Both the reveal and the level requirement are authoritative projection: this
  // surface never learns a Mission ID or a balance literal of its own.
  const { revealed, meetsWeldingLevel, requiredWeldingLevel } = state.workOrders;
  if (!revealed) return null;

  return (
    <Panel
      tone="raised"
      data-work-orders-terminal
      data-work-orders-state={meetsWeldingLevel ? "empty" : "locked"}
    >
      <SectionHeader eyebrow="Rusk Recovery">Work Orders</SectionHeader>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The terminal in the corner is where paying jobs come in off the wire.
      </p>
      <div className="mt-4">
        <ActionButton data-work-orders-control disabled intent="secondary">
          {meetsWeldingLevel
            ? "No Work Orders Available"
            : `Requires Welding Level ${requiredWeldingLevel}`}
        </ActionButton>
      </div>
    </Panel>
  );
}
