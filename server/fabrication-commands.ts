import { eq } from "drizzle-orm";
import {
  activeActions,
  characterFabricationState,
  characters,
  type ActiveAction,
} from "@/db/rune-space";
import { fabricationRecipeForActionId, type FabricationRecipeBalance } from "@/game/config/balance";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { checkBoundedRunSelection, type BoundedRunSelection } from "@/game/domain/bounded-run";
import {
  fabricationAffordableBatches,
  fabricationRecipeUnlocked,
  fabricationStartCheck,
} from "@/game/domain/fabrication";
import {
  overrideCanPush,
  overridePushes,
  pushManualOverride,
  startManualOverride,
  type ManualOverrideState,
  type OverrideRandom,
} from "@/game/domain/manual-override";
import type { MiningRandom } from "@/game/domain/mining";
import { millisecondsToWholeTicks } from "@/game/domain/timing";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import {
  defaultOverrideRandom,
  ensureFabricationState,
  isFabricationAction,
  loadFabricationCapacity,
  loadFabricationRow,
  loadFabricationUnlocked,
  overrideColumns,
  overrideFromRow,
  resetFabricationRun,
  resolveFabricationWorkpieceOnCommand,
} from "@/server/fabrication";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * Fabrication's player commands (#232).
 *
 * Every rule is revalidated inside the character lock after any due work has
 * resolved: that the player is standing at Rusk Recovery, that Tansy has put
 * them on the station, the recipe's level, the selection, and that the first
 * workpiece can genuinely begin. The browser sends intent only — a recipe, a
 * selection, a Feed.
 *
 * There is deliberately no cancel. Once a workpiece is on the machine the only
 * ways off it are success and bust; "stop" on a run means Finish Current.
 */

export type FabricationCommandError =
  | "fabrication_unavailable_here"
  | "fabrication_locked"
  | "fabrication_unknown_recipe"
  | "fabrication_recipe_locked"
  | "fabrication_insufficient_inputs"
  | "fabrication_no_room"
  /** The selected number exceeds what the inputs now pay for (#229); choose again. */
  | "fabrication_quantity_unavailable"
  /** A Manual Override command arrived with no workpiece on the machine. */
  | "fabrication_not_active"
  /** Override is off, locked in, or out of pushes on this workpiece. */
  | "fabrication_override_unavailable"
  /**
   * A push or Lock In aimed at a machine state that has already moved on —
   * another push, or another workpiece. Nothing was changed.
   */
  | "fabrication_stale_push";

type CommandRandoms = { random: MiningRandom; overrideRandom: OverrideRandom };

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  error?: FabricationCommandError | "another_action_active",
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
    error && error !== "another_action_active" ? { fabricationError: error } : undefined,
  );
}

async function standingAtRusk(transaction: DatabaseTransaction, characterId: string) {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId === RUSK_RECOVERY_CONTENT.locationId;
}

/** The run's number for the workpiece on the machine: every resolved one, plus this. */
function currentWorkpiece(row: { runBatches: number } | undefined): number {
  return (row?.runBatches ?? 0) + 1;
}

/** Whether the workpiece on the machine has reached its timer's end. */
function timerHasRunOut(
  action: ActiveAction,
  recipe: FabricationRecipeBalance,
  now: Date,
): boolean {
  const elapsed = Math.max(0, now.getTime() - action.resolvedThroughAt.getTime());
  return millisecondsToWholeTicks(elapsed) >= recipe.durationTicks;
}

function runFabricationCommand(
  userId: string,
  characterId: string,
  now: Date,
  randoms: CommandRandoms,
  command: (
    transaction: DatabaseTransaction,
    context: { characterId: string; action: ActiveAction | undefined },
  ) => Promise<PlayGameplayState>,
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      randoms.random,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      randoms.overrideRandom,
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return command(transaction, { characterId: context.character.id, action: context.action });
    },
    now,
  );
}

/**
 * Start a Fabrication run: bind the first workpiece.
 *
 * A number is a bounded count of recipe batches, revalidated against what the
 * inputs carried now pay for and refused — never shortened — when it no longer
 * fits. Max needs only that this first workpiece can begin. The workpiece's
 * input set is reserved from this instant; nothing about later batches is.
 */
