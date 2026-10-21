import { getShipFlightBalance } from "@/game/config/balance";
import { LOCATION_IDS, type ShipRouteId } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { getMission } from "@/game/content/missions";
import { getShipRoute, SHIP_ROUTES, type ShipRouteDefinition } from "@/game/content/ship-routes";

/**
 * Pure Rivet Utility Shuttle rules (#358). Server-authoritative: the browser
 * renders these results and never decides them.
 */

/** The berth of a character whose ship has never been touched. */
export const INITIAL_SHIP_BERTH_LOCATION_ID = LOCATION_IDS.crashSite;

/** A flight's duration in milliseconds, from the route's approved real seconds. */
export function shipFlightDurationMs(routeId: ShipRouteId): number {
  return getShipFlightBalance(routeId).durationSeconds * 1_000;
}

/**
 * The authored route that flies straight back from a route's destination to its
 * origin, when one exists (#375). The first flight has none: there is no way
 * back to the Crash Site.
 */
export function shipReturnRoute(route: ShipRouteDefinition): ShipRouteDefinition | undefined {
  return SHIP_ROUTES.find(
    (candidate) =>
      candidate.originLocationId === route.destinationLocationId &&
      candidate.destinationLocationId === route.originLocationId,
  );
}

/**
 * The candid return-fuel warning shown before an outbound launch (#375). It is
 * nonblocking: a launch that would land with less fuel than the flight back
 * costs is still allowed, and nothing refuels the tank for free on arrival.
 * Undefined when there is no route back or the projected tank covers it.
 */
export function shipReturnFuelShortfall(
  route: ShipRouteDefinition,
  fuelUnits: number,
): { fuelAfterArrival: number; returnFuelCostFuelUnits: number } | undefined {
  const back = shipReturnRoute(route);
  if (!back) return undefined;
  const fuelAfterArrival = Math.max(
    0,
    fuelUnits - getShipFlightBalance(route.id).fuelCostFuelUnits,
  );
  const returnFuelCostFuelUnits = getShipFlightBalance(back.id).fuelCostFuelUnits;
  return fuelAfterArrival < returnFuelCostFuelUnits
    ? { fuelAfterArrival, returnFuelCostFuelUnits }
    : undefined;
}

export type RefuelSource = "inventory" | "cargo_hold";

export type RefuelPlan =
  | { ok: false; reason: "tank_full" | "no_canister" }
  | {
      ok: true;
      /** Fuel Units the tank actually gains. */
      gainedFuelUnits: number;
      /** Fuel Units of the canister that do not fit and are lost. */
      wastedFuelUnits: number;
      /** A partial load (1–49 FU of headroom) must be confirmed with the exact figures. */
      requiresConfirmation: boolean;
      fuelAfter: number;
    };

/**
 * Plan one canister load. Exactly one Full Small Fuel Canister is consumed and
 * its shell is never returned. When the tank has at least a whole canister of
 * headroom the load needs no confirmation; with less, the player must confirm
 * the exact gain and waste.
 */
export function planRefuel(input: {
  fuelUnits: number;
  tankCapacityFuelUnits: number;
  canisterFuelUnits: number;
  canistersAvailable: number;
}): RefuelPlan {
  const headroom = input.tankCapacityFuelUnits - input.fuelUnits;
  if (headroom <= 0) return { ok: false, reason: "tank_full" };
  if (input.canistersAvailable < 1) return { ok: false, reason: "no_canister" };
  const gained = Math.min(headroom, input.canisterFuelUnits);
  return {
    ok: true,
    gainedFuelUnits: gained,
    wastedFuelUnits: input.canisterFuelUnits - gained,
    requiresConfirmation: headroom < input.canisterFuelUnits,
    fuelAfter: input.fuelUnits + gained,
  };
}

export type LaunchRefusalReason =
  | "unknown_route"
  | "not_at_berth"
  | "ship_not_berthed_here"
  | "in_flight"
  | "busy"
  | "repairs_incomplete"
  | "mission_incomplete"
  | "mission_not_accepted"
  | "insufficient_fuel";

export type LaunchPlan =
  | { ok: true; route: ShipRouteDefinition; fuelCostFuelUnits: number; durationMs: number }
  | { ok: false; reason: LaunchRefusalReason };

/** Every authoritative fact a launch is judged against. */
export type LaunchFacts = {
  characterLocationId: string;
  shipBerthLocationId: string;
  inFlight: boolean;
  /** Any active action at all, flight included, blocks a launch. */
  characterBusy: boolean;
  fuelUnits: number;
  completedRepairTargetIds: ReadonlySet<string>;
  completedMissionIds: ReadonlySet<string>;
  acceptedMissionIds: ReadonlySet<string>;
};

