import { getRepairTargetBalance } from "@/game/config/balance";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import type { RepairTargetDefinition } from "@/game/content/repair-targets";

/**
 * Startup validation for authored repair targets (#172).
 *
 * A target whose location, Local Place, authorizing Mission, or balance recipe
 * is missing would reach a player as a repair surface that silently refuses, so
 * it fails fast at module load instead.
 */
export function validateRepairTargets(
  targets: readonly RepairTargetDefinition[],
  knownMissionIds: ReadonlySet<string>,
): void {
  for (const target of targets) {
    const where = `Repair target "${target.id}"`;
    if (!getLocation(target.locationId)) {
      throw new Error(`${where} references unknown location "${target.locationId}".`);
    }
    if (target.localPlaceId && !getLocalPlaceInLocation(target.locationId, target.localPlaceId)) {
      throw new Error(
        `${where} references Local Place "${target.localPlaceId}", which does not belong to "${target.locationId}".`,
      );
    }
    if (!knownMissionIds.has(target.authorizingMissionId)) {
      throw new Error(
        `${where} is authorized by unknown mission "${target.authorizingMissionId}".`,
      );
    }
    // Throws when the balance registry authors no recipe for this target.
    getRepairTargetBalance(target.id);
  }
}
