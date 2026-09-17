"use client";

import { useEffect, useRef, useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { PracticeWeldingPanel } from "@/features/practice/PracticeWeldingPanel";
import { WorkOrderBenchPanel } from "@/features/practice/WorkOrderBenchPanel";

/**
 * The DOM anchor for Wade's one Workbench.
 *
 * The Work Orders terminal is a sibling panel on the same Play surface, so
 * "take the player to the bench" is a scroll and a focus rather than a route.
 * Exported so the terminal can find the bench without either surface importing
 * the other's component.
 */
export const WORKBENCH_ANCHOR_ID = "rusk-recovery-workbench";

/**
 * Wade's Workbench (#207).
 *
 * There is one bench in the yard and it holds one unfinished piece of work, so
 * there is one component for it. Which controls it shows follows the same
 * authoritative occupancy the server enforces: a customer's job when one is on
 * the bench, the ordinary Practice surface when it is clear. Rendering both, or
 * letting each decide independently whether to appear, is exactly how a UI
 * comes to disagree with the rule it is presenting.
 *
 * It also owns the completion acknowledgement, because that beat spans the
 * switch: the job that finished is gone from the projection by the time there
 * is anything to say about it. One generic acknowledgement serves every job in
 * the pool — a repeatable shop job does not get a scene.
 */
export function WorkbenchPanel() {
  const { state } = usePlay();
  const active = state.workOrders.active;
  const [completed, setCompleted] = useState<{ title: string; payoutCredits: number }>();
  // Only what the acknowledgement needs, so the effect below can depend on the
  // job's identity rather than on a projection object that is new every render.
  const lastActive = useRef<{ title: string; payoutCredits: number }>(undefined);

  const activeWorkOrderId = active?.workOrderId;
  const activeTitle = active?.title;
  const activePayout = active?.payoutCredits;
  useEffect(() => {
    const previous = lastActive.current;
    lastActive.current =
      activeTitle !== undefined && activePayout !== undefined
        ? { title: activeTitle, payoutCredits: activePayout }
        : undefined;
    // A job leaving the bench without another taking its place is a completion:
    // nothing else clears it, because Work Orders have no abandonment.
    if (previous && activeWorkOrderId === undefined) setCompleted(previous);
    if (activeWorkOrderId !== undefined) setCompleted(undefined);
  }, [activeWorkOrderId, activeTitle, activePayout]);

  if (!state.practice.unlocked && !active) return null;

  return (
    // `tabIndex={-1}` makes the bench a programmatic focus target without ever
    // putting it in the tab order, so accepting a job can move a keyboard user
    // here without adding a stop they then have to tab back out of.
    <div id={WORKBENCH_ANCHOR_ID} tabIndex={-1} data-workbench className="scroll-mt-4 outline-none">
      {completed ? (
        <Feedback tone="success">
          {`${completed.title} is finished and paid — ${completed.payoutCredits} Credits.`}
        </Feedback>
      ) : null}
      {active ? <WorkOrderBenchPanel active={active} /> : <PracticeWeldingPanel />}
    </div>
  );
}
