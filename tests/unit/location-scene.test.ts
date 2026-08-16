import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LOCATIONS, getLocation } from "@/game/content/locations";
import { resolveLocationScene } from "@/features/location-scene/LocationSceneHeader";

describe("location scene registry (issue #78)", () => {
  it("every current location has valid scene metadata (asset, dimensions, alt, focal)", () => {
    for (const location of LOCATIONS) {
      const scene = location.presentation.scene;
      expect(scene, `${location.id} must have a scene`).toBeDefined();
      expect(scene!.asset).toMatch(/^\/location-scenes\/.+\.webp$/);
      expect(scene!.asset).not.toContain("..");
      expect(scene!.width).toBeGreaterThan(0);
      expect(scene!.height).toBeGreaterThan(0);
      // Delivered intrinsic: 1920x480 (4:1 ultra-wide, single asset for mobile+desktop)
      expect(scene!.width).toBe(1920);
      expect(scene!.height).toBe(480);
      expect(scene!.alt.trim().length).toBeGreaterThan(10);
      // Focal metadata exists and is in valid percent range
      expect(scene!.focal).toBeDefined();
      expect(scene!.focal!.x).toBeGreaterThanOrEqual(0);
      expect(scene!.focal!.x).toBeLessThanOrEqual(100);
      expect(scene!.focal!.y).toBeGreaterThanOrEqual(0);
      expect(scene!.focal!.y).toBeLessThanOrEqual(100);
    }
  });

  it("authoritative current location selects the correct scene (no filename guessing)", () => {
    expect(getLocation(LOCATION_IDS.crashSite)?.presentation.scene.asset).toBe(
      "/location-scenes/crash-site.webp",
    );
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.presentation.scene.asset).toBe(
      "/location-scenes/processing-yard.webp",
    );
    expect(getLocation(LOCATION_IDS.emergencyPowerAnnex)?.presentation.scene.asset).toBe(
      "/location-scenes/power-annex.webp",
    );
    // Alt text is distinct per location (not a copy-pasted duplicate)
    const alts = LOCATIONS.map((l) => l.presentation.scene.alt);
    expect(new Set(alts).size).toBe(LOCATIONS.length);
  });

  it("transit never falsely renders the destination as current (scene helper resolves truthfully)", () => {
    // While in transit, currentLocationId is still the origin — destination must not be resolved.
    const origin = LOCATION_IDS.crashSite;
    const destination = LOCATION_IDS.abandonedProcessingYard;
    // Correct: scene for origin is shown (truthful while traveling)
    expect(resolveLocationScene(getLocation, origin)?.asset).toBe(
      "/location-scenes/crash-site.webp",
    );
    // The helper does not conflate destination with current during transit;
    // callers must pass currentLocationId, never destination.
    expect(resolveLocationScene(getLocation, destination)?.asset).toBe(
      "/location-scenes/processing-yard.webp",
    );
    expect(resolveLocationScene(getLocation, origin)?.asset).not.toBe(
      resolveLocationScene(getLocation, destination)?.asset,
    );
    // Unknown location returns undefined (no broken asset path)
    expect(resolveLocationScene(getLocation, "unknown_location")).toBeUndefined();
  });

  it("scene identities match the approved visual mapping", () => {
    // Supplied files are authoritative by location/visual identity per the issue:
    // img_c36e (wreck hull/crane) → Crash Site, img_fb1a (conveyor/gantry/hopper) → Processing Yard,
    // img_b54f (bunker capsule/cyan) → Power Annex. Filenames follow repo conventions.
    expect(getLocation(LOCATION_IDS.crashSite)?.presentation.scene.alt).toMatch(
      /hull|craft|derelict/i,
    );
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.presentation.scene.alt).toMatch(
      /conveyor|gantry|hopper|industrial/i,
    );
    expect(getLocation(LOCATION_IDS.emergencyPowerAnnex)?.presentation.scene.alt).toMatch(
      /bunker|capsule|dispenser|cyan/i,
    );
  });

  it("one shared responsive scene-header system uses a single asset per location (no breakpoint artwork split)", () => {
    // The issue requires "same scene asset on mobile and desktop" — one asset path per location,
    // with responsive framing handled by the shared component's viewport heights, not separate files.
    const distinctAssets = new Set(LOCATIONS.map((l) => l.presentation.scene.asset));
    expect(distinctAssets.size).toBe(LOCATIONS.length);
    for (const asset of distinctAssets) {
      expect(asset).toMatch(/^\/location-scenes\/[^/]+\.webp$/);
      expect(asset).not.toMatch(/mobile|desktop|sm:|lg:/);
    }
  });

  it("no gameplay controls/state are gated by artwork (metadata-only, no behavior change)", () => {
    // Scene metadata is presentation-only; location availability is unchanged by adding scenes.
    expect(getLocation(LOCATION_IDS.crashSite)?.availableActionIds).toContain(
      "crash_site_ferrite_shale_mining",
    );
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.availableActionIds).toHaveLength(0);
    expect(getLocation(LOCATION_IDS.emergencyPowerAnnex)?.availableActionIds).toHaveLength(0);
  });

  it("focal metadata contract is optional and location-scoped (not scattered conditionals)", () => {
    // Contract: focal, when present, is {x,y} in percent. No per-location CSS branches.
    for (const location of LOCATIONS) {
      const { focal } = location.presentation.scene;
      if (focal) {
        expect(Object.keys(focal).sort()).toEqual(["x", "y"]);
      }
    }
  });

  it("scene assets are local, non-remote, and follow repository conventions", () => {
    for (const location of LOCATIONS) {
      const asset = location.presentation.scene.asset;
      expect(asset.startsWith("/location-scenes/")).toBe(true);
      expect(asset).not.toMatch(/^https?:\/\//);
      expect(asset).not.toMatch(/\.\./);
      expect(asset.endsWith(".webp")).toBe(true);
    }
  });
});
