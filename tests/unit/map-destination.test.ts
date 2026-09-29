import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { mapDestinationStatus } from "@/features/travel/map-destination";

describe("selected map destination status (issue #240)", () => {
  const fromCrashSite = (locationId: string, travelable?: boolean) =>
    mapDestinationStatus({
      locationId,
      currentLocationId: LOCATION_IDS.crashSite,
      travelable,
    });

  it("offers nothing to travel to on the current hex", () => {
    expect(fromCrashSite(LOCATION_IDS.crashSite, true)).toBe("current");
  });

  it("offers a walk along an authored edge to a travelable destination", () => {
    expect(fromCrashSite(LOCATION_IDS.abandonedProcessingYard, true)).toBe("reachable");
    // Missing derived state is not a block, matching the travel gate.
    expect(fromCrashSite(LOCATION_IDS.abandonedProcessingYard)).toBe("reachable");
  });

  it("names a visible hex with no walking edge from here as unreachable", () => {
    expect(fromCrashSite(LOCATION_IDS.theJag, true)).toBe("unreachable");
    expect(fromCrashSite(LOCATION_IDS.deepJag, false)).toBe("unreachable");
  });

  it("keeps a walking edge whose destination state is shut as blocked, not walkable", () => {
    expect(
      mapDestinationStatus({
        locationId: LOCATION_IDS.deepJag,
        currentLocationId: LOCATION_IDS.theJag,
        travelable: false,
      }),
    ).toBe("blocked");
    expect(
      mapDestinationStatus({
        locationId: LOCATION_IDS.deepJag,
        currentLocationId: LOCATION_IDS.theJag,
        travelable: true,
      }),
    ).toBe("reachable");
  });
});
