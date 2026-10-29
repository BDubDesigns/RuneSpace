import { eq } from "drizzle-orm";
import { activeActions, characters, type ActiveAction } from "@/db/rune-space";
import { checkBoundedRunSelection, type BoundedRunSelection } from "@/game/domain/bounded-run";
import type { MiningRandom } from "@/game/domain/mining";
import {
  craftingAffordableCycles,
  craftingRecipeUnlocked,
  craftingStartCheck,
} from "@/game/domain/deterministic-crafting";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import type { createCraftingActivity } from "@/server/deterministic-crafting";

export type CraftingCommandError =
  | "unavailable_here"
  | "locked"
  | "unknown_recipe"
  | "recipe_locked"
  | "insufficient_inputs"
  | "no_room"
  | "quantity_unavailable";
export function createCraftingCommands(
  activity: ReturnType<typeof createCraftingActivity>,
  locationId: string,
  prefix: "runeworking" | "lapidary",
) {
  function stateWith(
    transaction: DatabaseTransaction,
    characterId: string,
    now: Date,
    error?: CraftingCommandError | "another_action_active",
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
      error && error !== "another_action_active"
        ? { [`${prefix}Error`]: `${prefix}_${error}` }
        : undefined,
    );
  }

  async function standingAtStation(transaction: DatabaseTransaction, characterId: string) {
    const rows = await transaction
      .select({ currentLocationId: characters.currentLocationId })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return rows[0]?.currentLocationId === locationId;
  }

  function runCraftingCommand(
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
   * Start a Crafting run: bind the first cycle.
   *
   * A number is a bounded count of cycles, revalidated against what the inputs
   * carried now pay for and refused — never shortened — when it no longer fits.
   * Max needs only that this first cycle can begin. The cycle's input set is
   * reserved from this instant; nothing about later cycles is.
   */
  async function startCrafting(
    userId: string,
    characterId: string,
    recipeActionId: string,
    selection: BoundedRunSelection = 1,
    now = new Date(),
    random: MiningRandom = defaultMiningRandom(),
  ): Promise<PlayGameplayState> {
    return runCraftingCommand(
      userId,
      characterId,
      now,
      random,
      async (transaction, { characterId: id, action }) => {
        const recipe = activity.config
          .recipes()
          .find((recipe) => recipe.actionId === recipeActionId);
        if (!recipe) return stateWith(transaction, id, now, "unknown_recipe");
        // Idempotent: a retried Start of the run already on the Rig changes
        // nothing. Anything else running is a different activity.
        if (action?.actionId === recipe.actionId) return stateWith(transaction, id, now);
        if (action) return stateWith(transaction, id, now, "another_action_active");
        if (!(await standingAtStation(transaction, id))) {
          return stateWith(transaction, id, now, "unavailable_here");
        }
        const access = await activity.config.loadAccess(transaction, id);
        if (
          access.kind === "locked" ||
          (access.kind === "supervised" && access.actionId !== recipe.actionId)
        ) {
          return stateWith(transaction, id, now, "locked");
        }
        if (access.kind === "supervised" && selection !== 1)
          return stateWith(transaction, id, now, "quantity_unavailable");
        const capacity = await activity.loadCapacity(transaction, id);
        if (!craftingRecipeUnlocked(capacity.skillLevel, recipe)) {
          return stateWith(transaction, id, now, "recipe_locked");
        }
        const quantityCheck = checkBoundedRunSelection(
          selection,
          craftingAffordableCycles(capacity, recipe),
        );
        if (!quantityCheck.ok) {
          return stateWith(
            transaction,
            id,
            now,
            quantityCheck.reason === "unavailable" ? "insufficient_inputs" : "quantity_unavailable",
          );
        }
        const first = craftingStartCheck(capacity, recipe);
        if (!first.ok) {
          return stateWith(
            transaction,
            id,
            now,
            first.reason === "insufficient_inputs"
              ? "insufficient_inputs"
              : first.reason === "recipe_locked"
                ? "recipe_locked"
                : "no_room",
          );
        }
        await activity.ensureState(transaction, id);
        await activity.resetRun(
          transaction,
          id,
          quantityCheck.selection,
          now,
          access.kind === "supervised" ? access.stageId : null,
        );
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
   * Stop, for a Crafting run, is Finish Current: the cycle on the Rig
   * completes exactly as it would have — its Seeker made, its XP paid — and no
   * next cycle begins or reserves anything. It never cancels.
   */
  async function finishCurrentCrafting(
    userId: string,
    characterId: string,
    now = new Date(),
    random: MiningRandom = defaultMiningRandom(),
  ): Promise<PlayGameplayState> {
    return runCraftingCommand(
      userId,
      characterId,
      now,
      random,
      async (transaction, { characterId: id, action }) => {
        // Reconciliation may already have ended the run — which is exactly what
        // was asked for.
        if (!activity.isAction(action?.actionId)) return stateWith(transaction, id, now);
        await transaction
          .update(activity.config.table)
          .set({ finishCurrent: true, updatedAt: now })
          .where(eq(activity.config.table.characterId, id));
        return stateWith(transaction, id, now);
      },
    );
  }

  return { start: startCrafting, finishCurrent: finishCurrentCrafting };
}
