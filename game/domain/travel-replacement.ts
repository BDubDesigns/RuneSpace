import { weldingActionIds } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";

/**
 * Travel may atomically replace any ongoing work action that declares itself
 * travel-replaceable. This is intentionally a small explicit set — not a
 * registry or plugin system. Adding a future work action is one entry here.
 *
 * Welding contributes every repair target's action, because Welding anywhere is
 * the same interruptible work: a partial pass is simply never resolved.
 * Practice Welding joins them for the same reason — leaving Wade's yard stops
 * the bench, and the partial weld is waiting when the player comes back (#190).
 */
const TRAVEL_REPLACEABLE_ACTION_IDS = new Set<string>([
  ACTION_IDS.ferriteShaleMining,
  ACTION_IDS.refining,
  ...weldingActionIds(),
  ACTION_IDS.practiceWelding,
]);

export function isTravelReplaceableAction(actionId: string): boolean {
  return TRAVEL_REPLACEABLE_ACTION_IDS.has(actionId);
}

export function travelReplaceableActionIds(): readonly string[] {
  return Array.from(TRAVEL_REPLACEABLE_ACTION_IDS);
}
