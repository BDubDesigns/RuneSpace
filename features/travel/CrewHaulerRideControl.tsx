"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { getLocation } from "@/game/content/locations";
import { getTransportRoutesFrom } from "@/game/content/transport-routes";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";
import { beginTransportTravelAction } from "@/server/actions";
import { travelErrorMessage } from "./travel-errors";

/**
 * The narrow ride affordance for one authored transport route (#172).
 *
 * The same control serves both ends of the Crew Hauler route: it reads the
 * routes touching the player's current location, so The Jag needs no duplicate
 * Local Place and no driver NPC standing around to operate one button. Every
 * rule it presents — that the route exists, that the Mission unlocked it, what
 * the fare is — is re-derived server-side when the ride actually starts.
 *
 * Unavailability is always stated, never merely implied by a greyed control:
 * the button says where it goes and what it costs, and the reason it cannot be
 * used right now is written out underneath.
 */
export function CrewHaulerRideControl() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [, startTransition] = useTransition();

  const completedMissionIds = deriveCompletedMissionIds(state.missions);
  const rides = getTransportRoutesFrom(state.location.currentLocationId).filter(({ route }) =>
    completedMissionIds.has(route.unlockMissionId),
  );
  if (rides.length === 0) return null;

  function board(destinationLocationId: string) {
    enqueueForeground(() => {
      setPending(destinationLocationId);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await beginTransportTravelAction({
            characterId: state.characterId,
            destinationLocationId,
          });
          if ("error" in result && result.error) {
            setMessage(result.error);
            return;
          }
          if (!result.state) return;
          acceptState(result.state);
          setMessage(
            result.state.travelError
              ? travelErrorMessage(result.state.travelError)
              : result.state.commandError === "another_action_active"
                ? "Finish the active activity before boarding."
                : undefined,
          );
        } catch {
          setMessage("Comms interruption. The ride could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  return (
    <div className="space-y-3" data-crew-hauler-rides>
      {rides.map(({ route, destinationLocationId }) => {
        const destination = getLocation(destinationLocationId);
        const affordable = state.credits >= route.fareCredits;
        const busy = Boolean(state.activeAction) || Boolean(state.travelState);
        return (
          <div key={route.id}>
            <ActionButton
              data-crew-hauler-ride={destinationLocationId}
              disabled={!affordable || busy || foregroundBusy}
              intent="secondary"
              loading={pending === destinationLocationId}
              onClick={() => board(destinationLocationId)}
            >
              {`Ride to ${destination?.displayName ?? "destination"} · ${route.fareCredits} Credits`}
            </ActionButton>
            {!affordable ? (
              <Feedback tone="danger">
                {`The fare is ${route.fareCredits} Credits. You have ${state.credits}.`}
              </Feedback>
            ) : busy ? (
              <Feedback>Finish what you are doing before boarding.</Feedback>
            ) : null}
          </div>
        );
      })}
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </div>
  );
}
