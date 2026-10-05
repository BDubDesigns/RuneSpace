"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { turnBackTravelAction } from "@/server/actions";

/**
 * Turn Back from the active Journey (#312).
 *
 * One click, no confirmation: the consequence a player should know first is
 * written next to the control instead. A ride's fare was spent at boarding and
 * is not refunded; a walk's cost is that Scavenge stays unavailable until a
 * walk is completed, which the Journey and the screen after it both state.
 *
 * Nothing here decides the outcome. The server reconciles Travel under the
 * character lock first, so a Journey that has already arrived simply arrives —
 * the accepted authoritative state replaces this panel either way, and there is
 * no client-side latch to clear.
 */
export function TurnBackControl({ rideFare }: { rideFare: boolean }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  function turnBack() {
    enqueueForeground(() => {
      setPending(true);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await turnBackTravelAction({ characterId: state.characterId });
          if ("error" in result && result.error) {
            setMessage(result.error);
            return;
          }
          if (result.state) acceptState(result.state);
        } catch {
          setMessage("Comms interruption. Turning back could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(false);
        }
      });
    });
  }

  return (
    <div className="mt-4" data-turn-back>
      <ActionButton
        data-turn-back-button
        disabled={foregroundBusy}
        intent="secondary"
        loading={pending}
        onClick={turnBack}
      >
        Turn Back
      </ActionButton>
      {rideFare ? <Feedback>Fare won&apos;t be refunded.</Feedback> : null}
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </div>
  );
}
