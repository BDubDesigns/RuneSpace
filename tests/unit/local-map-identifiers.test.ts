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
      expect(asset).toMatch(/^\/map-icons\/.+\.png$/);
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
});
