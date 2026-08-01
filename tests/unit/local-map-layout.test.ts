import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LOCATIONS, areLocationsAdjacent } from "@/game/content/locations";
import {
  LOCAL_MAP_GEOMETRY,
  LOCAL_MAP_HEX_HEIGHT,
  LOCAL_MAP_ROUTE_GAP,
  axialToPixel,
  buildLocalMapGeometry,
} from "@/features/travel/local-map-layout";
import { routeProgressSegment } from "@/features/travel/route-progress";

function layoutFor(locationId: string) {
  const layout = LOCAL_MAP_GEOMETRY.layouts.find(
    (candidate) => candidate.locationId === locationId,
  );
  if (!layout) throw new Error(`Missing layout for ${locationId}`);
  return layout;
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

describe("three-cell flat-top local map layout", () => {
  it("uses the approved local axial coordinates", () => {
    expect(layoutFor(LOCATION_IDS.emergencyPowerAnnex).coordinate).toEqual({ q: 0, r: 0 });
    expect(layoutFor(LOCATION_IDS.crashSite).coordinate).toEqual({ q: 0, r: 1 });
    expect(layoutFor(LOCATION_IDS.abandonedProcessingYard).coordinate).toEqual({ q: 1, r: 0 });
  });

  it("converts every approved neighbor to one uniform flat-top center spacing", () => {
    const annex = layoutFor(LOCATION_IDS.emergencyPowerAnnex).center;
    const crash = layoutFor(LOCATION_IDS.crashSite).center;
    const yard = layoutFor(LOCATION_IDS.abandonedProcessingYard).center;
    const expectedSpacing = LOCAL_MAP_HEX_HEIGHT + LOCAL_MAP_ROUTE_GAP;
    expect(distance(annex, crash)).toBeCloseTo(expectedSpacing, 6);
    expect(distance(annex, yard)).toBeCloseTo(expectedSpacing, 6);
    expect(distance(crash, yard)).toBeCloseTo(expectedSpacing, 6);

    const rawCrash = axialToPixel({ q: 0, r: 1 });
    const rawYard = axialToPixel({ q: 1, r: 0 });
    expect(rawCrash.y).toBeGreaterThan(0);
    expect(rawYard.x).toBeGreaterThan(0);
    expect(rawYard.y).toBeLessThan(rawCrash.y);
  });

  it("retains the original Crash Site / Processing Yard diagonal relationship", () => {
    const crash = layoutFor(LOCATION_IDS.crashSite).coordinate;
    const yard = layoutFor(LOCATION_IDS.abandonedProcessingYard).coordinate;
    expect({ q: yard.q - crash.q, r: yard.r - crash.r }).toEqual({ q: 1, r: -1 });
  });

  it("derives one route per undirected registry edge and animates both directions", () => {
    const geometry = buildLocalMapGeometry();
    expect(geometry.undirectedRoutes).toHaveLength(3);
    expect(Object.keys(geometry.routeSegments)).toHaveLength(6);
    expect(
      geometry.undirectedRoutes.every(
        (route) =>
          areLocationsAdjacent(route.originLocationId, route.destinationLocationId) &&
          areLocationsAdjacent(route.destinationLocationId, route.originLocationId),
      ),
    ).toBe(true);

    for (const route of geometry.undirectedRoutes) {
      expect(distance(route.endpoints.start, route.endpoints.end)).toBeCloseTo(
        LOCAL_MAP_ROUTE_GAP,
        6,
      );
      const forward = routeProgressSegment({
        originLocationId: route.originLocationId,
        destinationLocationId: route.destinationLocationId,
        routeSegments: geometry.routeSegments,
        progress: 50,
      });
      const reverse = routeProgressSegment({
        originLocationId: route.destinationLocationId,
        destinationLocationId: route.originLocationId,
        routeSegments: geometry.routeSegments,
        progress: 50,
      });
      expect(forward.routeStart).toEqual(route.endpoints.start);
      expect(reverse.routeStart).toEqual(route.endpoints.end);
      expect(forward.progressEnd).toEqual(reverse.progressEnd);
    }
  });
});
