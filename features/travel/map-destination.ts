import { areLocationsAdjacent } from "@/game/content/locations";

/**
 * What the selected-destination panel can offer for one inspected hex (#240):
 *
 * - `current` — the player is standing here; there is nothing to travel to.
 * - `reachable` — an authored walking edge whose destination is travelable now.
 * - `blocked` — an authored walking edge the destination's own state has shut
 *   (#209: a collapsed Deep Jag), named rather than silently unwalkable.
 * - `unreachable` — visible on the map, but no walking edge from here.
 *
 * Only `reachable` offers a Walk control. Adjacency is the location registry's
 * and `travelable` is the server-derived location state, so the panel reads the
 * same facts the travel gate enforces instead of carrying a rule of its own.
 */
export type MapDestinationStatus = "current" | "reachable" | "blocked" | "unreachable";

export function mapDestinationStatus({
  locationId,
  currentLocationId,
  travelable,
}: {
  locationId: string;
  currentLocationId: string;
  /** `state.locationStates[locationId]?.travelable`; missing state is not a block. */
  travelable: boolean | undefined;
}): MapDestinationStatus {
  if (locationId === currentLocationId) return "current";
  if (!areLocationsAdjacent(currentLocationId, locationId)) return "unreachable";
  return travelable === false ? "blocked" : "reachable";
}
