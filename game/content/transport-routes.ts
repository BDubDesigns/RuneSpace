import {
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  TRANSPORT_ROUTE_IDS,
  type LocalPlaceId,
  type LocationId,
  type MissionId,
  type TransportRouteId,
  type TravelMode,
} from "@/game/config/foundations";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";

/**
 * The authoritative registry of authored paid transport routes (#172).
 *
 * A transport route is deliberately NOT map adjacency. The Crew Hauler runs
 * between Holo Hollow and The Jag, which are two walking legs apart through
 * The Long Scramble, and adding it must never turn that into a walkable edge:
 * walking keeps its existing route, its duration, and its Scavenge windows.
 *
 * This is one fixed route earned by one real feature — not a transit network.
 * There are no schedules, timetables, waiting queues, transfers, tickets, or
 * pathfinding here, and there is no notion of "the cheapest way to get
 * somewhere". A route is an authored pair of endpoints, a fare, and a mode.
 */
export type TransportRouteDefinition = {
  id: TransportRouteId;
  /** The Journey mode this route travels as; it owns duration and Scavenge eligibility. */
  mode: Exclude<TravelMode, "walk">;
  /**
   * The two ends of the route. It is usable in both directions at the same
   * fare; direction is derived from where the character authoritatively is.
   */
  endpoints: readonly [LocationId, LocationId];
  /** Charged per ride, each direction. Never a one-time unlock that makes travel free. */
  fareCredits: number;
  /** The completed Mission that makes this route available to the character. */
  unlockMissionId: MissionId;
  /** Player-facing name of the ride, used by the ride controls and the Journey. */
  displayName: string;
  /**
   * Where an endpoint is boarded from, when boarding belongs to a Local Place
   * rather than the World Location surface.
   *
   * The Crew Hauler is not a service the town offers: it is the crews who use
   * the Crew Stop deciding they do not mind the player. Boarding in Holo Hollow
   * therefore happens at the repaired shelter itself, not from the town
   * directory. The Jag, which has no Local Places, keeps a narrow control on
   * the location surface, so the route needs no second Local Place and no
   * driver NPC to operate one button.
   *
   * This is presentation authority only. Where the player clicks changes
   * nothing the server checks: `beginTransportTravel` re-derives the route,
   * fare, and unlock from the character's own authoritative position.
   */
  boardingLocalPlaceIds?: Readonly<Record<string, LocalPlaceId>>;
};

export const TRANSPORT_ROUTES: readonly TransportRouteDefinition[] = [
  {
    id: TRANSPORT_ROUTE_IDS.crewHaulerHoloHollowTheJag,
    mode: "crew_hauler",
    endpoints: [LOCATION_IDS.holoHollow, LOCATION_IDS.theJag],
    fareCredits: 5,
    unlockMissionId: MISSION_IDS.outOfTheWeather,
    displayName: "Crew Hauler",
    boardingLocalPlaceIds: {
      [LOCATION_IDS.holoHollow]: LOCAL_PLACE_IDS.holoHollowCrewStop,
    },
  },
] as const satisfies readonly TransportRouteDefinition[];

/**
 * Startup validation. An authored route naming an unknown location, or one
 * whose ends are the same place, would fail silently at ride time rather than
 * visibly here.
 */
export function validateTransportRoutes(routes: readonly TransportRouteDefinition[]): void {
  for (const route of routes) {
    const [origin, destination] = route.endpoints;
    if (origin === destination) {
      throw new Error(`Transport route "${route.id}" connects a location to itself.`);
    }
    if (!getLocation(origin)) {
      throw new Error(`Transport route "${route.id}" references unknown location "${origin}".`);
    }
    if (!getLocation(destination)) {
      throw new Error(
        `Transport route "${route.id}" references unknown location "${destination}".`,
      );
    }
    if (!Number.isInteger(route.fareCredits) || route.fareCredits <= 0) {
      throw new Error(`Transport route "${route.id}" fare must be a positive integer.`);
    }
    for (const [locationId, localPlaceId] of Object.entries(route.boardingLocalPlaceIds ?? {})) {
      if (locationId !== origin && locationId !== destination) {
        throw new Error(
          `Transport route "${route.id}" boards at "${locationId}", which is not one of its endpoints.`,
        );
      }
      if (!getLocalPlaceInLocation(locationId, localPlaceId)) {
        throw new Error(
          `Transport route "${route.id}" boards at unknown Local Place "${localPlaceId}" in "${locationId}".`,
        );
      }
    }
  }
}

validateTransportRoutes(TRANSPORT_ROUTES);

/**
 * The authored route connecting these two locations, in either direction.
 * Returns nothing when no route is authored — the server never invents one.
 */
export function getTransportRoute(
  originLocationId: string,
  destinationLocationId: string,
): TransportRouteDefinition | undefined {
  return TRANSPORT_ROUTES.find(
    (route) =>
      (route.endpoints[0] === originLocationId && route.endpoints[1] === destinationLocationId) ||
      (route.endpoints[1] === originLocationId && route.endpoints[0] === destinationLocationId),
  );
}

/**
 * Every authored route with one end at this location, for the ride affordances.
 *
 * Each entry carries the Local Place this end is boarded from, when the route
 * authors one, so a surface can render exactly the rides that belong to it.
 */
export function getTransportRoutesFrom(locationId: string): readonly {
  route: TransportRouteDefinition;
  destinationLocationId: LocationId;
  boardingLocalPlaceId?: LocalPlaceId;
}[] {
  return TRANSPORT_ROUTES.flatMap((route) => {
    const [first, second] = route.endpoints;
    const boardingLocalPlaceId = route.boardingLocalPlaceIds?.[locationId];
    if (first === locationId)
      return [{ route, destinationLocationId: second, boardingLocalPlaceId }];
    if (second === locationId)
      return [{ route, destinationLocationId: first, boardingLocalPlaceId }];
    return [];
  });
}

/** Whether the route registry authors this Journey mode at all. */
export function isTransportMode(mode: string): mode is Exclude<TravelMode, "walk"> {
  return TRANSPORT_ROUTES.some((route) => route.mode === mode);
}
