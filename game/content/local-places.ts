import {
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
} from "@/game/config/foundations";
import { LocalPlaceDefinitionSchema, type LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * The authoritative Local Place registry (single source of truth).
 *
 * A Local Place is a place inside one parent World Location — a shop, a
 * municipal building, an inn. Entering one is navigation/presentation state
 * only: it never starts Travel, never awards Travel progression, never creates
 * Scavenge, and never moves the character's authoritative
 * `characters.current_location_id` away from its parent World Location.
 *
 * Local Places deliberately have no axial coordinate and no adjacency. They are
 * not Travel destinations and must not be modelled as ordinary
 * `LocationDefinition`s merely to reuse Travel/map behavior. Nesting is one
 * level only.
 */
const localPlaceDefinitions = [
  {
    id: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    parentLocationId: LOCATION_IDS.holoHollow,
    displayName: "Holo Hollow Souvenirs + Mining Supplies",
    description:
      "The original Holo Hollow Souvenirs sign still hangs over the door, with a rougher + Mining Supplies board bolted on underneath. Shelves of tourist-era trinkets sit beside the mining supplies that actually sell.",
    access: { kind: "open" as const },
    merchantId: MERCHANT_IDS.bixWeller,
    presentation: {
      scene: {
        asset: "/location-scenes/holo-hollow-souvenirs-exterior.webp" as const,
        width: 1536,
        height: 384,
        alt: "Small shopfront with a faded Holo Hollow Souvenirs sign and a rough bolted-on Mining Supplies board beneath it",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    id: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
    parentLocationId: LOCATION_IDS.holoHollow,
    displayName: "Holo Hollow Community Assistance Center",
    description:
      "The old Visitor Center lettering is still legible under newer municipal signage. Inside are forms, notices, stacked ration crates, and whoever needs a hand that week.",
    access: { kind: "open" as const },
    presentation: {
      scene: {
        asset: "/location-scenes/holo-hollow-assistance-center-exterior.webp" as const,
        width: 1536,
        height: 384,
        alt: "Municipal building with newer assistance-center signage partly covering older visitor-center lettering",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    id: LOCAL_PLACE_IDS.hhBnb,
    parentLocationId: LOCATION_IDS.holoHollow,
    displayName: "HH B&B",
    description:
      "A family bed-and-breakfast from the tourism years, now the town's working inn for miners, haulers, and contractors.",
    // Visible from the start, enterable once the player is somebody Mara knows:
    // Keep the Change (#170) puts them to work for Wade, introduces them to Bix
    // and Mara, and has them follow through on a job that mattered to Tansy.
    // Access derives from that Mission's completion — the authoritative state —
    // rather than a second persisted unlock flag.
    access: {
      kind: "locked_until_mission_completed" as const,
      missionId: MISSION_IDS.keepTheChange,
      reason: "Rooms here are held for locals and regular working crews, not outside guests.",
    },
    presentation: {
      scene: {
        asset: "/location-scenes/hh-bnb-exterior.webp" as const,
        width: 1536,
        height: 384,
        alt: "Converted family bed-and-breakfast serving as a working inn, with a hand-lettered HH B&B sign",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
] as const satisfies readonly LocalPlaceDefinition[];

export const LOCAL_PLACES: readonly LocalPlaceDefinition[] = localPlaceDefinitions.map((place) =>
  LocalPlaceDefinitionSchema.parse(place),
);

const localPlaceById = new Map<string, LocalPlaceDefinition>(
  LOCAL_PLACES.map((place) => [place.id, place]),
);

/** Resolve a Local Place from the authoritative registry by stable ID. */
export function getLocalPlace(localPlaceId: string): LocalPlaceDefinition | undefined {
  return localPlaceById.get(localPlaceId);
}

/** Authored Local Places belonging to one parent World Location, in authored order. */
export function getLocalPlacesForLocation(locationId: string): readonly LocalPlaceDefinition[] {
  return LOCAL_PLACES.filter((place) => place.parentLocationId === locationId);
}

/**
 * Resolve a Local Place only when it genuinely belongs to the supplied parent
 * World Location. Server commands use this so a requested Local Place can never
 * be honored from the wrong authoritative position.
 */
export function getLocalPlaceInLocation(
  locationId: string,
  localPlaceId: string,
): LocalPlaceDefinition | undefined {
  const place = localPlaceById.get(localPlaceId);
  return place?.parentLocationId === locationId ? place : undefined;
}
