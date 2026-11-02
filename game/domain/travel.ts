import { ACTION_IDS, type LocationId, type TravelMode } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import {
  isLocationTravelable,
  NO_LOCATION_STATE_FACTS,
  type LocationStateFacts,
} from "@/game/domain/location-state";
import { getTransportRoute, type TransportRouteDefinition } from "@/game/content/transport-routes";
import { ticksToMilliseconds } from "./timing";

/** Reasons the server may refuse a begin-travel command. */
export type TravelPlanRejection =
  | "unknown_destination"
  | "same_location"
  | "not_adjacent"
  | "already_traveling"
  /**
   * The authored walking edge exists, but the destination's current state does
   * not permit entry (#209) — a collapsed Deep Jag before Brace Yourself is
   * accepted. Adjacency alone can never answer this, which is why it is a
   * distinct refusal rather than a second meaning for `not_adjacent`.
   */
  | "route_blocked";

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
  /**
   * The character's authoritative location-state facts. Omitted, the caller
   * gets the base state of every location — which is why the server always
   * passes real facts and a forged request cannot walk into a cave-in.
   */
  locationStateFacts?: LocationStateFacts;
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
  if (
    !isLocationTravelable(
      input.destinationLocationId,
      input.locationStateFacts ?? NO_LOCATION_STATE_FACTS,
    )
  ) {
    return { ok: false, reason: "route_blocked" };
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
  /** When supplied, a destination whose state blocks entry invalidates the route. */
  locationStateFacts?: LocationStateFacts;
}): boolean {
  if (input.originLocationId === input.destinationLocationId) return false;
  if (
    input.locationStateFacts &&
    !isLocationTravelable(input.destinationLocationId, input.locationStateFacts)
  ) {
    return false;
  }
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

/**
 * Route To (#450): the reasons the server may refuse a multi-leg walking route.
 *
 * `route_blocked` keeps its single-walk meaning: the destination's own state
 * does not permit entry. `no_walking_route` is everything else that leaves no
 * ordinary walking path — another planet's location, or a way through that
 * runs only over locations this character may not currently enter.
 */
export type WalkingRouteRejection =
  | "unknown_destination"
  | "same_location"
  | "route_blocked"
  | "no_walking_route";

export type WalkingRoutePlan =
  | {
      ok: true;
      /** Every location on the route, origin first and destination last. */
      path: readonly LocationId[];
      /** Adjacent walking legs: `path.length - 1`. */
      legCount: number;
      /** Ordinary walking time for the whole route: one full walk per leg. */
      durationTicks: number;
    }
  | { ok: false; reason: WalkingRouteRejection };

/**
 * The deterministic shortest ordinary walking path between two locations on
 * one planet's map (#450).
 *
 * It walks only authored adjacency, which can never join two planets
 * (`assertBidirectionalAdjacency`), so no ship, ride, shuttle, or teleport is
 * ever part of a route. Every location the route enters — each intermediate
 * hex and the destination — must be travelable for this character right now,
 * by the same `isTravelable` answer a single Walk into it would get; the origin
 * is where the character already stands and is never re-entered.
 *
 * Ties between equally short paths resolve stably: of every shortest path, the
 * one whose sequence of location IDs is lexicographically smallest wins. That
 * depends only on the IDs and the edges, never on the order a location happens
 * to list its neighbors in, so the browser's preview and the server's plan
 * cannot disagree.
 *
 * The search is a breadth-first pass over one planet's hexes, so it is bounded
 * by the size of that map.
 */
export function planWalkingRoute(input: {
  currentLocationId: string;
  destinationLocationId: string;
  /** Whether this character may currently walk into the location. */
  isTravelable: (locationId: string) => boolean;
}): WalkingRoutePlan {
  const origin = getLocation(input.currentLocationId);
  const destination = getLocation(input.destinationLocationId);
  if (!destination) return { ok: false, reason: "unknown_destination" };
  if (input.destinationLocationId === input.currentLocationId) {
    return { ok: false, reason: "same_location" };
  }
  if (!input.isTravelable(destination.id)) return { ok: false, reason: "route_blocked" };
  if (!origin || origin.planetId !== destination.planetId) {
    return { ok: false, reason: "no_walking_route" };
  }

  // Distances measured back from the destination, over enterable hexes only.
  // A hex is enterable when the route may step into it: the destination, or
  // any travelable hex other than the origin (which is only ever left).
  const distanceToDestination = new Map<string, number>([[destination.id, 0]]);
  const queue: string[] = [destination.id];
  for (let head = 0; head < queue.length; head += 1) {
    const locationId = queue[head]!;
    const distance = distanceToDestination.get(locationId)!;
    // The origin is reached but never expanded through: a route never passes
    // back over the place it set out from.
    if (locationId === origin.id) continue;
    for (const neighborId of getLocation(locationId)?.adjacentLocationIds ?? []) {
      if (distanceToDestination.has(neighborId)) continue;
      if (neighborId !== origin.id && !input.isTravelable(neighborId)) continue;
      distanceToDestination.set(neighborId, distance + 1);
      queue.push(neighborId);
    }
  }

  const legCount = distanceToDestination.get(origin.id);
  if (legCount === undefined) return { ok: false, reason: "no_walking_route" };

  // Walk forward, always to the smallest-ID neighbor one step closer.
  const path: LocationId[] = [origin.id as LocationId];
  let currentId: string = origin.id;
  for (let remaining = legCount; remaining > 0; remaining -= 1) {
    const next = [...(getLocation(currentId)?.adjacentLocationIds ?? [])]
      .filter((neighborId) => distanceToDestination.get(neighborId) === remaining - 1)
      .sort()[0];
    // Unreachable by construction: every hex at distance d > 0 has a
    // neighbor at d - 1, which is how it got its distance.
    if (!next) return { ok: false, reason: "no_walking_route" };
    path.push(next as LocationId);
    currentId = next;
  }

  return {
    ok: true,
    path,
    legCount,
    durationTicks: legCount * travelDurationTicks("walk"),
  };
}

/**
 * The locations still ahead of the active leg on a stored route (#450): the
 * hexes after the leg's destination, in order. `undefined` means the stored
 * route does not describe this leg at all — the leg is not one consecutive
 * step of the path — and is treated as no route rather than guessed at.
 */
export function remainingRouteLocationIds(input: {
  routeLocationIds: readonly string[];
  originLocationId: string;
  destinationLocationId: string;
}): readonly string[] | undefined {
  const index = input.routeLocationIds.indexOf(input.destinationLocationId);
  if (index < 1 || input.routeLocationIds[index - 1] !== input.originLocationId) return undefined;
  // A shortest path never repeats a location; a stored one that does is not
  // a route this server planned.
  if (new Set(input.routeLocationIds).size !== input.routeLocationIds.length) return undefined;
  return input.routeLocationIds.slice(index + 1);
}

/** One adjacent walking leg of a route, on the authoritative timeline. */
export type WalkingRouteLeg = {
  originLocationId: string;
  destinationLocationId: string;
  startedAt: Date;
  arrivesAt: Date;
};

/**
 * Chain the legs of a route that follow an arrived leg, purely (#450).
 *
 * Each next leg starts at the exact instant the previous leg arrived — the
 * authoritative arrival boundary, never the moment a server happened to look —
 * and lasts one full ordinary walk. Every leg whose arrival is already covered
 * by `availableThroughAt` is returned as arrived, in chronological order; the
 * first leg still under way, if any, is returned as `activeLeg`. So a player
 * who was offline across several legs is reconciled to exactly the place, and
 * the leg timing, they would have had watching the whole time.
 *
 * `canWalk` is asked about every leg before it starts, with the same rule an
 * ordinary Walk is held to; the first refusal ends the route at the location
 * last arrived at. The loop is bounded by the route itself, which is a
 * shortest path on one planet's map.
 */
export function chainWalkingRouteLegs(input: {
  arrivedAt: Date;
  fromLocationId: string;
  remainingLocationIds: readonly string[];
  availableThroughAt: Date;
  canWalk: (originLocationId: string, destinationLocationId: string) => boolean;
}): {
  arrivedLegs: readonly WalkingRouteLeg[];
  activeLeg?: WalkingRouteLeg;
  /** Set when the route ended at `fromLocationId` or an arrived leg because a leg was refused. */
  refused: boolean;
} {
  const legMs = ticksToMilliseconds(travelDurationTicks("walk"));
  const arrivedLegs: WalkingRouteLeg[] = [];
  let originLocationId = input.fromLocationId;
  let startsAtMs = input.arrivedAt.getTime();
  for (const destinationLocationId of input.remainingLocationIds) {
    if (!input.canWalk(originLocationId, destinationLocationId)) {
      return { arrivedLegs, refused: true };
    }
    const leg: WalkingRouteLeg = {
      originLocationId,
      destinationLocationId,
      startedAt: new Date(startsAtMs),
      arrivesAt: new Date(startsAtMs + legMs),
    };
    if (leg.arrivesAt.getTime() > input.availableThroughAt.getTime()) {
      return { arrivedLegs, activeLeg: leg, refused: false };
    }
    arrivedLegs.push(leg);
    originLocationId = destinationLocationId;
    startsAtMs = leg.arrivesAt.getTime();
  }
  return { arrivedLegs, refused: false };
}
