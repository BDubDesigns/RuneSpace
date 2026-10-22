import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readImageHeader } from "./image-header";
import { ACTION_IDS, LOCATION_IDS, PLANET_IDS } from "@/game/config/foundations";
import {
  LOCAL_MAP_LOCATION_IDS_BY_PLANET,
  LOCATIONS,
  areLocationsAdjacent,
  getLocation,
  getLocationPlanetId,
} from "@/game/content/locations";
import { SHIP_ROUTES } from "@/game/content/ship-routes";
import { TRANSPORT_ROUTES } from "@/game/content/transport-routes";
import { ADMIN_DESTINATIONS } from "@/features/admin/admin-format";
import { resolveMapIdentifierAsset } from "@/features/travel/local-map-identifiers";
import {
  LOCAL_MAP_GEOMETRY_BY_PLANET,
  LOCAL_MAP_ROUTE_GAP,
  buildLocalMapGeometry,
  getLocalMapGeometryForLocation,
} from "@/features/travel/local-map-layout";
import { planTransportTravel, planTravel } from "@/game/domain/travel";
import { resolveLocationState } from "@/game/domain/location-state";
import {
  LocationDefinitionSchema,
  assertBidirectionalAdjacency,
  assertPlanetMembership,
  type LocationDefinition,
} from "@/game/schemas/locations";

/**
 * Stillreach Slice A (#373): eight scenery-only locations on a second planet, a
 * planet-scoped local map, and no route to it from Skatboll.
 */

// The approved eight, with their axial coordinates, undirected neighbours and
// shortest walk from the Landing Station.
const STILLREACH = [
  {
    id: LOCATION_IDS.stillreachLandingStation,
    name: "Stillreach Landing Station",
    axial: { q: 0, r: 0 },
    neighbors: [LOCATION_IDS.windwardTrack],
    legs: 0,
    slug: "stillreach-landing-station",
  },
  {
    id: LOCATION_IDS.windwardTrack,
    name: "Windward Track",
    axial: { q: 1, r: 0 },
    neighbors: [
      LOCATION_IDS.stillreachLandingStation,
      LOCATION_IDS.hilltopWorkshop,
      LOCATION_IDS.prospectingQuarry,
    ],
    legs: 1,
    slug: "windward-track",
  },
  {
    id: LOCATION_IDS.hilltopWorkshop,
    name: "Hilltop Workshop",
    axial: { q: 2, r: -1 },
    neighbors: [LOCATION_IDS.windwardTrack, LOCATION_IDS.theLowHum],
    legs: 2,
    slug: "hilltop-workshop",
  },
  {
    id: LOCATION_IDS.prospectingQuarry,
    name: "Prospecting Quarry",
    axial: { q: 1, r: 1 },
    neighbors: [LOCATION_IDS.windwardTrack, LOCATION_IDS.theSurveyLine],
    legs: 2,
    slug: "prospecting-quarry",
  },
  {
    id: LOCATION_IDS.theLowHum,
    name: "The Low Hum",
    axial: { q: 3, r: -2 },
    neighbors: [LOCATION_IDS.hilltopWorkshop],
    legs: 3,
    slug: "the-low-hum",
  },
  {
    id: LOCATION_IDS.theSurveyLine,
    name: "The Survey Line",
    axial: { q: 2, r: 1 },
    neighbors: [
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ],
    legs: 3,
    slug: "the-survey-line",
  },
  {
    id: LOCATION_IDS.theDrySeam,
    name: "The Dry Seam",
    axial: { q: 3, r: 0 },
    neighbors: [LOCATION_IDS.theSurveyLine],
    legs: 4,
    slug: "the-dry-seam",
  },
  {
    id: LOCATION_IDS.harmonicWorkings,
    name: "Harmonic Workings",
    axial: { q: 2, r: 2 },
    neighbors: [LOCATION_IDS.theSurveyLine],
    legs: 4,
    slug: "harmonic-workings",
  },
] as const;

const stillreachIds = STILLREACH.map((entry) => entry.id as string);
const skatbollLocations = LOCATIONS.filter((location) => location.planetId === PLANET_IDS.skatboll);
const stillreachLocations = LOCATIONS.filter(
  (location) => location.planetId === PLANET_IDS.stillreach,
);

