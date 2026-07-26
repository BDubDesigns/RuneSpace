import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { routeProgressSegment } from "@/features/travel/route-progress";

const crashEndpoint = { x: 10, y: 20 };
const processingYardEndpoint = { x: 30, y: 40 };

describe("travel route progress presentation", () => {
  it("starts Crash Site to Processing Yard progress at the Crash Site endpoint", () => {
    const segment = routeProgressSegment({
      originLocationId: LOCATION_IDS.crashSite,
      destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
      crashEndpoint,
      processingYardEndpoint,
      progress: 25,
    });

    expect(segment.routeStart).toEqual(crashEndpoint);
    expect(segment.routeEnd).toEqual(processingYardEndpoint);
    expect(segment.progressEnd).toEqual({ x: 15, y: 25 });
  });

  it("starts Processing Yard to Crash Site progress at the Processing Yard endpoint", () => {
    const segment = routeProgressSegment({
      originLocationId: LOCATION_IDS.abandonedProcessingYard,
      destinationLocationId: LOCATION_IDS.crashSite,
      crashEndpoint,
      processingYardEndpoint,
      progress: 25,
    });

    expect(segment.routeStart).toEqual(processingYardEndpoint);
    expect(segment.routeEnd).toEqual(crashEndpoint);
    expect(segment.progressEnd).toEqual({ x: 25, y: 35 });
  });
});
