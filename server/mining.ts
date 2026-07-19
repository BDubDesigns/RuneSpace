import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMiningState,
  characterSkillXp,
  characterStarterProvisioning,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, miningLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  inventorySlotCapacityFromContainers,
  inventorySlotsUsed,
  type StackState,
} from "@/game/domain/inventory";
import {
  miningSuccessChanceBps,
  miningPreflightStopReason,
  resolveCrashSiteMining,
  type MiningRandom,
  type MiningResolution,
  type MiningStopReason,
} from "@/game/domain/mining";
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import {
  type ActionResolver,
  type DatabaseTransaction,
  withResolvedOwnedCharacter,
} from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

const systemRandom: MiningRandom = {
  nextBasisPoints: () => randomInt(10_000),
  nextUnit: () => randomInt(2) / 2,
};

type MiningSnapshot = {
  miningLevel: number;
  hasCompatibleTool: boolean;
  existingStacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
  slotsUsed: number;
  slotCapacity: number;
};

type PersistedMiningOutcome = MiningResolution<string> & {
  characterId: string;
  attemptResolvedAt: readonly string[];
};

export type MiningRunAttempt = {
  sequence: number;
  resolvedAt: string;
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  shaleAwarded: number;
  xpAwarded: number;
};

type MiningRunState = {
  attempts: number;
  successes: number;
  failures: number;
  shaleGained: number;
  xpGained: number;
  recentAttempts: readonly MiningRunAttempt[];
};

export type MiningGameplayState = {
  characterId: string;
  activeAction?: {
    actionId: string;
    resolvedThroughAt: string;
    nextAttemptAt: string;
    progressStartedAt: string;
  };
  mining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  successChanceBps: number;
  ferriteShaleQuantity: number;
  inventory: {
    slotsUsed: number;
    slotsAvailable: number;
    massGrams: number;
    capacityGrams: number;
    stacks: readonly { id: string; itemId: string; name: string; quantity: number }[];
  };
  run: MiningRunState;
  recentResult: { successes: number; failures: number; awardedXp: number };
  stoppingReason?: MiningStopReason;
  commandError?: "another_action_active";
};

async function ensureStarterMiningState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  const balance = getEffectiveGameBalance();
  const marker = await transaction
    .insert(characterStarterProvisioning)
    .values({ characterId })
    .onConflictDoNothing({ target: characterStarterProvisioning.characterId })
    .returning({ characterId: characterStarterProvisioning.characterId });
  if (!marker[0]) return;

  await transaction
    .insert(characterSkillXp)
    .values([
      { characterId, skillId: SKILL_IDS.mining, totalXp: 0 },
      { characterId, skillId: SKILL_IDS.strength, totalXp: 0 },
    ])
    .onConflictDoNothing();
  await transaction
    .insert(characterMiningState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterMiningState.characterId });
  const instances = await transaction
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId))
    .for("update");
  const assignments = await transaction
    .select()
    .from(equippedItems)
    .where(eq(equippedItems.characterId, characterId))
    .for("update");
  const equippedIds = new Set(assignments.map((assignment) => assignment.itemInstanceId));
  const hasCutter = assignments.some(
    (assignment) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId &&
      instances.some(
        (instance) =>
          instance.id === assignment.itemInstanceId &&
          instance.itemId === balance.items.salvageCutter.itemId,
      ),
  );
  if (
    !hasCutter &&
    !assignments.some(
      (assignment) =>
        assignment.assignmentKind === "gear" &&
        assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
    )
  ) {
    let cutter = instances.find(
      (instance) =>
        instance.itemId === balance.items.salvageCutter.itemId && !equippedIds.has(instance.id),
    );
    if (!cutter) {
      cutter = (
        await transaction
          .insert(itemInstances)
          .values({ characterId, itemId: balance.items.salvageCutter.itemId })
          .returning()
      )[0]!;
    }
    await transaction.insert(equippedItems).values({
      characterId,
      assignmentKind: "gear",
      suitSlotId: balance.items.salvageCutter.suitSlotId,
      itemInstanceId: cutter.id,
    });
  }
  const hasContainer = assignments.some(
    (assignment) =>
      assignment.assignmentKind === "container" &&
      instances.some(
        (instance) =>
          instance.id === assignment.itemInstanceId &&
          instance.itemId === balance.items.starterContainer.itemId,
      ),
  );
  if (!hasContainer) {
    const availableSlot = balance.carrying.containerSuitSlotIds.find(
      (slot) =>
        !assignments.some(
          (assignment) =>
            assignment.assignmentKind === "container" && assignment.suitSlotId === slot,
        ),
    );
    if (availableSlot) {
      let container = instances.find(
        (instance) =>
          instance.itemId === balance.items.starterContainer.itemId &&
          !equippedIds.has(instance.id),
      );
      if (!container) {
        container = (
          await transaction
            .insert(itemInstances)
            .values({ characterId, itemId: balance.items.starterContainer.itemId })
            .returning()
        )[0]!;
      }
      await transaction.insert(equippedItems).values({
        characterId,
        assignmentKind: "container",
        suitSlotId: availableSlot,
        itemInstanceId: container.id,
      });
    }
  }
}

