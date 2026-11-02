import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { mapDestinationRoute, mapDestinationStatus } from "@/features/travel/map-destination";

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

  it("offers Route To a hex with no direct edge but an ordinary walking path (#450)", () => {
    expect(fromCrashSite(LOCATION_IDS.theJag, true)).toBe("routable");
    expect(
      mapDestinationRoute({
        locationId: LOCATION_IDS.theJag,
        currentLocationId: LOCATION_IDS.crashSite,
        travelable: true,
      }),
    ).toEqual([LOCATION_IDS.crashSite, LOCATION_IDS.theLongScramble, LOCATION_IDS.theJag]);
  });

  it("names a shut destination as blocked however far away it is (#450)", () => {
    expect(fromCrashSite(LOCATION_IDS.deepJag, false)).toBe("blocked");
  });

  it("names a hex with no walking path through enterable places as unreachable", () => {
    const status = mapDestinationStatus({
      locationId: LOCATION_IDS.theSouthCut,
      currentLocationId: LOCATION_IDS.crashSite,
      travelable: true,
      isTravelable: (id) => id !== LOCATION_IDS.southAccessTrack,
    });
    expect(status).toBe("unreachable");
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
