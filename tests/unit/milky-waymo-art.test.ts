import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSENGER_ROUTE_IDS, SHIP_ROUTE_IDS } from "@/game/config/foundations";
import {
  FLIGHT_CINEMATICS,
  PASSENGER_FLIGHT_CINEMATICS,
  getFlightCinematic,
} from "@/game/content/flight-cinematics";
import { LOCAL_PLACES } from "@/game/content/local-places";
import { PASSENGER_ROUTES } from "@/game/content/passenger-routes";
import { flightCinematicImageVariants } from "@/features/ship/flight-cinematic-images";
import { readImageHeader } from "./image-header";

/**
 * Issue #404 — Milky Waymo's approved art. The masters are the owner's, checked
 * against the SHA-256 the handoff recorded; the runtime files are derived from
 * them by `scripts/prepare-milky-waymo-art.mjs` and the cinematic seats the
 * shuttle where the Rivet's own measured marks put the ship.
 */
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the approved masters", () => {
  const masters: readonly [string, string, number, number][] = [
    [
      "assets/location-scenes/milky-waymo-spaceport-check-in-master.png",
      "d18cb7d80c471c59dd3dba4b15a106fbb65c23680a0be421563bd1ad4ea970d3",
      2508,
      627,
    ],
    [
      "assets/location-scenes/milky-waymo-outpost-under-aurora-skies-master.png",
      "ed653662460d6eac4718ae9ab5a060cc505aa032222bb9ec4cad29ed5113b16e",
      2508,
      627,
    ],
    [
      "assets/location-scenes/milky-waymo-shuttle-transparent-master.png",
      "97e2140813c04b3e24d02dc71cae2d21d9f20f56fb005c53f6144e16067179ce",
      1774,
      887,
    ],
  ];

  it.each(masters)("keeps %s unaltered at its approved size", (path, digest, width, height) => {
    expect(sha256(path)).toBe(digest);
    expect(readImageHeader(path)).toMatchObject({ width, height, container: "png" });
  });

  it("keeps the approved logo files unaltered", () => {
    expect(sha256("assets/branding/milky-waymo-logo-reference.png")).toBe(
      "bfbf4cb35f1924020271f8efc8fe50afeaedbf4e2397387646f8eb3ebdc682f0",
    );
    expect(sha256("assets/branding/milky-waymo-mark-cutout.png")).toBe(
      "b3344c5d7cbcfe9a58a8f6a9934e1ec573deb07654a545fd0dd13a5fa5c0392a",
    );
  });
});

describe("the two check-in Local Place scenes", () => {
  const checkIns = LOCAL_PLACES.filter((place) => place.passengerCheckIn);

  it("are one per landing hub, each downsampled whole to 1536x384 and never cropped", () => {
    expect(checkIns.map((place) => place.presentation.scene.asset)).toEqual([
      "/location-scenes/milky-waymo-spaceport-check-in.webp",
      "/location-scenes/milky-waymo-outpost-under-aurora-skies.webp",
    ]);
    for (const place of checkIns) {
      const { scene } = place.presentation;
      expect(readImageHeader(`public${scene.asset}`)).toMatchObject({
        width: 1536,
        height: 384,
        container: "VP8 ",
      });
      expect({ width: scene.width, height: scene.height }).toEqual({ width: 1536, height: 384 });
      expect(scene.alt.length).toBeGreaterThan(60);
    }
  });

  it("describes bare soil, not pavement, at Stillreach, and a paved apron at Skatboll", () => {
    const [skatboll, stillreach] = checkIns;
    expect(skatboll!.presentation.scene.alt).toMatch(/paved apron/i);
    expect(stillreach!.presentation.scene.alt).toMatch(/bare, dusty alien soil/i);
    expect(stillreach!.presentation.scene.alt).not.toMatch(/pave|asphalt|concrete/i);
  });
});

