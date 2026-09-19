import {
  ACTION_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
} from "@/game/config/foundations";
import {
  assertBidirectionalAdjacency,
  LocationDefinitionSchema,
  type LocationDefinition,
  type LocationDefinitionInput,
} from "@/game/schemas/locations";

/**
 * The authoritative local world (single source of truth).
 *
 * Server validation, UI projection, and adjacency checks all read from this
 * registry.
 *
 * - Crash Site: wreck / start location (Cargo Hold Welding after issue #89;
 *   no mining after issue #83).
 * - Abandoned Processing Yard: Ferrite Refining (issue #81).
 * - DeWhat? Emergency Power Annex: the daily Power Cell reward source.
 * - The Long Scramble (#83): intentionally barren traversal tile.
 * - The Jag (#83): Ferrite Shale Mining.
 * - Holo Hollow (#159): the first settlement. Its town places are Local Places
 *   (game/content/local-places), not separate World Locations, so they own no
 *   map coordinate, adjacency, or Travel semantics.
 * - Rusk Recovery (#190): Wade's recovery yard, one ordinary walking edge
 *   northwest of Holo Hollow. Practice Welding happens here.
 * - Deep Jag (#209): the collapsed lower workings southwest of The Jag. The
 *   first location whose player-facing state changes durably — see its
 *   `stateVariants` and `game/domain/location-state`.
 */
