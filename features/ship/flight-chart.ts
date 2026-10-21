import { PLANET_IDS, type PlanetId } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import {
  getPlanetPresentation,
  planetAnchorPoint,
  planetHorizontalReach,
  planetVerticalReach,
} from "@/game/content/planets";
import { axialToPixel } from "@/features/travel/local-map-layout";

/**
 * Geometry for the flight cinematic's small nav chart (#359).
 *
 * The chart is drawn in a fixed SVG box. Its two ends sit in the same direction
 * from each other as the two places do on the Local Map (from their authored
 * axial coordinates), so the chart never contradicts the map the player walks
 * on. It draws one leg, never a scale: no distance is invented.
 */
export const FLIGHT_CHART_VIEWBOX = { width: 600, height: 320 } as const;

const CENTER = { x: 300, y: 160 } as const;
/** Furthest an end may sit from the centre, per axis, so labels clear the frame's plates. */
const MAX_REACH = { x: 190, y: 70 } as const;
/** How far the route bows away from the straight line, so it reads as a flight path. */
const ARC_BOW = 48;

export type ChartPoint = { x: number; y: number };

export type FlightChartGeometry = {
  origin: ChartPoint;
  destination: ChartPoint;
  /** The quadratic Bézier control point of the route arc. */
  control: ChartPoint;
  /** The route as an SVG path. */
  path: string;
};

/**
 * Where each world sits on the interplanetary chart (#375). A fixed presentation
 * convention, not astronomy: Skatboll always on the left and Stillreach on the
 * right, so the outbound leg reads left to right and the flight home right to
 * left, and the two directions are visibly the same leg. No distance, scale,
 * orbit or third body is drawn.
 */
export const INTERPLANETARY_CHART_PLANETS: Readonly<
  Record<PlanetId, { center: ChartPoint; radius: number }>
> = {
  [PLANET_IDS.skatboll]: { center: { x: 122, y: 160 }, radius: 40 },
  [PLANET_IDS.stillreach]: { center: { x: 478, y: 160 }, radius: 40 },
};

/**
 * Where a flight leaves or lands on one charted world: its authored station
 * anchor (`game/content/planets`) resolved onto this chart's layout. The route
 * ends here, the station marker is drawn here, and the Rivet marker starts and
 * finishes here, so the three can never disagree.
 */
export function chartPlanetAnchor(planetId: PlanetId): ChartPoint {
  const { center, radius } = INTERPLANETARY_CHART_PLANETS[planetId];
  return planetAnchorPoint(getPlanetPresentation(planetId), center, radius);
}

/**
 * How far one charted world's drawing reaches from its centre, horizontally and
 * vertically, in chart units: its ring or halo from `game/content/planets`, or
 * its disc. The labels keep clear of it; the route does not, it lands on the disc.
 */
export function chartPlanetReach(planetId: PlanetId): { x: number; y: number } {
  const { radius } = INTERPLANETARY_CHART_PLANETS[planetId];
  const presentation = getPlanetPresentation(planetId);
  return {
    x: radius * planetHorizontalReach(presentation),
    y: radius * planetVerticalReach(presentation),
  };
}

/**
 * The vertical clearance every charted world's labels keep, so the names above
 * and the stations below sit on one line across the chart, whichever world has
 * the taller ring or halo.
 */
export function chartPlanetLabelReach(): number {
  return Math.max(
    ...Object.keys(INTERPLANETARY_CHART_PLANETS).map(
      (planetId) => chartPlanetReach(planetId as PlanetId).y,
    ),
  );
}

export function interplanetaryChartGeometry(
  originPlanetId: PlanetId,
  destinationPlanetId: PlanetId,
): FlightChartGeometry {
  // Station anchor to station anchor, on the discs. The control point depends
  // only on the unordered pair, so the flight home is the same curve reversed.
  const origin = chartPlanetAnchor(originPlanetId);
  const destination = chartPlanetAnchor(destinationPlanetId);
  // The same upward bow as the local chart, so a transfer arc reads as a flight.
  const control = { x: (origin.x + destination.x) / 2, y: Math.min(origin.y, destination.y) - 96 };
  return {
    origin,
    destination,
    control,
    path: `M ${round(origin.x)} ${round(origin.y)} Q ${round(control.x)} ${round(control.y)} ${round(destination.x)} ${round(destination.y)}`,
  };
}

export function flightChartGeometry(
  originLocationId: string,
  destinationLocationId: string,
): FlightChartGeometry {
  const from = getLocation(originLocationId)?.presentation.localMap.axial;
  const to = getLocation(destinationLocationId)?.presentation.localMap.axial;
  let ux = 1;
  let uy = 0;
  if (from && to) {
    const a = axialToPixel(from);
    const b = axialToPixel(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0) {
      ux = (b.x - a.x) / length;
      uy = (b.y - a.y) / length;
    }
  }
  const reach = Math.min(
    MAX_REACH.x / Math.max(Math.abs(ux), 1e-6),
    MAX_REACH.y / Math.max(Math.abs(uy), 1e-6),
  );
  const origin = { x: CENTER.x - ux * reach, y: CENTER.y - uy * reach };
  const destination = { x: CENTER.x + ux * reach, y: CENTER.y + uy * reach };
  // Bow towards the top of the chart (the perpendicular with negative y).
  let px = -uy;
  let py = ux;
  if (py > 0 || (py === 0 && px > 0)) {
    px = -px;
    py = -py;
  }
  const control = { x: CENTER.x + px * ARC_BOW * 2, y: CENTER.y + py * ARC_BOW * 2 };
  return {
    origin,
    destination,
    control,
    path: `M ${round(origin.x)} ${round(origin.y)} Q ${round(control.x)} ${round(control.y)} ${round(destination.x)} ${round(destination.y)}`,
  };
}

/** A point `t` (0..1) along the route arc, with the heading there in degrees. */
export function pointOnFlightChart(
  geometry: FlightChartGeometry,
  t: number,
): ChartPoint & { headingDegrees: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const { origin: p0, control: p1, destination: p2 } = geometry;
  const inverse = 1 - clamped;
  const x = inverse * inverse * p0.x + 2 * inverse * clamped * p1.x + clamped * clamped * p2.x;
  const y = inverse * inverse * p0.y + 2 * inverse * clamped * p1.y + clamped * clamped * p2.y;
  const dx = 2 * inverse * (p1.x - p0.x) + 2 * clamped * (p2.x - p1.x);
  const dy = 2 * inverse * (p1.y - p0.y) + 2 * clamped * (p2.y - p1.y);
  return { x, y, headingDegrees: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * Keep a centred label of roughly `text.length` characters inside the chart.
 * An estimate is enough: the display face is close to monospaced uppercase.
 */
export function clampChartLabelX(x: number, text: string, fontSize: number): number {
  const half = (text.length * fontSize * 0.62) / 2;
  const margin = 12;
  return Math.min(FLIGHT_CHART_VIEWBOX.width - margin - half, Math.max(margin + half, x));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
