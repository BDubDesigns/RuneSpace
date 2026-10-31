import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { characterRepairTargets } from "@/db/rune-space";
import { PERSONAL_RESONANCE_RIG } from "@/game/content/resonance-rig";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The arrival the finished Rig still owes the player (#441).
 *
 * Gameplay already happened when the twenty-fourth weld committed: the Rig is
 * complete and the Wise Old Enby stands at the Resonance Site because of that one
 * fact. What is owed is only the player being SHOWN it, so the receipt is its own
 * column (`character_repair_targets.arrival_acknowledged_at`) and is read from the
 * same row as the completion. A weld that finished offline, in another tab or after
 * the presentation was skipped is still owed after a reload, and an acknowledged
 * one is never owed again. Nothing here moves a character, an item or an NPC.
 */
export type ResonanceArrivalProjection = {
  /** When the Rig's last weld completed. */
  completedAt: string;
};

export async function loadResonanceArrival(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<ResonanceArrivalProjection | undefined> {
  const [row] = await transaction
    .select({ completedAt: characterRepairTargets.completedAt })
    .from(characterRepairTargets)
    .where(
      and(
        eq(characterRepairTargets.characterId, characterId),
        eq(characterRepairTargets.targetId, PERSONAL_RESONANCE_RIG.repairTargetId),
        isNotNull(characterRepairTargets.completedAt),
        isNull(characterRepairTargets.arrivalAcknowledgedAt),
      ),
    )
    .limit(1);
  return row?.completedAt ? { completedAt: row.completedAt.toISOString() } : undefined;
}
