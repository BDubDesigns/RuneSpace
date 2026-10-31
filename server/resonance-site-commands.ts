import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { characterRepairTargets } from "@/db/rune-space";
import { PERSONAL_RESONANCE_RIG } from "@/game/content/resonance-rig";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * Dismiss the Wise Old Enby's arrival at this character's finished Rig (#441).
 *
 * Presentation only and idempotent: it moves no one, consumes and grants nothing
 * and never touches the Mission, the NPC's placement or the Rig. An arrival that
 * was skipped, replayed from a stale tab or acknowledged twice leaves exactly the
 * same state. Allowed during a trade or a flight like the other dismissals, since
 * a notice that could not be dismissed would hold the player hostage.
 */
export function acknowledgeResonanceArrival(
  userId: string,
  characterId: string,
  now = new Date(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, { character }) => {
      await ensurePlayProvisioning(transaction, character.id);
      await transaction
        .update(characterRepairTargets)
        .set({ arrivalAcknowledgedAt: now })
        .where(
          and(
            eq(characterRepairTargets.characterId, character.id),
            eq(characterRepairTargets.targetId, PERSONAL_RESONANCE_RIG.repairTargetId),
            isNotNull(characterRepairTargets.completedAt),
            isNull(characterRepairTargets.arrivalAcknowledgedAt),
          ),
        );
      return stateFromTransaction(
        transaction,
        character.id,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
    { allowDuringTrade: true, allowDuringFlight: true },
  );
}
