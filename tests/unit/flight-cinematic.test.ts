import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCATION_IDS, SHIP_ROUTE_IDS } from "@/game/config/foundations";
import { FLIGHT_CINEMATICS, getFlightCinematic } from "@/game/content/flight-cinematics";
import { REPAIRED_RIVET_OVERLAY } from "@/game/content/locations";
import { SHIP_ROUTES } from "@/game/content/ship-routes";
import { shipFlightDurationMs } from "@/game/domain/ship";
import { FlightCinematic } from "@/features/ship/FlightCinematic";
import {
  FLIGHT_CINEMATIC_LANDING_MS,
  FLIGHT_CINEMATIC_TAKEOFF_MS,
  flightCinematicFrame,
  flightCountdown,
} from "@/features/ship/flight";
import {
  clampChartLabelX,
  FLIGHT_CHART_VIEWBOX,
  flightChartGeometry,
  pointOnFlightChart,
} from "@/features/ship/flight-chart";
import { readImageHeader } from "./image-header";
import {
  FLIGHT_VISUALS_WAIT_MS,
  flightBackdropImageProps,
  flightCinematicImageVariants,
  flightShipImageProps,
} from "@/features/ship/flight-cinematic-images";

/**
 * Issue #359 — the Rivet's first-flight cinematic. A presentation layer over
 * #358's recorded flight: its phases are read from the flight's own instants,
 * it adds no time, and it never claims an arrival the server has not confirmed.
 */
const ROUTE = SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding;
const START = Date.parse("2026-10-16T12:00:00.000Z");
const DURATION = shipFlightDurationMs(ROUTE);
const flight = {
  routeId: ROUTE,
  originLocationId: LOCATION_IDS.crashSite,
  destinationLocationId: LOCATION_IDS.holoHollowLanding,
  startedAt: new Date(START).toISOString(),
  arrivesAt: new Date(START + DURATION).toISOString(),
};
const at = (ms: number) => flightCinematicFrame(flight, START + ms);

describe("flight cinematic phases (#359)", () => {
  it("is the authoritative 15-second first flight, unchanged", () => {
    expect(DURATION).toBe(15_000);
  });

  it("splits the recorded flight into takeoff, chart and landing at the tuning targets", () => {
    expect(FLIGHT_CINEMATIC_TAKEOFF_MS).toBe(2_500);
    expect(FLIGHT_CINEMATIC_LANDING_MS).toBe(3_000);
    expect(at(0)).toMatchObject({ phase: "takeoff", phaseElapsedMs: 0, phaseDurationMs: 2_500 });
    expect(at(2_499).phase).toBe("takeoff");
    expect(at(2_500)).toMatchObject({ phase: "travel", phaseElapsedMs: 0, travelProgress: 0 });
    expect(at(7_250)).toMatchObject({ phase: "travel", travelProgress: 0.5 });
    expect(at(11_999).phase).toBe("travel");
    expect(at(12_000)).toMatchObject({ phase: "landing", phaseElapsedMs: 0, travelProgress: 1 });
    // The three phases fill the flight exactly: the touchdown pose is reached at the
    // scheduled arrival instant, with no extra time after it.
    expect(at(14_999)).toMatchObject({ phase: "landing", arrivalPending: false });
    expect(at(15_000)).toMatchObject({
      phase: "landing",
      phaseElapsedMs: 3_000,
      phaseDurationMs: 3_000,
      arrivalPending: true,
    });
  });

  it("starts at takeoff immediately after launch even if the local clock runs behind", () => {
    expect(at(-1_500)).toMatchObject({ phase: "takeoff", phaseElapsedMs: 0 });
  });

  it("resumes the phase the flight is actually in after a reload, never restarting takeoff", () => {
    const resumed = at(9_000);
    expect(resumed.phase).toBe("travel");
    expect(resumed.phaseElapsedMs).toBe(6_500);
    expect(at(13_200)).toMatchObject({ phase: "landing", phaseElapsedMs: 1_200 });
  });

  it("holds the settled touchdown as arrival pending past the instant, however long", () => {
    for (const late of [15_001, 60_000, 3 * 60 * 60 * 1_000]) {
      expect(at(late)).toMatchObject({
        phase: "landing",
        phaseElapsedMs: 3_000,
        arrivalPending: true,
      });
      expect(flightCountdown(flight, START + late)).toEqual({
        remainingSeconds: 0,
        arrivalPending: true,
      });
    }
  });

  it("scales the visual phases down for a shorter flight instead of overrunning it", () => {
    const short = { startedAt: flight.startedAt, arrivesAt: new Date(START + 6_000).toISOString() };
    expect(flightCinematicFrame(short, START).phaseDurationMs).toBe(1_000);
    expect(flightCinematicFrame(short, START + 5_000)).toMatchObject({
      phase: "landing",
      phaseDurationMs: 1_200,
    });
  });
});

