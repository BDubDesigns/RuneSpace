import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShipFlightControls } from "@/features/ship/ShipFlightControls";
import { chartPlanetAnchor, INTERPLANETARY_CHART_PLANETS } from "@/features/ship/flight-chart";
import {
  defaultStarChartRouteId,
  isInterplanetaryRoute,
  resolveStarChartRoute,
  routeForPlanetSelection,
  STAR_CHART_PLANETS,
  STAR_CHART_VIEWBOX,
  starChartColumn,
  starChartModel,
  type ShipRouteProjection,
} from "@/features/ship/star-chart";
import { LOCATION_IDS, PLANET_IDS, SHIP_ROUTE_IDS } from "@/game/config/foundations";
import { getPlanetPresentation } from "@/game/content/planets";
import type { ShipProjection } from "@/server/ship-state";
import { EMPTY_SHIP_PROJECTION } from "./ship-projection-fixture";

const play = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({
    state: play.state,
    foregroundBusy: false,
    enqueueForeground: () => undefined,
    releaseCommand: () => undefined,
    acceptState: () => undefined,
  }),
}));
vi.mock("@/server/actions", () => ({ launchShipAction: vi.fn() }));

const FIRST_FLIGHT: ShipRouteProjection = {
  routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
  destinationLocationId: LOCATION_IDS.holoHollowLanding,
  destinationName: "Holo Hollow Landing",
  fuelCostFuelUnits: 10,
  durationMs: 15_000,
  launchNotice: "Launching permanently moves your ship from the Crash Site to Holo Hollow Landing.",
};

const OUTBOUND: ShipRouteProjection = {
  routeId: SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
  destinationLocationId: LOCATION_IDS.stillreachLandingStation,
  destinationName: "Stillreach Landing Station",
  fuelCostFuelUnits: 120,
  durationMs: 260_000,
  launchNotice: "Launching flies you, the Rivet and everything in its Cargo Hold to Stillreach.",
};

const HOMEWARD: ShipRouteProjection = {
  routeId: SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
  destinationLocationId: LOCATION_IDS.holoHollowLanding,
  destinationName: "Holo Hollow Landing",
  fuelCostFuelUnits: 120,
  durationMs: 260_000,
  launchNotice: "Launching flies you, the Rivet and everything in its Cargo Hold back to Skatboll.",
};

const FUEL_REFUSAL = {
  reason: "insufficient_fuel" as const,
  message: "The Rivet needs at least 120 FU for this flight.",
};

const atLanding = (routes: ShipRouteProjection[], fuelUnits = 200) => ({
  ...EMPTY_SHIP_PROJECTION,
  berthLocationId: LOCATION_IDS.holoHollowLanding,
  berthName: "Holo Hollow Landing",
  fuelUnits,
  routes,
});

function renderControls(ship: ShipProjection) {
  play.state = {
    characterId: "00000000-0000-4000-8000-000000000001",
    location: { currentLocationId: ship.berthLocationId },
    ship,
  };
  return renderToStaticMarkup(React.createElement(ShipFlightControls));
}

describe("star chart model", () => {
  it("charts only flights to another world; the first flight is a hop on Skatboll", () => {
    expect(isInterplanetaryRoute(LOCATION_IDS.crashSite, FIRST_FLIGHT)).toBe(false);
    expect(isInterplanetaryRoute(LOCATION_IDS.holoHollowLanding, OUTBOUND)).toBe(true);
    expect(isInterplanetaryRoute(LOCATION_IDS.stillreachLandingStation, HOMEWARD)).toBe(true);
    expect(
      starChartModel({ berthLocationId: LOCATION_IDS.crashSite, routes: [FIRST_FLIGHT] }),
    ).toBeUndefined();
    expect(
      starChartModel({ berthLocationId: LOCATION_IDS.holoHollowLanding, routes: [] }),
    ).toBeUndefined();
  });

  it("shows the berth's world as the origin and only the worlds a projected route reaches", () => {
    const outbound = starChartModel(atLanding([OUTBOUND]))!;
    expect(outbound.originPlanetId).toBe(PLANET_IDS.skatboll);
    expect(outbound.destinations.map((destination) => destination.planetId)).toEqual([
      PLANET_IDS.stillreach,
    ]);
    // The reverse leg: Stillreach is the origin and Skatboll the one choice.
    const home = starChartModel({
      berthLocationId: LOCATION_IDS.stillreachLandingStation,
      routes: [HOMEWARD],
    })!;
    expect(home.originPlanetId).toBe(PLANET_IDS.stillreach);
    expect(home.destinations.map((destination) => destination.planetId)).toEqual([
      PLANET_IDS.skatboll,
    ]);
  });

  it("marks a world unavailable only when every route to it is refused by the server", () => {
    const blocked = starChartModel(atLanding([{ ...OUTBOUND, launchRefusal: FUEL_REFUSAL }]))!;
    expect(blocked.destinations[0]!.available).toBe(false);
    expect(starChartModel(atLanding([OUTBOUND]))!.destinations[0]!.available).toBe(true);
  });
});