async function loadMiningSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<MiningSnapshot> {
  const balance = getEffectiveGameBalance();
  const [xpRows, stacks, instances, assignments] = await Promise.all([
    transaction
      .select()
      .from(characterSkillXp)
      .where(eq(characterSkillXp.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const miningXp = xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const equippedIds = new Set(assignments.map((assignment) => assignment.itemInstanceId));
  const equipped = assignments.flatMap((assignment) => {
    const instance = instances.find((item) => item.id === assignment.itemInstanceId);
    return instance ? [{ assignment, instance }] : [];
  });
  const hasCompatibleTool = equipped.some(
    ({ assignment, instance }) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId &&
      instance.itemId === balance.items.salvageCutter.itemId,
  );
  const containerCapacity = inventorySlotCapacityFromContainers(
    equipped
      .filter(
        ({ assignment, instance }) =>
          assignment.assignmentKind === "container" &&
          instance.itemId === balance.items.starterContainer.itemId,
      )
      .map(() => balance.items.starterContainer.slotCapacity),
  );
  const stackMass = stacks.reduce(
    (total, stack) =>
      total +
      (stack.itemId === balance.items.ferriteShale.itemId
        ? stack.quantity * balance.items.ferriteShale.massGrams
        : 0),
    0,
  );
  const instanceMass = instances.reduce(
    (total, instance) =>
      total +
      (instance.itemId === balance.items.salvageCutter.itemId
        ? balance.items.salvageCutter.massGrams
        : instance.itemId === balance.items.starterContainer.itemId
          ? balance.items.starterContainer.massGrams
          : 0),
    0,
  );
  const slotsUsed = inventorySlotsUsed(
    stacks.length,
    instances.filter((item) => !equippedIds.has(item.id)).length,
  );
  return {
    miningLevel: levelFromXp(miningXp, miningLevelThresholds(balance)),
    hasCompatibleTool,
    existingStacks: stacks,
    slotsAvailable: Math.max(0, containerCapacity - slotsUsed),
    massAvailableGrams: Math.max(
      0,
      balance.carrying.startingCapacityGrams - stackMass - instanceMass,
    ),
    slotsUsed,
    slotCapacity: containerCapacity,
  };
}

function createMiningResolver(
  random: MiningRandom,
  onOutcome?: (outcome: PersistedMiningOutcome) => void,
): ActionResolver<MiningSnapshot, PersistedMiningOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.crashSiteMining,
    load: async (transaction, { character }) => loadMiningSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const resolved = resolveCrashSiteMining({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        balance: getEffectiveGameBalance(),
        random,
      });
      const attemptDurationMs = ticksToMilliseconds(
        getEffectiveGameBalance().mining.attemptDurationTicks,
      );
      const outcome: PersistedMiningOutcome = {
        characterId: action.characterId,
        ...resolved,
        attemptResolvedAt: resolved.attempts.map((_, index) =>
          new Date(window.startsAt.getTime() + (index + 1) * attemptDurationMs).toISOString(),
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
      if (outcome.awardedXp > 0)
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.mining,
          awardedXp: outcome.awardedXp,
          thresholds: miningLevelThresholds(),
        });
      for (const update of outcome.stackUpdates)
        await transaction
          .update(inventoryStacks)
          .set({ quantity: update.quantity, updatedAt: new Date() })
          .where(eq(inventoryStacks.id, update.id));
      if (outcome.createdStacks.length)
        await transaction.insert(inventoryStacks).values(
          outcome.createdStacks.map((stack) => ({
            characterId: outcome.characterId,
            itemId: stack.itemId,
            quantity: stack.quantity,
          })),
        );
      if (outcome.attempts.length) {
        const state = (
          await transaction
            .select()
            .from(characterMiningState)
            .where(eq(characterMiningState.characterId, outcome.characterId))
            .for("update")
        )[0];
        if (!state) throw new Error("Mining state must exist before resolution");
        const existing = state.recentAttempts as MiningRunAttempt[];
        const firstSequence = state.runAttempts + 1;
        const appended = outcome.attempts.map((attempt, index) => ({
          sequence: firstSequence + index,
          resolvedAt: outcome.attemptResolvedAt[index]!,
          ...attempt,
        }));
        const recentAttempts = [...existing, ...appended].slice(-10);
        await transaction
          .update(characterMiningState)
          .set({
            runAttempts: state.runAttempts + outcome.attempts.length,
            runSuccesses: state.runSuccesses + outcome.successes,
            runShaleGained:
              state.runShaleGained +
              appended.reduce((total, attempt) => total + attempt.shaleAwarded, 0),
            runXpGained: state.runXpGained + outcome.awardedXp,
            recentAttempts,
            updatedAt: new Date(),
          })
          .where(eq(characterMiningState.characterId, outcome.characterId));
      }
      if (outcome.stopReason)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: outcome.characterId, lastStopReason: outcome.stopReason })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: outcome.stopReason, updatedAt: new Date() },
          });
      onOutcome?.(outcome);
    },
  };
}

