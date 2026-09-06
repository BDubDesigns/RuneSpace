import { and, eq } from "drizzle-orm";
import { characterMissions } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { MISSION_IDS } from "@/game/config/foundations";
import { cargoHoldRepairComplete, type CargoHoldRepairState } from "@/game/domain/cargo-hold";
import type { DatabaseTransaction } from "@/server/action-resolution";

export type CargoRepairAccess = {
  /** The durable Cargo repair has reached its authoritative completion state. */
  complete: boolean;
  /** Incomplete repair controls are available through the accepted mission. */
  repairAvailable: boolean;
};

/**
 * The single semantic Cargo repair access predicate. A completed Hold remains
 * usable independently of mission state; an incomplete Hold requires the
 * authored Hold It Together mission to have been accepted.
 */
export function deriveCargoRepairAccess(
  repair: CargoHoldRepairState,
  holdItTogetherAccepted: boolean,
): CargoRepairAccess {
  const complete = cargoHoldRepairComplete(repair, getEffectiveGameBalance());
  return { complete, repairAvailable: complete || holdItTogetherAccepted };
}

/** Loads the accepted mission signal used by Cargo presentation and commands. */
export async function loadCargoRepairAccess(
  transaction: DatabaseTransaction,
  characterId: string,
  repair: CargoHoldRepairState,
): Promise<CargoRepairAccess> {
  const rows = await transaction
    .select({ acceptedAt: characterMissions.acceptedAt })
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, MISSION_IDS.holdItTogether),
      ),
    )
    .for("update");
  return deriveCargoRepairAccess(repair, rows[0]?.acceptedAt != null);
}
