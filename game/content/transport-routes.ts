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
 * from Holo Hollow to The Jag, which are two walking legs apart through The
 * Long Scramble, and adding it must never turn that into a walkable edge:
 * walking keeps its existing route, its duration, and its Scavenge windows —
 * in both directions.
 *
 * A route is **one-way**. The crews can make room for a passenger on the way
 * out; coming back the hauler is loaded with shale, so there is no ride home.
 * Direction is therefore authored explicitly rather than inferred from an
 * unordered pair, and the server refuses a ride nobody authored. An opposite
 * direction, if some later feature genuinely earns one, is a second authored
 * route — never a flag that makes this one reversible.
 *
 * This is one fixed route earned by one real feature — not a transit network.
 * There are no schedules, timetables, waiting queues, transfers, tickets, or
 * pathfinding here, and there is no notion of "the cheapest way to get
 * somewhere".
 */
export type TransportRouteDefinition = {
  id: TransportRouteId;
  /** The Journey mode this route travels as; it owns duration and Scavenge eligibility. */
  mode: Exclude<TravelMode, "walk">;
  /** Where the ride is boarded. A character anywhere else cannot take it. */
  originLocationId: LocationId;
  /** Where the ride goes. The return trip, if any, is a separate authored route. */
  destinationLocationId: LocationId;
  /** Charged per ride. Never a one-time unlock that makes travel free. */
  fareCredits: number;
  /** The completed Mission that makes this route available to the character. */
  unlockMissionId: MissionId;
  /** Player-facing name of the ride, used by the ride controls and the Journey. */
  displayName: string;
  /**
   * The Local Place the ride is boarded inside, when boarding belongs to a
   * place rather than the origin's World Location surface.
   *
   * The Crew Hauler is not a service the town offers: it is the crews who use
   * the Crew Stop deciding they do not mind the player. Boarding therefore
   * happens at the repaired shelter itself, not from the town directory.
   *
   * This is presentation authority only. Where the player clicks changes
   * nothing the server checks: `beginTransportTravel` re-derives the route,
   * fare, and unlock from the character's own authoritative position.
   */
  boardingLocalPlaceId?: LocalPlaceId;
};

export const TRANSPORT_ROUTES: readonly TransportRouteDefinition[] = [
  {
    id: TRANSPORT_ROUTE_IDS.crewHaulerHoloHollowTheJag,
    mode: "crew_hauler",
    // Outbound only: there is room for a passenger heading out to the mine,
    // and none on the way back with the hauler full of shale.
    originLocationId: LOCATION_IDS.holoHollow,
    destinationLocationId: LOCATION_IDS.theJag,
    fareCredits: 5,
    unlockMissionId: MISSION_IDS.outOfTheWeather,
    displayName: "Crew Hauler",
    boardingLocalPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
  },
] as const satisfies readonly TransportRouteDefinition[];

/**
 * Startup validation. An authored route naming an unknown location, or one
 * whose ends are the same place, would fail silently at ride time rather than
 * visibly here.
 */
export function validateTransportRoutes(routes: readonly TransportRouteDefinition[]): void {
  for (const route of routes) {
    const { originLocationId: origin, destinationLocationId: destination } = route;
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
    if (
      route.boardingLocalPlaceId &&
      !getLocalPlaceInLocation(origin, route.boardingLocalPlaceId)
    ) {
      throw new Error(
        `Transport route "${route.id}" boards at Local Place "${route.boardingLocalPlaceId}", which is not in its origin "${origin}".`,
      );
    }
  }
}

validateTransportRoutes(TRANSPORT_ROUTES);

/**
 * The authored route running FROM this location TO that one.
 *
 * Direction matters: a route authored Holo Hollow → The Jag answers nothing
 * for The Jag → Holo Hollow, which is exactly how the server refuses a ride
 * home without a component having to hide a button. Returns nothing when no
 * route is authored — the server never invents one.
 */
export function getTransportRoute(
  originLocationId: string,
  destinationLocationId: string,
): TransportRouteDefinition | undefined {
  return TRANSPORT_ROUTES.find(
    (route) =>
      route.originLocationId === originLocationId &&
      route.destinationLocationId === destinationLocationId,
  );
}

/**
 * Every authored route a character standing here could board.
 *
 * Only routes whose ORIGIN is this location: being the destination of a route
 * is not an affordance, so The Jag offers nothing and needs no placeholder
 * control explaining why.
 */
export function getTransportRoutesFrom(locationId: string): readonly TransportRouteDefinition[] {
  return TRANSPORT_ROUTES.filter((route) => route.originLocationId === locationId);
}

/** Whether the route registry authors this Journey mode at all. */
export function isTransportMode(mode: string): mode is Exclude<TravelMode, "walk"> {
  return TRANSPORT_ROUTES.some((route) => route.mode === mode);
}
