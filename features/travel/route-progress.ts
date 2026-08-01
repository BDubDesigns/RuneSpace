import { LOCATION_IDS, type LocationId } from "@/game/config/foundations";

export type RoutePoint = { x: number; y: number };
export type RouteSegmentEndpoints = { start: RoutePoint; end: RoutePoint };

export function routeProgressSegment({
  originLocationId,
  destinationLocationId,
  crashEndpoint,
  processingYardEndpoint,
  routeSegments,
  progress,
}: {
  originLocationId: LocationId;
  destinationLocationId: LocationId;
  crashEndpoint?: RoutePoint;
  processingYardEndpoint?: RoutePoint;
  routeSegments?: Readonly<Record<string, RouteSegmentEndpoints>>;
  progress: number;
}) {
  const explicit = routeSegments?.[`${originLocationId}->${destinationLocationId}`];
  const routeStart =
    explicit?.start ??
    (originLocationId === LOCATION_IDS.crashSite ? crashEndpoint : processingYardEndpoint);
  const routeEnd =
    explicit?.end ??
    (destinationLocationId === LOCATION_IDS.crashSite ? crashEndpoint : processingYardEndpoint);
  if (!routeStart || !routeEnd) throw new Error("Missing route geometry for travel segment");
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
