import { and, eq } from "drizzle-orm";
import {
  activeActions,
  characterRuneworkingState,
  inventoryStacks,
  type ActiveAction,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  runeworkingActionIds,
  runeworkingRecipeForActionId,
  standardSkillLevelThresholds,
  type RuneworkingRecipeBalance,
} from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { HILLTOP_WORKSHOP_CONTENT } from "@/game/content/hilltop-workshop";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  boundedRunAllowance,
  boundedRunSelectionFromColumn,
  boundedRunSelectionToColumn,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import { levelFromXp } from "@/game/domain/progression";
import {
  resolveRuneworking,
  validateRuneworkingRecipes,
  type RuneworkingCapacitySnapshot,
  type RuneworkingResolution,
  type RuneworkingResolvedCycle,
  type RuneworkingRunSnapshot,
  type RuneworkingStopReason,
} from "@/game/domain/runeworking";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { isMissionCompleted } from "@/server/mission-state";
import { recordTrackedActivity } from "@/server/mission-progress";
import { loadPlaySnapshot } from "@/server/play-state";
import { grantCharacterSkillXp } from "@/server/progression";

// Every authored recipe's inputs and output must stack; fail at module load,
// not in a player's transaction.
validateRuneworkingRecipes();

/**
 * Runeworking's persistence and lazy resolution (#391).
 *
 * The cycle on the Resonance Rig has no payload of its own: its recipe is the
 * active action's ID, its start is the action's durable cursor, and its
 * reserved inputs are that recipe's input set in the real inventory rows.
 * `character_runeworking_state` holds the run and the Finish Current intent.
 * Each window's completed cycles — the inputs they consumed, the Seekers they
 * made, the XP they paid and the Mission progress they earned — commit in the
 * one character transaction that resolved them, before the cursor advances, so
 * a retry, a second tab or an offline catch-up can never count a cycle twice.
 */

type RuneworkingRow = typeof characterRuneworkingState.$inferSelect;

/** One `This Run` entry: an immutable server-resolved cycle. */
export type RuneworkingRunCycle = RuneworkingResolvedCycle & {
  sequence: number;
  resolvedAt: string;
  recipeActionId: string;
};

export type RuneworkingRunState = {
  /** A number of cycles that `cycles` counts toward, or Max, which has none. */
  selection: BoundedRunSelection;
  cycles: number;
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  xpGained: number;
  recentCycles: readonly RuneworkingRunCycle[];
};

export type PersistedRuneworkingOutcome = RuneworkingResolution & {
  characterId: string;
  recipe: RuneworkingRecipeBalance;
  /** When each resolved cycle completed. */
  resolvedAt: readonly string[];
};

export function runeworkingRunStateFromRow(row: RuneworkingRow | undefined): RuneworkingRunState {
  return {
    selection: row
      ? boundedRunSelectionFromColumn(row.runSelectedCycles)
      : BOUNDED_RUN_DEFAULT_QUANTITY,
    cycles: row?.runCycles ?? 0,
    inputsConsumed: (row?.runInputsConsumed as Record<string, number> | undefined) ?? {},
    outputsGained: (row?.runOutputsGained as Record<string, number> | undefined) ?? {},
    xpGained: row?.runXpGained ?? 0,
    recentCycles: (row?.recentCycles as RuneworkingRunCycle[] | undefined) ?? [],
  };
}

/** Create the Rig row on first genuine use; an absent row is the correct initial state. */
export async function ensureRuneworkingState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction
    .insert(characterRuneworkingState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterRuneworkingState.characterId });
}

export async function loadRuneworkingRow(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RuneworkingRow | undefined> {
  const rows = await transaction
    .select()
    .from(characterRuneworkingState)
    .where(eq(characterRuneworkingState.characterId, characterId))
    .for("update");
  return rows[0];
}

/**
 * The Resonance Rig is the player's once the Enby has explained RuneSpace:
 * completing Not From Around Here puts them on it for good, whether or not the
 * First Runeworking Lesson has been accepted. Derived from the Mission record,
 * so there is no second unlock flag to drift.
 */
export async function loadResonanceRigUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  return isMissionCompleted(
    transaction,
    characterId,
    HILLTOP_WORKSHOP_CONTENT.resonanceRigUnlockMissionId,
  );
}

