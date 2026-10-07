import { and, eq } from "drizzle-orm";
import { characterMissionUnpins, characterMissions } from "@/db/rune-space";
import { getMission } from "@/game/content/missions";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

export type MissionPinOutcome =
  | { status: "pinned" | "unpinned" }
  | { status: "refused"; message: string };

export type MissionPinResult = { state: PlayGameplayState; pin: MissionPinOutcome };

/**
 * Pin or unpin one accepted Mission (#325).
 *
 * The one write path for the preference, so Current Missions' Unpin and the
 * Mission Log's Pin toggle change the same durable value. Pinning deletes the
 * override and unpinning stores it; both are idempotent, so a repeated press
 * reports the state the player asked for rather than an error.
 *
 * Only an accepted, uncompleted Mission can change: a completed one never shows
 * in Current Missions, so there is nothing to pin. Due work resolves first like
 * any other command, and the command touches nothing but the preference.
 */
export async function setMissionPinned(
  userId: string,
  characterId: string,
  missionId: string,
  pinned: boolean,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionPinResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const stateFor = async (pin: MissionPinOutcome): Promise<MissionPinResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          { successes: 0, failures: 0, awardedXp: 0 },
          undefined,
          undefined,
          undefined,
          undefined,
          now,
        ),
        pin,
      });

      const definition = getMission(missionId);
      if (!definition) return stateFor({ status: "refused", message: "Unknown mission." });
      const record = (
        await transaction
          .select({ completedAt: characterMissions.completedAt })
          .from(characterMissions)
          .where(
            and(
              eq(characterMissions.characterId, context.character.id),
              eq(characterMissions.missionId, definition.id),
            ),
          )
          .limit(1)
      )[0];
      if (!record) {
        return stateFor({ status: "refused", message: `Accept ${definition.title} first.` });
      }
      if (record.completedAt) {
        return stateFor({
          status: "refused",
          message: `${definition.title} is complete and is no longer shown in Current Missions.`,
        });
      }

      if (pinned) {
        await transaction
          .delete(characterMissionUnpins)
          .where(
            and(
              eq(characterMissionUnpins.characterId, context.character.id),
              eq(characterMissionUnpins.missionId, definition.id),
            ),
          );
      } else {
        await transaction
          .insert(characterMissionUnpins)
          .values({ characterId: context.character.id, missionId: definition.id, unpinnedAt: now })
          .onConflictDoNothing();
      }
      return stateFor({ status: pinned ? "pinned" : "unpinned" });
    },
    now,
  );
}
