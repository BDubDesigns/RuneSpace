import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLANET_IDS } from "@/game/config/foundations";
import {
  getPlanetPresentation,
  PLANET_PRESENTATIONS,
  planetHorizontalReach,
} from "@/game/content/planets";
import { PlanetBody } from "@/features/ship/PlanetBody";
import {
  chartPlanetLabelReach,
  chartPlanetReach,
  clampChartLabelX,
  FLIGHT_CHART_VIEWBOX,
  INTERPLANETARY_CHART_PLANETS,
  interplanetaryChartGeometry,
  pointOnFlightChart,
} from "@/features/ship/flight-chart";

/**
 * Issue #375 playtest — each planet's authored appearance, rendered generically
 * from data, and the interplanetary chart laid out around it.
 */
const render = (planetId: (typeof PLANET_IDS)[keyof typeof PLANET_IDS]) =>
  renderToStaticMarkup(
    createElement("svg", null, createElement(PlanetBody, { planetId, cx: 100, cy: 100, r: 40 })),
  );

describe("authored planet presentations", () => {
  it("authors every planet exactly once", () => {
    expect(Object.keys(PLANET_PRESENTATIONS).sort()).toEqual(Object.values(PLANET_IDS).sort());
  });

  it("gives Skatboll a thin tilted ring and banding, and no halo", () => {
    const skatboll = getPlanetPresentation(PLANET_IDS.skatboll);
    expect(skatboll.displayName).toBe("Skatboll");
    expect(skatboll.ring).toBeDefined();
    expect(skatboll.ring!.tiltDegrees).not.toBe(0);
    expect(skatboll.ring!.width).toBeLessThan(0.1);
    expect(skatboll.banding?.bands.length).toBeGreaterThan(0);
    expect(skatboll.halo).toBeUndefined();
  });

  it("gives Stillreach a luminous halo, and no ring", () => {
    const stillreach = getPlanetPresentation(PLANET_IDS.stillreach);
    expect(stillreach.displayName).toBe("Stillreach");
    expect(stillreach.halo).toBeDefined();
    expect(stillreach.halo!.reach).toBeGreaterThan(1);
    expect(stillreach.ring).toBeUndefined();
  });

  it("measures how far each drawing reaches, ring or halo included", () => {
    expect(planetHorizontalReach(getPlanetPresentation(PLANET_IDS.skatboll))).toBeGreaterThan(1.5);
    expect(planetHorizontalReach(getPlanetPresentation(PLANET_IDS.stillreach))).toBe(
      getPlanetPresentation(PLANET_IDS.stillreach).halo!.reach,
    );
  });
});

describe("PlanetBody renders only what the data authors", () => {
  it("draws Skatboll's ring behind and in front of the body, its bands, and no halo", () => {
    const markup = render(PLANET_IDS.skatboll);
    expect(markup).toContain('data-planet-body="skatboll"');
    expect(markup).toContain('data-planet-ring="far"');
    expect(markup).toContain('data-planet-ring="near"');
    // Far half first, body, then near half: the ring circles the planet.
    expect(markup.indexOf('data-planet-ring="far"')).toBeLessThan(
      markup.indexOf("data-planet-surface"),
    );
    expect(markup.indexOf("data-planet-surface")).toBeLessThan(
      markup.indexOf('data-planet-ring="near"'),
    );
    expect(markup).toContain("data-planet-banding");
    expect(markup).not.toContain("data-planet-halo");
    expect(markup).toContain(getPlanetPresentation(PLANET_IDS.skatboll).palette.surface);
  });

  it("draws Stillreach's halo beneath the body, and no ring", () => {
    const markup = render(PLANET_IDS.stillreach);
    expect(markup).toContain('data-planet-body="stillreach"');
    expect(markup).toContain("data-planet-halo");
    expect(markup.indexOf("data-planet-halo")).toBeLessThan(markup.indexOf("data-planet-surface"));
    expect(markup).not.toContain("data-planet-ring");
    expect(markup).toContain(getPlanetPresentation(PLANET_IDS.stillreach).palette.surface);
  });

  it("keeps gradient references valid: no colons in generated IDs", () => {
    for (const planetId of Object.values(PLANET_IDS)) {
      const ids = [...render(planetId).matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});

describe("the interplanetary chart around the drawn worlds", () => {
  it("starts and ends the route clear of each world's ring or halo, in both directions", () => {
    for (const [from, to] of [
      [PLANET_IDS.skatboll, PLANET_IDS.stillreach],
      [PLANET_IDS.stillreach, PLANET_IDS.skatboll],
    ] as const) {
      const geometry = interplanetaryChartGeometry(from, to);
      const origin = INTERPLANETARY_CHART_PLANETS[from].center;
      const destination = INTERPLANETARY_CHART_PLANETS[to].center;
      expect(Math.abs(geometry.origin.x - origin.x)).toBeGreaterThan(chartPlanetReach(from).x);
      expect(Math.abs(geometry.destination.x - destination.x)).toBeGreaterThan(
        chartPlanetReach(to).x,
      );
      // The marker moves toward the destination as the flight progresses.
      const early = pointOnFlightChart(geometry, 0.1).x;
      const late = pointOnFlightChart(geometry, 0.9).x;
      expect(Math.sign(late - early)).toBe(Math.sign(destination.x - origin.x));
    }
  });

  it("keeps each world, its labels and its ring or halo inside the chart", () => {
    for (const planetId of Object.values(PLANET_IDS)) {
      const { center } = INTERPLANETARY_CHART_PLANETS[planetId];
      const reach = chartPlanetReach(planetId);
      expect(center.x - reach.x).toBeGreaterThan(0);
      expect(center.x + reach.x).toBeLessThan(FLIGHT_CHART_VIEWBOX.width);
      // Name above (18px), station below (13px), as FlightCinematic places them,
      // on one shared line clear of every world's ring or halo.
      const labelReach = chartPlanetLabelReach();
      expect(labelReach).toBeGreaterThanOrEqual(reach.y);
      expect(center.y - labelReach - 12 - 18).toBeGreaterThan(0);
      expect(center.y + labelReach + 24).toBeLessThan(FLIGHT_CHART_VIEWBOX.height - 30);
      const station = "STILLREACH LANDING STATION";
      const x = clampChartLabelX(center.x, station, 13);
      expect(x - (station.length * 13 * 0.62) / 2).toBeGreaterThanOrEqual(12);
    }
  });
});