const locationDefinitions = [
  {
    id: LOCATION_IDS.crashSite,
    displayName: "Crash Site",
    description:
      "Your wrecked ship lies half-sunk in mud and scrap, with only a few systems still worth salvaging.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.holoHollow,
    ],
    availableActionIds: [ACTION_IDS.cargoHoldWelding],
    dormantActivities: [],
    presentation: {
      mapIconKey: "crash_site_deposit" as const,
      layout: "crash_site" as const,
      localMap: { axial: { q: 0, r: 1 }, label: "Crash Site" },
      scene: {
        asset: "/location-scenes/crash-site.webp" as const,
        width: 1920,
        height: 480,
        alt: "Fractured dark hull of a derelict craft resting on wet rocky ground at a sparse outpost, salvage crane nearby",
        focal: { x: 50, y: 42 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.abandonedProcessingYard,
    displayName: "Abandoned Processing Yard",
    description:
      "Rusted conveyors and a refurbished hopper stand ready — Ferrite Shale can be refined here into Refined Ferrite and Slag.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.emergencyPowerAnnex],
    availableActionIds: [ACTION_IDS.refining],
    mapStatus: "Refining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "processing_yard" as const,
      layout: "processing_yard" as const,
      localMap: { axial: { q: 1, r: 0 }, label: "Processing Yard" },
      scene: {
        asset: "/location-scenes/processing-yard.webp" as const,
        width: 1920,
        height: 480,
        alt: "Abandoned industrial yard with rusted conveyors, gantry and hopper on wet ground under overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.emergencyPowerAnnex,
    displayName: "DeWhat? Emergency Power Annex",
    description:
      "An automated DeWhat? depot, installed back when Settled Systems still required a public emergency power supply for Holo Hollow's visitors. The tourists left; the contract did not. It still issues its daily allotment of Power Cells to anyone who walks up.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.holoHollow,
    ],
    availableActionIds: [],
    mapStatus: "Daily cells",
    dormantActivities: [],
    presentation: {
      mapIconKey: "power_annex" as const,
      layout: "power_annex" as const,
      localMap: { axial: { q: 0, r: 0 }, label: "Power Annex" },
      scene: {
        asset: "/location-scenes/power-annex.webp" as const,
        width: 1920,
        height: 480,
        alt: "Compact emergency power bunker with a lit dispenser capsule standing in shallow water, cyan arcane light",
        focal: { x: 50, y: 46 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theLongScramble,
    displayName: "The Long Scramble",
    description:
      "A steep run of fractured stone and loose hardpan climbing toward the high ridge. Nothing worth stopping for, which is unfortunate given how long it takes to cross.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.theJag, LOCATION_IDS.holoHollow],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_long_scramble" as const,
      layout: "the_long_scramble" as const,
      localMap: { axial: { q: -1, r: 2 }, label: "Long Scramble" },
      scene: {
        // Delivered at its native 2508x627 4:1 resolution: the metadata must
        // describe the committed file (#117), and approved art is never
        // resampled merely to match the older 1920x480 convention.
        asset: "/location-scenes/the-long-scramble.png" as const,
        width: 2508,
        height: 627,
        alt: "Steep fractured stone and loose hardpan climbing toward a high ridge, rough switchback route through barren mountain approach",
        focal: { x: 50, y: 44 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theJag,
    displayName: "The Jag",
    description:
      "An exposed ferrite seam carved into the hardpan by whoever got here first. Calling it a mine would be generous, but the shale cuts just fine.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.theLongScramble, LOCATION_IDS.deepJag],
    availableActionIds: [ACTION_IDS.ferriteShaleMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_jag" as const,
      layout: "the_jag" as const,
      localMap: { axial: { q: -2, r: 3 }, label: "The Jag" },
      scene: {
        // Delivered at its native 2508x627 4:1 resolution: the metadata must
        // describe the committed file (#117), and approved art is never
        // resampled merely to match the older 1920x480 convention.
        asset: "/location-scenes/the-jag.png" as const,
        width: 2508,
        height: 627,
        alt: "Exposed jagged Ferrite Shale outcrop with cut faces, rough improvised mine entrance and disturbed ground with loose shale",
        focal: { x: 50, y: 43 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.holoHollow,
    displayName: "Holo Hollow",
    description:
      "A declining Ferrite-mining settlement built on the remains of a holo-tourism economy. Faded attraction signage still hangs over shopfronts that now serve miners and haulers.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.ruskRecovery,
    ],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "holo_hollow" as const,
      layout: "holo_hollow" as const,
      localMap: { axial: { q: -1, r: 1 }, label: "Holo Hollow" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#159): approved art
        // is never upscaled merely to match the older 1920x480 convention.
        asset: "/location-scenes/holo-hollow.webp" as const,
        width: 1536,
        height: 384,
        alt: "Weathered main street of a small mining settlement, faded holo-tourism signage above working shopfronts under an overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    // Wade's recovery yard on the northwest edge of town (#190). It is a full
    // World Location, not one of Holo Hollow's Local Places: it owns a map
    // coordinate, an ordinary walking edge, and its own activity. It is visible
    // and visitable from the beginning of the game — what changes with
    // progression is who is standing in it and what they will let the player
    // touch, never the place itself.
    id: LOCATION_IDS.ruskRecovery,
    displayName: "Rusk Recovery",
    description:
      "Wade's recovery yard: salvaged machinery and stripped components racked in rows, damaged speeders waiting their turn, and a welding bench somebody actually works at. Messy, and organized by somebody who knows exactly where everything is.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.holoHollow],
    // Both kinds of Welding the yard's one bench does. Listing the customer one
    // is what lets Mission guidance point a player who is somewhere else back
    // to the only place a Work Order can be welded (#207).
    availableActionIds: [ACTION_IDS.practiceWelding, ACTION_IDS.workOrderWelding],
    merchantId: MERCHANT_IDS.wadeRusk,
    dormantActivities: [],
    presentation: {
      mapIconKey: "rusk_recovery" as const,
      layout: "rusk_recovery" as const,
      localMap: { axial: { q: -2, r: 1 }, label: "Rusk Recovery" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#190): one static
        // scene before and after progression, never a locked/unlocked swap.
        asset: "/location-scenes/rusk-recovery.webp" as const,
        width: 1536,
        height: 384,
        alt: "Working recovery yard with racked salvage, stripped components, damaged work vehicles, and a welding bench under an overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    // Deep Jag (#209): ONE authored location with state-dependent presentation,
    // never two locations and never a second hidden one. It is visible on the
    // map from the beginning as a future-world tease, is impassable until
    // Tansy's Brace Yourself is accepted, and becomes a working Galvanite mine
    // the moment the brace is welded in.
    //
    // The unconditional fields below ARE the pre-Mission state: not travelable,
    // no actions, CAVE-IN, collapsed scene. Everything that changes is an
    // authored variant resolved from Mission acceptance and repair completion,
    // so no `deep_jag_open` flag exists to drift from the repair record.
    id: LOCATION_IDS.deepJag,
    displayName: "Deep Jag",
    description:
      "The Jag's lower workings, closed since the roof came down. Broken rock fills the passage from floor to back, and the cold draught that should be coming out of it is not.",
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.theJag],
    availableActionIds: [],
    travelable: false,
    mapStatus: "CAVE-IN",
    stateVariants: [
      {
        // Authored first: once the brace is in, the opened state wins however
        // the Mission itself is progressing.
        id: "deep_jag_opened",
        requires: { completedRepairTargetId: REPAIR_TARGET_IDS.deepJagCaveIn },
        description:
          "The passage is open again, held by the brace assembly the two of you set: yellow jacks under a welded header, rock swept back to the sides. Galvanite runs in the exposed face beyond.",
        travelable: true,
        mapStatus: "MINING",
        availableActionIds: [ACTION_IDS.galvaniteMining, ACTION_IDS.deepJagWelding],
        scene: {
          // Delivered at its native 1536x384 4:1 resolution, the matched pair
          // to the collapsed scene: same camera, same framing, same lighting.
          asset: "/location-scenes/deep-jag-opened.webp" as const,
          width: 1536,
          height: 384,
          alt: "Cleared mine passage held open by a welded header beam on two yellow hydraulic braces, rubble pushed to the sides, tunnel running away into the dark",
          focal: { x: 50, y: 48 } as const,
        },
      },
      {
        id: "deep_jag_worksite",
        requires: { acceptedMissionId: MISSION_IDS.braceYourself },
        travelable: true,
        availableActionIds: [ACTION_IDS.deepJagWelding],
      },
    ],
    dormantActivities: [],
    presentation: {
      mapIconKey: "deep_jag" as const,
      layout: "deep_jag" as const,
      localMap: { axial: { q: -3, r: 4 }, label: "Deep Jag" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#209).
        asset: "/location-scenes/deep-jag-collapsed.webp" as const,
        width: 1536,
        height: 384,
        alt: "Mine passage blocked floor to roof by a fall of broken rock, timber props leaning at the edges, brace hardware still crated on pallets to one side",
        focal: { x: 50, y: 48 } as const,
      },
    },
  },
] as const satisfies readonly LocationDefinitionInput[];

export const LOCATIONS: readonly LocationDefinition[] = locationDefinitions.map((location) =>
  LocationDefinitionSchema.parse(location),
);

assertBidirectionalAdjacency(LOCATIONS);

const locationById = new Map<string, LocationDefinition>(
  LOCATIONS.map((location) => [location.id, location]),
);

/** Resolve a location from the authoritative registry by stable ID. */
export function getLocation(locationId: string): LocationDefinition | undefined {
  return locationById.get(locationId);
}

/** Whether the given location may host the supplied authoritative action ID. */
export function isActionAvailableAtLocation(locationId: string, actionId: string): boolean {
  return getLocation(locationId)?.availableActionIds.includes(actionId) ?? false;
}

/** Whether two locations are directly adjacent and reachable in either direction. */
export function areLocationsAdjacent(originId: string, destinationId: string): boolean {
  return getLocation(originId)?.adjacentLocationIds.includes(destinationId as never) ?? false;
}

/** The ordered local map (issues #83 and #159). */
export const LOCAL_MAP_LOCATION_IDS: readonly LocationDefinition["id"][] = [
  LOCATION_IDS.crashSite,
  LOCATION_IDS.abandonedProcessingYard,
  LOCATION_IDS.emergencyPowerAnnex,
  LOCATION_IDS.theLongScramble,
  LOCATION_IDS.theJag,
  LOCATION_IDS.holoHollow,
  LOCATION_IDS.ruskRecovery,
  LOCATION_IDS.deepJag,
];
