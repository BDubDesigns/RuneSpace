import { ACTION_IDS, LOCATION_IDS } from "@/game/config/foundations";
import {
  assertBidirectionalAdjacency,
  LocationDefinitionSchema,
  type LocationDefinition,
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
 */
const locationDefinitions = [
  {
    id: LOCATION_IDS.crashSite,
    displayName: "Crash Site",
    description:
      "The damaged ship rests on broken ground, its fractured hull and scattered salvage marking the impact site.",
    adjacentLocationIds: [
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
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
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.emergencyPowerAnnex],
    availableActionIds: [ACTION_IDS.refining],
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
      "A mostly intact DeWhat? emergency-supply depot can dispense one registered worker allotment per Pacific reset day.",
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.abandonedProcessingYard],
    availableActionIds: [],
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
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.theJag],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_long_scramble" as const,
      layout: "the_long_scramble" as const,
      localMap: { axial: { q: -1, r: 2 }, label: "Long Scramble" },
      scene: {
        asset: "/location-scenes/the-long-scramble.png" as const,
        width: 1920,
        height: 480,
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
    adjacentLocationIds: [LOCATION_IDS.theLongScramble],
    availableActionIds: [ACTION_IDS.ferriteShaleMining],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_jag" as const,
      layout: "the_jag" as const,
      localMap: { axial: { q: -2, r: 3 }, label: "The Jag" },
      scene: {
        asset: "/location-scenes/the-jag.png" as const,
        width: 1920,
        height: 480,
        alt: "Exposed jagged Ferrite Shale outcrop with cut faces, rough improvised mine entrance and disturbed ground with loose shale",
        focal: { x: 50, y: 43 } as const,
      },
    },
  },
] as const satisfies readonly LocationDefinition[];

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

/** The ordered five-location local map (issue #83). */
export const LOCAL_MAP_LOCATION_IDS: readonly LocationDefinition["id"][] = [
  LOCATION_IDS.crashSite,
  LOCATION_IDS.abandonedProcessingYard,
  LOCATION_IDS.emergencyPowerAnnex,
  LOCATION_IDS.theLongScramble,
  LOCATION_IDS.theJag,
];
