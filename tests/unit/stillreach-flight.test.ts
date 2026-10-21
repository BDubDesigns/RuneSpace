import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getShipFlightBalance } from "@/game/config/balance";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  PLANET_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { getFlightCinematic } from "@/game/content/flight-cinematics";
import { getLocalPlace } from "@/game/content/local-places";
import {
  getLocation,
  REPAIRED_RIVET_OVERLAY,
  STILLREACH_LANDING_STATION_SHIP_BERTHED_VARIANT_ID,
} from "@/game/content/locations";
import { getLocationMerchant } from "@/game/content/merchants";
import { getShipRoute, shipRoutesFrom } from "@/game/content/ship-routes";
import { NO_LOCATION_STATE_FACTS, resolveLocationState } from "@/game/domain/location-state";
import {
  planLaunch,
  shipFlightDurationMs,
  shipReturnFuelShortfall,
  shipReturnRoute,
  type LaunchFacts,
} from "@/game/domain/ship";
import { FlightCinematic } from "@/features/ship/FlightCinematic";
import { flightCinematicFrame, flightDurationLabel } from "@/features/ship/flight";
import { interplanetaryChartGeometry } from "@/features/ship/flight-chart";
import { readImageHeader } from "./image-header";

/**
 * Issue #375 — Stillreach Slice B: the repeatable interplanetary Rivet leg, its
 * approved art and placements, and Last Leg Trading's affiliated terminal.
 * Persistence, concurrency and the shared allowance are proven against
 * PostgreSQL in tests/integration/stillreach-flight.test.ts.
 */
const OUT = SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation;
const BACK = SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding;
const FIRST = SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding;
const WHOLE_SHIP = new Set([
  REPAIR_TARGET_IDS.cargoHold,
  REPAIR_TARGET_IDS.landingGear,
  REPAIR_TARGET_IDS.propulsionSystem,
]);

function facts(overrides: Partial<LaunchFacts> = {}): LaunchFacts {
  return {
    characterLocationId: LOCATION_IDS.holoHollowLanding,
    shipBerthLocationId: LOCATION_IDS.holoHollowLanding,
    inFlight: false,
    characterBusy: false,
    fuelUnits: 300,
    completedRepairTargetIds: WHOLE_SHIP,
    completedMissionIds: new Set([MISSION_IDS.thrustIssues, MISSION_IDS.moveAlong]),
    acceptedMissionIds: new Set([MISSION_IDS.thrustIssues, MISSION_IDS.moveAlong]),
    ...overrides,
  };
}

