import { LOCATION_IDS, type LocationId } from "@/game/config/foundations";

export type RoutePoint = { x: number; y: number };

export function routeProgressSegment({
  originLocationId,
  destinationLocationId,
  crashEndpoint,
  processingYardEndpoint,
  progress,
}: {
  originLocationId: LocationId;
  destinationLocationId: LocationId;
  crashEndpoint: RoutePoint;
  processingYardEndpoint: RoutePoint;
  progress: number;
}) {
  const routeStart =
    originLocationId === LOCATION_IDS.crashSite ? crashEndpoint : processingYardEndpoint;
  const routeEnd =
    destinationLocationId === LOCATION_IDS.crashSite ? crashEndpoint : processingYardEndpoint;
  const clampedProgress = Math.min(100, Math.max(0, progress)) / 100;

  return {
    routeStart,
    routeEnd,
    progressEnd: {
      x: routeStart.x + (routeEnd.x - routeStart.x) * clampedProgress,
      y: routeStart.y + (routeEnd.y - routeStart.y) * clampedProgress,
    },
    originLocationId,
    destinationLocationId,
  };
}
