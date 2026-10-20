import { PLANET_IDS, type PlanetId } from "@/game/config/foundations";
import {
  getLocationPlanetId,
  LOCATIONS,
  LOCAL_MAP_LOCATION_IDS_BY_PLANET,
} from "@/game/content/locations";
import { TRANSPORT_ROUTES } from "@/game/content/transport-routes";
import type { LocationDefinition } from "@/game/schemas/locations";
import { routeSegmentKey, type RoutePoint, type RouteSegmentEndpoints } from "./route-progress";

/** Rendering-only flat-top hex dimensions; these are not world coordinates. */
export const LOCAL_MAP_HEX_WIDTH = 140;
export const LOCAL_MAP_HEX_RADIUS = LOCAL_MAP_HEX_WIDTH / 2;
export const LOCAL_MAP_HEX_HEIGHT = Math.sqrt(3) * LOCAL_MAP_HEX_RADIUS;
export const LOCAL_MAP_ROUTE_GAP = 30;
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
 * Build one planet's local presentation geometry from content-provided axial
 * coordinates and registry adjacency (#373). Only that planet's locations are
 * laid out, so another planet may reuse the same coordinate without a collision
 * or a leaked hex. Travel legality never reads this data.
 */
export function buildLocalMapGeometry(
  planetId: PlanetId,
  locations: readonly LocationDefinition[] = LOCATIONS,
  hexWidth = LOCAL_MAP_HEX_WIDTH,
): LocalMapGeometry {
  const hexHeight = Math.sqrt(3) * (hexWidth / 2);
  const localIds = new Set<string>(LOCAL_MAP_LOCATION_IDS_BY_PLANET[planetId]);
  const localLocations = locations.filter(
    (location) => location.planetId === planetId && localIds.has(location.id),
  );
  const rawLayouts = localLocations.map((location) => ({
    location,
    coordinate: location.presentation.localMap.axial,
    rawCenter: axialToPixel(location.presentation.localMap.axial, hexWidth),
  }));
  if (rawLayouts.length === 0) throw new Error(`The ${planetId} local map has no locations`);

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
  const addSegments = (
    endpoints: RouteSegmentEndpoints,
    originId: string,
    destinationId: string,
  ) => {
    routeSegments[routeSegmentKey(originId, destinationId)] = endpoints;
    routeSegments[routeSegmentKey(destinationId, originId)] = {
      start: endpoints.end,
      end: endpoints.start,
    };
  };
  for (const route of undirectedRoutes) {
    addSegments(route.endpoints, route.originLocationId, route.destinationLocationId);
  }

  // Authored transport routes get in-transit geometry so the Map can draw a
  // ride's progress, but they are deliberately NOT added to `undirectedRoutes`:
  // the map's walkable edges still come from adjacency alone, so the Crew
  // Hauler never appears as a route you could walk (#172). Only the authored
  // direction gets geometry — there is no ride the other way to draw.
  for (const route of TRANSPORT_ROUTES) {
    const { originLocationId: originId, destinationLocationId: destinationId } = route;
    const origin = layoutById.get(originId);
    const destination = layoutById.get(destinationId);
    if (!origin || !destination) continue;
    if (routeSegments[routeSegmentKey(originId, destinationId)]) continue;
    routeSegments[routeSegmentKey(originId, destinationId)] = deriveRouteEndpoints(
      origin.center,
      destination.center,
      hexHeight,
    );
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

/** One geometry per planet, built once; the active map is chosen by the character's planet. */
export const LOCAL_MAP_GEOMETRY_BY_PLANET: Readonly<Record<PlanetId, LocalMapGeometry>> = {
  [PLANET_IDS.skatboll]: buildLocalMapGeometry(PLANET_IDS.skatboll),
  [PLANET_IDS.stillreach]: buildLocalMapGeometry(PLANET_IDS.stillreach),
};

/**
 * The geometry of the map the character is standing on. The planet is derived
 * from the authoritative current location, never supplied by the client.
 */
export function getLocalMapGeometryForLocation(locationId: string): LocalMapGeometry {
  const planetId = getLocationPlanetId(locationId);
  if (!planetId) throw new Error(`Cannot resolve a local map for unknown location ${locationId}`);
  return LOCAL_MAP_GEOMETRY_BY_PLANET[planetId];
}
