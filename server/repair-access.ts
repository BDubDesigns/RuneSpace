import { and, eq } from "drizzle-orm";
import { characterMissions } from "@/db/rune-space";
import { getRepairTarget } from "@/game/content/repair-targets";
import type { RepairTargetId } from "@/game/config/foundations";
import { repairComplete, type RepairTargetState } from "@/game/domain/welding-repair";
import type { DatabaseTransaction } from "@/server/action-resolution";

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

/** Loads the accepted mission signal used by repair presentation and commands. */
export async function loadRepairAccess(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
  repair: RepairTargetState,
): Promise<RepairAccess> {
  const definition = getRepairTarget(targetId);
  if (!definition) throw new Error(`Unknown repair target "${targetId}"`);
  const rows = await transaction
    .select({ acceptedAt: characterMissions.acceptedAt })
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, definition.authorizingMissionId),
      ),
    )
    .for("update");
  return deriveRepairAccess(repair, rows[0]?.acceptedAt != null);
}