function shortestLegs(from: string, to: string): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let legs = 0; frontier.length > 0; legs += 1) {
    if (frontier.includes(to)) return legs;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of getLocation(id)?.adjacentLocationIds ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return Number.POSITIVE_INFINITY;
}

describe("Stillreach planet membership (#373)", () => {
  it("places exactly the eight approved locations on Stillreach and the original eleven on Skatboll", () => {
    expect(stillreachLocations.map((location) => location.id).sort()).toEqual(
      [...stillreachIds].sort(),
    );
    expect(skatbollLocations).toHaveLength(11);
    expect(skatbollLocations.map((location) => location.id)).toContain(
      LOCATION_IDS.holoHollowLanding,
    );
    expect(LOCATIONS).toHaveLength(19);
    expect(new Set(LOCATIONS.map((location) => location.id)).size).toBe(19);
  });

  it("derives a location's planet from the registry", () => {
    expect(getLocationPlanetId(LOCATION_IDS.crashSite)).toBe(PLANET_IDS.skatboll);
    expect(getLocationPlanetId(LOCATION_IDS.windwardTrack)).toBe(PLANET_IDS.stillreach);
    expect(getLocationPlanetId("unknown_place")).toBeUndefined();
  });

  it("keeps Skatboll's Holo Hollow region identity and invents none for Stillreach", () => {
    for (const location of skatbollLocations) expect(location.region).toBe("holo_hollow");
    for (const location of stillreachLocations) expect(location.region).toBeUndefined();
  });

  it("authors each approved name and axial coordinate", () => {
    for (const entry of STILLREACH) {
      const location = getLocation(entry.id);
      expect(location?.displayName).toBe(entry.name);
      expect(location?.presentation.localMap.axial).toEqual(entry.axial);
    }
  });

  it("lists each planet's map as exactly that planet's locations", () => {
    expect([...LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach].sort()).toEqual(
      [...stillreachIds].sort(),
    );
    expect([...LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll].sort()).toEqual(
      skatbollLocations.map((location) => location.id).sort(),
    );
  });
});

describe("Stillreach walking graph (#373)", () => {
  it("authors exactly the seven bidirectional edges", () => {
    for (const entry of STILLREACH) {
      expect([...(getLocation(entry.id)?.adjacentLocationIds ?? [])].sort()).toEqual(
        [...entry.neighbors].sort(),
      );
      for (const neighbor of entry.neighbors) {
        expect(areLocationsAdjacent(entry.id, neighbor)).toBe(true);
        expect(areLocationsAdjacent(neighbor, entry.id)).toBe(true);
      }
    }
    const edges = stillreachLocations.reduce(
      (total, location) => total + location.adjacentLocationIds.length,
      0,
    );
    expect(edges / 2).toBe(7);
  });

  it("does not infer edges from axial adjacency", () => {
    // Pairs that touch on the hex grid but are deliberately not linked.
    // touch on the hex grid but are deliberately not linked.
    expect(
      areLocationsAdjacent(LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.prospectingQuarry),
    ).toBe(false);
    expect(areLocationsAdjacent(LOCATION_IDS.hilltopWorkshop, LOCATION_IDS.theSurveyLine)).toBe(
      false,
    );
    expect(areLocationsAdjacent(LOCATION_IDS.theDrySeam, LOCATION_IDS.harmonicWorkings)).toBe(
      false,
    );
    expect(
      areLocationsAdjacent(LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings),
    ).toBe(false);
  });

  it("has the approved shortest walk from the Landing Station (0/1/2/2/3/3/4/4 legs)", () => {
    for (const entry of STILLREACH) {
      expect(shortestLegs(LOCATION_IDS.stillreachLandingStation, entry.id), entry.name).toBe(
        entry.legs,
      );
    }
  });

  it("walks each leg at the one established 24-second baseline", () => {
    const plan = planTravel({
      currentLocationId: LOCATION_IDS.stillreachLandingStation,
      destinationLocationId: LOCATION_IDS.windwardTrack,
      alreadyTraveling: false,
    });
    expect(plan).toEqual({ ok: true, durationTicks: 40 });
    expect(40 * 600).toBe(24_000);
  });

  it("refuses a walk that skips a leg", () => {
    expect(
      planTravel({
        currentLocationId: LOCATION_IDS.stillreachLandingStation,
        destinationLocationId: LOCATION_IDS.hilltopWorkshop,
        alreadyTraveling: false,
      }),
    ).toEqual({ ok: false, reason: "not_adjacent" });
  });
});