describe("star chart selection", () => {
  const second: ShipRouteProjection = {
    ...OUTBOUND,
    routeId: "hypothetical_second_station",
    destinationLocationId: LOCATION_IDS.windwardTrack,
    destinationName: "Windward Track",
  };

  it("preselects the sole launchable route, and nothing among several", () => {
    expect(defaultStarChartRouteId(starChartModel(atLanding([OUTBOUND]))!)).toBe(OUTBOUND.routeId);
    expect(defaultStarChartRouteId(starChartModel(atLanding([OUTBOUND, second]))!)).toBeUndefined();
    // One launchable among a refused one is still the only choice.
    expect(
      defaultStarChartRouteId(
        starChartModel(atLanding([{ ...OUTBOUND, launchRefusal: FUEL_REFUSAL }, second]))!,
      ),
    ).toBe(second.routeId);
  });

  it("shows a single refused route so its reason is on screen, but never picks among refused ones", () => {
    const refused = { ...OUTBOUND, launchRefusal: FUEL_REFUSAL };
    expect(defaultStarChartRouteId(starChartModel(atLanding([refused]))!)).toBe(OUTBOUND.routeId);
    expect(
      defaultStarChartRouteId(
        starChartModel(atLanding([refused, { ...second, launchRefusal: FUEL_REFUSAL }]))!,
      ),
    ).toBeUndefined();
  });

  it("acts only on a route the server projects from this berth", () => {
    const model = starChartModel(atLanding([OUTBOUND, second]))!;
    expect(resolveStarChartRoute(model, second.routeId)?.routeId).toBe(second.routeId);
    expect(resolveStarChartRoute(model, undefined)).toBeUndefined();
    // A choice left over from the other berth is never launched.
    expect(resolveStarChartRoute(model, HOMEWARD.routeId)).toBeUndefined();
    const single = starChartModel(atLanding([OUTBOUND]))!;
    expect(resolveStarChartRoute(single, HOMEWARD.routeId)?.routeId).toBe(OUTBOUND.routeId);
  });

  it("a tap on a world keeps its current route, else its first launchable one", () => {
    const model = starChartModel(
      atLanding([{ ...OUTBOUND, launchRefusal: FUEL_REFUSAL }, second]),
    )!;
    const stillreach = model.destinations[0]!;
    expect(stillreach.routes).toHaveLength(2);
    expect(routeForPlanetSelection(stillreach, undefined)).toBe(second.routeId);
    expect(routeForPlanetSelection(stillreach, OUTBOUND.routeId)).toBe(OUTBOUND.routeId);
  });
});

describe("star chart layout", () => {
  it("keeps the cinematic chart's left-to-right placement for every authored world", () => {
    for (const planetId of Object.values(PLANET_IDS)) {
      expect(STAR_CHART_PLANETS[planetId].center.x).toBe(
        INTERPLANETARY_CHART_PLANETS[planetId].center.x,
      );
      expect(STAR_CHART_PLANETS[planetId].center.y).toBe(STAR_CHART_VIEWBOX.height / 2);
    }
    expect(STAR_CHART_PLANETS.skatboll.center.x).toBeLessThan(
      STAR_CHART_PLANETS.stillreach.center.x,
    );
  });

  it("resolves station anchors from the authored presentation at the chart's own scale", () => {
    for (const planetId of Object.values(PLANET_IDS)) {
      const { center, radius } = STAR_CHART_PLANETS[planetId];
      const anchor = getPlanetPresentation(planetId).flightAnchor;
      expect(chartPlanetAnchor(planetId, STAR_CHART_PLANETS)).toEqual({
        x: center.x + anchor.x * radius,
        y: center.y + anchor.y * radius,
      });
    }
  });

  it("keeps each world's label column inside the chart, and the columns apart", () => {
    const columns = Object.values(PLANET_IDS).map((planetId) => starChartColumn(planetId));
    for (const column of columns) {
      expect(column.leftPercent).toBeGreaterThanOrEqual(0);
      expect(column.leftPercent + column.widthPercent).toBeLessThanOrEqual(100);
    }
    const [skatboll, stillreach] = columns;
    expect(skatboll!.leftPercent + skatboll!.widthPercent).toBeLessThanOrEqual(
      stillreach!.leftPercent,
    );
  });
});

