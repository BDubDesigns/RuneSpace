import { useEffect, useRef, useState, type RefObject } from "react";

export const LOCAL_MAP_SCROLL_EPSILON = 1;

export type LocalMapScrollDirection = "left" | "right" | "top" | "bottom";

export type LocalMapScrollMetrics = {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
};

export type LocalMapScrollAffordances = Readonly<Record<LocalMapScrollDirection, boolean>>;

export const NO_LOCAL_MAP_SCROLL_AFFORDANCES: LocalMapScrollAffordances = {
  left: false,
  right: false,
  top: false,
  bottom: false,
};

/**
 * Mission guidance tone carried onto an edge arrow (#240). The same two tones
 * the hexes use: an accepted Mission's next work (`active`, green) and its
 * final handoff (`turn_in`, blue). Available offers have no tone here.
 */
export type LocalMapMissionTone = "active" | "turn_in";

/** A guided hex's center, in the map canvas's own pixel coordinates. */
export type LocalMapMissionTarget = { x: number; y: number; tone: LocalMapMissionTone };

export type LocalMapMissionEdgeCues = Readonly<
  Partial<Record<LocalMapScrollDirection, LocalMapMissionTone>>
>;

/** The visible part of the canvas, in the same canvas coordinates as targets. */
export type LocalMapVisibleRect = { left: number; top: number; right: number; bottom: number };

export const NO_LOCAL_MAP_MISSION_EDGE_CUES: LocalMapMissionEdgeCues = {};

/**
 * Projects accepted-Mission map targets onto the viewport edges (#240). A
 * target is beyond an edge while its hex center lies outside the visible
 * rect on that side, so a diagonal target cues both of its edges and a hex
 * scrolled at least half into view clears its cue. Where targets compete for
 * one edge, active work wins over turn-in — the precedence every other Mission
 * surface uses. This only reads geometry; it adds no routing of its own.
 */
export function getLocalMapMissionEdgeCues(
  visible: LocalMapVisibleRect,
  targets: readonly LocalMapMissionTarget[],
): LocalMapMissionEdgeCues {
  const cues: Partial<Record<LocalMapScrollDirection, LocalMapMissionTone>> = {};
  const cue = (direction: LocalMapScrollDirection, tone: LocalMapMissionTone) => {
    if (cues[direction] !== "active") cues[direction] = tone;
  };
  for (const target of targets) {
    if (target.x < visible.left) cue("left", target.tone);
    if (target.x > visible.right) cue("right", target.tone);
    if (target.y < visible.top) cue("top", target.tone);
    if (target.y > visible.bottom) cue("bottom", target.tone);
  }
  return cues;
}

/** Per-direction equality, so an unchanged scroll does not re-render the map. */
function sameEdges(
  left: Readonly<Partial<Record<LocalMapScrollDirection, unknown>>>,
  right: Readonly<Partial<Record<LocalMapScrollDirection, unknown>>>,
) {
  return (
    left.left === right.left &&
    left.right === right.right &&
    left.top === right.top &&
    left.bottom === right.bottom
  );
}

export function getLocalMapScrollAffordances(
  metrics: LocalMapScrollMetrics,
  epsilon = LOCAL_MAP_SCROLL_EPSILON,
): LocalMapScrollAffordances {
  return {
    left: metrics.scrollLeft > epsilon,
    right: metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - epsilon,
    top: metrics.scrollTop > epsilon,
    bottom: metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - epsilon,
  };
}

function readScrollMetrics(element: HTMLDivElement): LocalMapScrollMetrics {
  return {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  };
}

/**
 * Where the canvas (the viewport's first child) currently is, measured in its
 * own coordinates: the part of it the scroll viewport's client box shows.
 */
function readVisibleCanvasRect(viewport: HTMLDivElement): LocalMapVisibleRect | undefined {
  const canvas = viewport.firstElementChild;
  if (!(canvas instanceof HTMLElement)) return undefined;
  const viewportRect = viewport.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const left = viewportRect.left + viewport.clientLeft - canvasRect.left;
  const top = viewportRect.top + viewport.clientTop - canvasRect.top;
  return { left, top, right: left + viewport.clientWidth, bottom: top + viewport.clientHeight };
}

export function useLocalMapScrollAffordances(
  enabled: boolean,
  missionTargets: readonly LocalMapMissionTarget[] = [],
): {
  viewportRef: RefObject<HTMLDivElement | null>;
  affordances: LocalMapScrollAffordances;
  missionCues: LocalMapMissionEdgeCues;
} {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [affordances, setAffordances] = useState<LocalMapScrollAffordances>(
    NO_LOCAL_MAP_SCROLL_AFFORDANCES,
  );
  const [missionCues, setMissionCues] = useState<LocalMapMissionEdgeCues>(
    NO_LOCAL_MAP_MISSION_EDGE_CUES,
  );
  // Targets are recomputed on every render; a string key keeps the effect from
  // resubscribing unless the guided hexes actually changed.
  const missionTargetsKey = missionTargets
    .map((target) => `${target.x},${target.y},${target.tone}`)
    .join("|");
  const missionTargetsRef = useRef(missionTargets);
  missionTargetsRef.current = missionTargets;

  useEffect(() => {
    if (!enabled) {
      setAffordances(NO_LOCAL_MAP_SCROLL_AFFORDANCES);
      setMissionCues(NO_LOCAL_MAP_MISSION_EDGE_CUES);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;

    const update = () => {
      const next = getLocalMapScrollAffordances(readScrollMetrics(viewport));
      setAffordances((previous) => (sameEdges(previous, next) ? previous : next));
      const visible = readVisibleCanvasRect(viewport);
      const nextCues = visible
        ? getLocalMapMissionEdgeCues(visible, missionTargetsRef.current)
        : NO_LOCAL_MAP_MISSION_EDGE_CUES;
      setMissionCues((previous) => (sameEdges(previous, nextCues) ? previous : nextCues));
    };

    update();
    viewport.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(viewport);
    if (observer) {
      for (const child of Array.from(viewport.children)) {
        observer.observe(child);
      }
    }

    return () => {
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [enabled, missionTargetsKey]);

  return { viewportRef, affordances, missionCues };
}
