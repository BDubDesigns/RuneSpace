import { miningActionIds, refiningActionIds, weldingActionIds } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";

/**
 * Travel may atomically replace any ongoing work action that declares itself
 * travel-replaceable. This is intentionally a small explicit set — not a
 * registry or plugin system. Adding a future work action is one entry here.
 *
 * Where an activity is a family of authored content, though, the entry is the
 * family rather than one of its members. Mining contributes every authored
 * source and Refining every authored recipe (#209), because walking away from
 * Galvanite is the same interruptible work as walking away from Ferrite Shale
 * — naming one source here would have quietly refused travel from the others.
 * Welding contributes every repair target's action for the same reason: a
 * partial pass is simply never resolved. Practice Welding joins them because
 * leaving Wade's yard stops the bench, and the partial weld is waiting when the
 * player comes back (#190).
 */
const TRAVEL_REPLACEABLE_ACTION_IDS = new Set<string>([
  ...miningActionIds(),
  ...refiningActionIds(),
  ...weldingActionIds(),
  ACTION_IDS.practiceWelding,
  // Walking out of the yard interrupts a customer job under the same shared
  // Stop/Travel semantics, preserving its durable progress (#207).
  ACTION_IDS.workOrderWelding,
]);

export function isTravelReplaceableAction(actionId: string): boolean {
  return TRAVEL_REPLACEABLE_ACTION_IDS.has(actionId);
}

export function travelReplaceableActionIds(): readonly string[] {
  return Array.from(TRAVEL_REPLACEABLE_ACTION_IDS);
}
