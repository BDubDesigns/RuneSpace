import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getLocation, getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { resolveLocationStateById, type LocationStateFacts } from "@/game/domain/location-state";

/**
 * Teleport runes (#438): the carried items whose Use moves the character to one
 * fixed World Location. The destination is an existing location, never a copy of
 * one; the item's mass, stack limit and tradability are ordinary item facts in
 * balance. Nothing here gates Use: any character carrying a valid rune may use it.
 */
export const TELEPORT_RUNES: Readonly<Record<string, { destinationLocationId: string }>> = {
  [ITEM_IDS.skatbollTpRune]: { destinationLocationId: LOCATION_IDS.crashSite },
};

export function getTeleportRune(itemId: string): { destinationLocationId: string } | undefined {
  return Object.hasOwn(TELEPORT_RUNES, itemId) ? TELEPORT_RUNES[itemId] : undefined;
}

/**
 * The destination as a character should read it. This is the one place the label
 * is chosen: the location's own name ("Crash Site") until this character's personal
 * Resonance Rig is finished there (#441), then their own "Resonance Site", from the
 * same location-state resolution the Map and the scene header use, so every surface
 * (confirmation, arrival modal) follows. The destination itself never changes.
 */
export function teleportDestinationPresentation(
  destinationLocationId: string,
  facts?: LocationStateFacts,
): {
  locationId: string;
  name: string;
  planetName?: string;
} {
  const planetId = getLocationPlanetId(destinationLocationId);
  return {
    locationId: destinationLocationId,
    name:
      (facts ? resolveLocationStateById(destinationLocationId, facts)?.displayName : undefined) ??
      getLocation(destinationLocationId)?.displayName ??
      destinationLocationId,
    ...(planetId ? { planetName: getPlanetPresentation(planetId).displayName } : {}),
  };
}

/** The arrival modal's copy (#438): distinct from Resonance Calibration's and Milky Waymo's. */
export const RUNE_TELEPORT_COPY = {
  useLabel: "USE RUNE",
  cancelLabel: "CANCEL",
  teleportLabel: "TELEPORT",
  arrivalHeading: "RUNE TELEPORT COMPLETE",
  arrivalAtmosphere: "The seams close behind you. The world holds still, and so do you.",
  arrivalContinue: "CONTINUE",
} as const;
