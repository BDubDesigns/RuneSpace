"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { InlineConfirmation } from "@/features/inventory/InlineConfirmation";
import { usePlay } from "@/features/play/PlayContext";
import { MISSION_ITEM_DESTROY_COPY } from "@/game/content/mission-item-destroy";
import { missionItemDestroyOffer } from "@/game/domain/research-jobs";
import { destroyMissionItemAction } from "@/server/actions";
import { useResearchCommand } from "./use-research-command";

/**
 * Destroy, in the Item Details of a carried Mission loan that opted in (#408).
 * It renders only for the exact instance the held run owns, asks for an inline
 * confirmation that names the item, the job and everything lost, and sends the
 * instance and run ids; the server rechecks both. Keeping the item or backing
 * out changes nothing. On success the authoritative state removes the item, and
 * the owner of the selection is told through `onResult`, for a refusal too (a
 * stale request removes this very control), so it can announce the outcome and
 * restore focus.
 */
export function ResearchLoanDestroy({
  item,
  onResult,
}: {
  item: { id: string; itemId: string; name: string };
  onResult: (feedback: { tone: "success" | "danger"; message: string }) => void;
}) {
  const { foregroundBusy, state } = usePlay();
  const command = useResearchCommand();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  const offer = missionItemDestroyOffer(state.research.assignment, item);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      startRef.current?.focus();
    }
  }, [confirming]);

  // The run ended or changed under an open confirmation: it no longer applies.
  useEffect(() => {
    if (!offer) setConfirming(false);
  }, [offer]);

  if (!offer) return null;
  const { job } = offer;

  return (
    <div
      className="mt-3 border-t border-[color:var(--rs-accent-danger)] pt-3"
      data-mission-item-destroy
    >
      {confirming ? (
        <InlineConfirmation
          busy={command.pending === "destroy"}
          cancelLabel={MISSION_ITEM_DESTROY_COPY.keep}
          cancelRef={cancelRef}
          confirmLabel={MISSION_ITEM_DESTROY_COPY.confirm}
          data-mission-item-destroy-confirmation
          onCancel={() => {
            returnFocusRef.current = true;
            setConfirming(false);
          }}
          onConfirm={() =>
            command.run(
              "destroy",
              () =>
                destroyMissionItemAction({
                  characterId: state.characterId,
                  assignmentId: offer.assignmentId,
                  itemInstanceId: item.id,
                }),
              (outcome) => {
                if (outcome.status === "ok") {
                  onResult({
                    tone: "success",
                    message: `${item.name} destroyed. ${job.title} abandoned. Progress and reward forfeited.`,
                  });
                } else {
                  // Reported by the owner, which outlives this control.
                  onResult({ tone: "danger", message: outcome.message });
                  command.setMessage(undefined);
                  returnFocusRef.current = true;
                  setConfirming(false);
                }
              },
            )
          }
        >
          <p className="font-bold text-[color:var(--rs-text-primary)]">
            Destroy {item.name} and abandon {job.title}?
          </p>
          <p className="mt-1">
            This is permanent. Destroying the {item.name} also abandons {job.title}: all progress is
            lost, and you forfeit {offer.forfeits}. Nothing is paid or returned. You can take an
            assignment again from The Wise Old Enby, starting from scratch.
          </p>
        </InlineConfirmation>
      ) : (
        <ActionButton
          data-mission-item-destroy-start
          disabled={foregroundBusy}
          intent="danger"
          onClick={() => setConfirming(true)}
          ref={startRef}
        >
          {MISSION_ITEM_DESTROY_COPY.action}
        </ActionButton>
      )}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </div>
  );
}
