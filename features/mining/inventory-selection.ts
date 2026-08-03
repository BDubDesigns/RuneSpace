import { ITEM_IDS } from "@/game/config/foundations";
import type { MiningGameplayState } from "@/server/mining";

/**
 * Pure inventory selection and action derivation for the Inventory drawer.
 * These helpers model the client's advisory view only: every mutation still
 * goes through the server-authoritative commands, and selections are always
 * reconciled against returned state.
 */

export type InventoryStackEntry = MiningGameplayState["inventory"]["stacks"][number];
export type InventoryUniqueEntry = MiningGameplayState["inventory"]["uniqueItems"][number];

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
  inventory: MiningGameplayState["inventory"],
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
  state: MiningGameplayState,
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
