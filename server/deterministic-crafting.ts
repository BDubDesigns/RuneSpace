import { and, eq } from "drizzle-orm";
import {
  activeActions,
  type CraftingRunTable,
  inventoryStacks,
  type ActiveAction,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import type { SkillId } from "@/game/config/foundations";
import type { TrackedMissionActivity } from "@/game/content/missions";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  boundedRunAllowance,
  boundedRunSelectionFromColumn,
  boundedRunSelectionToColumn,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import { levelFromXp } from "@/game/domain/progression";
import {
  resolveCrafting,
  validateCraftingRecipes,
  type DeterministicRecipe,
  type CraftingCapacitySnapshot,
  type CraftingResolution,
  type CraftingResolvedCycle,
  type CraftingRunSnapshot,
  type CraftingStopReason,
} from "@/game/domain/deterministic-crafting";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { recordTrackedActivity } from "@/server/mission-progress";
import { loadPlaySnapshot } from "@/server/play-state";
import { grantCharacterSkillXp } from "@/server/progression";

export type CraftingAuthorization =
  | { kind: "unrestricted" }
  | { kind: "supervised"; stageId: string; actionId: string }
  | { kind: "locked" };
export type CraftingActivityConfig = {
  table: CraftingRunTable;
  skillId: SkillId;
  activity: TrackedMissionActivity;
  recipes: () => readonly DeterministicRecipe[];
  loadAccess: (
    transaction: DatabaseTransaction,
    characterId: string,
  ) => Promise<CraftingAuthorization>;
};
type CraftingRow = CraftingRunTable["$inferSelect"];

/** One `This Run` entry: an immutable server-resolved cycle. */
export type CraftingRunCycle = CraftingResolvedCycle & {
  sequence: number;
  resolvedAt: string;
  recipeActionId: string;
};

export type CraftingRunState = {
  /** A number of cycles that `cycles` counts toward, or Max, which has none. */
  selection: BoundedRunSelection;
  cycles: number;
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  xpGained: number;
  recentCycles: readonly CraftingRunCycle[];
};

export type PersistedCraftingOutcome = CraftingResolution & {
  characterId: string;
  recipe: DeterministicRecipe;
  /** When each resolved cycle completed. */
  resolvedAt: readonly string[];
};

/** The shared cycle/run persistence and lazy resolver for two real activities. */
export function createCraftingActivity(config: CraftingActivityConfig) {
  validateCraftingRecipes(config.recipes());
  function craftingRunStateFromRow(row: CraftingRow | undefined): CraftingRunState {
    return {
      selection: row
        ? boundedRunSelectionFromColumn(row.runSelectedCycles)
        : BOUNDED_RUN_DEFAULT_QUANTITY,
      cycles: row?.runCycles ?? 0,
      inputsConsumed: (row?.runInputsConsumed as Record<string, number> | undefined) ?? {},
      outputsGained: (row?.runOutputsGained as Record<string, number> | undefined) ?? {},
      xpGained: row?.runXpGained ?? 0,
      recentCycles: (row?.recentCycles as CraftingRunCycle[] | undefined) ?? [],
    };
  }

  /** Create the Rig row on first genuine use; an absent row is the correct initial state. */
  async function ensureCraftingState(
    transaction: DatabaseTransaction,
    characterId: string,
  ): Promise<void> {
    await transaction
      .insert(config.table)
      .values({ characterId })
      .onConflictDoNothing({ target: config.table.characterId });
  }

  async function loadCraftingRow(
    transaction: DatabaseTransaction,
    characterId: string,
  ): Promise<CraftingRow | undefined> {
    const rows = await transaction
      .select()
      .from(config.table)
      .where(eq(config.table.characterId, characterId))
      .for("update");
    return rows[0];
  }

  function isCraftingAction(actionId: string | undefined): boolean {
    return (
      actionId !== undefined && config.recipes().some((recipe) => recipe.actionId === actionId)
    );
  }

  /** The carried inventory and level a cycle check reads, under the command lock. */
  async function loadCraftingCapacity(
    transaction: DatabaseTransaction,
    characterId: string,
  ): Promise<CraftingCapacitySnapshot> {
    const balance = getEffectiveGameBalance();
    const snapshot = await loadPlaySnapshot(transaction, characterId);
    // No XP row is the canonical zero: Level 1.
    const craftingXp = snapshot.xpRows.find((row) => row.skillId === config.skillId)?.totalXp ?? 0;
    return {
      skillLevel: levelFromXp(craftingXp, standardSkillLevelThresholds(balance)),
      stacks: snapshot.stacks,
      slotsAvailable: snapshot.slotsAvailable,
      massAvailableGrams: snapshot.massAvailableGrams,
    };
  }

  async function loadCraftingSnapshot(
    transaction: DatabaseTransaction,
    characterId: string,
  ): Promise<CraftingRunSnapshot & { allowedActionId?: string }> {
    const [capacity, row, access] = await Promise.all([
      loadCraftingCapacity(transaction, characterId),
      loadCraftingRow(transaction, characterId),
      config.loadAccess(transaction, characterId),
    ]);
    return {
      ...capacity,
      // No row means no run was ever started, so nothing more may begin.
      allowance: row
        ? boundedRunAllowance(boundedRunSelectionFromColumn(row.runSelectedCycles), row.runCycles)
        : { remaining: 0, exhaustedReason: "run_completed" },
      finishCurrent: row?.finishCurrent ?? false,
      authorized:
        access.kind === "unrestricted"
          ? row?.authorizationStageId == null
          : access.kind === "supervised" &&
            row?.authorizationStageId === access.stageId &&
            row.runCycles === 0,
      ...(access.kind === "supervised"
        ? {
            allowance: {
              remaining: Math.max(0, 1 - (row?.runCycles ?? 0)),
              exhaustedReason: "run_completed" as const,
            },
          }
        : {}),
      allowedActionId: access.kind === "supervised" ? access.actionId : undefined,
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
   * Persist one Crafting resolution. Everything commits in the caller's
   * character transaction: the final stack state the resolution decided, the XP,
   * the run, and one Mission credit per completed cycle.
   */
  async function persistCraftingOutcome(
    transaction: DatabaseTransaction,
    outcome: PersistedCraftingOutcome,
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
        throw new Error("Crafting resolved against a stack that no longer exists");
      }
      await transaction
        .delete(inventoryStacks)
        .where(
          and(
            eq(inventoryStacks.id, stackId),
            eq(inventoryStacks.characterId, outcome.characterId),
          ),
        );
    }
    for (const update of outcome.stackUpdates) {
      if (!persistedIds.has(update.id)) {
        throw new Error("Crafting resolved against a stack that no longer exists");
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
        skillId: config.skillId,
        awardedXp: outcome.awardedXp,
        thresholds: standardSkillLevelThresholds(),
      });
    }

    const row = await loadCraftingRow(transaction, outcome.characterId);
    if (!row) throw new Error("Crafting state must exist before Crafting persistence");
    const firstSequence = row.runCycles + 1;
    const appended: CraftingRunCycle[] = outcome.resolved.map((cycle, index) => ({
      sequence: firstSequence + index,
      resolvedAt: outcome.resolvedAt[index]!,
      recipeActionId: outcome.recipe.actionId,
      ...cycle,
    }));
    await transaction
      .update(config.table)
      .set({
        runCycles: row.runCycles + outcome.resolved.length,
        runInputsConsumed: mergeTotals(row.runInputsConsumed, outcome.inputsConsumed),
        runOutputsGained: mergeTotals(row.runOutputsGained, outcome.outputsGained),
        runXpGained: row.runXpGained + outcome.awardedXp,
        recentCycles: [...((row.recentCycles as CraftingRunCycle[]) ?? []), ...appended].slice(-10),
        ...(outcome.stopReason ? { lastStopReason: outcome.stopReason } : {}),
        // Spent the moment it is honoured; leaving it set would end the next run
        // after its first cycle.
        ...(outcome.stopReason === "finished_current" ? { finishCurrent: false } : {}),
        updatedAt: now,
      })
      .where(eq(config.table.characterId, outcome.characterId));

    // Every completed cycle is one successful craft of its own recipe; only an
    // accepted, unfinished Mission that names it is credited, capped at its target.
    await recordTrackedActivity(transaction, {
      characterId: outcome.characterId,
      activity: config.activity,
      metric: "completions",
      attemptCount: outcome.resolved.length,
      actionId: outcome.recipe.actionId,
    });
  }

  /**
   * The Crafting resolver: the ordinary lazy resolution every activity uses,
   * with the ordinary one-hour offline cap.
   */
  function createCraftingResolver(): ActionResolver<
    CraftingRunSnapshot & { allowedActionId?: string },
    PersistedCraftingOutcome
  > {
    return {
      supports: (action: ActiveAction) => isCraftingAction(action.actionId),
      load: async (transaction, { character }) => loadCraftingSnapshot(transaction, character.id),
      resolve: ({ action, snapshot, window }) => {
        const recipe = config.recipes().find((recipe) => recipe.actionId === action.actionId);
        if (!recipe) throw new Error(`No Crafting recipe authors action "${action.actionId}"`);
        const resolved = resolveCrafting({
          elapsedTicks: window.elapsedTicks,
          snapshot: {
            ...snapshot,
            authorized:
              snapshot.authorized !== false &&
              (!("allowedActionId" in snapshot) ||
                snapshot.allowedActionId === undefined ||
                snapshot.allowedActionId === action.actionId),
          },
          recipe,
        });
        const outcome: PersistedCraftingOutcome = {
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
        await persistCraftingOutcome(transaction, outcome);
      },
    };
  }

  /** Write the Rig's run selection and reset `This Run` for a fresh Start. */
  async function resetCraftingRun(
    transaction: DatabaseTransaction,
    characterId: string,
    selection: BoundedRunSelection,
    now: Date,
    authorizationStageId: string | null = null,
  ): Promise<void> {
    await transaction
      .update(config.table)
      .set({
        authorizationStageId,
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
      .where(eq(config.table.characterId, characterId));
  }

  /** An operator force-idle: the cycle's inputs were never consumed, so nothing is lost. */
  async function clearCraftingCycle(
    transaction: DatabaseTransaction,
    characterId: string,
    stopReason: CraftingStopReason,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(config.table)
      .set({ finishCurrent: false, lastStopReason: stopReason, updatedAt: now })
      .where(eq(config.table.characterId, characterId));
    await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
  }

  return {
    config,
    runStateFromRow: craftingRunStateFromRow,
    ensureState: ensureCraftingState,
    loadRow: loadCraftingRow,
    isAction: isCraftingAction,
    loadCapacity: loadCraftingCapacity,
    loadSnapshot: loadCraftingSnapshot,
    persistOutcome: persistCraftingOutcome,
    createResolver: createCraftingResolver,
    resetRun: resetCraftingRun,
    clearCycle: clearCraftingCycle,
  };
}