export async function startFabrication(
  userId: string,
  characterId: string,
  recipeActionId: string,
  selection: BoundedRunSelection = 1,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): Promise<PlayGameplayState> {
  return runFabricationCommand(
    userId,
    characterId,
    now,
    { random, overrideRandom },
    async (transaction, { characterId: id, action }) => {
      const recipe = fabricationRecipeForActionId(recipeActionId);
      if (!recipe) return stateWith(transaction, id, now, "fabrication_unknown_recipe");
      // Idempotent: a retried Start of the workpiece already on the machine
      // changes nothing. Anything else running is a different activity.
      if (action?.actionId === recipe.actionId) return stateWith(transaction, id, now);
      if (action) return stateWith(transaction, id, now, "another_action_active");
      if (!(await standingAtRusk(transaction, id))) {
        return stateWith(transaction, id, now, "fabrication_unavailable_here");
      }
      if (!(await loadFabricationUnlocked(transaction, id))) {
        return stateWith(transaction, id, now, "fabrication_locked");
      }
      const capacity = await loadFabricationCapacity(transaction, id);
      if (!fabricationRecipeUnlocked(capacity.fabricationLevel, recipe)) {
        return stateWith(transaction, id, now, "fabrication_recipe_locked");
      }
      const quantityCheck = checkBoundedRunSelection(
        selection,
        fabricationAffordableBatches(capacity, recipe),
      );
      if (!quantityCheck.ok) {
        return stateWith(
          transaction,
          id,
          now,
          quantityCheck.reason === "unavailable"
            ? "fabrication_insufficient_inputs"
            : "fabrication_quantity_unavailable",
        );
      }
      const first = fabricationStartCheck(capacity, recipe);
      if (!first.ok) {
        return stateWith(
          transaction,
          id,
          now,
          first.reason === "insufficient_inputs"
            ? "fabrication_insufficient_inputs"
            : first.reason === "recipe_locked"
              ? "fabrication_recipe_locked"
              : "fabrication_no_room",
        );
      }
      await ensureFabricationState(transaction, id);
      const row = await loadFabricationRow(transaction, id);
      // With the station's Override already on, this workpiece is an Override
      // workpiece from the moment it begins.
      const override = row?.manualOverrideEnabled ? startManualOverride(overrideRandom) : undefined;
      await resetFabricationRun(transaction, id, quantityCheck.selection, override, now);
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
 * Stop, for a Fabrication run, is Finish Current: the workpiece on the machine
 * resolves exactly as it would have — success, or whatever its Override brings
 * — and no next workpiece begins or reserves anything. It never cancels.
 */
export async function finishCurrentFabrication(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): Promise<PlayGameplayState> {
  return runFabricationCommand(
    userId,
    characterId,
    now,
    { random, overrideRandom },
    async (transaction, { characterId: id, action }) => {
      // Reconciliation may already have ended the run — which is exactly what
      // was asked for.
      if (!isFabricationAction(action?.actionId)) return stateWith(transaction, id, now);
      await transaction
        .update(characterFabricationState)
        .set({ finishCurrent: true, updatedAt: now })
        .where(eq(characterFabricationState.characterId, id));
      return stateWith(transaction, id, now);
    },
  );
}

/**
 * Resolve the workpiece on the spot when its multiplier is committed at or
 * after timer 0. Before timer 0 a Lock In just commits and the timer runs on.
 */
async function resolveIfTimerRanOut(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    action: ActiveAction;
    recipe: FabricationRecipeBalance;
    overrideRandom: OverrideRandom;
    now: Date;
  },
): Promise<void> {
  if (!timerHasRunOut(input.action, input.recipe, input.now)) return;
  await resolveFabricationWorkpieceOnCommand(transaction, {
    characterId: input.characterId,
    action: input.action,
    result: "success",
    random: input.overrideRandom,
    now: input.now,
  });
}

async function writeOverride(
  transaction: DatabaseTransaction,
  characterId: string,
  state: ManualOverrideState | undefined,
  now: Date,
) {
  await transaction
    .update(characterFabricationState)
    .set({ ...overrideColumns(state), updatedAt: now })
    .where(eq(characterFabricationState.characterId, characterId));
}

/**
 * The station's Manual Override toggle.
 *
 * On: a workpiece already on the machine becomes an Override workpiece at
 * 1.00× with a Load and Trend rolled now — once; if it already has a machine
 * state (even a locked one), nothing is rerolled. Off: an unlocked machine
 * locks in at what it has earned, resolving at once if its timer has run out,
 * and following workpieces are ordinary 1.00× workpieces.
 */
export async function setManualOverride(
  userId: string,
  characterId: string,
  enabled: boolean,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): Promise<PlayGameplayState> {
  return runFabricationCommand(
    userId,
    characterId,
    now,
    { random, overrideRandom },
    async (transaction, { characterId: id, action }) => {
      if (!(await loadFabricationUnlocked(transaction, id))) {
        return stateWith(transaction, id, now, "fabrication_locked");
      }
      await ensureFabricationState(transaction, id);
      await transaction
        .update(characterFabricationState)
        .set({ manualOverrideEnabled: enabled, updatedAt: now })
        .where(eq(characterFabricationState.characterId, id));
      const recipe = action ? fabricationRecipeForActionId(action.actionId) : undefined;
      if (!action || !recipe) return stateWith(transaction, id, now);
      const override = overrideFromRow(await loadFabricationRow(transaction, id));
      if (enabled && !override) {
        await writeOverride(transaction, id, startManualOverride(overrideRandom), now);
      } else if (!enabled && override && !override.locked) {
        await writeOverride(transaction, id, { ...override, locked: true }, now);
        await resolveIfTimerRanOut(transaction, {
          characterId: id,
          action,
          recipe,
          overrideRandom,
          now,
        });
      }
      return stateWith(transaction, id, now);
    },
  );
}

/**
 * Push the machine once with the player's Feed.
 *
 * `expectedWorkpiece` and `expectedPushes` are the workpiece number and push
 * count the player's screen showed: a retried or duplicated request for a push
 * that already happened finds the machine moved on — another push, or another
 * workpiece altogether — and pushes nothing, so no request can roll the machine
 * twice or land on a workpiece the player never looked at. A miss busts
 * the workpiece on the spot — the complete input set consumed, no output, no
 * XP — and the run carries on exactly as the timer would have.
 */
export async function pushFabricationOverride(
  userId: string,
  characterId: string,
  feed: number,
  expectedWorkpiece: number,
  expectedPushes: number,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): Promise<PlayGameplayState> {
  return runFabricationCommand(
    userId,
    characterId,
    now,
    { random, overrideRandom },
    async (transaction, { characterId: id, action }) => {
      const recipe = action ? fabricationRecipeForActionId(action.actionId) : undefined;
      if (!action || !recipe) return stateWith(transaction, id, now, "fabrication_not_active");
      const row = await loadFabricationRow(transaction, id);
      if (currentWorkpiece(row) !== expectedWorkpiece) {
        return stateWith(transaction, id, now, "fabrication_stale_push");
      }
      const override = overrideFromRow(row);
      if (!override || !overrideCanPush(override)) {
        return stateWith(transaction, id, now, "fabrication_override_unavailable");
      }
      if (overridePushes(override) !== expectedPushes) {
        return stateWith(transaction, id, now, "fabrication_stale_push");
      }
      const push = pushManualOverride(override, feed, overrideRandom);
      if (push.kind === "bust") {
        await resolveFabricationWorkpieceOnCommand(transaction, {
          characterId: id,
          action,
          result: "bust",
          bust: { feed: push.feed, load: push.load },
          random: overrideRandom,
          now,
        });
        return stateWith(transaction, id, now);
      }
      await writeOverride(transaction, id, push.state, now);
      // The fifth successful push locks in by itself.
      if (push.state.locked) {
        await resolveIfTimerRanOut(transaction, {
          characterId: id,
          action,
          recipe,
          overrideRandom,
          now,
        });
      }
      return stateWith(transaction, id, now);
    },
  );
}

/**
 * Commit the multiplier earned so far. Before timer 0 the workpiece runs out
 * its timer normally; at or after it, the workpiece resolves now. Locking an
 * already-locked machine changes nothing, and a Lock In aimed at a workpiece
 * that has since resolved never touches the next one.
 */
export async function lockInFabricationOverride(
  userId: string,
  characterId: string,
  expectedWorkpiece: number,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): Promise<PlayGameplayState> {
  return runFabricationCommand(
    userId,
    characterId,
    now,
    { random, overrideRandom },
    async (transaction, { characterId: id, action }) => {
      const recipe = action ? fabricationRecipeForActionId(action.actionId) : undefined;
      if (!action || !recipe) return stateWith(transaction, id, now, "fabrication_not_active");
      const row = await loadFabricationRow(transaction, id);
      if (currentWorkpiece(row) !== expectedWorkpiece) {
        return stateWith(transaction, id, now, "fabrication_stale_push");
      }
      const override = overrideFromRow(row);
      if (!override) return stateWith(transaction, id, now, "fabrication_override_unavailable");
      if (!override.locked)
        await writeOverride(transaction, id, { ...override, locked: true }, now);
      await resolveIfTimerRanOut(transaction, {
        characterId: id,
        action,
        recipe,
        overrideRandom,
        now,
      });
      return stateWith(transaction, id, now);
    },
  );
}
