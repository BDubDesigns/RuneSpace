"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { stopRouteAfterLegAction } from "@/server/actions";

/**
 * Stop After This Leg (#450): finish the walk under way and go no further.
 *
 * Distinct from Turn Back by design: nothing is cancelled, the leg keeps its
 * Scavenge window and arrives normally, and arriving lifts suppression as any
 * completed walk does. As with Turn Back, the server reconciles first, so if
 * the leg the player saw has already arrived, that arrival stands and the
 * route stops after the leg now under way; the accepted state says which.
 */
export function StopAfterLegControl({ legDestinationName }: { legDestinationName: string }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  function stopAfterLeg() {
    enqueueForeground(() => {
      setPending(true);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await stopRouteAfterLegAction({ characterId: state.characterId });
          if ("error" in result && result.error) {
            setMessage(result.error);
            return;
          }
          if (result.state) acceptState(result.state);
        } catch {
          setMessage("Comms interruption. Stopping could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(false);
        }
      });
    });
  }

  return (
    <div className="mt-4" data-stop-after-leg>
      <ActionButton
        data-stop-after-leg-button
        disabled={foregroundBusy}
        intent="secondary"
        loading={pending}
        onClick={stopAfterLeg}
      >
        Stop After This Leg
      </ActionButton>
      <Feedback>You&apos;ll finish this walk and stop at {legDestinationName}.</Feedback>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </div>
  );
}
