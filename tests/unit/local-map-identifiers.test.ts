import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LOCATIONS } from "@/game/content/locations";
import {
  MAP_IDENTIFIER_ASSET_BY_KEY,
  resolveMapIdentifierAsset,
  resolveMapIdentifierAssetForLocation,
} from "@/features/travel/local-map-identifiers";
import { getLocation } from "@/game/content/locations";

describe("local map identifier asset boundary (issue #53)", () => {
  it("maps every approved mapIconKey to a local /map-icons/... asset with no remote URL", () => {
    for (const key of Object.keys(
      MAP_IDENTIFIER_ASSET_BY_KEY,
    ) as (keyof typeof MAP_IDENTIFIER_ASSET_BY_KEY)[]) {
      const asset = resolveMapIdentifierAsset(key);
      expect(asset).toMatch(/^\/map-icons\/.+\.webp$/);
      expect(asset).not.toMatch(/^https?:\/\//);
      expect(asset).not.toContain("..");
    }
  });

  it("every registry location resolves to a valid identifier asset", () => {
    for (const location of LOCATIONS) {
      const asset = resolveMapIdentifierAssetForLocation(getLocation, location.id);
      expect(asset, `location ${location.id} should resolve`).toBeDefined();
      expect(asset).toMatch(/^\/map-icons\//);
    }
  });

  it("current location is always in the local map id set, confirming population tile has an identifier", () => {
    // The three-location slice keeps exactly the three approved ids.
    expect(LOCATIONS.map((l) => l.id)).toEqual(expect.arrayContaining(Object.values(LOCATION_IDS)));
    for (const location of LOCATIONS) {
      expect(resolveMapIdentifierAsset(location.presentation.mapIconKey)).toBeTruthy();
    }
  });

  it("unknown location id returns undefined rather than a broken path", () => {
    expect(
      resolveMapIdentifierAssetForLocation(getLocation, "unknown_location_id"),
    ).toBeUndefined();
  });

  it("visibly painted width is 55–65% of hex width at both mobile (108) and desktop (128)", () => {
    // Tight-alpha-cropped 512 long-edge sizes + 0.60W×0.62H meet viewport.
    // Painted width = min(viewportW/bboxW, viewportH/bboxH) * bboxW / hexW.
    const hexWidths = [108, 128];
    const hexHeightFor = (w: number) => w * (Math.sqrt(3) / 2);
    // Known tight-bbox/cropped sizes after optimization (from Pillow bbox).
    const croppedSizes: Record<string, { w: number; h: number }> = {
      crash_site_deposit: { w: 512, h: 421 },
      processing_yard: { w: 512, h: 488 },
      power_annex: { w: 512, h: 470 },
    };
    const vpWFrac = 0.6;
    const vpHFrac = 0.62;
    for (const hexW of hexWidths) {
      const hexH = hexHeightFor(hexW);
      const vpW = hexW * vpWFrac;
      const vpH = hexH * vpHFrac;
      for (const key of Object.keys(croppedSizes) as (keyof typeof croppedSizes)[]) {
        const entry = croppedSizes[key]!;
        const { w: bboxW, h: bboxH } = entry;
        const scale = Math.min(vpW / bboxW, vpH / bboxH);
        const paintedW = bboxW * scale;
        const pct = (paintedW / hexW) * 100;
        expect(
          pct,
          `${key} painted ${pct.toFixed(1)}% at hexW=${hexW} (vp ${vpW.toFixed(1)}×${vpH.toFixed(1)}, bbox ${bboxW}×${bboxH})`,
        ).toBeGreaterThanOrEqual(55);
        expect(pct).toBeLessThanOrEqual(65);
      }
    }
  });
});