async function stateFromTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  recentResult: MiningGameplayState["recentResult"],
  stoppingReason?: MiningStopReason,
  commandError?: MiningGameplayState["commandError"],
): Promise<MiningGameplayState> {
  const balance = getEffectiveGameBalance();
  const snapshot = await loadMiningSnapshot(transaction, characterId);
  const [xpRows, stacks, actionRows, miningStateRows] = await Promise.all([
    transaction
      .select()
      .from(characterSkillXp)
      .where(eq(characterSkillXp.characterId, characterId)),
    transaction.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId)),
    transaction.select().from(activeActions).where(eq(activeActions.characterId, characterId)),
    transaction
      .select()
      .from(characterMiningState)
      .where(eq(characterMiningState.characterId, characterId)),
  ]);
  const totalXp = xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const thresholds = miningLevelThresholds(balance);
  const level = levelFromXp(totalXp, thresholds);
  const next = thresholds.find((threshold) => threshold.level === level + 1);
  const action = actionRows[0];
  const miningState = miningStateRows[0];
  const run: MiningRunState = {
    attempts: miningState?.runAttempts ?? 0,
    successes: miningState?.runSuccesses ?? 0,
    failures: (miningState?.runAttempts ?? 0) - (miningState?.runSuccesses ?? 0),
    shaleGained: miningState?.runShaleGained ?? 0,
    xpGained: miningState?.runXpGained ?? 0,
    recentAttempts: (miningState?.recentAttempts as MiningRunAttempt[] | undefined) ?? [],
  };
  return {
    characterId,
    activeAction:
      action?.actionId === ACTION_IDS.crashSiteMining
        ? {
            actionId: action.actionId,
            resolvedThroughAt: action.resolvedThroughAt.toISOString(),
            progressStartedAt: action.resolvedThroughAt.toISOString(),
            nextAttemptAt: new Date(
              action.resolvedThroughAt.getTime() +
                ticksToMilliseconds(balance.mining.attemptDurationTicks),
            ).toISOString(),
          }
        : undefined,
    mining: {
      totalXp,
      level,
      xpToNextLevel: next ? next.totalXp - totalXp : undefined,
      xpIntoLevel:
        totalXp - (thresholds.find((threshold) => threshold.level === level)?.totalXp ?? 0),
    },
    successChanceBps: miningSuccessChanceBps(level, balance),
    ferriteShaleQuantity: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)
      .reduce((total, stack) => total + stack.quantity, 0),
    inventory: {
      slotsUsed: snapshot.slotsUsed,
      slotsAvailable: snapshot.slotsAvailable,
      massGrams: balance.carrying.startingCapacityGrams - snapshot.massAvailableGrams,
      capacityGrams: balance.carrying.startingCapacityGrams,
      stacks: stacks.map((stack) => ({
        id: stack.id,
        itemId: stack.itemId,
        name: stack.itemId === ITEM_IDS.ferriteShale ? "Ferrite Shale" : stack.itemId,
        quantity: stack.quantity,
      })),
    },
    run,
    recentResult,
    stoppingReason: action
      ? undefined
      : (stoppingReason ?? (miningState?.lastStopReason as MiningStopReason | null) ?? undefined),
    commandError,
  };
}

export async function getMiningGameplayState(
  userId: string,
  characterId: string,
  now = new Date(),
  random = systemRandom,
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createMiningResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        outcome?.stopReason,
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining
          ? "another_action_active"
          : undefined,
      );
    },
    now,
  );
}

export async function startCrashSiteMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random = systemRandom,
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createMiningResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const unsupportedAction =
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining;
      const snapshot = await loadMiningSnapshot(transaction, context.character.id);
      const preflightStopReason = context.action
        ? undefined
        : miningPreflightStopReason(snapshot, getEffectiveGameBalance());
      if (!context.action && !preflightStopReason) {
        await transaction.insert(activeActions).values({
          characterId: context.character.id,
          actionId: ACTION_IDS.crashSiteMining,
          startedAt: now,
          resolvedThroughAt: now,
        });
        await transaction
          .insert(characterMiningState)
          .values({
            characterId: context.character.id,
            runAttempts: 0,
            runSuccesses: 0,
            runShaleGained: 0,
            runXpGained: 0,
            recentAttempts: [],
            lastStopReason: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: {
              runAttempts: 0,
              runSuccesses: 0,
              runShaleGained: 0,
              runXpGained: 0,
              recentAttempts: [],
              lastStopReason: null,
              updatedAt: now,
            },
          });
      }
      if (!unsupportedAction && !preflightStopReason)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: null })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: null, updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        preflightStopReason ?? outcome?.stopReason,
        unsupportedAction ? "another_action_active" : undefined,
      );
    },
    now,
  );
}

export async function stopMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random = systemRandom,
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createMiningResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const manuallyStopped = context.action?.actionId === ACTION_IDS.crashSiteMining;
      if (manuallyStopped)
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
      if (manuallyStopped)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: "manually_stopped" })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: "manually_stopped", updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        manuallyStopped ? "manually_stopped" : outcome?.stopReason,
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining
          ? "another_action_active"
          : undefined,
      );
    },
    now,
  );
}

export const miningTestInternals = { createMiningResolver, ensureStarterMiningState };