describe("the two authored interplanetary legs", () => {
  it("are 120 FU and exactly 260 real seconds in each direction", () => {
    for (const routeId of [OUT, BACK]) {
      expect(getShipFlightBalance(routeId)).toEqual({
        fuelCostFuelUnits: 120,
        durationSeconds: 260,
      });
      expect(shipFlightDurationMs(routeId)).toBe(260_000);
    }
    // The first flight is untouched.
    expect(shipFlightDurationMs(FIRST)).toBe(15_000);
    expect(getShipFlightBalance(FIRST).fuelCostFuelUnits).toBe(10);
  });

  it("join exactly the two landing stations, one per direction, each the other's way back", () => {
    const out = getShipRoute(OUT)!;
    const back = getShipRoute(BACK)!;
    expect([out.originLocationId, out.destinationLocationId]).toEqual([
      LOCATION_IDS.holoHollowLanding,
      LOCATION_IDS.stillreachLandingStation,
    ]);
    expect([back.originLocationId, back.destinationLocationId]).toEqual([
      LOCATION_IDS.stillreachLandingStation,
      LOCATION_IDS.holoHollowLanding,
    ]);
    expect(shipRoutesFrom(LOCATION_IDS.stillreachLandingStation)).toEqual([back]);
    expect(shipReturnRoute(out)).toBe(back);
    expect(shipReturnRoute(back)).toBe(out);
    // There is still no way back to the Crash Site.
    expect(shipReturnRoute(getShipRoute(FIRST)!)).toBeUndefined();
  });

  it("need the whole ship and a reported Thrust Issues, and no Move Along or Rune Fragment gate", () => {
    for (const routeId of [OUT, BACK]) {
      const route = getShipRoute(routeId)!;
      expect(new Set(route.requiredRepairTargetIds)).toEqual(WHOLE_SHIP);
      expect(route.requiredCompletedMissionIds).toEqual([MISSION_IDS.thrustIssues]);
      expect(route.requiredAcceptedMissionId).toBeUndefined();
    }
    expect(
      planLaunch(
        OUT,
        facts({
          acceptedMissionIds: new Set(),
          completedMissionIds: new Set([MISSION_IDS.thrustIssues]),
        }),
      ).ok,
    ).toBe(true);
    expect(planLaunch(OUT, facts({ completedMissionIds: new Set() }))).toEqual({
      ok: false,
      reason: "mission_incomplete",
    });
  });

  it("refuses 119 FU and launches at exactly 120 FU", () => {
    expect(planLaunch(OUT, facts({ fuelUnits: 119 }))).toEqual({
      ok: false,
      reason: "insufficient_fuel",
    });
    const plan = planLaunch(OUT, facts({ fuelUnits: 120 }));
    expect(plan).toMatchObject({ ok: true, fuelCostFuelUnits: 120, durationMs: 260_000 });
  });

  it("launches only from the ship's actual berth, with the character standing there", () => {
    expect(planLaunch(OUT, facts({ shipBerthLocationId: LOCATION_IDS.crashSite }))).toEqual({
      ok: false,
      reason: "ship_not_berthed_here",
    });
    expect(planLaunch(OUT, facts({ characterLocationId: LOCATION_IDS.holoHollow }))).toEqual({
      ok: false,
      reason: "not_at_berth",
    });
    // A forged return from a ship parked on Skatboll is not a route from here.
    expect(planLaunch(BACK, facts())).toEqual({ ok: false, reason: "ship_not_berthed_here" });
    expect(
      planLaunch(
        BACK,
        facts({
          characterLocationId: LOCATION_IDS.stillreachLandingStation,
          shipBerthLocationId: LOCATION_IDS.stillreachLandingStation,
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("the nonblocking return-fuel warning", () => {
  it("warns exactly when the tank would land with less than the 120 FU flight back", () => {
    const out = getShipRoute(OUT)!;
    expect(shipReturnFuelShortfall(out, 300)).toBeUndefined(); // lands with 180
    expect(shipReturnFuelShortfall(out, 240)).toBeUndefined(); // lands with 120
    expect(shipReturnFuelShortfall(out, 239)).toEqual({
      fuelAfterArrival: 119,
      returnFuelCostFuelUnits: 120,
    });
    expect(shipReturnFuelShortfall(out, 120)).toEqual({
      fuelAfterArrival: 0,
      returnFuelCostFuelUnits: 120,
    });
    // The warning never refuses the launch.
    expect(planLaunch(OUT, facts({ fuelUnits: 120 })).ok).toBe(true);
  });

  it("is never shown for the first flight, which has no way back", () => {
    expect(shipReturnFuelShortfall(getShipRoute(FIRST)!, 10)).toBeUndefined();
  });

  it("states the flight time in minutes and seconds", () => {
    expect(flightDurationLabel(260_000)).toBe("4 min 20 s");
    expect(flightDurationLabel(15_000)).toBe("15 seconds");
  });
});

describe("approved Stillreach art and Rivet placements", () => {
  it("commits the approved 15:8 master and its 1717x916 opaque runtime backdrop", () => {
    expect(
      readImageHeader("assets/location-scenes/stillreach-landing-station-cinematic-master.png"),
    ).toMatchObject({
      width: 1717,
      height: 916,
      container: "png",
    });
    const runtime = readImageHeader(
      "public/location-scenes/stillreach-landing-station-cinematic.webp",
    );
    expect(runtime).toMatchObject({ width: 1717, height: 916, container: "VP8 " });
    // Reference composites are review material, never committed art.
    expect(
      existsSync(
        "public/location-scenes/reference-stillreach-cinematic-rivet-option-B-balanced.png",
      ),
    ).toBe(false);
  });

  it("places the cinematic Rivet on Option B: 515 px wide at (680, 268) on 1717x916", () => {
    const scale = 515 / 1774;
    // The trimmed overlay's box inside the 1774x887 master.
    const crop = { left: 16, top: 43, width: 1742 };
    expect(REPAIRED_RIVET_OVERLAY.width / REPAIRED_RIVET_OVERLAY.height).toBeCloseTo(1742 / 816, 2);
    for (const backdrop of [
      getFlightCinematic(OUT)!.arrival,
      getFlightCinematic(BACK)!.departure,
    ]) {
      expect(backdrop.scene.asset).toBe(
        "/location-scenes/stillreach-landing-station-cinematic.webp",
      );
      expect([backdrop.scene.width, backdrop.scene.height]).toEqual([1717, 916]);
      const { left, top, width } = backdrop.ship.placement;
      expect(left).toBeCloseTo(((680 + crop.left * scale) / 1717) * 100, 2);
      expect(top).toBeCloseTo(((268 + crop.top * scale) / 916) * 100, 2);
      expect(width).toBeCloseTo(((crop.width * scale) / 1717) * 100, 2);
      expect(backdrop.ship.asset).toBe(REPAIRED_RIVET_OVERLAY.asset);
    }
  });

  it("reuses Holo Hollow Landing's approved pad backdrop and mark at the Skatboll end, both ways", () => {
    const first = getFlightCinematic(FIRST)!.arrival;
    for (const backdrop of [
      getFlightCinematic(OUT)!.departure,
      getFlightCinematic(BACK)!.arrival,
    ]) {
      expect(backdrop.scene.asset).toBe(first.scene.asset);
      expect(backdrop.ship.placement).toEqual(first.ship.placement);
    }
    // Never the Crash Site as an interplanetary departure.
    expect(getFlightCinematic(OUT)!.departure.scene.asset).not.toMatch(/crash-site/);
  });

  it("parks the 4:1 Rivet on Option 2 (0.205 at (585, 84) on 1536x384), only when it is berthed there", () => {
    const station = getLocation(LOCATION_IDS.stillreachLandingStation)!;
    expect(station.presentation.scene.overlay).toBeUndefined();
    const empty = resolveLocationState(station, {
      ...NO_LOCATION_STATE_FACTS,
      shipBerthLocationId: LOCATION_IDS.holoHollowLanding,
    });
    expect(empty.scene.overlay).toBeUndefined();
    expect(empty.variantId).toBeUndefined();
    const berthed = resolveLocationState(station, {
      ...NO_LOCATION_STATE_FACTS,
      shipBerthLocationId: LOCATION_IDS.stillreachLandingStation,
    });
    expect(berthed.variantId).toBe(STILLREACH_LANDING_STATION_SHIP_BERTHED_VARIANT_ID);
    expect(berthed.scene.asset).toBe(station.presentation.scene.asset);
    const { left, top, width } = berthed.scene.overlay!.placement;
    expect(left).toBeCloseTo(((585 + 16 * 0.205) / 1536) * 100, 2);
    expect(top).toBeCloseTo(((84 + 43 * 0.205) / 384) * 100, 2);
    expect(width).toBeCloseTo(((1742 * 0.205) / 1536) * 100, 2);
    expect(berthed.description).toMatch(/Rivet/);
    expect(empty.description).not.toMatch(/Rivet/);
  });
});

describe("the interplanetary cinematic", () => {
  it("charts Skatboll and Stillreach in the true direction of each leg", () => {
    expect(getFlightCinematic(OUT)!.chart).toEqual({
      kind: "interplanetary",
      originPlanetId: PLANET_IDS.skatboll,
      destinationPlanetId: PLANET_IDS.stillreach,
    });
    expect(getFlightCinematic(BACK)!.chart).toEqual({
      kind: "interplanetary",
      originPlanetId: PLANET_IDS.stillreach,
      destinationPlanetId: PLANET_IDS.skatboll,
    });
    expect(getFlightCinematic(FIRST)!.chart).toEqual({ kind: "local" });
    const out = interplanetaryChartGeometry(PLANET_IDS.skatboll, PLANET_IDS.stillreach);
    const back = interplanetaryChartGeometry(PLANET_IDS.stillreach, PLANET_IDS.skatboll);
    expect(out.origin.x).toBeLessThan(out.destination.x);
    expect(back.origin.x).toBeGreaterThan(back.destination.x);
    expect(back.origin).toEqual(out.destination);
  });

  it("spends almost all of the 260 seconds on the chart, inside the recorded flight", () => {
    const startedAt = "2026-10-21T12:00:00.000Z";
    const arrivesAt = "2026-10-21T12:04:20.000Z";
    const start = Date.parse(startedAt);
    const at = (ms: number) => flightCinematicFrame({ startedAt, arrivesAt }, start + ms);
    expect(at(0).phase).toBe("takeoff");
    expect(at(2_499).phase).toBe("takeoff");
    expect(at(2_500).phase).toBe("travel");
    expect(at(2_500).phaseDurationMs).toBe(254_500);
    expect(at(256_999).phase).toBe("travel");
    expect(at(257_000).phase).toBe("landing");
    expect(at(259_999).arrivalPending).toBe(false);
    expect(at(260_000)).toMatchObject({ phase: "landing", arrivalPending: true });
  });

  it("renders a stable empty frame on the server for either direction", () => {
    for (const [routeId, origin, destination] of [
      [OUT, LOCATION_IDS.holoHollowLanding, LOCATION_IDS.stillreachLandingStation],
      [BACK, LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.holoHollowLanding],
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(FlightCinematic, {
          flight: {
            routeId,
            originLocationId: origin,
            destinationLocationId: destination,
            startedAt: "2026-10-21T12:00:00.000Z",
            arrivesAt: "2026-10-21T12:04:20.000Z",
          },
          now: Date.parse("2026-10-21T12:01:00.000Z"),
          originName: getLocation(origin)!.displayName,
          destinationName: getLocation(destination)!.displayName,
        }),
      );
      expect(markup).toContain(`data-flight-cinematic="${routeId}"`);
    }
  });
});

describe("Last Leg Trading's Stillreach terminal", () => {
  it("is the same Last Leg Trading merchant Toll fronts, hosted by the Landing Station", () => {
    const terminal = getLocationMerchant(LOCATION_IDS.stillreachLandingStation)!;
    const counter = getLocalPlace(LOCAL_PLACE_IDS.lastLegTrading)!;
    expect(terminal.id).toBe(MERCHANT_IDS.lastLegTrading);
    expect(counter.merchantId).toBe(terminal.id);
    expect(terminal.requiredCompletedMissionId).toBe(MISSION_IDS.thrustIssues);
  });

  it("carries exactly the locked first-pass catalog and daily limits", () => {
    const terminal = getLocationMerchant(LOCATION_IDS.stillreachLandingStation)!;
    expect(terminal.prices).toEqual([
      { itemId: ITEM_IDS.fullSmallFuelCanister, buyPrice: 160, sellPrice: 225, dailySellLimit: 5 },
      { itemId: ITEM_IDS.emptySmallFuelCanister, buyPrice: 25, sellPrice: 40, dailySellLimit: 5 },
      { itemId: ITEM_IDS.oilShale, buyPrice: 6 },
    ]);
  });

  it("puts no merchant anywhere else on Stillreach", () => {
    for (const id of [
      LOCATION_IDS.windwardTrack,
      LOCATION_IDS.hilltopWorkshop,
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theLowHum,
      LOCATION_IDS.theSurveyLine,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ]) {
      expect(getLocationMerchant(id)).toBeUndefined();
    }
  });
});
