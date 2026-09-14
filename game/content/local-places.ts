import {
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
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
  {
    id: LOCAL_PLACE_IDS.holoHollowCrewStop,
    parentLocationId: LOCATION_IDS.holoHollow,
    displayName: "Crew Stop",
    // Open from the start: the player can walk up and see the state it is in
    // long before anybody asks them to do anything about it. What the accepted
    // Mission unlocks is the repair work, not the place (#172).
    access: { kind: "open" as const },
    description:
      "A covered roadside shelter on the haul road, where mining crews wait for the shift hauler out to The Jag. The canopy sags at one corner and the bench leans with it, so most mornings the crews stand in the weather instead.",
    presentation: {
      // The approved damaged/repaired pair (#172). Both scenes share one camera,
      // framing, and time of day so the only thing that changes is the thing the
      // player fixed — see docs/location-scenes.md on before/after pairs.
      scene: {
        asset: "/location-scenes/holo-hollow-crew-stop-damaged.webp" as const,
        width: 1536,
        height: 384,
        alt: "Roadside crew shelter at dusk with its corrugated canopy torn open to the sky and its bench collapsed face-down in the mud, mine workings lit beyond",
        focal: { x: 42, y: 50 } as const,
      },
      repaired: {
        repairTargetId: REPAIR_TARGET_IDS.crewStop,
        description:
          "A covered roadside shelter on the haul road, where mining crews wait for the shift hauler out to The Jag. The canopy sits square on a welded brace now, and the bench takes a full shift's worth of people without complaint.",
        scene: {
          asset: "/location-scenes/holo-hollow-crew-stop-repaired.webp" as const,
          width: 1536,
          height: 384,
          alt: "The same roadside crew shelter at dusk, its canopy whole and squared on welded bracing with the bench remounted along the back wall, mine workings lit beyond",
          focal: { x: 42, y: 50 } as const,
        },
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
