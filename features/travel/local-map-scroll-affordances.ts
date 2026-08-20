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

export function useLocalMapScrollAffordances(enabled: boolean): {
  viewportRef: RefObject<HTMLDivElement | null>;
  affordances: LocalMapScrollAffordances;
} {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [affordances, setAffordances] = useState<LocalMapScrollAffordances>(
    NO_LOCAL_MAP_SCROLL_AFFORDANCES,
  );

  useEffect(() => {
    if (!enabled) {
      setAffordances(NO_LOCAL_MAP_SCROLL_AFFORDANCES);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;

    const update = () => {
      setAffordances(getLocalMapScrollAffordances(readScrollMetrics(viewport)));
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
  }, [enabled]);

  return { viewportRef, affordances };
}
