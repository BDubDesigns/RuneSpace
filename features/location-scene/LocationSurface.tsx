"use client";

import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Feedback } from "@/components/ui/Feedback";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { LocalPlaceDirectory } from "@/features/local-places/LocalPlaceDirectory";
import { LocalPlaceSurface } from "@/features/local-places/LocalPlaceSurface";
import { MiningActivity } from "@/features/mining/MiningActivity";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
import { usePlay } from "@/features/play/PlayContext";
import { LocationPopulationPanel } from "./LocationPopulationPanel";
import { LocationSceneHeader } from "./LocationSceneHeader";

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
  if (!location || state.travelState) return null;

  // The shared interpretation: a hand-edited URL naming an unknown,
  // wrong-parent, or locked place falls back to the town surface rather than
  // revealing an interior. The resident panel reads the same answer.
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });
  if (activePlace) {
    return (
      <LocalPlaceSurface
        characterName={characterName}
        parentDisplayName={location.displayName}
        place={activePlace}
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
        <div className="mt-4">
          <LocationPopulationPanel />
        </div>
        {localPlaces.length > 0 ? (
          <div className="mt-5">
            <LocalPlaceDirectory locationId={locationId} />
          </div>
        ) : null}
        {locationId === LOCATION_IDS.theLongScramble || localPlaces.length > 0 ? null : (
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
