import { eq } from "drizzle-orm";
import { characters } from "@/db/rune-space";
import { getLocationPlanetId } from "@/game/content/locations";
import { beginnerEchoTargetPool, canBeginEchoReading } from "@/game/domain/echo-hunts";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import {
  acknowledgeEchoReadingNotice,
  insertEchoReadingAction,
  isEchoReadingAction,
} from "@/server/echo-hunts";
import { defaultMiningRandom } from "@/server/mining";
import { loadPlaySnapshot } from "@/server/play-state";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * The Beginner Echo Seeker's player commands (#393).
 *
 * The browser sends intent only — "read a Seeker here" — and every rule is
 * revalidated inside the character lock after any due work has resolved: the
 * character is idle (a reading cannot overlap travel or any other activity),
 * stands on a planet that has Beginner Echoes, and carries a Seeker. Which
 * planet is searched, the hidden target, the Seeker consumed and the outcome
 * are the server's alone. There is no Inspect command: Item Details read the
 * projection, which never changes hunt state.
 */

export type EchoReadingCommandError =
  | "echo_no_seeker"
  /** No Beginner Echoes on this planet. Unreachable today: both planets have them. */
  | "echo_unavailable_here";

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  error?: EchoReadingCommandError | "another_action_active",
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    error === "another_action_active" ? "another_action_active" : undefined,
    undefined,
    undefined,
    now,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    error && error !== "another_action_active" ? { echoReadingError: error } : undefined,
  );
}

/**
 * Begin one stationary Seeker reading. A retried Use while a reading is already
 * running is that same reading, never a second one; anything else running is a
 * different activity and refuses. Nothing is chosen or consumed here: the
 * reading resolves once its time has passed.
 */
export async function startEchoReading(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, { character, action }) => {
      const id = character.id;
      await ensurePlayProvisioning(transaction, id);
      if (isEchoReadingAction(action?.actionId)) return stateWith(transaction, id, now);
      if (action) return stateWith(transaction, id, now, "another_action_active");
      const [row] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, id))
        .limit(1);
      const planetId = row ? getLocationPlanetId(row.currentLocationId) : undefined;
      if (!planetId || !beginnerEchoTargetPool(planetId)) {
        return stateWith(transaction, id, now, "echo_unavailable_here");
      }
      const { stacks } = await loadPlaySnapshot(transaction, id);
      if (!canBeginEchoReading(stacks)) return stateWith(transaction, id, now, "echo_no_seeker");
      await insertEchoReadingAction(transaction, id, now);
      return stateWith(transaction, id, now);
    },
    now,
  );
}

/** Dismiss a reading result. Presentation only, and idempotent. */
export async function acknowledgeEchoReading(
  userId: string,
  characterId: string,
  noticeId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, { character }) => {
      await acknowledgeEchoReadingNotice(transaction, { characterId: character.id, noticeId, now });
      return stateWith(transaction, character.id, now);
    },
    now,
    { allowDuringTrade: true, allowDuringFlight: true },
  );
}
