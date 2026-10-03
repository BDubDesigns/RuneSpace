import { and, eq, isNotNull } from "drizzle-orm";
import { characterMissions, characterRepairTargets } from "@/db/rune-space";
import { skillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS, type RepairTargetId } from "@/game/config/foundations";
import { getRepairTarget } from "@/game/content/repair-targets";
import { repairComplete, type RepairTargetState } from "@/game/domain/welding-repair";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { characterSkillLevel } from "@/server/skill-levels";

export type RepairAccess = {
  /** The durable repair has reached its authoritative completion state. */
  complete: boolean;
  /** Incomplete repair controls are available through the accepted mission. */
  repairAvailable: boolean;
};

/**
 * The single semantic repair-access predicate, for every repair target.
 *
 * A completed repair remains usable independently of mission state; an
 * incomplete one requires that target's authorizing mission to have been
 * accepted. That is what keeps the Crew Stop visible but un-repairable until
 * Renn actually asks, without a second persisted flag.
 */
export function deriveRepairAccess(
  repair: RepairTargetState,
  authorizingMissionAccepted: boolean,
): RepairAccess {
  const complete = repairComplete(repair);
  return { complete, repairAvailable: complete || authorizingMissionAccepted };
}

/**
 * Loads the authorization signal used by repair presentation and commands.
 *
 * A Mission-authorized target reads that Mission's acceptance. A Welding-level
 * target (#284) reads the character's PERSONAL Welding level through the same
 * curve the projection displays, plus the completion of any prerequisite
 * target (Deep Jag's mount needs the passage braced open). Both are read under
 * the caller's character lock.
 */
export async function loadRepairAccess(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
  repair: RepairTargetState,
): Promise<RepairAccess> {
  const definition = getRepairTarget(targetId);
  if (!definition) throw new Error(`Unknown repair target "${targetId}"`);
  const { authorization } = definition;
  if (authorization.kind === "mission") {
    const rows = await transaction
      .select({ acceptedAt: characterMissions.acceptedAt })
      .from(characterMissions)
      .where(
        and(
          eq(characterMissions.characterId, characterId),
          eq(characterMissions.missionId, authorization.missionId),
        ),
      )
      .for("update");
    return deriveRepairAccess(repair, rows[0]?.acceptedAt != null);
  }
  const thresholds = skillLevelThresholds(SKILL_IDS.welding);
  if (!thresholds) throw new Error("Welding has no level curve.");
  const level = await characterSkillLevel(transaction, characterId, SKILL_IDS.welding, thresholds);
  let authorized = level >= authorization.level;
  if (authorized && authorization.requiresCompletedTargetId) {
    const prerequisite = await transaction
      .select({ completedAt: characterRepairTargets.completedAt })
      .from(characterRepairTargets)
      .where(
        and(
          eq(characterRepairTargets.characterId, characterId),
          eq(characterRepairTargets.targetId, authorization.requiresCompletedTargetId),
          isNotNull(characterRepairTargets.completedAt),
        ),
      )
      .limit(1);
    authorized = prerequisite.length > 0;
  }
  return deriveRepairAccess(repair, authorized);
}
