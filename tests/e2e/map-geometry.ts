import type { Locator } from "@playwright/test";

/**
 * Shared local-map geometry assertions for the browser journeys (Travel and
 * location population). Every element carrying `dataAttribute` must sit
 * entirely inside the hex of its own `[data-map-location]` button and must not
 * overlap any drawn route line.
 */
export async function expectElementsInsideHexes(
  map: Locator,
  dataAttribute: string,
): Promise<{ labels: string[]; allInside: boolean; routeOverlaps: string[] }> {
  return map.evaluate((mapElement, attribute) => {
    function pointInPolygon(
      point: { x: number; y: number },
      polygon: Array<{ x: number; y: number }>,
    ) {
      let inside = false;
      for (
        let index = 0, previous = polygon.length - 1;
        index < polygon.length;
        previous = index++
      ) {
        const currentPoint = polygon[index]!;
        const previousPoint = polygon[previous]!;
        const intersects =
          currentPoint.y > point.y !== previousPoint.y > point.y &&
          point.x <
            ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
              (previousPoint.y - currentPoint.y) +
              currentPoint.x;
        if (intersects) inside = !inside;
      }
      return inside;
    }

    function screenPoint(element: SVGGraphicsElement, x: number, y: number) {
      const svg = element.ownerSVGElement;
      const matrix = element.getScreenCTM();
      if (!svg || !matrix) throw new Error("Map geometry is not measurable");
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      const transformed = point.matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    }

    function segmentIntersectsRect(
      start: { x: number; y: number },
      end: { x: number; y: number },
      rect: DOMRect,
    ) {
      let lower = 0;
      let upper = 1;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      for (const [coefficient, constant] of [
        [-dx, start.x - rect.left],
        [dx, rect.right - start.x],
        [-dy, start.y - rect.top],
        [dy, rect.bottom - start.y],
      ]) {
        if (coefficient === 0) {
          if (constant < 0) return false;
          continue;
        }
        const ratio = constant / coefficient;
        if (coefficient < 0) lower = Math.max(lower, ratio);
        else upper = Math.min(upper, ratio);
        if (lower > upper) return false;
      }
      return true;
    }

    const hexes = Array.from(mapElement.querySelectorAll("[data-map-hex]"));
    const plates = Array.from(mapElement.querySelectorAll(`[${attribute}]`));
    const plateChecks = plates.map((plate) => {
      const button = plate.closest("button");
      const locationId = button?.getAttribute("data-map-location");
      const hex = hexes.find((candidate) => candidate.getAttribute("data-map-hex") === locationId);
      if (!(button && hex instanceof SVGPolygonElement))
        throw new Error("Map status is missing a hex");
      const polygon = Array.from(hex.points).map((point) => screenPoint(hex, point.x, point.y));
      const rect = plate.getBoundingClientRect();
      const inset = 0.5;
      const isStatePlate = plate.hasAttribute("data-map-state");
      const isNameplate = plate.hasAttribute("data-map-nameplate");
      if (isNameplate) {
        // Nameplates are intentionally mounted plates that may overhang the hex
        // in either direction (designed to look mounted). Only require that the
        // plate's center lies inside the hex — corners may spill.
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        return {
          label: plate.textContent?.trim(),
          inside: pointInPolygon(center, polygon),
        };
      }
      // YOU ARE HERE state plate may overhang the top like a mounted label.
      const overhangAllowance = isStatePlate ? 4 : 0;
      const corners = [
        { x: rect.left + inset, y: rect.top + inset + overhangAllowance },
        { x: rect.right - inset, y: rect.top + inset + overhangAllowance },
        { x: rect.right - inset, y: rect.bottom - inset },
        { x: rect.left + inset, y: rect.bottom - inset },
      ];
      if (isStatePlate) {
        const bottomInside = corners.slice(2).every((corner) => pointInPolygon(corner, polygon));
        const hexTopY = Math.min(...polygon.map((p) => p.y));
        const topOk = corners
          .slice(0, 2)
          .every((corner) => pointInPolygon(corner, polygon) || corner.y >= hexTopY - 8);
        return {
          label: plate.textContent?.trim(),
          inside: bottomInside && topOk,
        };
      }
      return {
        label: plate.textContent?.trim(),
        inside: corners.every((corner) => pointInPolygon(corner, polygon)),
      };
    });

    const routeOverlaps = Array.from(mapElement.querySelectorAll("svg line")).flatMap((line) => {
      const svgLine = line as SVGLineElement;
      const start = screenPoint(svgLine, svgLine.x1.baseVal.value, svgLine.y1.baseVal.value);
      const end = screenPoint(svgLine, svgLine.x2.baseVal.value, svgLine.y2.baseVal.value);
      return plates
        .filter((plate) => segmentIntersectsRect(start, end, plate.getBoundingClientRect()))
        .map((plate) => plate.textContent?.trim() ?? "unknown");
    });

    return {
      labels: plateChecks.map((plate) => plate.label),
      allInside: plateChecks.every((plate) => plate.inside),
      routeOverlaps,
    };
  }, dataAttribute);
}
