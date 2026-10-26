"use client";

import { useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { InlineConfirmation } from "@/features/inventory/InlineConfirmation";
import { usePlay } from "@/features/play/PlayContext";
import { getItemPresentation } from "@/game/content/item-presentation";
import { RESEARCH_ABANDON_LABEL, getResearchJob } from "@/game/content/research-jobs";
import type { MissionProjection } from "@/game/domain/missions";
import { abandonResearchJobAction } from "@/server/actions";
import { useResearchCommand } from "./use-research-command";

/**
 * Abandon Assignment, in the Mission details of a held Wise Old Enby research
 * run (#406). Available from anywhere and at any stage, with no trip to the
 * workshop, and never without an explicit confirmation that says exactly what
 * is forfeited. It frees the one assignment slot; the next acceptance starts
 * from scratch. This is not a generic Destroy and not a completion.
 */
export function ResearchAbandon({ mission }: { mission: MissionProjection }) {
  const { foregroundBusy, state } = usePlay();
  const command = useResearchCommand();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const assignmentId = mission.research?.assignmentId;
  if (!assignmentId) return null;
  const job = getResearchJob(mission.missionId);
  const held = state.research.assignment?.loanItemHeld;
  const itemName = job ? getItemPresentation(job.loanItemId)?.displayName : undefined;

  return (
    <div
      className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3"
      data-research-abandon
    >
      {confirming ? (
        <InlineConfirmation
          busy={command.pending === "abandon"}
          cancelRef={cancelRef}
          confirmLabel={RESEARCH_ABANDON_LABEL}
          data-research-abandon-confirmation
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            command.run(
              "abandon",
              () => abandonResearchJobAction({ characterId: state.characterId, assignmentId }),
              (outcome) => {
                if (outcome.status === "ok") setConfirming(false);
              },
            )
          }
        >
          Abandon {mission.title}? All progress
          {held && itemName ? `, the ${itemName} you are carrying,` : ""} and any payout or passage
          will be permanently forfeited. You can take an assignment again from The Wise Old Enby,
          starting from scratch.
        </InlineConfirmation>
      ) : (
        <ActionButton
          data-research-abandon-start
          disabled={foregroundBusy}
          intent="danger"
          onClick={() => setConfirming(true)}
        >
          {RESEARCH_ABANDON_LABEL}
        </ActionButton>
      )}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </div>
  );
}
