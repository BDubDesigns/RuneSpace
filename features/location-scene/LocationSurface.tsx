"use client";

import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Feedback } from "@/components/ui/Feedback";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { deriveLocalPlaceSurface, resolveActiveLocalPlace } from "@/game/domain/local-places";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { deriveCompletedRepairTargetIds } from "@/game/domain/welding-repair";
import { LOCAL_PLACE_IDS } from "@/game/config/foundations";
import { CrewStopPanel } from "@/features/local-places/CrewStopPanel";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { LocalPlaceDirectory } from "@/features/local-places/LocalPlaceDirectory";
import { LocalPlaceSurface } from "@/features/local-places/LocalPlaceSurface";
import { MiningActivity } from "@/features/mining/MiningActivity";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
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
 * The activity a Local Place hosts, when it hosts one.
 *
 * The same shape as this surface's existing per-location activity selection —
 * one narrow mapping from an authored place to the component that owns its
 * gameplay, rather than a generic plugin registry built for a single case.
 */
function localPlaceActivity(localPlaceId: string) {
  return localPlaceId === LOCAL_PLACE_IDS.holoHollowCrewStop ? <CrewStopPanel /> : undefined;
}

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
        activity={localPlaceActivity(activePlace.id)}
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

  return (
    <Panel tone="raised" className="overflow-hidden !p-0" data-location-surface>
      <LocationSceneHeader
        characterName={characterName}
        location={location}
        resourceLabels={resourceLabels}
      />
      <div className="p-5">
        <SectionHeader eyebrow={location.displayName}>Location</SectionHeader>
        <p
          className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-location-description
        >
          {location.description}
        </p>
        {/* The person standing here comes before the place's own context, so a
            phone shows Talk and Trade without scrolling past the shop UI. */}
        <NpcInteractionPanel className="mt-4" />
        <div className="mt-4">
          <LocationPopulationPanel />
        </div>
        {localPlaces.length > 0 ? (
          <div className="mt-5">
            <LocalPlaceDirectory locationId={locationId} />
          </div>
        ) : null}
        {/* Rusk Recovery's Workbench, Welding progression, Practice run, and
            Work Orders are composed as sibling panels rather than one giant
            location panel (#190), so this surface hosts no activity block. */}
        {locationId === LOCATION_IDS.theLongScramble ||
        locationId === LOCATION_IDS.ruskRecovery ||
        localPlaces.length > 0 ? null : (
          <div className="mt-5" data-location-activity>
            {locationId === LOCATION_IDS.abandonedProcessingYard ? (
              <RefiningConsole showDescription={false} />
            ) : locationId === LOCATION_IDS.theJag ? (
              <MiningActivity characterName={characterName} />
            ) : locationId === LOCATION_IDS.crashSite ? (
              <CargoHoldPanel />
            ) : locationId === LOCATION_IDS.emergencyPowerAnnex ? (
              <PowerAnnexClaimPanel />
            ) : (
              <Feedback tone="muted">No production activity is available here.</Feedback>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
