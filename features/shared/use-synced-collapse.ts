"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A collapse preference shared across every location that renders the same
 * component, persisted in localStorage under one stable key. A single global
 * state per component family: collapsing the cargo readout at the Crash Site
 * collapses it at the Processing Yard too, and the same for the world map.
 *
 * Client-only by design (localStorage). Defaults to expanded. Survives
 * refresh, navigation, and tab switches.
 */
export function useSyncedCollapse(key: string, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        setCollapsed(stored === "1");
      }
    } catch {
      // localStorage unavailable (private mode, storage disabled) — stay default.
    }
  }, [key]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // best effort; state still flips for this session
      }
      return next;
    });
  }, [key]);

  return { collapsed, toggle, setCollapsed };
}

/** Stable keys shared across locations for the synced collapse state. */
export const COLLAPSE_KEYS = {
  cargoReadout: "runespace:collapse:cargo-readout",
  worldMap: "runespace:collapse:world-map",
  runHistory: "runespace:collapse:run-history",
} as const;
