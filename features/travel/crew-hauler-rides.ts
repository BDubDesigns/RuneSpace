import { getTransportRoutesFrom } from "@/game/content/transport-routes";
import type { LocalPlaceId } from "@/game/config/foundations";
import type { TransportRouteDefinition } from "@/game/content/transport-routes";

/**
 * The rides one surface may offer (#172).
 *
 * Three authored facts decide it, and nothing else: the route runs FROM here,
 * the completed Mission that unlocks it, and where it is boarded from. A route
 * boarding at a Local Place belongs to that place's surface alone — the Crew
 * Hauler is offered inside the repaired Crew Stop, never on the town surface —
 * while a route with no authored boarding place belongs to the World Location
 * surface.
 *
 * Because routes are directional, a location that is only some route's
 * DESTINATION offers nothing: The Jag has no ride home to hide, disable, or
 * explain away, because none is authored.
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
}): readonly TransportRouteDefinition[] {
  return getTransportRoutesFrom(input.locationId).filter(
    (route) =>
      route.boardingLocalPlaceId === input.localPlaceId &&
      input.completedMissionIds.has(route.unlockMissionId),
  );
}
