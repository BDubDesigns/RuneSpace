import { eq } from "drizzle-orm";
import {
  activeActions,
  characterPracticeWelds,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { rolledCleanPass } from "@/game/domain/clean-pass";
import { canBeginPracticeWeld } from "@/game/domain/practice-welding";
import type { MiningRandom } from "@/game/domain/mining";
import { defaultMiningRandom } from "@/server/mining";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { consumeStackableItem } from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  ensurePracticeState,
  interruptPracticeWelding,
  loadPracticeRow,
  loadPracticeUnlocked,
  practiceStateFromRow,
  resetPracticeRun,
  writePracticeState,
} from "@/server/practice-welding";

/**
 * Practice Welding's player commands (#190).
 *
 * Every rule is revalidated server-side inside the character lock: that the
 * player is standing in Wade's yard, that 10,000 Hours is accepted, and that
 * there is genuinely Scrap for a fresh weld. The browser supplies only intent.
 */

export type PracticeCommandError =
  | "practice_unavailable_here"
  | "practice_locked"
  | "insufficient_scrap"
  | "another_action_active";

async function currentLocationId(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId ?? "";
}

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  practiceError?: PracticeCommandError,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    practiceError === "another_action_active" ? "another_action_active" : undefined,
    undefined,
    undefined,
    now,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    undefined,
    undefined,
    practiceError && practiceError !== "another_action_active" ? practiceError : undefined,
  );
}

/**
 * Start or resume Practice.
 *
 * A fresh weld consumes its two Scrap here, at the instant it begins, and rolls
 * that weld's Clean Pass opportunities once. Resuming a partial weld consumes
 * nothing and rerolls nothing: those two Scrap were spent when that weld began,
 * which is exactly why Resume works with no Scrap left at all.
 */
export async function startPracticeWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();

      // Idempotent: a retried Start on an already-running bench changes nothing.
      if (context.action?.actionId === ACTION_IDS.practiceWelding) {
        return stateWith(transaction, context.character.id, now);
      }
      if (context.action) {
        return stateWith(transaction, context.character.id, now, "another_action_active");
      }
      if (
        (await currentLocationId(transaction, context.character.id)) !==
        RUSK_RECOVERY_CONTENT.locationId
      ) {
        return stateWith(transaction, context.character.id, now, "practice_unavailable_here");
      }
      if (!(await loadPracticeUnlocked(transaction, context.character.id))) {
        return stateWith(transaction, context.character.id, now, "practice_locked");
      }

      await ensurePracticeState(transaction, context.character.id);
      const row = await loadPracticeRow(transaction, context.character.id);
      const practice = practiceStateFromRow(row);

      if (!practice.cycleActive) {
        const scrapAvailable = await carriedScrap(transaction, context.character.id);
        if (!canBeginPracticeWeld(scrapAvailable, balance)) {
          return stateWith(transaction, context.character.id, now, "insufficient_scrap");
        }
        const consumption = await consumeStackableItem(transaction, {
          characterId: context.character.id,
          itemId: ITEM_IDS.scrapMetal,
          quantity: balance.practiceWelding.scrapPerWeld,
          now,
        });
        if (!consumption.ok) {
          return stateWith(transaction, context.character.id, now, "insufficient_scrap");
        }
        await writePracticeState(transaction, {
          characterId: context.character.id,
          practice: {
            sectionsCompleted: 0,
            cycleActive: true,
            cleanPass: rolledCleanPass(random, balance),
          },
          now,
          stopReason: null,
        });
      }

      await resetPracticeRun(transaction, context.character.id, now);
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.practiceWelding,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return stateWith(transaction, context.character.id, now);
    },
    now,
  );
}

async function carriedScrap(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<number> {
  const stacks = await transaction
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId))
    .for("update");
  return stacks
    .filter((stack) => stack.itemId === ITEM_IDS.scrapMetal)
    .reduce((total, stack) => total + stack.quantity, 0);
}

/**
 * Stop Practice, preserving the real partial weld.
 *
 * Resolved sections are already committed and a partial section never became
 * progress, so the only extra work is closing an open Clean Pass window: an
 * opportunity the player was in the middle of is spent, and resuming the same
 * weld later must not resurrect it. Scrap is never refunded and Slag is never
 * produced early — the weld is simply waiting.
 */
export async function stopPracticeWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      if (context.action?.actionId !== ACTION_IDS.practiceWelding) {
        return stateWith(
          transaction,
          context.character.id,
          now,
          context.action ? "another_action_active" : undefined,
        );
      }
      await interruptPracticeWelding(transaction, context.character.id, now);
      return stateWith(transaction, context.character.id, now);
    },
    now,
  );
}

/**
 * Set the persistent per-character Slag preference.
 *
 * Read at each weld's completion, so flipping it mid-weld applies to the weld
 * that is finishing. It is a preference, not progression: changing it never
 * touches the run, the partial weld, or the action.
 */
export async function setPracticeSlagPreference(
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
      if (!(await loadPracticeUnlocked(transaction, context.character.id))) {
        return stateWith(transaction, context.character.id, now, "practice_locked");
      }
      await ensurePracticeState(transaction, context.character.id);
      await transaction
        .update(characterPracticeWelds)
        .set({ autoDiscardSlag, updatedAt: now })
        .where(eq(characterPracticeWelds.characterId, context.character.id));
      return stateWith(transaction, context.character.id, now);
    },
    now,
  );
}
