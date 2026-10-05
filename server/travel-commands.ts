import { eq } from "drizzle-orm";
import { characters, characterTravelState } from "@/db/rune-space";
import { ACTION_IDS, type TravelMode } from "@/game/config/foundations";
import { travelOffersScavenge } from "@/game/domain/travel";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { createPlayResolver, ensurePlayProvisioning, stateFromTransaction } from "@/server/play";
import type { PlayGameplayState } from "@/server/play";
import { clearActiveJourney } from "@/server/travel";

/**
 * Turn Back from the active Journey (#312).
 *
 * The browser sends only its character identity. Everything that decides what
 * the command does is server-owned:
 *
 * - **Arrival wins.** The owned-character lock reconciles Travel first, through
 *   the same resolver every Play command uses. If arrival was already due it
 *   commits there, the character is no longer traveling, and this command finds
 *   nothing to cancel — it can never teleport anyone back to the old origin.
 *   The client countdown is never consulted and there is no "too late" window.
 * - **Cancel at the origin.** If a Journey still remains after reconciliation,
 *   its action and travel row are cleared together. `current_location_id` is
 *   the authoritative origin for the whole Journey and is not touched, so the
 *   character is simply idle where they set out. Elapsed progress is discarded;
 *   no halfway place and no return trip exist to create.
 * - **Rewards stay committed.** A claimed Scavenge reveal is untouched; an
 *   unclaimed opportunity lives on the travel row and goes with it.
 * - **Walking cancellation suppresses Scavenge**, even before an opportunity
 *   appeared, so Turn Back is not a way to reroll the random window. A Crew
 *   Hauler ride neither sets that suppression nor clears it, and its fare was
 *   spent at boarding and is not refunded.
 *
 * Retries are harmless: once the Journey is gone the command is a no-op that
 * returns the current authoritative state, which is also what a forged request
 * from a character that is not traveling gets.
 */
export async function turnBackTravel(
  userId: string,
  characterId: string,
  now = new Date(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);

      if (context.action?.actionId === ACTION_IDS.travel) {
        const [travel] = await transaction
          .select()
          .from(characterTravelState)
          .where(eq(characterTravelState.characterId, context.character.id))
          .for("update");

        await clearActiveJourney(transaction, context.character.id);
        if (travel && travelOffersScavenge(travel.mode as TravelMode)) {
          await transaction
            .update(characters)
            .set({ scavengeSuppressed: true })
            .where(eq(characters.id, context.character.id));
        }
      }

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
