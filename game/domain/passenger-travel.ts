import { getEffectiveGameBalance } from "@/game/config/balance";
import { SHIP_ROUTE_IDS } from "@/game/config/foundations";
import { PASSENGER_KIOSK_COPY } from "@/game/content/passenger-kiosk";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getPassengerRoute, passengerRouteFrom } from "@/game/content/passenger-routes";
import type { PassengerRouteDefinition } from "@/game/content/passenger-routes";

/**
 * Pure Milky Waymo passenger rules (#404). Server-authoritative: the kiosk
 * renders these results and never decides them.
 *
 * A passenger journey is a service the character buys, not a flight they pilot:
 * it moves the character, their carried Inventory and their equipment, and
 * nothing else. There is no fuel, no ship and no cargo anywhere in these rules.
 */

/** One ticket's fare in Credits: the same in both directions, from balance. */
export function passengerFareCredits(): number {
  return getEffectiveGameBalance().passengerTravel.fareCredits;
}

/** One journey's duration in milliseconds, from the approved real seconds. */
export function passengerJourneyDurationMs(): number {
  return getEffectiveGameBalance().passengerTravel.durationSeconds * 1_000;
}

/**
 * The Rivet leg whose arrival unlocks the service: the character's first
 * flight into Stillreach on their own ship. The unlock is derived from the
 * durable landing receipt that flight wrote, never from a second flag.
 */
export const PASSENGER_UNLOCK_SHIP_ROUTE_ID =
  SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation;

export type PassengerRefusalReason =
  | "not_at_check_in"
  | "service_locked"
  | "busy"
  | "insufficient_credits";

export type PassengerBookingPlan =
  | { ok: false; reason: PassengerRefusalReason }
  | { ok: true; route: PassengerRouteDefinition; fareCredits: number; durationMs: number };

/**
 * Whether a ticket may be bought now. `localPlaceId` is only ever the check-in
 * the browser says it is standing at; it is honoured only when it is genuinely
 * the Milky Waymo place of the character's own, authoritative, current location.
 * Order matters: where you are, then whether the service is yours, then whether
 * you are free, then whether you can pay.
 */
export function planPassengerBooking(input: {
  currentLocationId: string;
  localPlaceId: string;
  unlocked: boolean;
  /** The character has an active action, a walk, a flight or a journey of any kind. */
  busy: boolean;
  credits: number;
}): PassengerBookingPlan {
  const place = getLocalPlaceInLocation(input.currentLocationId, input.localPlaceId);
  const route = passengerRouteFrom(input.currentLocationId);
  if (!place?.passengerCheckIn || !route || route.checkInLocalPlaceId !== place.id) {
    return { ok: false, reason: "not_at_check_in" };
  }
  if (!input.unlocked) return { ok: false, reason: "service_locked" };
  if (input.busy) return { ok: false, reason: "busy" };
  const fareCredits = passengerFareCredits();
  if (input.credits < fareCredits) return { ok: false, reason: "insufficient_credits" };
  return { ok: true, route, fareCredits, durationMs: passengerJourneyDurationMs() };
}

const REFUSAL_MESSAGES: Record<PassengerRefusalReason, string> = {
  not_at_check_in: "Passage can only be booked at a Milky Waymo check-in.",
  service_locked: PASSENGER_KIOSK_COPY.locked.quote,
  busy: "Finish what you are doing before booking passage.",
  insufficient_credits: PASSENGER_KIOSK_COPY.insufficient.quote,
};

export function passengerRefusalMessage(reason: PassengerRefusalReason): string {
  return REFUSAL_MESSAGES[reason];
}

/**
 * Whether a persisted journey's route is still one the content registry knows,
 * from the origin it was booked at. Landing only commits for a route that is.
 */
export function isPassengerJourneyValid(journey: {
  routeId: string;
  originLocationId: string;
  destinationLocationId: string;
}): boolean {
  const route = getPassengerRoute(journey.routeId);
  return (
    route !== undefined &&
    route.originLocationId === journey.originLocationId &&
    route.destinationLocationId === journey.destinationLocationId
  );
}