describe("flight cinematic art (#359)", () => {
  it("authors a cinematic for every flight route", () => {
    for (const route of SHIP_ROUTES) expect(getFlightCinematic(route.id)).toBeDefined();
    expect(Object.keys(FLIGHT_CINEMATICS)).toEqual(SHIP_ROUTES.map((route) => route.id));
    expect(getFlightCinematic("not_a_route")).toBeUndefined();
  });

  it("uses the two approved 15:8 shipless backdrops at their delivered size, not a 4:1 pano", () => {
    const { departure, arrival } = getFlightCinematic(ROUTE)!;
    expect(departure.scene.asset).toBe("/location-scenes/crash-site-departure.webp");
    expect(arrival.scene.asset).toBe("/location-scenes/holo-hollow-landing-arrival.webp");
    for (const { scene } of [departure, arrival]) {
      expect(readImageHeader(`public${scene.asset}`)).toEqual({
        width: 1717,
        height: 916,
        container: "VP8 ",
      });
      expect({ width: scene.width, height: scene.height }).toEqual({ width: 1717, height: 916 });
      expect(Math.abs(scene.width / scene.height - 15 / 8)).toBeLessThan(0.01);
      // The ship is a separate layer, never part of the backdrop.
      expect(scene.overlay).toBeUndefined();
      expect(scene.alt.length).toBeGreaterThan(40);
    }
  });

  it("keeps the unaltered masters beside the other location-scene masters", () => {
    for (const name of ["crash-site-departure", "holo-hollow-landing-arrival"]) {
      expect(readImageHeader(`assets/location-scenes/${name}-master.png`)).toMatchObject({
        width: 1717,
        height: 916,
        container: "png",
      });
    }
  });

  it("composites the one canonical repaired Rivet, inside each backdrop's canvas", () => {
    for (const { ship } of [
      getFlightCinematic(ROUTE)!.departure,
      getFlightCinematic(ROUTE)!.arrival,
    ]) {
      expect(ship.asset).toBe(REPAIRED_RIVET_OVERLAY.asset);
      expect({ width: ship.width, height: ship.height }).toEqual({
        width: REPAIRED_RIVET_OVERLAY.width,
        height: REPAIRED_RIVET_OVERLAY.height,
      });
      expect(existsSync(`public${ship.asset}`)).toBe(true);
      const { left, top, width } = ship.placement;
      const heightPercent = (width * (1717 / 916) * ship.height) / ship.width;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(100);
      // Wheels on the ground about four-fifths of the way down, inside the frame.
      expect(top + heightPercent).toBeGreaterThan(75);
      expect(top + heightPercent).toBeLessThan(90);
    }
  });
});

