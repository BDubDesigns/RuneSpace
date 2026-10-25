import {
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  PASSENGER_ROUTE_IDS,
  SHIP_ROUTE_IDS,
  type LocalPlaceId,
  type LocationId,
  type PassengerRouteId,
  type ShipRouteId,
} from "@/game/config/foundations";

/**
 * The authoritative registry of Milky Waymo's passenger routes (#404).
 *
 * A route says where a ticket goes from and to. What it costs and how long it
 * takes is balance (`game/config/balance`, `passengerTravel`), identical in
 * both directions, and who may board is `game/domain/passenger-travel`. A
 * passenger journey moves the character and nothing else, so unlike a Rivet
 * flight (`game/content/ship-routes`) a route here never names a ship, a fuel
 * cost, a repair or a Mission.
 *
 * It is a separate registry from the Rivet's because it is a separate service,
 * but it flies the same interplanetary leg: `cinematicRouteId` names the Rivet
 * route whose chart and backdrops the flight cinematic reuses, with the shuttle
 * drawn in place of the ship (`game/content/flight-cinematics`).
 */
export type PassengerRouteDefinition = {
  id: PassengerRouteId;
  /** The landing hub the ticket is bought at. */
  originLocationId: LocationId;
  /** The landing hub the ticket lands at. */
  destinationLocationId: LocationId;
  /** The Milky Waymo Local Place at the origin hub: the one place that books it. */
  checkInLocalPlaceId: LocalPlaceId;
  /** The Rivet leg whose interplanetary chart and backdrops this journey reuses. */
  cinematicRouteId: ShipRouteId;
};

export const PASSENGER_ROUTES: readonly PassengerRouteDefinition[] = [
  {
    id: PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
    originLocationId: LOCATION_IDS.holoHollowLanding,
    destinationLocationId: LOCATION_IDS.stillreachLandingStation,
    checkInLocalPlaceId: LOCAL_PLACE_IDS.milkyWaymoHoloHollowLanding,
    cinematicRouteId: SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
  },
  {
    id: PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
    originLocationId: LOCATION_IDS.stillreachLandingStation,
    destinationLocationId: LOCATION_IDS.holoHollowLanding,
    checkInLocalPlaceId: LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation,
    cinematicRouteId: SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
  },
];

const routeById = new Map<string, PassengerRouteDefinition>(
  PASSENGER_ROUTES.map((route) => [route.id, route]),
);

export function getPassengerRoute(routeId: string): PassengerRouteDefinition | undefined {
  return routeById.get(routeId);
}

/** The route a ticket bought at one hub flies. Never derived from a client value. */
export function passengerRouteFrom(originLocationId: string): PassengerRouteDefinition | undefined {
  return PASSENGER_ROUTES.find((route) => route.originLocationId === originLocationId);
}
