import { and, eq, inArray } from "drizzle-orm";
import {
  activeActions,
  characterTinkeringState,
  inventoryStacks,
  itemInstances,
  type ActiveAction,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  standardSkillLevelThresholds,
  tinkeringActionIds,
  tinkeringTargetForActionId,
  type TinkeringTargetBalance,
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
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import {
  usableMiningCutterCount,
  resolveTinkering,
  type TinkeringCycle,
  type TinkeringResolution,
  type TinkeringResolvedBatch,
  type TinkeringSnapshot,
  type TinkeringStopReason,
} from "@/game/domain/tinkering";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { isMissionCompleted } from "@/server/mission-state";
import { recordTrackedActivity } from "@/server/mission-progress";
import { loadPlaySnapshot } from "@/server/play-state";
import { grantCharacterSkillXp } from "@/server/progression";

/**
 * Tinkering's persistence and lazy resolution (#232).
 *
 * Tinkering follows Practice Welding's cycle model: a cycle commits — destroys
 * — its complete batch the instant it begins, so `cycle_action_id` names a
 * cycle whose items are already gone. Ordinary Stop keeps that cycle, Resume
 * continues it without committing another, and Finish Current completes it
 * and ends the run. A refresh or disconnect can neither duplicate the
 * destruction nor dodge it.
 */

type TinkeringRow = typeof characterTinkeringState.$inferSelect;

/** One `This Run` entry: an immutable server-resolved batch. */
export type TinkeringRunBatch = TinkeringResolvedBatch & { sequence: number; resolvedAt: string };

export type TinkeringRunState = {
  selection: BoundedRunSelection;
  batches: number;
  itemsConsumed: Readonly<Record<string, number>>;
  scrapKept: number;
  scrapDiscarded: number;
  xpGained: number;
  recentBatches: readonly TinkeringRunBatch[];
};

export type PersistedTinkeringOutcome = TinkeringResolution & {
  characterId: string;
  target: TinkeringTargetBalance;
  resolvedAt: readonly string[];
};

export function isTinkeringAction(actionId: string | undefined): boolean {
  return actionId !== undefined && tinkeringActionIds().includes(actionId);
}

export function tinkeringCycleFromRow(row: TinkeringRow | undefined): TinkeringCycle | undefined {
  return row?.cycleActionId
    ? { targetActionId: row.cycleActionId, ticksCompleted: row.cycleTicksCompleted }
    : undefined;
}

export function tinkeringRunStateFromRow(row: TinkeringRow | undefined): TinkeringRunState {
  return {
    selection: row
      ? boundedRunSelectionFromColumn(row.runSelectedBatches)
      : BOUNDED_RUN_DEFAULT_QUANTITY,
    batches: row?.runBatches ?? 0,
    itemsConsumed: (row?.runItemsConsumed as Record<string, number> | undefined) ?? {},
    scrapKept: row?.runScrapKept ?? 0,
    scrapDiscarded: row?.runScrapDiscarded ?? 0,
    xpGained: row?.runXpGained ?? 0,
    recentBatches: (row?.recentBatches as TinkeringRunBatch[] | undefined) ?? [],
  };
}

export async function ensureTinkeringState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction
    .insert(characterTinkeringState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterTinkeringState.characterId });
}

export async function loadTinkeringRow(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<TinkeringRow | undefined> {
  const rows = await transaction
    .select()
    .from(characterTinkeringState)
    .where(eq(characterTinkeringState.characterId, characterId))
    .for("update");
  return rows[0];
}

/**
 * Tinkering opens with Tansy's demonstration: COMPLETING Return the Favor.
 * Derived from that Mission record — not a separate pickup, not a flag.
 */
export async function loadTinkeringUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  return isMissionCompleted(
    transaction,
    characterId,
    RUSK_RECOVERY_CONTENT.tinkeringAuthorizingMissionId,
  );
}

