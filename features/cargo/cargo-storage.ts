import type { PlayGameplayState } from "@/server/play";
import type { StorageProjection } from "@/features/storage/storage-selection";
import type { StorageDestinationLabels } from "@/features/storage/StorageTransferSurface";

/**
 * The ship Cargo Hold's adapter onto the shared storage transfer surface
 * (#282). It is the only place that knows `PlayGameplayState["cargoHold"]` is
 * the destination: it projects the authoritative Play state into the generic
 * carried/destination shape and names the destination. Every mutation still
 * goes through the Cargo Hold's own server-authoritative commands, wired in
 * `CargoHoldPanel`.
 */
export function projectCargoHoldStorage(state: PlayGameplayState): StorageProjection {
  return {
    carried: {
      stacks: state.inventory.stacks,
      uniqueItems: state.inventory.uniqueItems,
      slotsUsed: state.inventory.slotsUsed,
      capacitySlots: state.inventory.slotsUsed + state.inventory.slotsAvailable,
    },
    destination: {
      stacks: state.cargoHold.stacks,
      uniqueItems: state.cargoHold.uniqueItems,
      slotsUsed: state.cargoHold.slotsUsed,
      capacitySlots: state.cargoHold.capacitySlots,
    },
  };
}

export const CARGO_HOLD_STORAGE_LABELS: StorageDestinationLabels = {
  title: "CARGO",
  regionLabel: "Cargo Hold storage",
  itemsLabel: "Cargo Hold items",
  emptyMessage: "No occupied Cargo Hold items.",
  switcherLabel: "Cargo storage mode",
};