/**
 * Plan a launch on one authored route. Everything is checked against
 * authoritative facts and the authored route; the client contributes a route
 * ID and nothing else, so an unauthorised origin or destination simply is not
 * a route.
 */
export function planLaunch(routeId: string, facts: LaunchFacts): LaunchPlan {
  const route = getShipRoute(routeId);
  if (!route) return { ok: false, reason: "unknown_route" };
  if (facts.inFlight) return { ok: false, reason: "in_flight" };
  if (facts.characterBusy) return { ok: false, reason: "busy" };
  if (facts.shipBerthLocationId !== route.originLocationId) {
    return { ok: false, reason: "ship_not_berthed_here" };
  }
  if (facts.characterLocationId !== route.originLocationId) {
    return { ok: false, reason: "not_at_berth" };
  }
  if (!route.requiredRepairTargetIds.every((id) => facts.completedRepairTargetIds.has(id))) {
    return { ok: false, reason: "repairs_incomplete" };
  }
  if (!route.requiredCompletedMissionIds.every((id) => facts.completedMissionIds.has(id))) {
    return { ok: false, reason: "mission_incomplete" };
  }
  if (
    route.requiredAcceptedMissionId &&
    !facts.acceptedMissionIds.has(route.requiredAcceptedMissionId)
  ) {
    return { ok: false, reason: "mission_not_accepted" };
  }
  const { fuelCostFuelUnits } = getShipFlightBalance(route.id);
  if (facts.fuelUnits < fuelCostFuelUnits) return { ok: false, reason: "insufficient_fuel" };
  return { ok: true, route, fuelCostFuelUnits, durationMs: shipFlightDurationMs(route.id) };
}

/**
 * The words a refused launch gets. The server returns them and the Ship panel
 * shows them, so the guidance a player reads and the rule that refused them
 * can never be two different texts.
 */
export function launchRefusalMessage(
  reason: LaunchRefusalReason,
  route?: ShipRouteDefinition,
): string {
  const missionTitle = (missionId: string | undefined) =>
    (missionId ? getMission(missionId)?.title : undefined) ?? "the required Mission";
  switch (reason) {
    case "unknown_route":
      return "The Rivet cannot fly that route.";
    case "not_at_berth":
      return "Board the Rivet where it is parked to launch.";
    case "ship_not_berthed_here":
      return "The Rivet is not berthed here.";
    case "in_flight":
      return "The Rivet is already in flight.";
    case "busy":
      return "Finish what you are doing before launching.";
    case "repairs_incomplete":
      return "The Rivet is not flight-ready. Finish its repairs first.";
    case "mission_incomplete":
      return `Finish ${missionTitle(route?.requiredCompletedMissionIds[0])} first.`;
    case "mission_not_accepted":
      return `Report Thrust Issues to Wade at Rusk Recovery to start ${missionTitle(route?.requiredAcceptedMissionId)}.`;
    case "insufficient_fuel": {
      const cost = route ? getShipFlightBalance(route.id).fuelCostFuelUnits : undefined;
      return cost === undefined
        ? "The tank does not hold enough fuel."
        : `The tank needs at least ${cost} FU to launch.`;
    }
  }
}

/** Whether a recorded flight has reached its scheduled arrival. Server clock only. */
export function flightHasArrived(arrivesAt: Date, now: Date): boolean {
  return now.getTime() >= arrivesAt.getTime();
}

/** Remaining whole milliseconds of a flight, never negative. */
export function flightRemainingMs(arrivesAt: Date, now: Date): number {
  return Math.max(0, arrivesAt.getTime() - now.getTime());
}

/** Startup validation for authored routes against the location registry. */
export function validateShipRoutes(routes: readonly ShipRouteDefinition[]): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const where = `Ship route "${route.id}"`;
    if (seen.has(route.id)) throw new Error(`${where} is authored more than once.`);
    seen.add(route.id);
    if (!getLocation(route.originLocationId)) {
      throw new Error(`${where} departs from unknown location "${route.originLocationId}".`);
    }
    if (!getLocation(route.destinationLocationId)) {
      throw new Error(`${where} lands at unknown location "${route.destinationLocationId}".`);
    }
    if (route.originLocationId === route.destinationLocationId) {
      throw new Error(`${where} departs and lands at the same location.`);
    }
    // Throws when balance authors no cost or duration for the route.
    getShipFlightBalance(route.id);
  }
}
