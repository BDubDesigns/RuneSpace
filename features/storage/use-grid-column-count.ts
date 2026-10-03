"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * How many columns a CSS grid is currently laying out, read from its resolved
 * `grid-template-columns` rather than assumed from a breakpoint, so a class
 * change (`grid-cols-3 sm:grid-cols-4`) can never leave the count stale.
 *
 * A grid that is not rendered (the region the narrow-screen switcher hides is
 * `display: none`) reports its declared, unresolved template, which is not a
 * track list; it keeps the last measured count and re-measures the moment it
 * has a size again.
 */
export function useGridColumnCount(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const measure = () => {
      if (grid.getClientRects().length === 0) return;
      const tracks = getComputedStyle(grid).gridTemplateColumns;
      setColumns(tracks === "none" ? 1 : Math.max(1, tracks.trim().split(/\s+/).length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}
