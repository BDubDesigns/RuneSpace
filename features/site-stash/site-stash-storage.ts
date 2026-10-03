import type { PlayGameplayState, SiteStashState } from "@/server/play";
import type { StorageProjection } from "@/features/storage/storage-selection";
import type { StorageDestinationLabels } from "@/features/storage/StorageTransferSurface";

/**
 * A character's site stash as a destination of the shared storage transfer
 * surface (#284, consuming #282).
 *
 * The one place that knows `PlayGameplayState["siteStash"]` is the destination:
 * it projects authoritative Play state into the generic carried/destination
 * shape. The destination's capacity is whatever the installed container's
 * authored slot count is; the surface never derives it, and there is no mass
 * limit to show because stored mass is unlimited.
 */
export function projectSiteStashStorage(
  state: PlayGameplayState,
  stash: SiteStashState,
): StorageProjection {
  return {
    carried: {
      stacks: state.inventory.stacks,
      uniqueItems: state.inventory.uniqueItems,
      slotsUsed: state.inventory.slotsUsed,
      capacitySlots: state.inventory.slotsUsed + state.inventory.slotsAvailable,
    },
    destination: {
      stacks: stash.stacks,
      uniqueItems: stash.uniqueItems,
      slotsUsed: stash.slotsUsed,
      capacitySlots: stash.capacitySlots,
    },
  };
}

export const SITE_STASH_STORAGE_LABELS: StorageDestinationLabels = {
  title: "STASH",
  regionLabel: "Site stash storage",
  itemsLabel: "Site stash items",
  emptyMessage: "Nothing stashed here.",
  switcherLabel: "Stash storage mode",
};
