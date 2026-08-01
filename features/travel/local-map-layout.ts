import { LOCATIONS, LOCAL_MAP_LOCATION_IDS } from "@/game/content/locations";
import type { LocationDefinition } from "@/game/schemas/locations";
import { routeSegmentKey, type RoutePoint, type RouteSegmentEndpoints } from "./route-progress";

/** Rendering-only flat-top hex dimensions; these are not world coordinates. */
export const LOCAL_MAP_HEX_WIDTH = 128;
export const LOCAL_MAP_HEX_RADIUS = LOCAL_MAP_HEX_WIDTH / 2;
export const LOCAL_MAP_HEX_HEIGHT = Math.sqrt(3) * LOCAL_MAP_HEX_RADIUS;
export const LOCAL_MAP_ROUTE_GAP = 12;
export const LOCAL_MAP_PADDING = 16;

export type LocalMapAxialCoordinate = { q: number; r: number };

export type LocalMapLayout = {
  locationId: LocationDefinition["id"];
  coordinate: LocalMapAxialCoordinate;
  center: RoutePoint;
  label: string;
};

export type LocalMapUndirectedRoute = {
  originLocationId: LocationDefinition["id"];
  destinationLocationId: LocationDefinition["id"];
  endpoints: RouteSegmentEndpoints;
};

export type LocalMapGeometry = {
  hexWidth: number;
  hexHeight: number;
  width: number;
  height: number;
  layouts: readonly LocalMapLayout[];
  undirectedRoutes: readonly LocalMapUndirectedRoute[];
  routeSegments: Readonly<Record<string, RouteSegmentEndpoints>>;
};

/** Convert local presentation axial coordinates to unnormalized flat-top pixels. */
export function axialToPixel(
  coordinate: LocalMapAxialCoordinate,
  hexWidth = LOCAL_MAP_HEX_WIDTH,
): RoutePoint {
  const hexRadius = hexWidth / 2;
  const hexHeight = Math.sqrt(3) * hexRadius;
  const gridSpacingScale = (hexHeight + LOCAL_MAP_ROUTE_GAP) / hexHeight;
  return {
    x: 1.5 * hexRadius * coordinate.q * gridSpacingScale,
    y: hexHeight * (coordinate.r + coordinate.q / 2) * gridSpacingScale,
  };
}

function deriveRouteEndpoints(
  start: RoutePoint,
  end: RoutePoint,
  hexHeight: number,
): RouteSegmentEndpoints {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) throw new Error("Adjacent map locations cannot share a center");

  // The apothem is the distance from a flat-top hex center to the midpoint of
  // its facing edge. The remaining distance is the single uniform route gap.
  const apothem = hexHeight / 2;
  const unitX = dx / distance;
  const unitY = dy / distance;
  return {
    start: { x: start.x + unitX * apothem, y: start.y + unitY * apothem },
    end: { x: end.x - unitX * apothem, y: end.y - unitY * apothem },
  };
}

function undirectedRouteKey(first: string, second: string): string {
  return [first, second].sort().join("::");
}

/**
 * Build the small local presentation geometry from content-provided axial
 * coordinates and registry adjacency. Travel legality never reads this data.
 */
export function buildLocalMapGeometry(
  locations: readonly LocationDefinition[] = LOCATIONS,
  hexWidth = LOCAL_MAP_HEX_WIDTH,
): LocalMapGeometry {
  const hexHeight = Math.sqrt(3) * (hexWidth / 2);
  const localIds = new Set<string>(LOCAL_MAP_LOCATION_IDS);
  const localLocations = locations.filter((location) => localIds.has(location.id));
  const rawLayouts = localLocations.map((location) => ({
    location,
    coordinate: location.presentation.localMap.axial,
    rawCenter: axialToPixel(location.presentation.localMap.axial, hexWidth),
  }));
  if (rawLayouts.length === 0) throw new Error("The local map requires at least one location");

  const coordinates = new Set<string>();
  for (const layout of rawLayouts) {
    const key = `${layout.coordinate.q},${layout.coordinate.r}`;
    if (coordinates.has(key)) throw new Error(`Duplicate local map coordinate: ${key}`);
    coordinates.add(key);
  }

  const minX = Math.min(...rawLayouts.map((layout) => layout.rawCenter.x));
  const minY = Math.min(...rawLayouts.map((layout) => layout.rawCenter.y));
  const maxX = Math.max(...rawLayouts.map((layout) => layout.rawCenter.x));
  const maxY = Math.max(...rawLayouts.map((layout) => layout.rawCenter.y));
  const layouts = rawLayouts.map<LocalMapLayout>((layout) => ({
    locationId: layout.location.id,
    coordinate: layout.coordinate,
    center: {
      x: layout.rawCenter.x - minX + hexWidth / 2 + LOCAL_MAP_PADDING,
      y: layout.rawCenter.y - minY + hexHeight / 2 + LOCAL_MAP_PADDING,
    },
    label: layout.location.presentation.localMap.label,
  }));
  const layoutById = new Map(layouts.map((layout) => [layout.locationId, layout]));

  const undirectedRoutes: LocalMapUndirectedRoute[] = [];
  const seenRoutes = new Set<string>();
  for (const location of localLocations) {
    const origin = layoutById.get(location.id);
    if (!origin) throw new Error(`Missing local map layout for ${location.id}`);
    for (const neighborId of location.adjacentLocationIds) {
      if (!localIds.has(neighborId)) continue;
      const routeKey = undirectedRouteKey(location.id, neighborId);
      if (seenRoutes.has(routeKey)) continue;
      const destination = layoutById.get(neighborId);
      if (!destination) throw new Error(`Missing local map layout for ${neighborId}`);
      seenRoutes.add(routeKey);
      undirectedRoutes.push({
        originLocationId: origin.locationId,
        destinationLocationId: destination.locationId,
        endpoints: deriveRouteEndpoints(origin.center, destination.center, hexHeight),
      });
    }
  }

  const routeSegments: Record<string, RouteSegmentEndpoints> = {};
  for (const route of undirectedRoutes) {
    routeSegments[routeSegmentKey(route.originLocationId, route.destinationLocationId)] =
      route.endpoints;
    routeSegments[routeSegmentKey(route.destinationLocationId, route.originLocationId)] = {
      start: route.endpoints.end,
      end: route.endpoints.start,
    };
  }

  return {
    hexWidth,
    hexHeight,
    width: maxX - minX + hexWidth + LOCAL_MAP_PADDING * 2,
    height: maxY - minY + hexHeight + LOCAL_MAP_PADDING * 2,
    layouts,
    undirectedRoutes,
    routeSegments,
  };
}

export const LOCAL_MAP_GEOMETRY = buildLocalMapGeometry();