describe("the shuttle in the flight cinematic", () => {
  it("is a real transparent overlay at its trimmed delivered size", () => {
    const header = readImageHeader("public/location-scenes/milky-waymo-shuttle.webp");
    expect(header).toMatchObject({ width: 1289, height: 596, hasAlpha: true });
  });

  it("authors a passenger cinematic per passenger route, keyed by the passenger route", () => {
    expect(Object.keys(PASSENGER_FLIGHT_CINEMATICS)).toEqual(
      PASSENGER_ROUTES.map((route) => route.id),
    );
    for (const route of PASSENGER_ROUTES) {
      expect(getFlightCinematic(route.id)).toBe(PASSENGER_FLIGHT_CINEMATICS[route.id]);
    }
  });

  it("flies the shuttle on the passenger legs and never the shuttle on the Rivet's", () => {
    for (const cinematic of Object.values(PASSENGER_FLIGHT_CINEMATICS)) {
      for (const backdrop of [cinematic.departure, cinematic.arrival]) {
        expect(backdrop.ship.asset).toBe("/location-scenes/milky-waymo-shuttle.webp");
        expect(backdrop.scene.alt).toMatch(/Milky Waymo passenger shuttle/);
        expect(backdrop.scene.alt).not.toMatch(/Rivet/);
      }
    }
    for (const cinematic of Object.values(FLIGHT_CINEMATICS)) {
      expect(cinematic.departure.ship.asset).toBe("/location-scenes/rivet-repaired.webp");
      expect(cinematic.arrival.ship.asset).toBe("/location-scenes/rivet-repaired.webp");
    }
  });

  it("reuses the Rivet leg's own chart and approved backdrops, authored once", () => {
    const pairs = [
      [
        PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
      ],
      [
        PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
        SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
      ],
    ] as const;
    for (const [passengerId, shipId] of pairs) {
      const passenger = PASSENGER_FLIGHT_CINEMATICS[passengerId]!;
      const rivet = FLIGHT_CINEMATICS[shipId]!;
      expect(passenger.chart).toEqual(rivet.chart);
      expect(passenger.chartTitle).toBe(rivet.chartTitle);
      expect(passenger.departure.scene.asset).toBe(rivet.departure.scene.asset);
      expect(passenger.arrival.scene.asset).toBe(rivet.arrival.scene.asset);
      expect(passenger.departure.dustColor).toBe(rivet.departure.dustColor);
    }
  });

  it("seats the shuttle on the very reference box the Rivet's marks were measured from", () => {
    const owner = {
      left: (680 / 1717) * 100,
      top: (268 / 916) * 100,
      width: ((1774 * 0.2903) / 1717) * 100,
    };
    // The owner's approved Stillreach mark: the 1774x887 canvas at (680, 268), 515 px wide.
    const arrival =
      PASSENGER_FLIGHT_CINEMATICS[PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation]!
        .arrival.ship;
    const scale = 515 / 1774; // canvas px per master px
    const trimLeft = owner.left + ((39 * scale) / 1717) * 100;
    const trimTop = owner.top + ((55 * scale) / 916) * 100;
    expect(arrival.placement.left).toBeCloseTo(trimLeft, 0);
    expect(arrival.placement.top).toBeCloseTo(trimTop, 0);
    expect(arrival.placement.width).toBeCloseTo(((1719 * scale) / 1717) * 100, 0);
    // The trimmed overlay keeps the shuttle's own aspect ratio.
    expect(arrival.width / arrival.height).toBeCloseTo(1719 / 794, 1);
  });

  it("warms the shuttle and both backdrops before launch", () => {
    for (const route of PASSENGER_ROUTES) {
      const variants = flightCinematicImageVariants(getFlightCinematic(route.id)!);
      const urls = variants.map((variant) => decodeURIComponent(variant.src));
      expect(urls.some((url) => url.includes("milky-waymo-shuttle.webp"))).toBe(true);
      expect(urls.some((url) => url.includes("rivet-repaired.webp"))).toBe(false);
    }
  });
});

describe("the logo", () => {
  it("ships the approved lockup and mark without redrawing them", () => {
    expect(readImageHeader("public/branding/milky-waymo-logo.webp")).toMatchObject({ width: 720 });
    expect(readImageHeader("public/branding/milky-waymo-mark.webp")).toMatchObject({
      width: 640,
      container: "VP8L",
    });
  });
});
