import type { LocationId } from "@/game/config/foundations";

export type RoutePoint = { x: number; y: number };
export type RouteSegmentEndpoints = { start: RoutePoint; end: RoutePoint };

export function routeSegmentKey(originLocationId: string, destinationLocationId: string): string {
  return `${originLocationId}->${destinationLocationId}`;
}

export function routeProgressSegment({
  originLocationId,
  destinationLocationId,
  routeSegments,
  progress,
}: {
  originLocationId: LocationId;
  destinationLocationId: LocationId;
  routeSegments: Readonly<Record<string, RouteSegmentEndpoints>>;
  progress: number;
}) {
  const segment = routeSegments[routeSegmentKey(originLocationId, destinationLocationId)];
  if (!segment) throw new Error("Missing route geometry for travel segment");
  const clampedProgress = Math.min(100, Math.max(0, progress)) / 100;

  return {
    routeStart: segment.start,
    routeEnd: segment.end,
    progressEnd: {
      x: segment.start.x + (segment.end.x - segment.start.x) * clampedProgress,
      y: segment.start.y + (segment.end.y - segment.start.y) * clampedProgress,
    },
    originLocationId,
    destinationLocationId,
  };
}
