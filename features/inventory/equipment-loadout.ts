import type { EquipmentTarget } from "@/game/domain/equipment";
import type { PlayGameplayState } from "@/server/play";

/**
 * Pure derivation for the Equipment loadout grid (#364). Slots, labels and
 * candidates all come from the authoritative `state.equipment.slots`
 * projection; nothing here knows an item name or re-creates an equip rule.
 */

export type EquipmentSlotState = PlayGameplayState["equipment"]["slots"][number];
export type EquipmentCandidate = EquipmentSlotState["eligibleItems"][number];

/** Silhouette family for an empty slot. */
export type EquipmentSlotIconKind = "tool" | "container" | "gloves" | "boots";

export const POWER_CELL_UTILITY_KEY = "utility:power_cell";

export type LoadoutCell =
  | {
      kind: "slot";
      key: string;
      slot: EquipmentSlotState;
      icon: EquipmentSlotIconKind;
      /** Compact grid label ("Container 1"); the slot's full label stays in details. */
      shortLabel: string;
    }
  | { kind: "power_cell"; key: typeof POWER_CELL_UTILITY_KEY };

export function equipmentSlotKey(target: EquipmentTarget): string {
  return `${target.assignmentKind}:${target.suitSlotId}`;
}

export function shortSlotLabel(label: string): string {
  return label.replace(/^Container attachment (\d+)$/, "Container $1");
}

/** The authored suit slots the loadout arranges (`balance.carrying`). */
export type LoadoutSlotIds = {
  miningToolSlotId: string;
  handsSlotId: string;
  feetSlotId: string;
};

/**
 * The three-row, two-column first view: Mining tool | Power Cell utility,
 * Gloves | Boots, then every other authored slot in pairs (the two containers
 * now). Every slot comes from the authoritative projection (#399 made Gloves and
 * Boots real); none is a placeholder.
 */
export function deriveLoadoutCells(
  slots: readonly EquipmentSlotState[],
  slotIds: LoadoutSlotIds,
): LoadoutCell[] {
  const isGear = (slot: EquipmentSlotState, suitSlotId: string) =>
    slot.target.assignmentKind === "gear" && slot.target.suitSlotId === suitSlotId;
  const isTool = (slot: EquipmentSlotState) => isGear(slot, slotIds.miningToolSlotId);
  const isGloves = (slot: EquipmentSlotState) => isGear(slot, slotIds.handsSlotId);
  const isBoots = (slot: EquipmentSlotState) => isGear(slot, slotIds.feetSlotId);
  const cell = (slot: EquipmentSlotState): LoadoutCell => ({
    kind: "slot",
    key: equipmentSlotKey(slot.target),
    slot,
    icon: isTool(slot) ? "tool" : isGloves(slot) ? "gloves" : isBoots(slot) ? "boots" : "container",
    shortLabel: shortSlotLabel(slot.label),
  });
  return [
    ...slots.filter(isTool).map(cell),
    { kind: "power_cell", key: POWER_CELL_UTILITY_KEY },
    ...slots.filter(isGloves).map(cell),
    ...slots.filter(isBoots).map(cell),
    ...slots.filter((slot) => !isTool(slot) && !isGloves(slot) && !isBoots(slot)).map(cell),
  ];
}

export type PowerCellUtilityState =
  | { status: "no_tool"; carried: number }
  | { status: "charged"; charge: number; maximum: number; carried: number }
  | { status: "ready"; charge: number; maximum: number; carried: number }
  | { status: "no_cells"; charge: number; maximum: number; carried: number };

/**
 * At-a-glance Power Cell utility state from the authoritative projection. The
 * Power Cell is a UI utility, not equipment; the server picks which stack a
 * Load consumes (lowest quantity first), so nothing here chooses one.
 */
export function derivePowerCellUtility(
  equipment: PlayGameplayState["equipment"],
): PowerCellUtilityState {
  const carried = equipment.carriedPowerCellQuantity;
  const tool = equipment.miningTool;
  if (!tool) return { status: "no_tool", carried };
  const facts = { charge: tool.currentCharge, maximum: tool.maximumCharge, carried };
  if (tool.currentCharge > 0) return { status: "charged", ...facts };
  return { status: carried > 0 ? "ready" : "no_cells", ...facts };
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