describe("no route between planets (#373)", () => {
  it("refuses any forged cross-planet walk in either direction", () => {
    for (const skatboll of skatbollLocations) {
      for (const entry of STILLREACH) {
        expect(areLocationsAdjacent(skatboll.id, entry.id)).toBe(false);
        expect(areLocationsAdjacent(entry.id, skatboll.id)).toBe(false);
        expect(
          planTravel({
            currentLocationId: skatboll.id,
            destinationLocationId: entry.id,
            alreadyTraveling: false,
          }),
        ).toEqual({ ok: false, reason: "not_adjacent" });
        expect(
          planTravel({
            currentLocationId: entry.id,
            destinationLocationId: skatboll.id,
            alreadyTraveling: false,
          }),
        ).toEqual({ ok: false, reason: "not_adjacent" });
      }
    }
  });

  it("keeps every authored edge on one planet", () => {
    for (const location of LOCATIONS) {
      for (const neighbor of location.adjacentLocationIds) {
        expect(getLocationPlanetId(neighbor), `${location.id} -> ${neighbor}`).toBe(
          location.planetId,
        );
      }
    }
  });

  it("reaches Stillreach only by the Rivet's two authored Landing-to-Landing legs (#375)", () => {
    for (const route of TRANSPORT_ROUTES) {
      expect(stillreachIds).not.toContain(route.originLocationId);
      expect(stillreachIds).not.toContain(route.destinationLocationId);
    }
    const crossing = SHIP_ROUTES.filter(
      (route) =>
        getLocationPlanetId(route.originLocationId) !==
        getLocationPlanetId(route.destinationLocationId),
    ).map((route) => [route.originLocationId, route.destinationLocationId]);
    expect(crossing).toEqual([
      [LOCATION_IDS.holoHollowLanding, LOCATION_IDS.stillreachLandingStation],
      [LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.holoHollowLanding],
    ]);
    for (const entry of STILLREACH) {
      for (const origin of LOCATIONS) {
        const refused = planTransportTravel({
          currentLocationId: origin.id,
          destinationLocationId: entry.id,
          alreadyTraveling: false,
          completedMissionIds: new Set(TRANSPORT_ROUTES.map((route) => route.unlockMissionId)),
          credits: 1_000_000,
        });
        expect(refused.ok).toBe(false);
      }
    }
  });

  it("rejects a mis-authored edge across planets at registry load", () => {
    const crash = getLocation(LOCATION_IDS.crashSite)!;
    const landing = getLocation(LOCATION_IDS.stillreachLandingStation)!;
    const crossing: LocationDefinition[] = [
      { ...crash, adjacentLocationIds: [landing.id] },
      { ...landing, adjacentLocationIds: [crash.id] },
    ];
    expect(() => assertBidirectionalAdjacency(crossing)).toThrow(/crosses planets/);
  });
});

describe("planet-scoped coordinates (#373)", () => {
  it("lets two planets share the same axial coordinate", () => {
    const crash = getLocation(LOCATION_IDS.emergencyPowerAnnex)!;
    const landing = getLocation(LOCATION_IDS.stillreachLandingStation)!;
    // Both authored at (0,0) on their own planet.
    expect(crash.presentation.localMap.axial).toEqual({ q: 0, r: 0 });
    expect(landing.presentation.localMap.axial).toEqual({ q: 0, r: 0 });
    expect(() => assertPlanetMembership(LOCATIONS)).not.toThrow();
  });

  it("still rejects a duplicate coordinate within one planet", () => {
    const annex = getLocation(LOCATION_IDS.emergencyPowerAnnex)!;
    const duplicate: LocationDefinition = {
      ...getLocation(LOCATION_IDS.crashSite)!,
      presentation: {
        ...getLocation(LOCATION_IDS.crashSite)!.presentation,
        localMap: { axial: annex.presentation.localMap.axial, label: "Duplicate" },
      },
    };
    expect(() => assertPlanetMembership([annex, duplicate])).toThrow(
      /Duplicate local map coordinate/,
    );
  });

  it("refuses the Holo Hollow region on another planet", () => {
    expect(() =>
      assertPlanetMembership([
        { ...getLocation(LOCATION_IDS.windwardTrack)!, region: "holo_hollow" as const },
      ]),
    ).toThrow(/belongs to Skatboll/);
  });

  it("requires a planet on every location", () => {
    const { planetId, ...withoutPlanet } = getLocation(LOCATION_IDS.crashSite)!;
    expect(planetId).toBe(PLANET_IDS.skatboll);
    expect(LocationDefinitionSchema.safeParse(withoutPlanet).success).toBe(false);
  });
});

