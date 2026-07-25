import { ACTION_IDS, LOCATION_IDS, type LocationId } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { areLocationsAdjacent } from "@/game/content/locations";
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
  if (
    input.destinationLocationId !== LOCATION_IDS.crashSite &&
    input.destinationLocationId !== LOCATION_IDS.abandonedProcessingYard
  ) {
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
    durationTicks: getEffectiveGameBalance().travel.adjacentWalkDurationTicks,
  };
}

/** Whole-tick duration for an adjacent walk between the two issue #40 locations. */
export function adjacentWalkDurationTicks(): number {
  return getEffectiveGameBalance().travel.adjacentWalkDurationTicks;
}

export type TravelState = {
  originLocationId: LocationId;
  destinationLocationId: LocationId;
  startedAt: Date;
  arrivesAt: Date;
};

/**
 * Resolve a travel window purely. Returns whether the character has arrived and
 * how many whole ticks were consumed so the cursor can advance exactly once.
 *
 * The `window` is the same durable lazy-resolution window used by every action.
 * A travel is consumed in whole 40-tick steps; the offline cap can advance the
 * window start past `startedAt`, so a long absence still resolves exactly one
 * arrival when the window reaches `arrivesAt`.
 */
export function resolveTravel(input: {
  travel: TravelState;
  windowStartsAt: Date;
  elapsedTicks: number;
  alreadyConsumedTicks: number;
}): { arrived: boolean; consumedTicks: number } {
  if (input.elapsedTicks <= 0) return { arrived: false, consumedTicks: 0 };

  const totalTicks = adjacentWalkDurationTicks();
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
