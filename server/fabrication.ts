import { and, eq } from "drizzle-orm";
import { randomInt } from "node:crypto";
import {
  activeActions,
  characterFabricationState,
  inventoryStacks,
  itemInstances,
  type ActiveAction,
} from "@/db/rune-space";
import {
  fabricationActionIds,
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getItemMaximumCharge,
  standardSkillLevelThresholds,
  type FabricationRecipeBalance,
} from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  boundedRunAllowance,
  boundedRunSelectionFromColumn,
  boundedRunSelectionToColumn,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import {
  type FabricationCapacitySnapshot,
  type FabricationResolution,
  type FabricationResolvedWorkpiece,
  type FabricationRunSnapshot,
  type FabricationStopReason,
  resolveFabrication,
  resolveFabricationWorkpieceNow,
  validateFabricationRecipes,
} from "@/game/domain/fabrication";
import type {
  ManualOverrideState,
  OverrideRandom,
  OverrideTrend,
} from "@/game/domain/manual-override";
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { isMissionAccepted } from "@/server/mission-state";
import { recordFabricationOutcomes } from "@/server/mission-progress";
import { loadPlaySnapshot } from "@/server/play-state";
import { grantCharacterSkillXp } from "@/server/progression";

// Every authored recipe's inputs must stack; fail at module load, not in a
// player's transaction.
validateFabricationRecipes();

/**
 * Fabrication's persistence and lazy resolution (#232).
 *
 * The workpiece on the machine has no payload of its own: its recipe is the
 * active action's ID, its start is the action's durable cursor, and its
 * reserved inputs are that recipe's input set in the real inventory rows.
 * `character_fabrication_state` holds the run, the Finish Current intent, the
 * Manual Override toggle, and — once Override is on the workpiece — its
 * machine state, so nothing the player sees can be rerolled by a reload.
 */

const systemOverrideRandom: OverrideRandom = { nextInt: (n) => randomInt(n) };

/**
 * CI-only deterministic Manual Override source for the browser journey: every
 * draw is the lowest, so a workpiece starts at Load 2 trending HIGHER and each
 * push rolls the Load up by exactly one. Selected only by explicit CI
 * configuration, never by a request or ordinary runtime user.
 */
const e2eOverrideRandom: OverrideRandom = { nextInt: () => 0 };

export function defaultOverrideRandom(): OverrideRandom {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_MINING === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
    ? e2eOverrideRandom
    : systemOverrideRandom;
}

type FabricationRow = typeof characterFabricationState.$inferSelect;

/** One `This Run` entry: an immutable server-resolved workpiece. */
export type FabricationRunWorkpiece = FabricationResolvedWorkpiece & {
  sequence: number;
  resolvedAt: string;
  recipeActionId: string;
};

export type FabricationRunState = {
  /** A number of batches that `batches` counts toward, or Max, which has none. */
  selection: BoundedRunSelection;
  batches: number;
  successes: number;
  busts: number;
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  xpGained: number;
  recentWorkpieces: readonly FabricationRunWorkpiece[];
};

export type PersistedFabricationOutcome = FabricationResolution & {
  characterId: string;
  recipe: FabricationRecipeBalance;
  /** When each resolved workpiece resolved. */
  resolvedAt: readonly string[];
};

export function overrideFromRow(row: FabricationRow | undefined): ManualOverrideState | undefined {
  if (!row || row.overrideLoad === null || row.overrideTrend === null) return undefined;
  const lastPush = row.overrideLastPush as ManualOverrideState["lastPush"] | null;
  return {
    load: row.overrideLoad,
    trend: row.overrideTrend as OverrideTrend,
    safePushes: row.overrideSafePushes,
    exactPushes: row.overrideExactPushes,
    locked: row.overrideLocked,
    ...(lastPush ? { lastPush } : {}),
  };
}

/** The columns one workpiece's machine state is written to; all cleared when it has none. */
export function overrideColumns(state: ManualOverrideState | undefined) {
  return {
    overrideLoad: state?.load ?? null,
    overrideTrend: state?.trend ?? null,
    overrideSafePushes: state?.safePushes ?? 0,
    overrideExactPushes: state?.exactPushes ?? 0,
    overrideLocked: state?.locked ?? false,
    overrideLastPush: state?.lastPush ?? null,
  };
}

export function fabricationRunStateFromRow(row: FabricationRow | undefined): FabricationRunState {
  return {
    selection: row
      ? boundedRunSelectionFromColumn(row.runSelectedBatches)
      : BOUNDED_RUN_DEFAULT_QUANTITY,
    batches: row?.runBatches ?? 0,
    successes: row?.runSuccesses ?? 0,
    busts: row?.runBusts ?? 0,
    inputsConsumed: (row?.runInputsConsumed as Record<string, number> | undefined) ?? {},
    outputsGained: (row?.runOutputsGained as Record<string, number> | undefined) ?? {},
    xpGained: row?.runXpGained ?? 0,
    recentWorkpieces: (row?.recentWorkpieces as FabricationRunWorkpiece[] | undefined) ?? [],
  };
}