describe("ShipFlightControls star chart", () => {
  it("leaves the first flight's launch card exactly as it was, with no chart", () => {
    const markup = renderControls({
      ...EMPTY_SHIP_PROJECTION,
      fuelUnits: 40,
      routes: [FIRST_FLIGHT],
    });
    expect(markup).not.toContain("data-star-chart");
    expect(markup).toContain(`data-ship-route="${FIRST_FLIGHT.routeId}"`);
    expect(markup).toContain("Tank after arrival");
    expect(markup.match(/LAUNCH/g)).toHaveLength(1);
  });

  it("at Holo Hollow Landing: Skatboll here, Stillreach preselected, readout and one LAUNCH", () => {
    const markup = renderControls(
      atLanding([
        {
          ...OUTBOUND,
          returnFuelWarning: { fuelAfterArrival: 80, returnFuelCostFuelUnits: 120 },
        },
      ]),
    );
    expect(markup).toContain('data-star-chart-origin="skatboll"');
    expect(markup).toMatch(/data-star-chart-planet="skatboll" data-state="origin"/);
    expect(markup).toContain("You are here");
    // Both worlds drawn by the shared renderer: Skatboll's ring, Stillreach's halo.
    expect(markup).toContain('data-planet-body="skatboll"');
    expect(markup).toContain('data-planet-body="stillreach"');
    expect(markup).toContain("data-planet-ring");
    expect(markup).toContain("data-planet-halo");
    // The origin is never a button; the destination is, pressed by default.
    expect(markup).not.toContain('data-star-chart-destination="skatboll"');
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*data-selected="" data-star-chart-destination="stillreach" data-state="available"/,
    );
    expect(markup).toContain(
      'data-selected="" data-star-chart-route="stillreach" data-state="available"',
    );
    expect(markup).toContain('data-star-chart-reticle="stillreach"');
    expect(markup).toContain(`data-ship-route="${OUTBOUND.routeId}"`);
    expect(markup).toContain("120 FU");
    expect(markup).toContain("4 min 20 s");
    expect(markup).toContain("200 / 300 FU");
    expect(markup).toContain("80 / 300 FU");
    expect(markup).toContain("data-ship-return-fuel-warning");
    expect(markup.match(/>LAUNCH</g)).toHaveLength(1);
    expect(markup).toContain(`data-ship-launch="${OUTBOUND.routeId}"`);
    expect(markup).not.toMatch(/data-ship-launch="[^"]*"[^>]*disabled=""/);
    expect(markup).not.toContain("data-star-chart-prompt");
  });

  it("at Stillreach: the reverse leg, Stillreach here and Skatboll the destination", () => {
    const markup = renderControls({
      ...EMPTY_SHIP_PROJECTION,
      berthLocationId: LOCATION_IDS.stillreachLandingStation,
      berthName: "Stillreach Landing Station",
      fuelUnits: 120,
      routes: [HOMEWARD],
    });
    expect(markup).toContain('data-star-chart-origin="stillreach"');
    expect(markup).toContain(
      'data-selected="" data-star-chart-destination="skatboll" data-state="available"',
    );
    expect(markup).toContain(`data-ship-launch="${HOMEWARD.routeId}"`);
    expect(markup).toContain("0 / 300 FU");
  });

  it("dims a refused world, keeps it readable, and disables LAUNCH with the server's reason", () => {
    const markup = renderControls(atLanding([{ ...OUTBOUND, launchRefusal: FUEL_REFUSAL }], 40));
    expect(markup).toContain('data-star-chart-status="unavailable"');
    expect(markup).toContain('class="rs-star-chart__dimmed" data-star-chart-world="stillreach"');
    expect(markup).toContain(
      'data-selected="" data-star-chart-route="stillreach" data-state="unavailable"',
    );
    expect(markup).toMatch(/data-ship-launch="[^"]*"[^>]*disabled=""/);
    expect(markup).toContain(`data-ship-launch-guidance="insufficient_fuel"`);
    expect(markup).toContain(FUEL_REFUSAL.message);
  });

  it("asks for a choice when several routes could launch, with no LAUNCH until one is chosen", () => {
    const markup = renderControls(
      atLanding([
        OUTBOUND,
        {
          ...OUTBOUND,
          routeId: "hypothetical_second_station",
          destinationLocationId: LOCATION_IDS.windwardTrack,
          destinationName: "Windward Track",
        },
      ]),
    );
    expect(markup).toContain("data-star-chart-prompt");
    expect(markup).not.toContain("LAUNCH");
    expect(markup).toContain('data-star-chart-destination="stillreach" data-state="available"');
  });
});