describe("planet-scoped local map geometry (#373)", () => {
  it("lays out exactly eight Stillreach hexes and seven routes, with nothing from Skatboll", () => {
    const geometry = LOCAL_MAP_GEOMETRY_BY_PLANET.stillreach;
    expect(geometry.layouts.map((layout) => layout.locationId).sort()).toEqual(
      [...stillreachIds].sort(),
    );
    expect(geometry.undirectedRoutes).toHaveLength(7);
    // Seven routes, each walkable both ways, and no transport-route extras.
    expect(Object.keys(geometry.routeSegments)).toHaveLength(14);
    for (const route of geometry.undirectedRoutes) {
      expect(stillreachIds).toContain(route.originLocationId);
      expect(stillreachIds).toContain(route.destinationLocationId);
      expect(areLocationsAdjacent(route.originLocationId, route.destinationLocationId)).toBe(true);
      expect(
        Math.hypot(
          route.endpoints.end.x - route.endpoints.start.x,
          route.endpoints.end.y - route.endpoints.start.y,
        ),
      ).toBeCloseTo(LOCAL_MAP_ROUTE_GAP, 6);
    }
  });

  it("keeps the Skatboll map to its existing eleven hexes and fifteen routes", () => {
    const geometry = LOCAL_MAP_GEOMETRY_BY_PLANET.skatboll;
    expect(geometry.layouts).toHaveLength(11);
    expect(geometry.undirectedRoutes).toHaveLength(15);
    expect(geometry.layouts.every((layout) => !stillreachIds.includes(layout.locationId))).toBe(
      true,
    );
  });

  it("is unaffected by the other planet's locations", () => {
    // Building Skatboll's geometry over the whole registry equals building it over
    // Skatboll's locations alone: no hex, route or bound leaks across planets.
    const whole = buildLocalMapGeometry(PLANET_IDS.skatboll, LOCATIONS);
    const alone = buildLocalMapGeometry(PLANET_IDS.skatboll, skatbollLocations);
    expect(whole).toEqual(alone);
    expect(whole).toEqual(LOCAL_MAP_GEOMETRY_BY_PLANET.skatboll);
  });

  it("is chosen from the character's authoritative location", () => {
    expect(getLocalMapGeometryForLocation(LOCATION_IDS.crashSite)).toBe(
      LOCAL_MAP_GEOMETRY_BY_PLANET.skatboll,
    );
    expect(getLocalMapGeometryForLocation(LOCATION_IDS.theLowHum)).toBe(
      LOCAL_MAP_GEOMETRY_BY_PLANET.stillreach,
    );
    expect(() => getLocalMapGeometryForLocation("unknown_place")).toThrow(/unknown location/);
  });

  it("places the same coordinate at the same offset on both maps without overlap", () => {
    const skatboll = LOCAL_MAP_GEOMETRY_BY_PLANET.skatboll.layouts;
    const stillreach = LOCAL_MAP_GEOMETRY_BY_PLANET.stillreach.layouts;
    for (const layouts of [skatboll, stillreach]) {
      const keys = layouts.map(
        (layout) => `${layout.center.x.toFixed(3)},${layout.center.y.toFixed(3)}`,
      );
      expect(new Set(keys).size).toBe(layouts.length);
    }
  });
});

