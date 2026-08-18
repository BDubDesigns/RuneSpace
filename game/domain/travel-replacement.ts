import { ACTION_IDS } from "@/game/config/foundations";

/**
 * Travel may atomically replace any ongoing work action that declares itself
 * travel-replaceable. This is intentionally a small explicit set — not a
 * registry or plugin system. Adding a future work action is one entry here.
 */
const TRAVEL_REPLACEABLE_ACTION_IDS = new Set<string>([
  ACTION_IDS.crashSiteMining,
  ACTION_IDS.refining,
]);

export function isTravelReplaceableAction(actionId: string): boolean {
  return TRAVEL_REPLACEABLE_ACTION_IDS.has(actionId);
}

export function travelReplaceableActionIds(): readonly string[] {
  return Array.from(TRAVEL_REPLACEABLE_ACTION_IDS);
}
