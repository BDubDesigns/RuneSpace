import { getTransportRoutesFrom } from "@/game/content/transport-routes";
import type { LocalPlaceId, LocationId } from "@/game/config/foundations";
import type { TransportRouteDefinition } from "@/game/content/transport-routes";

export type AvailableRide = {
  route: TransportRouteDefinition;
  destinationLocationId: LocationId;
};

/**
 * The rides one surface may offer (#172).
 *
 * Two authored facts decide it, and nothing else: the completed Mission that
 * unlocks the route, and where that end of the route is boarded from. A route
 * boarding at a Local Place belongs to that place's surface alone — Holo
 * Hollow's Crew Hauler is offered inside the repaired Crew Stop, never on the
 * town surface — while a route with no authored boarding place belongs to the
 * World Location surface, which is how The Jag offers the return leg without a
 * second Local Place or a driver NPC.
 *
 * Presentation shares this with the composition layer so a surface can ask
 * whether it has any ride to show before it lays out space for one. It is not
 * an authorization check: the server re-derives route, fare, and unlock from
 * the character's own position when the ride actually starts.
 */
export function availableCrewHaulerRides(input: {
  locationId: string;
  /** The Local Place being rendered, or undefined for the World Location surface. */
  localPlaceId?: LocalPlaceId | string;
  completedMissionIds: ReadonlySet<string>;
}): readonly AvailableRide[] {
  return getTransportRoutesFrom(input.locationId)
    .filter(
      ({ route, boardingLocalPlaceId }) =>
        boardingLocalPlaceId === input.localPlaceId &&
        input.completedMissionIds.has(route.unlockMissionId),
    )
    .map(({ route, destinationLocationId }) => ({ route, destinationLocationId }));
}
