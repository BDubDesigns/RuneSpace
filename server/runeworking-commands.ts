import { eq } from "drizzle-orm";
import {
  activeActions,
  characterRuneworkingState,
  characters,
  type ActiveAction,
} from "@/db/rune-space";
import { runeworkingRecipeForActionId } from "@/game/config/balance";
import { HILLTOP_WORKSHOP_CONTENT } from "@/game/content/hilltop-workshop";
import { checkBoundedRunSelection, type BoundedRunSelection } from "@/game/domain/bounded-run";
import type { MiningRandom } from "@/game/domain/mining";
import {
  runeworkingAffordableCycles,
  runeworkingRecipeUnlocked,
  runeworkingStartCheck,
} from "@/game/domain/runeworking";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  ensureRuneworkingState,
  isRuneworkingAction,
  loadResonanceRigUnlocked,
  loadRuneworkingCapacity,
  resetRuneworkingRun,
} from "@/server/runeworking";

/**
 * Runeworking's player commands (#391).
 *
 * Every rule is revalidated inside the character lock after any due work has
 * resolved: that the player is standing at Hilltop Workshop, that the Rig is
 * theirs (Not From Around Here is complete), the recipe's level, the selection,
 * and that the first cycle can genuinely begin. The browser sends intent only —
 * a recipe and a selection.
 *
 * There is deliberately no cancel. Once a cycle is on the Rig it completes;
 * "stop" on a run means Finish Current.
 */

export type RuneworkingCommandError =
  | "runeworking_unavailable_here"
  | "runeworking_locked"
  | "runeworking_unknown_recipe"
  | "runeworking_recipe_locked"
  | "runeworking_insufficient_inputs"
  | "runeworking_no_room"
  /** The selected number exceeds what the inputs now pay for (#229); choose again. */
  | "runeworking_quantity_unavailable";

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  error?: RuneworkingCommandError | "another_action_active",
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
    error && error !== "another_action_active" ? { runeworkingError: error } : undefined,
  );
}

async function standingAtHilltop(transaction: DatabaseTransaction, characterId: string) {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId === HILLTOP_WORKSHOP_CONTENT.locationId;
}

function runRuneworkingCommand(
  userId: string,
  characterId: string,
  now: Date,
  random: MiningRandom,
  command: (
    transaction: DatabaseTransaction,
    context: { characterId: string; action: ActiveAction | undefined },
  ) => Promise<PlayGameplayState>,
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return command(transaction, { characterId: context.character.id, action: context.action });
    },
    now,
  );
}

/**
 * Start a Runeworking run: bind the first cycle.
 *
 * A number is a bounded count of cycles, revalidated against what the inputs
 * carried now pay for and refused — never shortened — when it no longer fits.
 * Max needs only that this first cycle can begin. The cycle's input set is
 * reserved from this instant; nothing about later cycles is.
 */
export async function startRuneworking(
  userId: string,
  characterId: string,
  recipeActionId: string,
  selection: BoundedRunSelection = 1,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runRuneworkingCommand(
    userId,
    characterId,
    now,
    random,
    async (transaction, { characterId: id, action }) => {
      const recipe = runeworkingRecipeForActionId(recipeActionId);
      if (!recipe) return stateWith(transaction, id, now, "runeworking_unknown_recipe");
      // Idempotent: a retried Start of the run already on the Rig changes
      // nothing. Anything else running is a different activity.
      if (action?.actionId === recipe.actionId) return stateWith(transaction, id, now);
      if (action) return stateWith(transaction, id, now, "another_action_active");
      if (!(await standingAtHilltop(transaction, id))) {
        return stateWith(transaction, id, now, "runeworking_unavailable_here");
      }
      if (!(await loadResonanceRigUnlocked(transaction, id))) {
        return stateWith(transaction, id, now, "runeworking_locked");
      }
      const capacity = await loadRuneworkingCapacity(transaction, id);
      if (!runeworkingRecipeUnlocked(capacity.runeworkingLevel, recipe)) {
        return stateWith(transaction, id, now, "runeworking_recipe_locked");
      }
      const quantityCheck = checkBoundedRunSelection(
        selection,
        runeworkingAffordableCycles(capacity, recipe),
      );
      if (!quantityCheck.ok) {
        return stateWith(
          transaction,
          id,
          now,
          quantityCheck.reason === "unavailable"
            ? "runeworking_insufficient_inputs"
            : "runeworking_quantity_unavailable",
        );
      }
      const first = runeworkingStartCheck(capacity, recipe);
      if (!first.ok) {
        return stateWith(
          transaction,
          id,
          now,
          first.reason === "insufficient_inputs"
            ? "runeworking_insufficient_inputs"
            : first.reason === "recipe_locked"
              ? "runeworking_recipe_locked"
              : "runeworking_no_room",
        );
      }
      await ensureRuneworkingState(transaction, id);
      await resetRuneworkingRun(transaction, id, quantityCheck.selection, now);
      await transaction.insert(activeActions).values({
        characterId: id,
        actionId: recipe.actionId,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return stateWith(transaction, id, now);
    },
  );
}

/**
 * Stop, for a Runeworking run, is Finish Current: the cycle on the Rig
 * completes exactly as it would have — its Seeker made, its XP paid — and no
 * next cycle begins or reserves anything. It never cancels.
 */
export async function finishCurrentRuneworking(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runRuneworkingCommand(
    userId,
    characterId,
    now,
    random,
    async (transaction, { characterId: id, action }) => {
      // Reconciliation may already have ended the run — which is exactly what
      // was asked for.
      if (!isRuneworkingAction(action?.actionId)) return stateWith(transaction, id, now);
      await transaction
        .update(characterRuneworkingState)
        .set({ finishCurrent: true, updatedAt: now })
        .where(eq(characterRuneworkingState.characterId, id));
      return stateWith(transaction, id, now);
    },
  );
}
