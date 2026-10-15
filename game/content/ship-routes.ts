import {
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
  type LocationId,
  type MissionId,
  type RepairTargetId,
  type ShipRouteId,
} from "@/game/config/foundations";

/**
 * The authoritative registry of the Rivet Utility Shuttle's flight routes (#358).
 *
 * A route says where a flight goes and what must already be true for a
 * character to take it. What it costs and how long it takes is balance
 * (`game/config/balance`, `ship.flights`), and the Mission a landing completes
 * is the Mission's own `autoCompletion` (`game/content/missions`) — a route
 * never names it, so the two cannot disagree.
 *
 * A route is **one-way** and is a physical move of the ship: the berth after a
 * flight is the route's destination, permanently. There is deliberately no
 * route back to the Crash Site, no schedule, no pathfinding and no
 * interplanetary leg here; a later route is a second authored entry.
 */
export type ShipRouteDefinition = {
  id: ShipRouteId;
  displayName: string;
  /** Where the ship must be berthed, and the character standing, to launch. */
  originLocationId: LocationId;
  /** Where the ship is berthed after landing. */
  destinationLocationId: LocationId;
  /** Repairs that must be complete: the ship has to be whole to leave the ground. */
  requiredRepairTargetIds: readonly RepairTargetId[];
  /** Missions that must be completed before this route may be flown. */
  requiredCompletedMissionIds: readonly MissionId[];
  /**
   * A Mission that must be ACCEPTED (not necessarily completed) to launch
   * (#358). Move Along gates only the flight that completes it, and a Mission
   * that is already finished gates nothing, so this can never lock a later,
   * unrelated flight behind a story beat the player has already seen.
   */
  requiredAcceptedMissionId?: MissionId;
  /** Copy for the launch control, never rules. */
  launchNotice: string;
};

export const SHIP_ROUTES: readonly ShipRouteDefinition[] = [
  {
    id: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
    displayName: "Holo Hollow Landing",
    originLocationId: LOCATION_IDS.crashSite,
    destinationLocationId: LOCATION_IDS.holoHollowLanding,
    requiredRepairTargetIds: [
      REPAIR_TARGET_IDS.cargoHold,
      REPAIR_TARGET_IDS.landingGear,
      REPAIR_TARGET_IDS.propulsionSystem,
    ],
    requiredCompletedMissionIds: [MISSION_IDS.thrustIssues],
    requiredAcceptedMissionId: MISSION_IDS.moveAlong,
    launchNotice:
      "Launching permanently moves your ship from the Crash Site to Holo Hollow Landing.",
  },
];

const routeById = new Map<string, ShipRouteDefinition>(
  SHIP_ROUTES.map((route) => [route.id, route]),
);

export function getShipRoute(routeId: string): ShipRouteDefinition | undefined {
  return routeById.get(routeId);
}

/** The authored routes that depart from a berth. Never derived from a client value. */
export function shipRoutesFrom(originLocationId: string): readonly ShipRouteDefinition[] {
  return SHIP_ROUTES.filter((route) => route.originLocationId === originLocationId);
}
