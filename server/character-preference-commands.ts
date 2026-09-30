import { eq } from "drizzle-orm";
import { characters } from "@/db/rune-space";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * Set the character-wide Auto-discard Slag preference (#256).
 *
 * The one write path for the setting, so the Practice Welding toggle and the
 * Refining toggle change the same durable value. Due work resolves first, under
 * the preference it was earned under; the new value then applies to work that
 * resolves after this command, which is the same "read at completion" rule
 * Practice has always had. Available to any owned character: whether the player
 * has unlocked Practice or Refining decides what they can see, not whether the
 * preference exists.
 */
export async function setAutoDiscardSlagPreference(
  userId: string,
  characterId: string,
  autoDiscardSlag: boolean,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      await transaction
        .update(characters)
        .set({ autoDiscardSlag })
        .where(eq(characters.id, context.character.id));
      return stateFromTransaction(
        transaction,
        context.character.id,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
  );
}
