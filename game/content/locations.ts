import { ACTION_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  assertBidirectionalAdjacency,
  LocationDefinitionSchema,
  type LocationDefinition,
} from "@/game/schemas/locations";

/**
 * The authoritative two-location world for issue #40 (single source of truth).
 *
 * Server validation, UI projection, and adjacency checks all read from this
 * registry. The product owner approved exactly two connected locations for this
 * slice; no further locations, content, or map systems are introduced here.
 *
 * - Crash Site: the existing Ferrite Shale deposit where Mining is available.
 * - Abandoned Processing Yard: a dormant industrial location whose future
 *   Metallurgy activity is shown as dormant only — it performs no refining.
 */
const locationDefinitions = [
  {
    id: LOCATION_IDS.crashSite,
    displayName: "Crash Site",
    description:
      "The damaged ship rests on broken ground. An infinite Ferrite Shale deposit is exposed at the impact scar, ready to be cut.",
    adjacentLocationIds: [LOCATION_IDS.abandonedProcessingYard],
    availableActionIds: [ACTION_IDS.crashSiteMining],
    dormantActivities: [],
    presentation: {
      mapIconKey: "crash_site_deposit" as const,
      layout: "crash_site" as const,
    },
  },
  {
    id: LOCATION_IDS.abandonedProcessingYard,
    displayName: "Abandoned Processing Yard",
    description:
      "A dormant industrial yard of silent stamping presses and cold smelters. Its machinery waits for a future Metallurgy activity that is not yet operational.",
    adjacentLocationIds: [LOCATION_IDS.crashSite],
    availableActionIds: [],
    dormantActivities: [
      {
        skillId: SKILL_IDS.metallurgy,
        label: "Metallurgy",
        status: "Dormant — not yet operational",
      },
    ],
    presentation: {
      mapIconKey: "processing_yard" as const,
      layout: "processing_yard" as const,
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

/** The ordered two-location local map for the issue #40 slice. */
export const LOCAL_MAP_LOCATION_IDS: readonly string[] = [
  LOCATION_IDS.crashSite,
  LOCATION_IDS.abandonedProcessingYard,
];
