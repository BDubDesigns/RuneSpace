import { ACTION_IDS, type LocationId, type TravelMode } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import { getTransportRoute, type TransportRouteDefinition } from "@/game/content/transport-routes";
import { ticksToMilliseconds } from "./timing";

/** Reasons the server may refuse a begin-travel command. */
export type TravelPlanRejection =
  | "unknown_destination"
  | "same_location"
  | "not_adjacent"
  | "already_traveling";

export type TravelPlan =
  | { ok: true; durationTicks: number }
  | { ok: false; reason: TravelPlanRejection };

/**
 * Authoritative validation for a begin-travel command. The server derives origin
 * and adjacency from content; the client supplies only the destination ID.
 */
export function planTravel(input: {
  currentLocationId: string;
  destinationLocationId: string;
  alreadyTraveling: boolean;
}): TravelPlan {
  if (!getLocation(input.destinationLocationId)) {
    return { ok: false, reason: "unknown_destination" };
  }
  if (input.destinationLocationId === input.currentLocationId) {
    return { ok: false, reason: "same_location" };
  }
  if (!areLocationsAdjacent(input.currentLocationId, input.destinationLocationId)) {
    return { ok: false, reason: "not_adjacent" };
  }
  if (input.alreadyTraveling) {
    return { ok: false, reason: "already_traveling" };
  }
  return {
    ok: true,
    durationTicks: travelDurationTicks("walk"),
  };
}

/** Whole-tick duration for an adjacent walk between the two issue #40 locations. */
export function adjacentWalkDurationTicks(): number {
  return getEffectiveGameBalance().travel.adjacentWalkDurationTicks;
}

/**
 * The authoritative duration of one Journey, by how it is being made (#172).
 *
 * A Crew Hauler ride covers the whole authored Holo Hollow <-> The Jag route in
 * 20 ticks, where walking it is two 40-tick legs through The Long Scramble. The
 * gap is intentional: the route is fixed rather than general-purpose fast
 * travel, every ride is paid, and a ride offers nothing to scavenge.
 */
export function travelDurationTicks(mode: TravelMode): number {
  const balance = getEffectiveGameBalance();
  return mode === "crew_hauler"
    ? balance.travel.crewHaulerDurationTicks
    : balance.travel.adjacentWalkDurationTicks;
}

/**
 * Whether a Journey made this way offers the optional Scavenge window.
 *
 * Only an ordinary walk does. A paid ride has no Scavenge opportunity at all —
 * not a missed one, not an empty one: the travel row carries no window, the
 * projection exposes none, and the claim command refuses.
 */
export function travelOffersScavenge(mode: TravelMode): boolean {
  return mode === "walk";
}

export type TransportPlanRejection =
  | "unknown_destination"
  | "same_location"
  | "unknown_route"
  | "route_locked"
  | "already_traveling"
  | "insufficient_credits";

export type TransportPlan =
  | {
      ok: true;
      route: TransportRouteDefinition;
      mode: Exclude<TravelMode, "walk">;
      durationTicks: number;
      fareCredits: number;
    }
  | { ok: false; reason: TransportPlanRejection };

/**
 * Authoritative validation for a paid transport ride.
 *
 * Everything that decides whether the ride happens and what it costs — the
 * route, its mode, its fare, its duration, and the Mission that unlocks it —
 * is resolved here from authored content and the character's own authoritative
 * state. The client contributes a destination and nothing else.
 */
export function planTransportTravel(input: {
  currentLocationId: string;
  destinationLocationId: string;
  alreadyTraveling: boolean;
  completedMissionIds: ReadonlySet<string>;
  credits: number;
}): TransportPlan {
  if (!getLocation(input.destinationLocationId)) {
    return { ok: false, reason: "unknown_destination" };
  }
  if (input.destinationLocationId === input.currentLocationId) {
    return { ok: false, reason: "same_location" };
  }
  const route = getTransportRoute(input.currentLocationId, input.destinationLocationId);
  if (!route) return { ok: false, reason: "unknown_route" };
  if (!input.completedMissionIds.has(route.unlockMissionId)) {
    return { ok: false, reason: "route_locked" };
  }
  if (input.alreadyTraveling) return { ok: false, reason: "already_traveling" };
  if (input.credits < route.fareCredits) {
    return { ok: false, reason: "insufficient_credits" };
  }
  return {
    ok: true,
    route,
    mode: route.mode,
    durationTicks: travelDurationTicks(route.mode),
    fareCredits: route.fareCredits,
  };
}

/**
 * Whether a persisted Journey's route is still legitimate.
 *
 * Walking is validated against map adjacency; a transport Journey is validated
 * against its authored route. Either way an arrival only commits for a route
 * the content registry still recognises.
 */
export function isTravelRouteValid(input: {
  mode: TravelMode;
  originLocationId: string;
  destinationLocationId: string;
}): boolean {
  if (input.originLocationId === input.destinationLocationId) return false;
  if (input.mode === "walk") {
    return areLocationsAdjacent(input.originLocationId, input.destinationLocationId);
  }
  const route = getTransportRoute(input.originLocationId, input.destinationLocationId);
  return route?.mode === input.mode;
}

export type TravelState = {
  originLocationId: LocationId;
  destinationLocationId: LocationId;
  mode: TravelMode;
  startedAt: Date;
  arrivesAt: Date;
};

/**
 * Resolve a travel window purely. Returns whether the character has arrived and
 * how many whole ticks were consumed so the cursor can advance exactly once.
 *
 * The `window` is the same durable lazy-resolution window used by every action.
 * A travel is consumed in whole steps of its own duration; the offline cap can
 * advance the window start past `startedAt`, so a long absence still resolves
 * exactly one arrival when the window reaches `arrivesAt`.
 */
export function resolveTravel(input: {
  travel: TravelState;
  windowStartsAt: Date;
  elapsedTicks: number;
  alreadyConsumedTicks: number;
}): { arrived: boolean; consumedTicks: number } {
  if (input.elapsedTicks <= 0) return { arrived: false, consumedTicks: 0 };

  const totalTicks = travelDurationTicks(input.travel.mode);
  const startsAtMs = input.travel.startedAt.getTime();
  const cursorMs = startsAtMs + ticksToMilliseconds(input.alreadyConsumedTicks);
  const dueAtMs = startsAtMs + ticksToMilliseconds(totalTicks);
  const availableThroughMs =
    input.windowStartsAt.getTime() + ticksToMilliseconds(input.elapsedTicks);

  if (availableThroughMs >= dueAtMs) {
    // Arrival: advance the cursor through the remaining journey ticks in this
    // window. `consumedTicks` is the delta for this window (total minus what was
    // already consumed), so the durable cursor lands exactly on arrival.
    return { arrived: true, consumedTicks: totalTicks - input.alreadyConsumedTicks };
  }
  const remainingMs = Math.max(0, dueAtMs - cursorMs);
  const remainingTicks = Math.ceil(remainingMs / ticksToMilliseconds(1));
  const resolvedTicks = Math.min(remainingTicks, input.elapsedTicks);
  return { arrived: false, consumedTicks: resolvedTicks };
}

export type TravelActionId = typeof ACTION_IDS.travel;
