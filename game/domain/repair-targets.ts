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
    const { authorization } = target;
    if (authorization.kind === "mission") {
      if (!knownMissionIds.has(authorization.missionId)) {
        throw new Error(`${where} is authorized by unknown mission "${authorization.missionId}".`);
      }
      const { minimumWeldingLevel } = authorization;
      if (
        minimumWeldingLevel !== undefined &&
        (!Number.isInteger(minimumWeldingLevel) || minimumWeldingLevel < 1)
      ) {
        throw new Error(`${where} has an invalid Welding level gate ${minimumWeldingLevel}.`);
      }
    } else {
      if (!Number.isInteger(authorization.level) || authorization.level < 1) {
        throw new Error(`${where} has an invalid Welding level gate ${authorization.level}.`);
      }
      const prerequisite = authorization.requiresCompletedTargetId;
      if (prerequisite !== undefined) {
        if (prerequisite === target.id || !targets.some((other) => other.id === prerequisite)) {
          throw new Error(`${where} requires unknown or self repair target "${prerequisite}".`);
        }
      }
    }
    // Throws when the balance registry authors no recipe for this target.
    const recipe = getRepairTargetBalance(target.id);
    // A note for a material the recipe does not want would never render, so it
    // is almost certainly a typo in an item ID or a leftover from a recipe
    // change (#209). Failing here is how an author finds out.
    for (const itemId of Object.keys(target.materialNotes ?? {})) {
      if (!recipe.materials.some((material) => material.itemId === itemId)) {
        throw new Error(`${where} notes material "${itemId}", which its recipe does not require.`);
      }
    }
  }
}

/**
 * What a finished repair target reads as (#330): its authored `completedStatus`,
 * or its `reportedStatus` once the Mission that authorizes it has been turned in.
 *
 * Both facts already exist. The repair's own completion decides that the target
 * is in this state at all, and the Mission's completion decides which line, so
 * the physical restoration and the story never need a flag of their own and a
 * shared presentation never has to name a Mission.
 */
export function completedRepairStatus(
  definition: Pick<RepairTargetDefinition, "authorization" | "completedStatus" | "reportedStatus">,
  missions: readonly { missionId: string; state: string }[],
): string {
  const { authorization } = definition;
  const reported =
    definition.reportedStatus !== undefined &&
    authorization.kind === "mission" &&
    missions.some(
      (mission) => mission.missionId === authorization.missionId && mission.state === "completed",
    );
  return (reported ? definition.reportedStatus : definition.completedStatus) ?? "Operational.";
}