describe("flight cinematic image warm-up (#359 playtest)", () => {
  const content = getFlightCinematic(ROUTE)!;

  it("warms exactly the optimized variants the frame renders, never a source or master", () => {
    const variants = flightCinematicImageVariants(content);
    // Departure and arrival backdrops, the ship overlay (one URL set for both
    // backdrops' widths when equal, otherwise two), and the chart miniature.
    expect(variants.length).toBeGreaterThanOrEqual(4);
    for (const variant of variants) {
      expect(variant.src).toMatch(/^\/_next\/image\?url=%2Flocation-scenes%2F/);
      expect(variant.src).not.toContain("master");
    }
    const sources = variants.map((variant) => decodeURIComponent(variant.src));
    expect(sources.some((src) => src.includes("crash-site-departure.webp"))).toBe(true);
    expect(sources.some((src) => src.includes("holo-hollow-landing-arrival.webp"))).toBe(true);
    expect(sources.some((src) => src.includes("rivet-repaired.webp"))).toBe(true);
    expect(variants).toContainEqual(flightBackdropImageProps(content.departure));
    expect(variants).toContainEqual(flightShipImageProps(content.departure));
    // Responsive backdrops carry the frame's own srcset and sizes.
    expect(flightBackdropImageProps(content.departure)).toMatchObject({
      sizes: "(max-width: 640px) 100vw, 56rem",
      srcSet: expect.stringContaining("w,"),
    });
  });

  it("never holds a launch for long: the wait is capped", () => {
    expect(FLIGHT_VISUALS_WAIT_MS).toBeLessThanOrEqual(6_000);
  });
});

describe("flight chart (#359)", () => {
  const geometry = flightChartGeometry(LOCATION_IDS.crashSite, LOCATION_IDS.holoHollowLanding);

  it("draws the leg in the same direction as the Local Map: the Landing is east of the Crash Site", () => {
    expect(geometry.destination.x).toBeGreaterThan(geometry.origin.x);
    for (const point of [geometry.origin, geometry.destination]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(FLIGHT_CHART_VIEWBOX.width);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(FLIGHT_CHART_VIEWBOX.height);
    }
  });

  it("flies the marker from the origin to the destination along the arc", () => {
    const start = pointOnFlightChart(geometry, 0);
    const end = pointOnFlightChart(geometry, 1);
    expect(start.x).toBeCloseTo(geometry.origin.x);
    expect(start.y).toBeCloseTo(geometry.origin.y);
    expect(end.x).toBeCloseTo(geometry.destination.x);
    expect(end.y).toBeCloseTo(geometry.destination.y);
    expect(pointOnFlightChart(geometry, -1)).toEqual(start);
    expect(pointOnFlightChart(geometry, 2)).toEqual(end);
    // Heading east throughout.
    for (const t of [0, 0.5, 1]) {
      expect(Math.abs(pointOnFlightChart(geometry, t).headingDegrees)).toBeLessThan(90);
    }
  });

  it("keeps a long label on the chart", () => {
    const label = "HOLO HOLLOW LANDING";
    const x = clampChartLabelX(geometry.destination.x, label, 18);
    const half = (label.length * 18 * 0.62) / 2;
    expect(x + half).toBeLessThanOrEqual(FLIGHT_CHART_VIEWBOX.width);
    expect(x - half).toBeGreaterThanOrEqual(0);
  });
});

describe("FlightCinematic server markup (#359)", () => {
  it("renders a stable empty 15:8 frame before the browser clock is known", () => {
    const html = renderToStaticMarkup(
      createElement(FlightCinematic, {
        flight,
        now: START + 9_000,
        originName: "Crash Site",
        destinationName: "Holo Hollow Landing",
      }),
    );
    expect(html).toContain("aspect-[15/8]");
    expect(html).toContain(`data-flight-cinematic="${ROUTE}"`);
    // No phase or art until mounted, so server and client markup cannot disagree.
    expect(html).not.toContain("data-flight-phase");
    expect(html).not.toContain("<img");
    expect(html).toContain("En route · Holo Hollow Landing");
    expect(html).toContain("6s to touchdown");
  });

  it("renders nothing for a route with no authored cinematic", () => {
    const html = renderToStaticMarkup(
      createElement(FlightCinematic, {
        flight: { ...flight, routeId: "not_a_route" },
        now: START,
        originName: "Crash Site",
        destinationName: "Holo Hollow Landing",
      }),
    );
    expect(html).toBe("");
  });
});
