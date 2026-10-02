"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DESKTOP_WORKSPACE_QUERY,
  homeUtilityStorageKey,
  parseHomeUtility,
  type PlayUtilityId,
} from "./utility-workspace";

/**
 * Browser bindings for the utility workspace's two presentation facts: whether
 * the viewport is wide enough for the docked desktop composition, and which
 * utility this character has made their desktop home on this browser.
 *
 * Both are external-store reads with a `undefined` server snapshot, so the
 * server render and the first hydration pass agree and nothing is committed on
 * a guess. The dock waits for both to resolve before mounting anything, which
 * is what keeps a default Chat from mounting — and reading messages — before
 * the character's real home has been applied.
 */

function subscribeToDesktopQuery(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function desktopSnapshot(): boolean | undefined {
  return window.matchMedia(DESKTOP_WORKSPACE_QUERY).matches;
}

function desktopServerSnapshot(): boolean | undefined {
  return undefined;
}

/**
 * `true` at the docked desktop width, `false` below it, `undefined` until the
 * browser has answered (the server render and hydration). Callers treat
 * `undefined` as "not yet decided", never as either layout.
 */
export function useDesktopWorkspace(): boolean | undefined {
  return useSyncExternalStore(subscribeToDesktopQuery, desktopSnapshot, desktopServerSnapshot);
}

const homeListeners = new Set<() => void>();
// Where a preference lives when the browser refuses storage (private modes,
// disabled storage): the choice still holds for the life of the page.
const memoryHome = new Map<string, string>();

function readHome(characterId: string): PlayUtilityId {
  const key = homeUtilityStorageKey(characterId);
  let raw: string | null | undefined;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = undefined;
  }
  return parseHomeUtility(raw ?? memoryHome.get(key));
}

function writeHome(characterId: string, utility: PlayUtilityId): void {
  const key = homeUtilityStorageKey(characterId);
  memoryHome.set(key, utility);
  try {
    window.localStorage.setItem(key, utility);
  } catch {
    // Kept in memory above; nothing else to do.
  }
  for (const listener of [...homeListeners]) listener();
}

function subscribeToHome(onChange: () => void): () => void {
  homeListeners.add(onChange);
  // Another tab on this browser changing the same character's home.
  window.addEventListener("storage", onChange);
  return () => {
    homeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function homeServerSnapshot(): PlayUtilityId | undefined {
  return undefined;
}

/**
 * This character's desktop home utility on this browser, `undefined` until
 * hydration has read it, with a setter for the explicit "Set as default"
 * action. Nothing else ever writes it: casually opening Inventory or Missions
 * never changes the preference.
 */
export function useHomeUtility(
  characterId: string,
): readonly [PlayUtilityId | undefined, (utility: PlayUtilityId) => void] {
  const getSnapshot = useCallback(
    (): PlayUtilityId | undefined => readHome(characterId),
    [characterId],
  );
  const home = useSyncExternalStore(subscribeToHome, getSnapshot, homeServerSnapshot);
  const setHome = useCallback(
    (utility: PlayUtilityId) => writeHome(characterId, utility),
    [characterId],
  );
  return [home, setHome] as const;
}
