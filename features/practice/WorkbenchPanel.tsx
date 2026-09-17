"use client";

import { useEffect, useState } from "react";
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
 * switch: the job that finished is gone from the bench by the time there is
 * anything to say about it. One generic acknowledgement serves every job in the
 * pool — a repeatable shop job does not get a scene.
 *
 * The receipt is the server's, never inferred from the job disappearing. A job
 * can vanish without being paid (an operator Mission reset), and — the case
 * that matters most — a job can be paid without this component ever having seen
 * it: the last section often resolves during the very state load that follows
 * the player being away, so on that render there is no "before" to compare
 * against. The player who was away is exactly the one who cannot know they were
 * paid, so the payout has to arrive from the transaction that paid it.
 */
export function WorkbenchPanel() {
  const { state } = usePlay();
  const active = state.workOrders.active;
  const [completed, setCompleted] = useState<{ title: string; payoutCredits: number }>();

  const receipt = state.workOrders.recentCompletion;
  const receiptId = receipt?.workOrderId;
  const receiptTitle = receipt?.title;
  const receiptPayout = receipt?.payoutCredits;
  const activeWorkOrderId = active?.workOrderId;
  useEffect(() => {
    // Latched, because the receipt is present on exactly one response: the next
    // ordinary refresh must not wipe what the player has just been told.
    if (receiptTitle !== undefined && receiptPayout !== undefined) {
      setCompleted({ title: receiptTitle, payoutCredits: receiptPayout });
    }
  }, [receiptId, receiptTitle, receiptPayout]);
  useEffect(() => {
    // Putting the next job on the bench is the player moving on from the last.
    if (activeWorkOrderId !== undefined) setCompleted(undefined);
  }, [activeWorkOrderId]);

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
