import { getLocation } from "@/game/content/locations";
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