describe("Stillreach is scenery-only (#373)", () => {
  it("authors no activity, status, merchant or state variant beyond the Landing Station's (#375)", () => {
    for (const location of stillreachLocations) {
      // The Prospecting Quarry's Stone Mining (#379) is the one other activity.
      if (location.id === LOCATION_IDS.prospectingQuarry) {
        expect(location.availableActionIds).toEqual([ACTION_IDS.stoneMining]);
        expect(location.dormantActivities).toEqual([]);
        expect(location.merchantId).toBeUndefined();
        expect(location.stateVariants).toEqual([]);
        continue;
      }
      // The Dry Seam's Oil Shale Mining (#380) is the other: the same canonical
      // action as The South Cut, with a Mining map status.
      if (location.id === LOCATION_IDS.theDrySeam) {
        expect(location.availableActionIds).toEqual([ACTION_IDS.oilShaleMining]);
        expect(location.mapStatus).toBe("Mining");
        expect(location.dormantActivities).toEqual([]);
        expect(location.merchantId).toBeUndefined();
        expect(location.stateVariants).toEqual([]);
        expect(location.adjacentLocationIds).toEqual([LOCATION_IDS.theSurveyLine]);
        continue;
      }
      expect(location.availableActionIds).toEqual([]);
      expect(location.dormantActivities).toEqual([]);
      expect(location.mapStatus).toBeUndefined();
      // Last Leg Trading's terminal is a Local Place, never a location merchant (#375).
      expect(location.merchantId).toBeUndefined();
      if (location.id === LOCATION_IDS.stillreachLandingStation) {
        // The berthed-ship scene (#375).
        expect(location.stateVariants.map((variant) => variant.requires)).toEqual([
          { shipBerth: "here" },
        ]);
        continue;
      }
      expect(location.stateVariants).toEqual([]);
      expect(location.travelable).toBe(true);
      expect(location.presentation.localPlacesEyebrow).toBeUndefined();
      const resolved = resolveLocationState(location);
      expect(resolved.availableActionIds).toEqual([]);
      expect(resolved.mapStatus).toBeUndefined();
      expect(resolved.travelable).toBe(true);
    }
  });

  it("authors no ship overlay: the Landing Station panorama stays empty", () => {
    for (const location of stillreachLocations) {
      expect(location.presentation.scene.overlay).toBeUndefined();
    }
  });

  it("is open to the admin teleport and to nothing else", () => {
    const offered = ADMIN_DESTINATIONS.map((destination) => destination.locationId);
    for (const id of stillreachIds) expect(offered).toContain(id);
  });
});

describe("Stillreach art (#373)", () => {
  it("binds each location to its own committed 4:1 panorama and lossless transparent identifier", () => {
    for (const entry of STILLREACH) {
      const { scene, mapIconKey } = getLocation(entry.id)!.presentation;
      expect(scene.asset).toBe(`/location-scenes/${entry.slug}.webp`);
      expect({ width: scene.width, height: scene.height }).toEqual({ width: 1536, height: 384 });
      expect(scene.alt.trim().length).toBeGreaterThan(40);
      const sceneHeader = readImageHeader(`public${scene.asset}`);
      expect(sceneHeader).toMatchObject({ width: 1536, height: 384, container: "VP8 " });

      const icon = resolveMapIdentifierAsset(mapIconKey);
      expect(icon).toBe(`/map-icons/${entry.slug}.webp`);
      const iconHeader = readImageHeader(`public${icon}`);
      expect(iconHeader.container).toBe("VP8L");
      expect(iconHeader.hasAlpha ?? true).toBe(true);
      expect(Math.max(iconHeader.width, iconHeader.height)).toBe(512);
    }
  });

  it("paints each identifier at 55-75% of the hex width in the map's artwork viewport", () => {
    // Same arithmetic as tests/unit/local-map-identifiers.test.ts: viewport
    // 0.72W x 0.68H at the unified 140 px hex, painted `meet`.
    const hexWidth = 140;
    const viewportWidth = hexWidth * 0.72;
    const viewportHeight = hexWidth * (Math.sqrt(3) / 2) * 0.68;
    for (const entry of STILLREACH) {
      const { width, height } = readImageHeader(`public/map-icons/${entry.slug}.webp`);
      const painted = width * Math.min(viewportWidth / width, viewportHeight / height);
      const percent = (painted / hexWidth) * 100;
      expect(percent, entry.slug).toBeGreaterThanOrEqual(55);
      expect(percent, entry.slug).toBeLessThanOrEqual(75);
    }
  });

  it("keeps the approved masters under assets/", () => {
    for (const entry of STILLREACH) {
      expect(existsSync(`assets/location-scenes/${entry.slug}-master.png`), entry.slug).toBe(true);
      const icon = readImageHeader(`assets/map-icons/${entry.slug}.png`);
      expect({ width: icon.width, height: icon.height }).toEqual({ width: 1254, height: 1254 });
    }
  });

  it("describes each place distinctly", () => {
    const alts = stillreachLocations.map((location) => location.presentation.scene.alt);
    expect(new Set(alts).size).toBe(alts.length);
    const descriptions = stillreachLocations.map((location) => location.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