export function isRuneworkingAction(actionId: string | undefined): boolean {
  return actionId !== undefined && runeworkingActionIds().includes(actionId);
}

/** The carried inventory and level a cycle check reads, under the command lock. */
export async function loadRuneworkingCapacity(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RuneworkingCapacitySnapshot> {
  const balance = getEffectiveGameBalance();
  const snapshot = await loadPlaySnapshot(transaction, characterId);
  // No XP row is the canonical zero: Level 1.
  const runeworkingXp =
    snapshot.xpRows.find((row) => row.skillId === SKILL_IDS.runeworking)?.totalXp ?? 0;
  return {
    runeworkingLevel: levelFromXp(runeworkingXp, standardSkillLevelThresholds(balance)),
    stacks: snapshot.stacks,
    slotsAvailable: snapshot.slotsAvailable,
    massAvailableGrams: snapshot.massAvailableGrams,
  };
}

export async function loadRuneworkingSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RuneworkingRunSnapshot> {
  const [capacity, row] = await Promise.all([
    loadRuneworkingCapacity(transaction, characterId),
    loadRuneworkingRow(transaction, characterId),
  ]);
  return {
    ...capacity,
    // No row means no run was ever started, so nothing more may begin.
    allowance: row
      ? boundedRunAllowance(boundedRunSelectionFromColumn(row.runSelectedCycles), row.runCycles)
      : { remaining: 0, exhaustedReason: "run_completed" },
    finishCurrent: row?.finishCurrent ?? false,
  };
}

function mergeTotals(
  existing: unknown,
  addition: Readonly<Record<string, number>>,
): Record<string, number> {
  const merged: Record<string, number> = { ...((existing as Record<string, number>) ?? {}) };
  for (const [itemId, quantity] of Object.entries(addition)) {
    if (quantity > 0) merged[itemId] = (merged[itemId] ?? 0) + quantity;
  }
  return merged;
}

/**
 * Persist one Runeworking resolution. Everything commits in the caller's
 * character transaction: the final stack state the resolution decided, the XP,
 * the run, and one Mission credit per completed cycle.
 */
export async function persistRuneworkingOutcome(
  transaction: DatabaseTransaction,
  outcome: PersistedRuneworkingOutcome,
  now = new Date(),
): Promise<void> {
  const persistedStacks = await transaction
    .select({ id: inventoryStacks.id })
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, outcome.characterId))
    .for("update");
  const persistedIds = new Set(persistedStacks.map((stack) => stack.id));
  // The resolution's final inventory, not a replay of its totals: its snapshot
  // was read under this same transaction's row locks.
  for (const stackId of outcome.deletedStackIds) {
    if (!persistedIds.has(stackId)) {
      throw new Error("Runeworking resolved against a stack that no longer exists");
    }
    await transaction
      .delete(inventoryStacks)
      .where(
        and(eq(inventoryStacks.id, stackId), eq(inventoryStacks.characterId, outcome.characterId)),
      );
  }
  for (const update of outcome.stackUpdates) {
    if (!persistedIds.has(update.id)) {
      throw new Error("Runeworking resolved against a stack that no longer exists");
    }
    await transaction
      .update(inventoryStacks)
      .set({ quantity: update.quantity, updatedAt: now })
      .where(
        and(
          eq(inventoryStacks.id, update.id),
          eq(inventoryStacks.characterId, outcome.characterId),
        ),
      );
  }
  if (outcome.createdStacks.length > 0) {
    await transaction.insert(inventoryStacks).values(
      outcome.createdStacks.map((stack) => ({
        characterId: outcome.characterId,
        itemId: stack.itemId,
        quantity: stack.quantity,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  if (outcome.awardedXp > 0) {
    await grantCharacterSkillXp(transaction, {
      characterId: outcome.characterId,
      skillId: SKILL_IDS.runeworking,
      awardedXp: outcome.awardedXp,
      thresholds: standardSkillLevelThresholds(),
    });
  }

  const row = await loadRuneworkingRow(transaction, outcome.characterId);
  if (!row) throw new Error("Runeworking state must exist before Runeworking persistence");
  const firstSequence = row.runCycles + 1;
  const appended: RuneworkingRunCycle[] = outcome.resolved.map((cycle, index) => ({
    sequence: firstSequence + index,
    resolvedAt: outcome.resolvedAt[index]!,
    recipeActionId: outcome.recipe.actionId,
    ...cycle,
  }));
  await transaction
    .update(characterRuneworkingState)
    .set({
      runCycles: row.runCycles + outcome.resolved.length,
      runInputsConsumed: mergeTotals(row.runInputsConsumed, outcome.inputsConsumed),
      runOutputsGained: mergeTotals(row.runOutputsGained, outcome.outputsGained),
      runXpGained: row.runXpGained + outcome.awardedXp,
      recentCycles: [...((row.recentCycles as RuneworkingRunCycle[]) ?? []), ...appended].slice(
        -10,
      ),
      ...(outcome.stopReason ? { lastStopReason: outcome.stopReason } : {}),
      // Spent the moment it is honoured; leaving it set would end the next run
      // after its first cycle.
      ...(outcome.stopReason === "finished_current" ? { finishCurrent: false } : {}),
      updatedAt: now,
    })
    .where(eq(characterRuneworkingState.characterId, outcome.characterId));

  // Every completed cycle is one successful craft of its own recipe; only an
  // accepted, unfinished Mission that names it is credited, capped at its target.
  await recordTrackedActivity(transaction, {
    characterId: outcome.characterId,
    activity: "runeworking",
    metric: "completions",
    attemptCount: outcome.resolved.length,
    actionId: outcome.recipe.actionId,
  });
}

/**
 * The Runeworking resolver: the ordinary lazy resolution every activity uses,
 * with the ordinary one-hour offline cap.
 */
export function createRuneworkingResolver(): ActionResolver<
  RuneworkingRunSnapshot,
  PersistedRuneworkingOutcome
> {
  return {
    supports: (action: ActiveAction) => isRuneworkingAction(action.actionId),
    load: async (transaction, { character }) => loadRuneworkingSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const recipe = runeworkingRecipeForActionId(action.actionId);
      if (!recipe) throw new Error(`No Runeworking recipe authors action "${action.actionId}"`);
      const resolved = resolveRuneworking({
        elapsedTicks: window.elapsedTicks,
        snapshot: snapshot as RuneworkingRunSnapshot,
        recipe,
      });
      const outcome: PersistedRuneworkingOutcome = {
        characterId: action.characterId,
        recipe,
        ...resolved,
        resolvedAt: resolved.resolved.map((_, index) =>
          new Date(
            window.startsAt.getTime() + ticksToMilliseconds((index + 1) * recipe.durationTicks),
          ).toISOString(),
        ),
      };
      return {
        outcome,
        transition: outcome.stopReason
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => {
      // A window that resolved nothing and ended nothing — the cycle is still
      // running — changes no durable state.
      if (outcome.resolved.length === 0 && !outcome.stopReason) return;
      await persistRuneworkingOutcome(transaction, outcome);
    },
  };
}

/** Write the Rig's run selection and reset `This Run` for a fresh Start. */
export async function resetRuneworkingRun(
  transaction: DatabaseTransaction,
  characterId: string,
  selection: BoundedRunSelection,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterRuneworkingState)
    .set({
      runSelectedCycles: boundedRunSelectionToColumn(selection),
      runCycles: 0,
      runInputsConsumed: {},
      runOutputsGained: {},
      runXpGained: 0,
      recentCycles: [],
      finishCurrent: false,
      lastStopReason: null,
      updatedAt: now,
    })
    .where(eq(characterRuneworkingState.characterId, characterId));
}

/** An operator force-idle: the cycle's inputs were never consumed, so nothing is lost. */
export async function clearRuneworkingCycle(
  transaction: DatabaseTransaction,
  characterId: string,
  stopReason: RuneworkingStopReason,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterRuneworkingState)
    .set({ finishCurrent: false, lastStopReason: stopReason, updatedAt: now })
    .where(eq(characterRuneworkingState.characterId, characterId));
  await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
}
