import type { PlanetId } from "@/game/config/foundations";
import { getLocationPlanetId } from "@/game/content/locations";
import {
  chartPlanetReach,
  INTERPLANETARY_CHART_PLANETS,
  type ChartPoint,
  type PlanetChartLayout,
} from "@/features/ship/flight-chart";
import type { ShipProjection } from "@/server/ship-state";

/**
 * The Rivet's pre-launch star chart (#377): which worlds it shows, which route
 * is selected, and where everything sits. Pure presentation over the server's
 * own ship projection.
 *
 * What may be shown is exactly what the server projected: the planet the ship is
 * berthed on, as the origin, and the planets its authored routes from that berth
 * land on. A planet nothing departs to is not drawn at all, however it is
 * authored in `game/content/planets`, so no world is revealed by its art. Whether
 * a route can be flown is the route's own `launchRefusal`; nothing here decides it.
 * Selecting is local state only: nothing is sent until LAUNCH.
 */
export type ShipRouteProjection = ShipProjection["routes"][number];

export type StarChartDestination = {
  planetId: PlanetId;
  /** The projected routes landing on this world, in authored order. */
  routes: readonly ShipRouteProjection[];
  /** Whether any of those routes would launch right now, by the server's verdict. */
  available: boolean;
};

export type StarChartModel = {
  originPlanetId: PlanetId;
  destinations: readonly StarChartDestination[];
};

/**
 * Whether a projected route crosses to another world. The chart is for those
 * only: a hop between two places on one planet, such as the first flight from
 * the Crash Site to Holo Hollow Landing, keeps its own launch card.
 */
export function isInterplanetaryRoute(
  berthLocationId: string,
  route: Pick<ShipRouteProjection, "destinationLocationId">,
): boolean {
  const origin = getLocationPlanetId(berthLocationId);
  const destination = getLocationPlanetId(route.destinationLocationId);
  return origin !== undefined && destination !== undefined && origin !== destination;
}

/** The chart for a berth's projected interplanetary routes, or undefined when there are none. */
export function starChartModel(
  ship: Pick<ShipProjection, "berthLocationId" | "routes">,
): StarChartModel | undefined {
  const originPlanetId = getLocationPlanetId(ship.berthLocationId);
  if (!originPlanetId) return undefined;
  const byPlanet = new Map<PlanetId, ShipRouteProjection[]>();
  for (const route of ship.routes) {
    if (!isInterplanetaryRoute(ship.berthLocationId, route)) continue;
    const planetId = getLocationPlanetId(route.destinationLocationId)!;
    byPlanet.set(planetId, [...(byPlanet.get(planetId) ?? []), route]);
  }
  if (byPlanet.size === 0) return undefined;
  return {
    originPlanetId,
    destinations: [...byPlanet].map(([planetId, routes]) => ({
      planetId,
      routes,
      available: routes.some((route) => route.launchRefusal === undefined),
    })),
  };
}

function chartRoutes(model: StarChartModel): ShipRouteProjection[] {
  return model.destinations.flatMap((destination) => destination.routes);
}

/**
 * The route selected when the player has not chosen one: the only route that
 * would launch, when exactly one would. With nothing launchable and a single
 * route, that route, so the server's reason it cannot fly is on screen without
 * a pointless tap; it still cannot be launched. Otherwise nothing.
 */
export function defaultStarChartRouteId(model: StarChartModel): string | undefined {
  const routes = chartRoutes(model);
  const available = routes.filter((route) => route.launchRefusal === undefined);
  if (available.length === 1) return available[0]!.routeId;
  if (available.length === 0 && routes.length === 1) return routes[0]!.routeId;
  return undefined;
}

/**
 * The route the readout and LAUNCH act on: the player's choice while the server
 * still projects it from this berth, otherwise the default. A choice left over
 * from another berth, or a route the server no longer offers, is never launched.
 */
export function resolveStarChartRoute(
  model: StarChartModel,
  chosenRouteId: string | undefined,
): ShipRouteProjection | undefined {
  const routes = chartRoutes(model);
  const chosen = routes.find((route) => route.routeId === chosenRouteId);
  if (chosen) return chosen;
  const fallback = defaultStarChartRouteId(model);
  return routes.find((route) => route.routeId === fallback);
}

/**
 * The route a tap on a world selects: the one already selected there, else the
 * first that would launch, else the first. Only routes the server projected.
 */
export function routeForPlanetSelection(
  destination: StarChartDestination,
  currentRouteId: string | undefined,
): string {
  const current = destination.routes.find((route) => route.routeId === currentRouteId);
  const launchable = destination.routes.find((route) => route.launchRefusal === undefined);
  return (current ?? launchable ?? destination.routes[0]!).routeId;
}

/**
 * The star chart's drawing box and its worlds. The same left-to-right placement
 * as the flight cinematic's chart (`INTERPLANETARY_CHART_PLANETS`), so the leg
 * chosen here is crossed the same way once launched, but larger bodies on a
 * shorter box: on a phone each world is a comfortable touch target.
 */
export const STAR_CHART_VIEWBOX = { width: 600, height: 300 } as const;

const STAR_CHART_RADIUS = 54;

export const STAR_CHART_PLANETS: PlanetChartLayout = Object.fromEntries(
  Object.entries(INTERPLANETARY_CHART_PLANETS).map(([planetId, { center }]) => [
    planetId,
    { center: { x: center.x, y: STAR_CHART_VIEWBOX.height / 2 }, radius: STAR_CHART_RADIUS },
  ]),
) as PlanetChartLayout;

/** Share of the chart's width a world's column (its labels and touch target) takes. */
const COLUMN_WIDTH_PERCENT = 40;

/**
 * Where one world's HTML column sits over the drawing, in percent of the chart:
 * centred on the world, but kept inside the frame, so a world near an edge never
 * pushes its labels off the chart or the page.
 */
export function starChartColumn(planetId: PlanetId): {
  leftPercent: number;
  widthPercent: number;
} {
  const centerPercent = (STAR_CHART_PLANETS[planetId].center.x / STAR_CHART_VIEWBOX.width) * 100;
  const leftPercent = Math.min(
    100 - COLUMN_WIDTH_PERCENT,
    Math.max(0, centerPercent - COLUMN_WIDTH_PERCENT / 2),
  );
  return { leftPercent: round(leftPercent), widthPercent: COLUMN_WIDTH_PERCENT };
}

/**
 * The bounding box of one world's art on the star chart (ring or halo
 * included), for the selection reticle drawn around it.
 */
export function starChartPlanetBounds(planetId: PlanetId): {
  center: ChartPoint;
  reach: ChartPoint;
} {
  return {
    center: STAR_CHART_PLANETS[planetId].center,
    reach: chartPlanetReach(planetId, STAR_CHART_PLANETS),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
