import { ITEM_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import type { EquipmentTarget } from "@/game/domain/equipment";
import type { PlayGameplayState } from "@/server/play";

/**
 * Pure inventory selection and action derivation for the Inventory drawer.
 * These helpers model the client's advisory view only: every mutation still
 * goes through the server-authoritative commands, and selections are always
 * reconciled against returned state.
 */

export type InventoryStackEntry = PlayGameplayState["inventory"]["stacks"][number];
export type InventoryUniqueEntry = PlayGameplayState["inventory"]["uniqueItems"][number];

/**
 * Selected-entry identity. Stack rows and unique item instances live in two
 * distinct identity namespaces (inventory_stacks.id vs item_instances.id), so
 * the selection carries its kind explicitly instead of a bare ID.
 */
export type InventorySelection = { kind: "stack" | "unique"; id: string };

export type ResolvedInventorySelection =
  | { kind: "stack"; entry: InventoryStackEntry }
  | { kind: "unique"; entry: InventoryUniqueEntry };

/** Resolve the current selection against the authoritative inventory projection. */
export function resolveInventorySelection(
  inventory: PlayGameplayState["inventory"],
  selection: InventorySelection | undefined,
): ResolvedInventorySelection | undefined {
  if (!selection) return undefined;
  if (selection.kind === "stack") {
    const entry = inventory.stacks.find((stack) => stack.id === selection.id);
    return entry ? { kind: "stack", entry } : undefined;
  }
  const entry = inventory.uniqueItems.find((item) => item.id === selection.id);
  return entry ? { kind: "unique", entry } : undefined;
}

/**
 * Selecting the already-selected entry toggles it closed; any other selection
 * replaces the current one. Returns `undefined` when the player dismisses the
 * current details panel by activating its tile again.
 */
export function toggleInventorySelection(
  current: InventorySelection | undefined,
  next: InventorySelection,
): InventorySelection | undefined {
  if (current && current.kind === next.kind && current.id === next.id) return undefined;
  return next;
}

export type StackDropAction = { mode: "one" | "stack"; label: string };

/**
 * Stack rows are droppable; unique items never are. A one-item stack gets a
 * single non-redundant `Drop item` action instead of two destructive choices.
 */
export function stackDropActions(quantity: number): readonly StackDropAction[] {
  if (quantity < 1) return [];
  if (quantity === 1) return [{ mode: "one", label: "Drop item" }];
  return [
    { mode: "one", label: "Drop 1" },
    { mode: "stack", label: `Drop stack (${quantity})` },
  ];
}

export type PowerCellLoadAvailability =
  | { enabled: true }
  | {
      enabled: false;
      reason: "charged" | "no_cutter" | "no_cells" | "busy";
      remainingCharge?: number;
    };

/**
 * Client-advisory enablement for `Load into Salvage Cutter`. The server
 * command remains authoritative; this only decides whether the control is
 * offered and which clear reason is shown when it is not.
 */
export function derivePowerCellLoadAvailability(
  state: PlayGameplayState,
  selection: ResolvedInventorySelection | undefined,
  busy: boolean,
): PowerCellLoadAvailability | undefined {
  if (!selection || selection.kind !== "stack") return undefined;
  if (selection.entry.itemId !== ITEM_IDS.powerCell) return undefined;
  if (busy) return { enabled: false, reason: "busy" };
  const cutter = state.equipment.salvageCutter;
  if (!cutter) return { enabled: false, reason: "no_cutter" };
  if (cutter.currentCharge > 0)
    return {
      enabled: false,
      reason: "charged",
      remainingCharge: cutter.currentCharge,
    };
  if (state.equipment.carriedPowerCellQuantity <= 0) return { enabled: false, reason: "no_cells" };
  return { enabled: true };
}

export type InventoryEquipAvailability =
  | { enabled: true; target: EquipmentTarget; itemInstanceId: string; slotLabel: string }
  | { enabled: false; reason: "busy" };

/**
 * Client-advisory equip availability for a carried unique item selected in
 * Inventory.
 *
 * Issue #68 is specifically about equipping a carried Salvage Cutter into the
 * authoritative Mining-tool slot. This helper therefore resolves the Mining-tool
 * slot from the authoritative equipment projection (the `gear` slot whose
 * `suitSlotId` matches the Salvage Cutter's approved slot) and requires the
 * selected unique instance to appear in THAT slot's `eligibleItems`. It does not
 * search other equipment slots (so a carried MYKEA or other listed container is
 * never offered an Equip action via Inventory) and it never hard-codes
 * compatibility from the item name or re-creates the server compatibility
 * matrix — the server's `eligibleItems` projection stays the single source of
 * truth.
 *
 * Eligibility is decided BEFORE the busy check: an otherwise ineligible unique
 * item returns `undefined` and never gains a disabled Equip control merely
 * because another command is in flight. The equip command itself remains
 * authoritative.
 */
export function deriveInventoryEquipAvailability(
  state: PlayGameplayState,
  selection: ResolvedInventorySelection | undefined,
  busy: boolean,
): InventoryEquipAvailability | undefined {
  if (!selection || selection.kind !== "unique") return undefined;
  const toolSlotId = getEffectiveGameBalance().items.salvageCutter.suitSlotId;
  const toolSlot = state.equipment.slots.find(
    (slot) => slot.target.assignmentKind === "gear" && slot.target.suitSlotId === toolSlotId,
  );
  const eligible = toolSlot?.eligibleItems.some(
    (item) => item.itemInstanceId === selection.entry.id,
  );
  if (!toolSlot || !eligible) return undefined;
  if (busy) return { enabled: false, reason: "busy" };
  return {
    enabled: true,
    target: toolSlot.target,
    itemInstanceId: selection.entry.id,
    slotLabel: toolSlot.label,
  };
}
