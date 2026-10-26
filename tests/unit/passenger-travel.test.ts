import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  PASSENGER_ROUTE_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { getLocalPlace } from "@/game/content/local-places";
import { PASSENGER_KIOSK_COPY } from "@/game/content/passenger-kiosk";
import {
  getPassengerRoute,
  PASSENGER_ROUTES,
  passengerRouteFrom,
} from "@/game/content/passenger-routes";
import {
  isPassengerJourneyValid,
  PASSENGER_UNLOCK_SHIP_ROUTE_ID,
  passengerFareCredits,
  passengerJourneyDurationMs,
  passengerRefusalMessage,
  planPassengerBooking,
} from "@/game/domain/passenger-travel";

/**
 * Issue #404 — Milky Waymo's route, fare, duration and unlock rules. Pure and
 * server-authoritative: the kiosk renders these, the command re-runs them.
 */
const HOLO = LOCATION_IDS.holoHollowLanding;
const STILLREACH = LOCATION_IDS.stillreachLandingStation;
const base = {
  currentLocationId: HOLO,
  localPlaceId: LOCAL_PLACE_IDS.milkyWaymoHoloHollowLanding,
  unlocked: true,
  busy: false,
  credits: 200,
};

describe("fare and duration", () => {
  it("is 200 CR and 180 seconds, one way, in both directions", () => {
    expect(passengerFareCredits()).toBe(200);
    expect(passengerJourneyDurationMs()).toBe(180_000);
    expect(getEffectiveGameBalance().passengerTravel).toEqual({
      actionId: ACTION_IDS.passengerTravel,
      fareCredits: 200,
      durationSeconds: 180,
    });
    for (const route of PASSENGER_ROUTES) {
      const plan = planPassengerBooking({
        ...base,
        currentLocationId: route.originLocationId,
        localPlaceId: route.checkInLocalPlaceId,
      });
      expect(plan).toMatchObject({ ok: true, fareCredits: 200, durationMs: 180_000 });
    }
  });
});

describe("routes", () => {
  it("are exactly the two directions between the landing hubs", () => {
    expect(
      PASSENGER_ROUTES.map((route) => [route.originLocationId, route.destinationLocationId]),
    ).toEqual([
      [HOLO, STILLREACH],
      [STILLREACH, HOLO],
    ]);
    expect(passengerRouteFrom(HOLO)?.id).toBe(
      PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
    );
    expect(passengerRouteFrom(STILLREACH)?.id).toBe(
      PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
    );
    expect(passengerRouteFrom(LOCATION_IDS.holoHollow)).toBeUndefined();
    expect(passengerRouteFrom("nowhere")).toBeUndefined();
    expect(getPassengerRoute("nope")).toBeUndefined();
  });

  it("are a separate service from the Rivet's routes, never sharing an ID", () => {
    const shipRouteIds = new Set<string>(Object.values(SHIP_ROUTE_IDS));
    for (const route of PASSENGER_ROUTES) {
      expect(shipRouteIds.has(route.id)).toBe(false);
      // ...though each flies the same leg its Rivet counterpart does.
      expect(shipRouteIds.has(route.cinematicRouteId)).toBe(true);
    }
  });

  it("each begin at the check-in Local Place of their own hub, which flags itself as one", () => {
    for (const route of PASSENGER_ROUTES) {
      const place = getLocalPlace(route.checkInLocalPlaceId)!;
      expect(place.parentLocationId).toBe(route.originLocationId);
      expect(place.passengerCheckIn).toBe(true);
      expect(place.access).toEqual({ kind: "open" });
      expect(place.merchantId).toBeUndefined();
    }
  });

  it("validates a persisted journey against its authored route", () => {
    const route = PASSENGER_ROUTES[0]!;
    const journey = {
      routeId: route.id,
      originLocationId: route.originLocationId,
      destinationLocationId: route.destinationLocationId,
    };
    expect(isPassengerJourneyValid(journey)).toBe(true);
    expect(isPassengerJourneyValid({ ...journey, routeId: "forged" })).toBe(false);
    expect(isPassengerJourneyValid({ ...journey, destinationLocationId: HOLO })).toBe(false);
    expect(isPassengerJourneyValid({ ...journey, originLocationId: STILLREACH })).toBe(false);
  });
});

describe("planning a booking", () => {
  it("is unlocked by a Rivet arrival at Stillreach, not by anything else", () => {
    expect(PASSENGER_UNLOCK_SHIP_ROUTE_ID).toBe(
      SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
    );
    expect(planPassengerBooking({ ...base, unlocked: false })).toEqual({
      ok: false,
      reason: "service_locked",
    });
    expect(planPassengerBooking(base)).toMatchObject({ ok: true });
  });

  it("refuses the wrong place before anything else, including a desk at the other hub", () => {
    for (const localPlaceId of [
      LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation,
      LOCAL_PLACE_IDS.lastLegTrading,
      LOCAL_PLACE_IDS.fedhexHoloHollowLanding,
      "",
      "forged",
    ]) {
      expect(
        planPassengerBooking({ ...base, localPlaceId, unlocked: false, busy: true, credits: 0 }),
      ).toEqual({ ok: false, reason: "not_at_check_in" });
    }
    expect(planPassengerBooking({ ...base, currentLocationId: LOCATION_IDS.holoHollow })).toEqual({
      ok: false,
      reason: "not_at_check_in",
    });
  });

  it("refuses in a fixed order: locked, then busy, then too poor", () => {
    expect(planPassengerBooking({ ...base, unlocked: false, busy: true, credits: 0 })).toEqual({
      ok: false,
      reason: "service_locked",
    });
    expect(planPassengerBooking({ ...base, busy: true, credits: 0 })).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(planPassengerBooking({ ...base, credits: 199 })).toEqual({
      ok: false,
      reason: "insufficient_credits",
    });
  });

  it("allows exactly the fare and anything above it", () => {
    expect(planPassengerBooking({ ...base, credits: 200 })).toMatchObject({ ok: true });
    expect(planPassengerBooking({ ...base, credits: 10_000_000 })).toMatchObject({ ok: true });
  });

  it("books the opposite route from the other hub", () => {
    const plan = planPassengerBooking({
      ...base,
      currentLocationId: STILLREACH,
      localPlaceId: LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation,
    });
    expect(plan).toMatchObject({
      ok: true,
      route: { destinationLocationId: HOLO, originLocationId: STILLREACH },
    });
  });
});

describe("refusal copy", () => {
  it("is the approved kiosk copy, so the server and the screen cannot disagree", () => {
    expect(passengerRefusalMessage("insufficient_credits")).toBe(
      PASSENGER_KIOSK_COPY.insufficient.quote,
    );
    expect(passengerRefusalMessage("service_locked")).toBe(PASSENGER_KIOSK_COPY.locked.quote);
    expect(PASSENGER_KIOSK_COPY.insufficient.quote).toBe(
      "Unfortunately, your available balance is insufficient. Please come back when you have rectified your financial troubles.",
    );
    expect(PASSENGER_KIOSK_COPY.locked.quote).toBe(
      "Milky Waymo looks forward to serving you! Passenger service becomes available after your first successful interplanetary flight aboard your own ship.",
    );
    expect(passengerRefusalMessage("busy")).toMatch(/finish what you are doing/i);
    expect(passengerRefusalMessage("not_at_check_in")).toMatch(/check-in/i);
  });
});
