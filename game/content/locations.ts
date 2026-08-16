import { ACTION_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  assertBidirectionalAdjacency,
  LocationDefinitionSchema,
  type LocationDefinition,
} from "@/game/schemas/locations";

/**
 * The authoritative local world for issues #40 and #47 (single source of truth).
 *
 * Server validation, UI projection, and adjacency checks all read from this
 * registry. The product owner approved exactly three connected locations for
 * this slice; no further locations, content, or map systems are introduced here.
 *
 * - Crash Site: the existing Ferrite Shale deposit where Mining is available.
 * - Abandoned Processing Yard: a dormant industrial location whose future
 *   Metallurgy activity is shown as offline only — it performs no refining.
 * - DeWhat? Emergency Power Annex: the daily Power Cell reward source.
 */
const locationDefinitions = [
  {
    id: LOCATION_IDS.crashSite,
    displayName: "Crash Site",
    description:
      "The damaged ship rests on broken ground. An infinite Ferrite Shale deposit is exposed at the impact scar, ready to be cut.",
    adjacentLocationIds: [LOCATION_IDS.abandonedProcessingYard, LOCATION_IDS.emergencyPowerAnnex],
    availableActionIds: [ACTION_IDS.crashSiteMining],
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
    description: "The processing equipment is offline. Refining is not available yet.",
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.emergencyPowerAnnex],
    availableActionIds: [],
    dormantActivities: [
      {
        skillId: SKILL_IDS.metallurgy,
        label: "Metallurgy",
        status: "Offline — not yet operational",
      },
    ],
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

/** The ordered three-location local map for the issue #47 slice. */
export const LOCAL_MAP_LOCATION_IDS: readonly LocationDefinition["id"][] = [
  LOCATION_IDS.crashSite,
  LOCATION_IDS.abandonedProcessingYard,
  LOCATION_IDS.emergencyPowerAnnex,
];
