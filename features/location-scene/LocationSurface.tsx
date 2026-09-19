"use client";

import { Panel } from "@/components/ui/Panel";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { deriveLocalPlaceSurface, resolveActiveLocalPlace } from "@/game/domain/local-places";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { deriveCompletedRepairTargetIds } from "@/game/domain/welding-repair";
import { LocalPlaceDirectory } from "@/features/local-places/LocalPlaceDirectory";
import { LocalPlaceSurface } from "@/features/local-places/LocalPlaceSurface";
import { NpcInteractionPanel } from "@/features/npc/NpcInteractionPanel";
import { usePlay } from "@/features/play/PlayContext";
import { LocationPopulationPanel } from "./LocationPopulationPanel";
import { LocationSceneHeader } from "./LocationSceneHeader";

/**
 * A World Location surface offers no paid ride of its own (#172). The one
 * authored route boards inside a Local Place, and The Jag — which the route
 * only ever arrives at — offers nothing, because the crews cannot make room on
 * the way back. The walk home is the ordinary Travel control, unchanged.
 *
 * This surface is the place: its scene, its description, who is here, and the
 * resident standing in it. What the player can *do* here is a sibling panel
 * (`LocationActivity`, #193), so that every location presents its activity in
 * the same frame at the same depth instead of four different ways.
 */
export function LocationSurface({
  characterName,
  localPlaceId,
}: {
  characterName: string;
  localPlaceId?: string;
}) {
  const { state } = usePlay();
  const locationId = state.location.currentLocationId;
  const location = getLocation(locationId);
  const completedMissionIds = deriveCompletedMissionIds(state.missions);
  if (!location || state.travelState) return null;

  // The shared interpretation: a hand-edited URL naming an unknown,
  // wrong-parent, or locked place falls back to the town surface rather than
  // revealing an interior. The resident panel reads the same answer.
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds,
  });
  if (activePlace) {
    return (
      <LocalPlaceSurface
        characterName={characterName}
        parentDisplayName={location.displayName}
        resident={
          // Keyed by the requested place so a contact's opened Trade surface
          // never survives moving to another place and reappears there.
          <NpcInteractionPanel
            className="mt-4"
            key={localPlaceId ?? ""}
            localPlaceId={localPlaceId}
          />
        }
        surface={deriveLocalPlaceSurface(
          activePlace,
          deriveCompletedRepairTargetIds(Object.values(state.repairs)),
        )}
      />
    );
  }

  // A settlement presents its places instead of a production activity; the
  // existing simple locations are untouched.
  const localPlaces = getLocalPlacesForLocation(locationId);
  const resourceLabels =
    locationId === LOCATION_IDS.theJag
      ? ["Ferrite Shale"]
      : locationId === LOCATION_IDS.abandonedProcessingYard
        ? ["Refined Ferrite", "Slag"]
        : locationId === LOCATION_IDS.emergencyPowerAnnex
          ? ["Power Cell"]
          : undefined;
  // The place's derived state, not its base content (#209): the collapsed and
  // opened Deep Jag are one authored location, and which scene and description
  // the player gets is the location-state boundary's answer. Every other
  // location authors no variants, so this resolves to exactly what it always
  // was.
  const locationState = state.locationStates[locationId];
  const presentedLocation = locationState
    ? {
        ...location,
        description: locationState.description,
        presentation: { scene: locationState.scene },
      }
    : location;

  return (
    <Panel tone="raised" className="overflow-hidden !p-0" data-location-surface>
      <LocationSceneHeader
        characterName={characterName}
        location={presentedLocation}
        resourceLabels={resourceLabels}
      />
      {/* Slightly less padding below the resident than above the description:
          what follows this panel is the place's activity, and the two panels
          plus the stack gap otherwise put 56px of gutter between the person
          standing here and the thing to do here. */}
      <div className="p-5 pb-4">
        {/* No heading line here (#193): the scene plate above already names the
            place and carries the surface's `h1`. A second copy of the name over
            the literal word "Location" cost 68px of a 844px-tall phone screen
            and told the player nothing the artwork had not. */}
        <p
          className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-location-description
        >
          {presentedLocation.description}
        </p>
        {/* Who is here rides on the resident row's second line rather than
            taking a row of its own (#193) — 32px on a phone, which is the
            difference between the Workbench starting above the fold at Rusk
            Recovery and starting below it. It states its own subject so it
            still reads as the place's, not the resident's. */}
        <NpcInteractionPanel className="mt-3" meta={<LocationPopulationPanel />} />
        {localPlaces.length > 0 ? (
          <div className="mt-5">
            <LocalPlaceDirectory locationId={locationId} />
          </div>
        ) : null}
        {/* No activity block here (#193). Every place's activity is a sibling
            panel composed by `LocationActivity`, the way Rusk Recovery's
            Workbench already was (#190), so this panel is the place itself:
            where you are, who is here, and who you can talk to. */}
      </div>
    </Panel>
  );
}
