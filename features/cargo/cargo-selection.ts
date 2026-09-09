import type {
  CargoHoldStackState,
  CargoHoldUniqueItemState,
  PlayGameplayState,
} from "@/server/play";

/**
 * Pure Cargo Hold selection and reconciliation for the compact carried/Cargo
 * tile grids (Issue #151). These helpers model the client's advisory view
 * only: every mutation still goes through the server-authoritative Deposit
 * and Withdraw commands, and the selection is always reconciled against
 * returned authoritative state, mirroring the Inventory drawer's selection
 * model in `features/inventory/inventory-selection.ts`.
 */

export type CarriedStackEntry = PlayGameplayState["inventory"]["stacks"][number];
export type CarriedUniqueEntry = PlayGameplayState["inventory"]["uniqueItems"][number];

export type CargoArea = "carried" | "cargo";

/**
 * Selected-entry identity. Carried and Cargo stack/unique rows live in
 * distinct identity namespaces, so the selection carries both its area and
 * kind explicitly instead of a bare ID.
 */
export type CargoSelection = { area: CargoArea; kind: "stack" | "unique"; id: string };

export type ResolvedCargoSelection =
  | { area: "carried"; kind: "stack"; entry: CarriedStackEntry }
  | { area: "carried"; kind: "unique"; entry: CarriedUniqueEntry }
  | { area: "cargo"; kind: "stack"; entry: CargoHoldStackState }
  | { area: "cargo"; kind: "unique"; entry: CargoHoldUniqueItemState };

/** Resolve the current selection against the authoritative Play state. */
export function resolveCargoSelection(
  state: PlayGameplayState,
  selection: CargoSelection | undefined,
): ResolvedCargoSelection | undefined {
  if (!selection) return undefined;
  if (selection.area === "carried") {
    if (selection.kind === "stack") {
      const entry = state.inventory.stacks.find((stack) => stack.id === selection.id);
      return entry ? { area: "carried", kind: "stack", entry } : undefined;
    }
    const entry = state.inventory.uniqueItems.find((item) => item.id === selection.id);
    return entry ? { area: "carried", kind: "unique", entry } : undefined;
  }
  if (selection.kind === "stack") {
    const entry = state.cargoHold.stacks.find((stack) => stack.id === selection.id);
    return entry ? { area: "cargo", kind: "stack", entry } : undefined;
  }
  const entry = state.cargoHold.uniqueItems.find((item) => item.id === selection.id);
  return entry ? { area: "cargo", kind: "unique", entry } : undefined;
}

/**
 * Selecting the already-selected entry toggles it closed; any other
 * selection (including one in the other area) replaces the current one.
 */
export function toggleCargoSelection(
  current: CargoSelection | undefined,
  next: CargoSelection,
): CargoSelection | undefined {
  if (current && current.area === next.area && current.kind === next.kind && current.id === next.id)
    return undefined;
  return next;
}
