/**
 * Pure, destination-agnostic selection and reconciliation for the shared
 * storage transfer surface (Issue #282, extracted from the Cargo Hold's
 * Issue #151 tile grids). These helpers model the client's advisory view only:
 * every mutation still goes through the host's server-authoritative commands,
 * and a selection is always resolved against the current authoritative
 * projection — never against cached entry details — so a transferred-away or
 * resized entry reconciles on the next render. They know nothing about which
 * storage destination (ship Cargo Hold, a future site stash) is on screen.
 */

/** A stackable entry. Hosts may pass richer rows; only these fields are read. */
export type StorageStackEntry = {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  stackLimit: number;
};

/** A unique item instance. `currentCharge` is present only for a charged tool. */
export type StorageUniqueEntry = {
  id: string;
  itemId: string;
  name: string;
  currentCharge?: number;
};

/**
 * One occupied region: what it holds and how many of its slots are used. The
 * capacity is whatever the container defines — the surface never derives it.
 */
export type StorageRegion = {
  stacks: readonly StorageStackEntry[];
  uniqueItems: readonly StorageUniqueEntry[];
  slotsUsed: number;
  capacitySlots: number;
};

/**
 * The two inventories the surface moves items between: what the character
 * carries, and the one storage destination currently open.
 */
export type StorageProjection = {
  carried: StorageRegion;
  destination: StorageRegion;
};

export type StorageArea = "carried" | "stored";

/**
 * Selected-entry identity. Carried and stored stack/unique rows live in
 * distinct identity namespaces, so the selection carries both its area and
 * kind explicitly instead of a bare ID.
 */
export type StorageSelection = { area: StorageArea; kind: "stack" | "unique"; id: string };

export type ResolvedStorageSelection =
  | { area: StorageArea; kind: "stack"; entry: StorageStackEntry }
  | { area: StorageArea; kind: "unique"; entry: StorageUniqueEntry };

/** Resolve the current selection against the authoritative projection. */
export function resolveStorageSelection(
  projection: StorageProjection,
  selection: StorageSelection | undefined,
): ResolvedStorageSelection | undefined {
  if (!selection) return undefined;
  const region = selection.area === "carried" ? projection.carried : projection.destination;
  if (selection.kind === "stack") {
    const entry = region.stacks.find((stack) => stack.id === selection.id);
    return entry ? { area: selection.area, kind: "stack", entry } : undefined;
  }
  const entry = region.uniqueItems.find((item) => item.id === selection.id);
  return entry ? { area: selection.area, kind: "unique", entry } : undefined;
}

/**
 * Storage selection identity: carried and stored entries live in separate
 * areas as well as separate stack/unique namespaces, so two selections match
 * only when the area, the kind, and the id all do. The shared
 * selectable-details contract applies the toggle rule on top of this predicate
 * (see `features/shared/use-selectable-details.ts`).
 */
export function sameStorageSelection(current: StorageSelection, next: StorageSelection): boolean {
  return current.area === next.area && current.kind === next.kind && current.id === next.id;
}
