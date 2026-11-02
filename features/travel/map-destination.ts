import { areLocationsAdjacent } from "@/game/content/locations";
import { planWalkingRoute } from "@/game/domain/travel";

/**
 * What the selected-destination panel can offer for one inspected hex (#240):
 *
 * - `current` — the player is standing here; there is nothing to travel to.
 * - `reachable` — an authored walking edge whose destination is travelable now.
 * - `routable` — no direct edge, but an ordinary multi-leg walking route on
 *   this planet reaches it (#450, Route To).
 * - `blocked` — the destination's own state has shut it (#209: a collapsed
 *   Deep Jag), named rather than silently unwalkable, however far away it is.
 * - `unreachable` — visible on the map, but no ordinary walking path from here.
 *
 * Only `reachable` offers Walk and only `routable` offers Route To. Adjacency is
 * the location registry's, `travelable` is the server-derived location state,
 * and the route is `planWalkingRoute` — the same rule and the same facts the
 * travel gate enforces — so the panel never offers what the server refuses.
 */
export type MapDestinationStatus = "current" | "reachable" | "routable" | "blocked" | "unreachable";

type MapDestinationInput = {
  locationId: string;
  currentLocationId: string;
  /** `state.locationStates[locationId]?.travelable`; missing state is not a block. */
  travelable: boolean | undefined;
  /**
   * Whether any other hex may currently be entered, from the same derived
   * location state. Omitted, every hex is open, matching missing state.
   */
  isTravelable?: (locationId: string) => boolean;
};

/** The walking route Route To would take to the destination, origin first. */
export function mapDestinationRoute({
  locationId,
  currentLocationId,
  travelable,
  isTravelable = () => true,
}: MapDestinationInput): readonly string[] | undefined {
  const plan = planWalkingRoute({
    currentLocationId,
    destinationLocationId: locationId,
    isTravelable: (candidate) =>
      candidate === locationId ? travelable !== false : isTravelable(candidate),
  });
  return plan.ok ? plan.path : undefined;
}

export function mapDestinationStatus(input: MapDestinationInput): MapDestinationStatus {
  const { locationId, currentLocationId, travelable } = input;
  if (locationId === currentLocationId) return "current";
  if (travelable === false) return "blocked";
  if (areLocationsAdjacent(currentLocationId, locationId)) return "reachable";
  return mapDestinationRoute(input) ? "routable" : "unreachable";
}