/** Create the station row on first genuine use; an absent row is the correct initial state. */
export async function ensureFabricationState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction
    .insert(characterFabricationState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterFabricationState.characterId });
}

export async function loadFabricationRow(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<FabricationRow | undefined> {
  const rows = await transaction
    .select()
    .from(characterFabricationState)
    .where(eq(characterFabricationState.characterId, characterId))
    .for("update");
  return rows[0];
}

/**
 * Fabricate is Tansy's to open: accepting Return the Favor puts the player on
 * the station, and it stays theirs after. Derived from the Mission record, so
 * there is no second unlock flag to drift.
 */
export async function loadFabricationUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  return isMissionAccepted(
    transaction,
    characterId,
    RUSK_RECOVERY_CONTENT.fabricationAuthorizingMissionId,
  );
}

export function isFabricationAction(actionId: string | undefined): boolean {
  return actionId !== undefined && fabricationActionIds().includes(actionId);
}

/** The carried inventory and level a workpiece check reads, under the command lock. */
export async function loadFabricationCapacity(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<FabricationCapacitySnapshot> {
  const balance = getEffectiveGameBalance();
  const snapshot = await loadPlaySnapshot(transaction, characterId);
  const fabricationXp =
    snapshot.xpRows.find((row) => row.skillId === SKILL_IDS.fabrication)?.totalXp ?? 0;
  return {
    fabricationLevel: levelFromXp(fabricationXp, standardSkillLevelThresholds(balance)),
    stacks: snapshot.stacks,
    slotsAvailable: snapshot.slotsAvailable,
    massAvailableGrams: snapshot.massAvailableGrams,
  };
}

export async function loadFabricationSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<FabricationRunSnapshot> {
  const [capacity, row] = await Promise.all([
    loadFabricationCapacity(transaction, characterId),
    loadFabricationRow(transaction, characterId),
  ]);
  const override = overrideFromRow(row);
  return {
    ...capacity,
    // No row means no run was ever started, so nothing more may begin.
    allowance: row
      ? boundedRunAllowance(boundedRunSelectionFromColumn(row.runSelectedBatches), row.runBatches)
      : { remaining: 0, exhaustedReason: "run_completed" },
    finishCurrent: row?.finishCurrent ?? false,
    overrideEnabled: row?.manualOverrideEnabled ?? false,
    ...(override ? { override } : {}),
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
 * Persist one Fabrication resolution — whether the timer resolved it lazily or
 * the player's Lock In or bust resolved it on the spot. Everything commits in
 * the caller's character transaction: the final stack state the resolution
 * decided, the new unique outputs, the XP, the run, the next workpiece's
 * machine state, and the narrow Mission facts.
 */
export async function persistFabricationOutcome(
  transaction: DatabaseTransaction,
  outcome: PersistedFabricationOutcome,
  now = new Date(),
): Promise<void> {
  const balance = getEffectiveGameBalance();
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
      throw new Error("Fabrication resolved against a stack that no longer exists");
    }
    await transaction
      .delete(inventoryStacks)
      .where(
        and(eq(inventoryStacks.id, stackId), eq(inventoryStacks.characterId, outcome.characterId)),
      );
  }
  for (const update of outcome.stackUpdates) {
    if (!persistedIds.has(update.id)) {
      throw new Error("Fabrication resolved against a stack that no longer exists");
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
  if (outcome.uniqueItemsCreated > 0) {
    // Another ordinary instance of the item, created exactly as any other new
    // instance is: a chargeable item arrives at its uncharged state — the
    // recipe's Power Cell is a construction component, not stored charge.
    const maximumCharge = getItemMaximumCharge(outcome.recipe.outputItemId);
    await transaction.insert(itemInstances).values(
      Array.from({ length: outcome.uniqueItemsCreated }, () => ({
        characterId: outcome.characterId,
        itemId: outcome.recipe.outputItemId,
        currentCharge: maximumCharge === undefined ? null : 0,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  if (outcome.awardedXp > 0) {
    await grantCharacterSkillXp(transaction, {
      characterId: outcome.characterId,
      skillId: SKILL_IDS.fabrication,
      awardedXp: outcome.awardedXp,
      thresholds: standardSkillLevelThresholds(balance),
    });
  }

  const row = await loadFabricationRow(transaction, outcome.characterId);
  if (!row) throw new Error("Fabrication state must exist before Fabrication persistence");
  const firstSequence = row.runBatches + 1;
  const appended: FabricationRunWorkpiece[] = outcome.resolved.map((workpiece, index) => ({
    sequence: firstSequence + index,
    resolvedAt: outcome.resolvedAt[index]!,
    recipeActionId: outcome.recipe.actionId,
    ...workpiece,
  }));
  const successes = outcome.resolved.filter((workpiece) => workpiece.result === "success").length;
  await transaction
    .update(characterFabricationState)
    .set({
      runBatches: row.runBatches + outcome.resolved.length,
      runSuccesses: row.runSuccesses + successes,
      runBusts: row.runBusts + (outcome.resolved.length - successes),
      runInputsConsumed: mergeTotals(row.runInputsConsumed, outcome.inputsConsumed),
      runOutputsGained: mergeTotals(row.runOutputsGained, outcome.outputsGained),
      runXpGained: row.runXpGained + outcome.awardedXp,
      recentWorkpieces: [
        ...((row.recentWorkpieces as FabricationRunWorkpiece[]) ?? []),
        ...appended,
      ].slice(-10),
      // The workpiece now on the machine — a fresh one after any resolution —
      // carries only its own machine state, or none.
      ...overrideColumns(outcome.override),
      ...(outcome.stopReason ? { lastStopReason: outcome.stopReason } : {}),
      // Spent the moment it is honoured; leaving it set would end the next run
      // after its first workpiece.
      ...(outcome.stopReason === "finished_current" ? { finishCurrent: false } : {}),
      updatedAt: now,
    })
    .where(eq(characterFabricationState.characterId, outcome.characterId));

  await recordFabricationOutcomes(transaction, {
    characterId: outcome.characterId,
    actionId: outcome.recipe.actionId,
    outcomes: outcome.resolved.map((workpiece) => ({
      result: workpiece.result,
      usedOverride: workpiece.usedOverride,
    })),
  });
}

/**
 * The Fabrication resolver: the ordinary lazy resolution every activity uses,
 * with the ordinary one-hour offline cap. A workpiece held at 0 for an
 * Override decision simply consumes no ticks until the player decides.
 */
export function createFabricationResolver(
  random: OverrideRandom = defaultOverrideRandom(),
): ActionResolver<FabricationRunSnapshot, PersistedFabricationOutcome> {
  return {
    supports: (action: ActiveAction) => isFabricationAction(action.actionId),
    load: async (transaction, { character }) => loadFabricationSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const recipe = fabricationRecipeForActionId(action.actionId);
      if (!recipe) throw new Error(`No Fabrication recipe authors action "${action.actionId}"`);
      const resolved = resolveFabrication({
        elapsedTicks: window.elapsedTicks,
        snapshot: snapshot as FabricationRunSnapshot,
        recipe,
        random,
      });
      const outcome: PersistedFabricationOutcome = {
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
      // A window that resolved nothing and ended nothing — the workpiece is
      // still running, or held at 0 — changes no durable state.
      if (outcome.resolved.length === 0 && !outcome.stopReason) return;
      await persistFabricationOutcome(transaction, outcome);
    },
  };
}

/**
 * Resolve the workpiece on the machine right now, at the player's command —
 * Lock In (or Override switched off, or a fifth push) at or after timer 0, or
 * a bust — and then start the next workpiece at this instant or end the run,
 * exactly as the timer would have. Returns whether the run continues.
 */
export async function resolveFabricationWorkpieceOnCommand(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    action: ActiveAction;
    result: "success" | "bust";
    /** For a bust: the Feed and the Load that busted it. */
    bust?: { feed: number; load: number };
    random: OverrideRandom;
    now: Date;
  },
): Promise<{ continues: boolean }> {
  const recipe = fabricationRecipeForActionId(input.action.actionId);
  if (!recipe) throw new Error(`No Fabrication recipe authors action "${input.action.actionId}"`);
  const snapshot = await loadFabricationSnapshot(transaction, input.characterId);
  const resolved = resolveFabricationWorkpieceNow({
    snapshot,
    recipe,
    result: input.result,
    ...(input.bust ? { bust: input.bust } : {}),
    random: input.random,
  });
  await persistFabricationOutcome(
    transaction,
    {
      characterId: input.characterId,
      recipe,
      ...resolved,
      resolvedAt: resolved.resolved.map(() => input.now.toISOString()),
    },
    input.now,
  );
  if (resolved.stopReason) {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, input.characterId));
    return { continues: false };
  }
  // The next workpiece begins now: the cursor is always the start of the
  // workpiece on the machine.
  await transaction
    .update(activeActions)
    .set({ resolvedThroughAt: input.now })
    .where(eq(activeActions.characterId, input.characterId));
  return { continues: true };
}

/** Write the station's run selection and reset `This Run` for a fresh Start. */
export async function resetFabricationRun(
  transaction: DatabaseTransaction,
  characterId: string,
  selection: BoundedRunSelection,
  override: ManualOverrideState | undefined,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterFabricationState)
    .set({
      runSelectedBatches: boundedRunSelectionToColumn(selection),
      runBatches: 0,
      runSuccesses: 0,
      runBusts: 0,
      runInputsConsumed: {},
      runOutputsGained: {},
      runXpGained: 0,
      recentWorkpieces: [],
      finishCurrent: false,
      lastStopReason: null,
      ...overrideColumns(override),
      updatedAt: now,
    })
    .where(eq(characterFabricationState.characterId, characterId));
}

/** An operator force-idle: the workpiece's inputs were never consumed, so nothing is lost. */
export async function clearFabricationWorkpiece(
  transaction: DatabaseTransaction,
  characterId: string,
  stopReason: FabricationStopReason,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterFabricationState)
    .set({
      ...overrideColumns(undefined),
      finishCurrent: false,
      lastStopReason: stopReason,
      updatedAt: now,
    })
    .where(eq(characterFabricationState.characterId, characterId));
  await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
}