export async function loadTinkeringSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<TinkeringSnapshot> {
  const balance = getEffectiveGameBalance();
  const [snapshot, row] = await Promise.all([
    loadPlaySnapshot(transaction, characterId),
    loadTinkeringRow(transaction, characterId),
  ]);
  const fabricationXp =
    snapshot.xpRows.find((xp) => xp.skillId === SKILL_IDS.fabrication)?.totalXp ?? 0;
  const miningXp = snapshot.xpRows.find((xp) => xp.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const miningLevel = levelFromXp(miningXp, standardSkillLevelThresholds(balance));
  const equipped = snapshot.equipmentLoadout.equippedItemInstanceIds;
  const cycle = tinkeringCycleFromRow(row);
  return {
    fabricationLevel: levelFromXp(fabricationXp, standardSkillLevelThresholds(balance)),
    miningLevel,
    stacks: snapshot.stacks,
    carriedUniqueItems: snapshot.carriedInstances
      .filter((instance) => !equipped.has(instance.id))
      .map((instance) => ({
        id: instance.id,
        itemId: instance.itemId,
        currentCharge: instance.currentCharge,
        createdAt: instance.createdAt.toISOString(),
      })),
    // Every owned usable Cutter counts for the last-Cutter guard: equipped,
    // carried, and in the Cargo Hold alike (#233: either Mining tool).
    usableMiningCutters: usableMiningCutterCount(snapshot.allItemInstances, miningLevel, balance),
    slotsAvailable: snapshot.slotsAvailable,
    massAvailableGrams: snapshot.massAvailableGrams,
    autoDiscardScrap: row?.autoDiscardScrap ?? false,
    finishCurrent: row?.finishCurrent ?? false,
    allowance: row
      ? boundedRunAllowance(boundedRunSelectionFromColumn(row.runSelectedBatches), row.runBatches)
      : { remaining: 0, exhaustedReason: "run_completed" },
    ...(cycle ? { cycle } : {}),
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
 * Persist one Tinkering resolution in the caller's character transaction: the
 * final stack state, the destroyed unique instances, the XP, the run, the
 * cycle left on the station, and the Mission credit for completed batches.
 */
export async function persistTinkeringOutcome(
  transaction: DatabaseTransaction,
  outcome: PersistedTinkeringOutcome,
  now = new Date(),
): Promise<void> {
  const balance = getEffectiveGameBalance();
  const persistedStacks = await transaction
    .select({ id: inventoryStacks.id })
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, outcome.characterId))
    .for("update");
  const persistedIds = new Set(persistedStacks.map((stack) => stack.id));
  for (const stackId of outcome.deletedStackIds) {
    if (!persistedIds.has(stackId)) {
      throw new Error("Tinkering resolved against a stack that no longer exists");
    }
    await transaction
      .delete(inventoryStacks)
      .where(
        and(eq(inventoryStacks.id, stackId), eq(inventoryStacks.characterId, outcome.characterId)),
      );
  }
  for (const update of outcome.stackUpdates) {
    if (!persistedIds.has(update.id)) {
      throw new Error("Tinkering resolved against a stack that no longer exists");
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
  if (outcome.consumedInstanceIds.length > 0) {
    const deleted = await transaction
      .delete(itemInstances)
      .where(
        and(
          eq(itemInstances.characterId, outcome.characterId),
          inArray(itemInstances.id, [...outcome.consumedInstanceIds]),
        ),
      )
      .returning({ id: itemInstances.id });
    if (deleted.length !== outcome.consumedInstanceIds.length) {
      throw new Error("Tinkering committed an item instance that no longer exists");
    }
  }
  if (outcome.awardedXp > 0) {
    await grantCharacterSkillXp(transaction, {
      characterId: outcome.characterId,
      skillId: SKILL_IDS.fabrication,
      awardedXp: outcome.awardedXp,
      thresholds: standardSkillLevelThresholds(balance),
    });
  }

  const row = await loadTinkeringRow(transaction, outcome.characterId);
  if (!row) throw new Error("Tinkering state must exist before Tinkering persistence");
  const firstSequence = row.runBatches + 1;
  const appended: TinkeringRunBatch[] = outcome.resolved.map((batch, index) => ({
    sequence: firstSequence + index,
    resolvedAt: outcome.resolvedAt[index]!,
    ...batch,
  }));
  await transaction
    .update(characterTinkeringState)
    .set({
      runBatches: row.runBatches + outcome.resolved.length,
      runItemsConsumed: mergeTotals(row.runItemsConsumed, outcome.itemsCommitted),
      runScrapKept: row.runScrapKept + outcome.scrapKept,
      runScrapDiscarded: row.runScrapDiscarded + outcome.scrapDiscarded,
      runXpGained: row.runXpGained + outcome.awardedXp,
      recentBatches: [...((row.recentBatches as TinkeringRunBatch[]) ?? []), ...appended].slice(
        -10,
      ),
      cycleActionId: outcome.cycle?.targetActionId ?? null,
      cycleTicksCompleted: outcome.cycle?.ticksCompleted ?? 0,
      ...(outcome.stopReason ? { lastStopReason: outcome.stopReason } : {}),
      ...(outcome.finishCurrentHonoured ? { finishCurrent: false } : {}),
      updatedAt: now,
    })
    .where(eq(characterTinkeringState.characterId, outcome.characterId));

  if (outcome.resolved.length > 0) {
    await recordTrackedActivity(transaction, {
      characterId: outcome.characterId,
      activity: "tinkering",
      metric: "completions",
      attemptCount: outcome.resolved.length,
      actionId: outcome.target.actionId,
    });
  }
}

export function createTinkeringResolver(): ActionResolver<
  TinkeringSnapshot,
  PersistedTinkeringOutcome
> {
  return {
    supports: (action: ActiveAction) => isTinkeringAction(action.actionId),
    load: async (transaction, { character }) => loadTinkeringSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const target = tinkeringTargetForActionId(action.actionId);
      if (!target) throw new Error(`No Tinkering target authors action "${action.actionId}"`);
      const resolved = resolveTinkering({
        elapsedTicks: window.elapsedTicks,
        snapshot: snapshot as TinkeringSnapshot,
        target,
      });
      // Each completed batch resolved when its cycle's remaining ticks ran out.
      let ticks = 0;
      const duration =
        target.recipe.durationTicks * getEffectiveGameBalance().tinkering.durationMultiplier;
      const resolvedAt = resolved.resolved.map((_, index) => {
        ticks = index === 0 ? duration - (snapshot.cycle?.ticksCompleted ?? 0) : ticks + duration;
        return new Date(window.startsAt.getTime() + ticksToMilliseconds(ticks)).toISOString();
      });
      const outcome: PersistedTinkeringOutcome = {
        characterId: action.characterId,
        target,
        ...resolved,
        resolvedAt,
      };
      return {
        outcome,
        transition: outcome.stopReason
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => persistTinkeringOutcome(transaction, outcome),
  };
}

/**
 * Commit a fresh cycle now, at Start, through the same resolver rules: zero
 * elapsed ticks commits the first batch — destroying it — and stops there.
 */
export async function commitTinkeringCycle(
  transaction: DatabaseTransaction,
  input: { characterId: string; target: TinkeringTargetBalance; now: Date },
): Promise<TinkeringStopReason | undefined> {
  const snapshot = await loadTinkeringSnapshot(transaction, input.characterId);
  const resolved = resolveTinkering({ elapsedTicks: 0, snapshot, target: input.target });
  if (resolved.stopReason) return resolved.stopReason;
  await persistTinkeringOutcome(
    transaction,
    { characterId: input.characterId, target: input.target, ...resolved, resolvedAt: [] },
    input.now,
  );
  return undefined;
}

/** Reset `This Run` for a fresh Start, recording the selection. */
export async function resetTinkeringRun(
  transaction: DatabaseTransaction,
  characterId: string,
  selection: BoundedRunSelection,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterTinkeringState)
    .set({
      runSelectedBatches: boundedRunSelectionToColumn(selection),
      runBatches: 0,
      runItemsConsumed: {},
      runScrapKept: 0,
      runScrapDiscarded: 0,
      runXpGained: 0,
      recentBatches: [],
      finishCurrent: false,
      lastStopReason: null,
      updatedAt: now,
    })
    .where(eq(characterTinkeringState.characterId, characterId));
}

/**
 * The single Tinkering interruption — the player's Stop, Travel, and an
 * operator's force-idle. The committed cycle and every tick worked on it are
 * already durable; only the action ends.
 */
export async function interruptTinkering(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
}
