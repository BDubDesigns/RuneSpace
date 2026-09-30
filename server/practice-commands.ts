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
import { checkBoundedRunSelection, type BoundedRunSelection } from "@/game/domain/bounded-run";
import { canBeginPracticeWeld, practiceAffordableWelds } from "@/game/domain/practice-welding";
import { deriveWorkbenchOccupancy } from "@/game/domain/workbench";
import { loadActiveWorkOrder } from "@/server/work-orders";
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
  loadPracticeSnapshot,
  loadPracticeUnlocked,
  practiceStateFromRow,
  resetPracticeRun,
  setPracticeFinishCurrentWeld,
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
  | "another_action_active"
  /** A customer Work Order holds the one bench (#207). */
  | "workbench_occupied"
  /** Nothing is on the bench to finish, so "finish and stop" has no subject. */
  | "no_weld_in_progress"
  /**
   * The selected weld count is more than the Scrap carried pays for (#229).
   * Refused rather than reduced; the returned state carries the fresh count.
   */
  | "practice_quantity_unavailable";

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
 *
 * The run has a selection (#229). A number is how many COMPLETE welds to run,
 * a resumed partial weld being the first; it is revalidated against the welds
 * the Scrap carried pays for before any Scrap is spent, and a number that no
 * longer fits is refused rather than quietly shortened. Max needs only that
 * the first weld can begin; after that the resolver keeps welding until the
 * Scrap cannot pay for another.
 */
export async function startPracticeWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  selection: BoundedRunSelection = 1,
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

      // As with a repair start: a refused start must leave no row behind, so
      // the Practice row is read without being created and is materialized only
      // once the work is genuinely starting.
      const practice = practiceStateFromRow(
        await loadPracticeRow(transaction, context.character.id),
      );

      // One bench, one unfinished unit. Resuming the partial weld already on it
      // is always allowed — that weld IS what occupies the bench — but a fresh
      // weld has to prove nothing else is on it, which is the same question
      // accepting a Work Order asks from the other side (#207).
      if (!practice.cycleActive) {
        const occupancy = deriveWorkbenchOccupancy({
          practice,
          activeWorkOrder: await loadActiveWorkOrder(transaction, context.character.id),
        });
        if (occupancy.kind !== "clear") {
          return stateWith(transaction, context.character.id, now, "workbench_occupied");
        }
      }

      if (!practice.cycleActive) {
        const scrapAvailable = await carriedScrap(transaction, context.character.id);
        if (!canBeginPracticeWeld(scrapAvailable, balance)) {
          return stateWith(transaction, context.character.id, now, "insufficient_scrap");
        }
      }

      // The selection, against the welds the Scrap carried pays for — checked
      // before the first weld's Scrap is spent.
      const quantityCheck = checkBoundedRunSelection(
        selection,
        practiceAffordableWelds(
          await loadPracticeSnapshot(transaction, context.character.id),
          balance,
        ),
      );
      if (!quantityCheck.ok) {
        return stateWith(transaction, context.character.id, now, "practice_quantity_unavailable");
      }

      if (!practice.cycleActive) {
        const consumption = await consumeStackableItem(transaction, {
          characterId: context.character.id,
          itemId: ITEM_IDS.scrapMetal,
          quantity: balance.practiceWelding.scrapPerWeld,
          now,
        });
        if (!consumption.ok) {
          return stateWith(transaction, context.character.id, now, "insufficient_scrap");
        }
        await ensurePracticeState(transaction, context.character.id);
        await writePracticeState(transaction, {
          characterId: context.character.id,
          practice: {
            sectionsCompleted: 0,
            cycleActive: true,
            cleanPass: rolledCleanPass(random, balance.practiceWelding.sectionsPerWeld, balance),
          },
          now,
          stopReason: null,
        });
      }

      await resetPracticeRun(transaction, context.character.id, quantityCheck.selection, now);
      // An ordinary Start is a request for the selected run in full, so it
      // clears any "finish and stop" the player set and then changed their mind
      // about.
      await setPracticeFinishCurrentWeld(transaction, context.character.id, false, now);
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
 * Finish the weld already on the bench, then stop (#207).
 *
 * A run rolls straight from one selected weld into the next (#229), which
 * leaves the player no other way to end it early on a clean bench: ordinary Stop
 * preserves a partial weld, and simply waiting spends two more Scrap the instant
 * the current weld completes if the selection has welds left. Neither is an
 * answer when the bench has to be clear for customer work. In a bounded run
 * this ends the run after the weld on the bench, whatever the selection had
 * left — the selection is a cap, never an obligation.
 *
 * So this is a third intent rather than a variant of Stop. It applies to the
 * weld the player has ALREADY paid for, whether that weld is running or was
 * stopped with partial progress: it marks the durable intent, then starts or
 * resumes so the weld can actually finish. Resolution lets it complete with
 * ordinary XP, output and Clean Pass semantics, starts no next weld, consumes
 * no further Scrap, and leaves the Workbench clear.
 */
export async function finishCurrentPracticeWeld(
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
      const practice = practiceStateFromRow(
        await loadPracticeRow(transaction, context.character.id),
      );
      // Reconciliation above may have just completed the weld this command was
      // about, which is a success rather than a refusal: the bench is clear,
      // which is what the player asked for.
      if (!practice.cycleActive) {
        return stateWith(
          transaction,
          context.character.id,
          now,
          context.action?.actionId === ACTION_IDS.practiceWelding
            ? undefined
            : "no_weld_in_progress",
        );
      }
      if (context.action && context.action.actionId !== ACTION_IDS.practiceWelding) {
        return stateWith(transaction, context.character.id, now, "another_action_active");
      }
      if (
        (await currentLocationId(transaction, context.character.id)) !==
        RUSK_RECOVERY_CONTENT.locationId
      ) {
        return stateWith(transaction, context.character.id, now, "practice_unavailable_here");
      }

      await setPracticeFinishCurrentWeld(transaction, context.character.id, true, now);
      // The weld cannot finish unless it is running, so a bench the player had
      // stopped is resumed here. Resuming a paid weld consumes nothing and
      // rerolls nothing.
      if (!context.action) {
        await transaction.insert(activeActions).values({
          characterId: context.character.id,
          actionId: ACTION_IDS.practiceWelding,
          startedAt: now,
          resolvedThroughAt: now,
        });
      }
      return stateWith(transaction, context.character.id, now);
    },
    now,
  );
}
