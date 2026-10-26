"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { RESEARCH_COPY } from "@/game/content/research-jobs";
import { assignmentFactsOf, canDeliverPacket } from "@/game/domain/research-jobs";
import { deliverResearchPacketAction } from "@/server/actions";
import { useResearchCommand } from "./use-research-command";

/**
 * The Research Courier's handoff inside the Stillreach FedHex terminal (#406):
 * one compact Research Delivery section above the ordinary Parcel Pickup.
 *
 * It exists only while the server projects a Courier run whose original packet
 * is still carried and undelivered, at the one FedHex that accepts it; the same
 * pure rule (`canDeliverPacket`) is what the server rechecks. Once the handoff
 * succeeds the section is replaced by the terminal's confirmation and the
 * Courier's next step. FedHex pays nothing: payment is at The Wise Old Enby.
 */
export function ResearchDelivery({ localPlaceId }: { localPlaceId: string }) {
  const { foregroundBusy, state } = usePlay();
  const command = useResearchCommand();
  const [delivered, setDelivered] = useState(false);
  const assignment = state.research.assignment;
  const eligible =
    assignment &&
    canDeliverPacket(assignmentFactsOf(assignment), {
      locationId: state.location.currentLocationId,
      localPlaceId,
    });

  if (!eligible && delivered) {
    return (
      <section
        aria-label={RESEARCH_COPY.deliveryHeading}
        className="space-y-1 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2"
        data-research-delivery="done"
      >
        <p className="text-sm font-semibold text-[color:var(--rs-accent-success)]" role="status">
          {RESEARCH_COPY.deliveryDone}
        </p>
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          {RESEARCH_COPY.deliveryNext}
        </p>
      </section>
    );
  }
  if (!eligible || !assignment) return null;

  return (
    <section
      aria-label={RESEARCH_COPY.deliveryHeading}
      className="rs-mission-guidance space-y-2 border bg-[color:var(--rs-surface-panel)] px-3 py-2"
      data-research-delivery="ready"
    >
      <h3 className="font-display text-xs font-bold uppercase tracking-wide">
        {RESEARCH_COPY.deliveryHeading}
      </h3>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        Research Courier: hand the Sealed Research Packet from The Wise Old Enby to FedHex. They pay
        nothing; payment is at the workshop.
      </p>
      <ActionButton
        data-research-deliver
        disabled={foregroundBusy}
        intent="success"
        loading={command.pending === "deliver"}
        onClick={() =>
          command.run(
            "deliver",
            () =>
              deliverResearchPacketAction({
                characterId: state.characterId,
                assignmentId: assignment.assignmentId,
                localPlaceId,
              }),
            (outcome) => {
              if (outcome.status === "ok") setDelivered(true);
            },
          )
        }
      >
        {RESEARCH_COPY.deliveryAction}
      </ActionButton>
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </section>
  );
}
