import type { EquipmentTarget } from "@/game/domain/equipment";
import type { PlayGameplayState } from "@/server/play";

/**
 * Pure derivation for the Equipment loadout grid (#364). Slots, labels and
 * candidates all come from the authoritative `state.equipment.slots`
 * projection; nothing here knows an item name or re-creates an equip rule.
 */

export type EquipmentSlotState = PlayGameplayState["equipment"]["slots"][number];
export type EquipmentCandidate = EquipmentSlotState["eligibleItems"][number];

/** Silhouette family for an empty slot; gloves and boots wait for real slots. */
export type EquipmentSlotIconKind = "tool" | "container" | "gloves" | "boots";

export type LoadoutTile = {
  key: string;
  slot: EquipmentSlotState;
  /** Columns spanned in the two-column grid. */
  span: 1 | 2;
  icon: EquipmentSlotIconKind;
};

export function equipmentSlotKey(target: EquipmentTarget): string {
  return `${target.assignmentKind}:${target.suitSlotId}`;
}

/**
 * Two-column mapping: the Mining tool takes a spanning row and every other
 * authored slot pairs up beside its neighbour (the two containers now; gloves
 * and boots once those slots exist), so a new slot never needs a layout rewrite.
 */
export function deriveLoadoutTiles(
  slots: readonly EquipmentSlotState[],
  miningToolSlotId: string,
): LoadoutTile[] {
  return slots.map((slot) => {
    const isTool =
      slot.target.assignmentKind === "gear" && slot.target.suitSlotId === miningToolSlotId;
    return {
      key: equipmentSlotKey(slot.target),
      slot,
      span: isTool ? 2 : 1,
      icon: isTool ? "tool" : "container",
    };
  });
}

export function resolveSelectedSlot(
  slots: readonly EquipmentSlotState[],
  selectedKey: string | undefined,
): EquipmentSlotState | undefined {
  return selectedKey
    ? slots.find((slot) => equipmentSlotKey(slot.target) === selectedKey)
    : undefined;
}

/** A candidate that vanished (equipped, dropped, consumed) resolves to nothing. */
export function resolveSelectedCandidate(
  slot: EquipmentSlotState | undefined,
  candidateId: string | undefined,
): EquipmentCandidate | undefined {
  return slot?.eligibleItems.find((item) => item.itemInstanceId === candidateId);
}

export function candidateBlockedReasons(candidate: EquipmentCandidate): readonly string[] {
  return candidate.blockedReasons ?? [];
}
