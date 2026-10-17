import { ITEM_IDS } from "@/game/config/foundations";
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
 * Inventory selection identity: stack rows and unique instances live in two
 * distinct namespaces, so two selections match only when both the kind and the
 * id do. The shared selectable-details contract applies the toggle rule on top
 * of this predicate (see `features/shared/use-selectable-details.ts`).
 */
export function sameInventorySelection(
  current: InventorySelection,
  next: InventorySelection,
): boolean {
  return current.kind === next.kind && current.id === next.id;
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
 * Client-advisory enablement for loading a Power Cell into the equipped Mining
 * tool — whichever authored Cutter it is (#233). The server command remains
 * authoritative; this only decides whether the control is offered and which
 * clear reason is shown when it is not.
 */
export function derivePowerCellLoadAvailability(
  state: PlayGameplayState,
  selection: ResolvedInventorySelection | undefined,
  busy: boolean,
): PowerCellLoadAvailability | undefined {
  if (!selection || selection.kind !== "stack") return undefined;
  if (selection.entry.itemId !== ITEM_IDS.powerCell) return undefined;
  if (busy) return { enabled: false, reason: "busy" };
  const cutter = state.equipment.miningTool;
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
  | { enabled: false; reason: "busy" }
  /** The authoritative evaluator refuses every empty compatible slot; `messages` say why. */
  | { enabled: false; reason: "blocked"; messages: readonly string[] }
  /**
   * Every compatible slot is occupied, so replacing is the player's choice of
   * slot in Equipment. Inventory never picks one for them.
   */
  | {
      enabled: false;
      reason: "slots_occupied";
      slotLabels: readonly string[];
      messages: readonly string[];
    };

/**
 * Client-advisory equip availability for a carried unique item selected in
 * Inventory (#363, extending #68).
 *
 * Compatibility, eligibility and refusal reasons all come from the server's
 * `equipment.slots[].eligibleItems` projection (which runs the same
 * `evaluateEquipmentChange` the equip command does); nothing here knows an item
 * name or re-creates the rules. Inventory only automates allocation to an EMPTY
 * compatible slot, preferring the first one in authored order. When every
 * compatible slot is occupied it offers no target at all, so a replacement is
 * always a deliberate choice in Equipment.
 *
 * An item no slot lists is not equippable gear and gets no Equip surface.
 * Eligibility is decided BEFORE the busy check, so an ineligible item never
 * gains a control merely because another command is in flight.
 */
export function deriveInventoryEquipAvailability(
  state: PlayGameplayState,
  selection: ResolvedInventorySelection | undefined,
  busy: boolean,
): InventoryEquipAvailability | undefined {
  if (!selection || selection.kind !== "unique") return undefined;
  const instanceId = selection.entry.id;
  const candidates = state.equipment.slots.flatMap((slot) => {
    const item = slot.eligibleItems.find((eligible) => eligible.itemInstanceId === instanceId);
    return item ? [{ slot, item }] : [];
  });
  if (candidates.length === 0) return undefined;

  const reasonOf = (item: (typeof candidates)[number]["item"]) =>
    item.requiredMiningLevel !== undefined
      ? `Requires Mining ${item.requiredMiningLevel} (current ${state.mining.level})`
      : item.blockedReason;
  const reasons = (list: typeof candidates) => [
    ...new Set(list.flatMap(({ item }) => reasonOf(item) ?? [])),
  ];

  const empty = candidates.filter(({ slot }) => !slot.item);
  if (empty.length === 0)
    return {
      enabled: false,
      reason: "slots_occupied",
      slotLabels: candidates.map(({ slot }) => slot.label),
      messages: reasons(candidates),
    };
  const open = empty.find(({ item }) => reasonOf(item) === undefined);
  if (!open) return { enabled: false, reason: "blocked", messages: reasons(empty) };
  if (busy) return { enabled: false, reason: "busy" };
  return {
    enabled: true,
    target: open.slot.target,
    itemInstanceId: instanceId,
    slotLabel: open.slot.label,
  };
}
