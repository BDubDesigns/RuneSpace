"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { getLocation } from "@/game/content/locations";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";
import { beginTransportTravelAction } from "@/server/actions";
import { availableCrewHaulerRides } from "./crew-hauler-rides";
import { travelErrorMessage } from "./travel-errors";

/**
 * The narrow ride affordance for one authored transport route (#172).
 *
 * It renders the authored rides that board at the surface it was placed on, so
 * the Crew Hauler belongs to the repaired Crew Stop rather than the town
 * directory — and The Jag, which is only the route's destination, renders
 * nothing at all rather than a disabled control explaining the ride home the
 * crews cannot give. Every rule it presents — that the route exists, that the
 * Mission unlocked it, what the fare is — is re-derived server-side when the
 * ride actually starts.
 *
 * Unavailability is always stated, never merely implied by a greyed control:
 * the button says where it goes and what it costs, and the reason it cannot be
 * used right now is written out underneath.
 */
export function CrewHaulerRideControl({ localPlaceId }: { localPlaceId?: string }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [, startTransition] = useTransition();

  const rides = availableCrewHaulerRides({
    locationId: state.location.currentLocationId,
    localPlaceId,
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });
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
      {rides.map((route) => {
        const destinationLocationId = route.destinationLocationId;
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
