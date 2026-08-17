import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterRefiningState,
  characterSkillXp,
  inventoryStacks,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import type { StackState } from "@/game/domain/inventory";
import {
  refiningSuccessChanceBps,
  refiningPreflightStopReason,
  resolveRefining,
  type RefiningRandom,
  type RefiningResolution,
  type RefiningStopReason,
  type RefiningResolvedAttempt,
} from "@/game/domain/refining";
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

export type RefiningSnapshot = {
  refiningLevel: number;
  existingStacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

export type RefiningRunAttempt = RefiningResolvedAttempt & {
  sequence: number;
  resolvedAt: string;
};

export type RefiningRunState = {
  attempts: number;
  successes: number;
  failures: number;
  ferriteGained: number;
  slagGained: number;
  shaleConsumed: number;
  xpGained: number;
  recentAttempts: readonly RefiningRunAttempt[];
};

export type PersistedRefiningOutcome = RefiningResolution<string> & {
  characterId: string;
  attemptResolvedAt: readonly string[];
};

export async function ensureStarterRefiningState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  // Ensure refining XP row exists (idempotent, handles legacy metallurgy already migrated via SQL)
  await transaction
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.refining, totalXp: 0 })
    .onConflictDoNothing();
  await transaction
    .insert(characterRefiningState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterRefiningState.characterId });
}

async function loadRefiningSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RefiningSnapshot> {
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
  const refiningXp = xpRows.find((row) => row.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
  const equipmentLoadout = deriveEquipmentLoadout({
    assignments,
    instances,
    stacks,
    balance,
  });
  return {
    refiningLevel: levelFromXp(refiningXp, standardSkillLevelThresholds(balance)),
    existingStacks: stacks,
    slotsAvailable: Math.max(0, equipmentLoadout.containerSlotCapacity - equipmentLoadout.inventorySlotsUsed),
    massAvailableGrams: Math.max(0, equipmentLoadout.maximumCarryCapacityGrams - equipmentLoadout.carriedMassGrams),
  };
}

export function createRefiningResolver(
  random: RefiningRandom,
  onOutcome?: (outcome: PersistedRefiningOutcome) => void,
): ActionResolver<RefiningSnapshot, PersistedRefiningOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.refining,
    load: async (transaction, { character }) => loadRefiningSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const resolved = resolveRefining({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        balance: getEffectiveGameBalance(),
        random,
      });
      let cumulativeAttemptTicks = 0;
      const outcome: PersistedRefiningOutcome = {
        characterId: action.characterId,
        ...resolved,
        attemptResolvedAt: resolved.resolvedAttempts.map((_, index) =>
          new Date(
            window.startsAt.getTime() +
              ticksToMilliseconds((cumulativeAttemptTicks += resolved.resolvedAttempts[index]!.durationTicks)),
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
      // Handle deleted empty shale stacks first
      if (outcome.deletedStackIds.length) {
        for (const id of outcome.deletedStackIds) {
          await transaction.delete(inventoryStacks).where(eq(inventoryStacks.id, id as string));
        }
      }
      for (const update of outcome.stackUpdates) {
        await transaction
          .update(inventoryStacks)
          .set({ quantity: update.quantity, updatedAt: new Date() })
          .where(eq(inventoryStacks.id, update.id as string));
      }
      if (outcome.createdStacks.length) {
        await transaction.insert(inventoryStacks).values(
          outcome.createdStacks.map((stack) => ({
            characterId: outcome.characterId,
            itemId: stack.itemId,
            quantity: stack.quantity,
          })),
        );
      }
      if (outcome.awardedXp > 0) {
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.refining,
          awardedXp: outcome.awardedXp,
          thresholds: standardSkillLevelThresholds(),
        });
      }
      if (outcome.resolvedAttempts.length) {
        const state = (
          await transaction
            .select()
            .from(characterRefiningState)
            .where(eq(characterRefiningState.characterId, outcome.characterId))
            .for("update")
        )[0];
        if (!state) throw new Error("Refining state must exist before resolution");
        const existing = state.recentAttempts as RefiningRunAttempt[];
        const firstSequence = state.runAttempts + 1;
        const appended = outcome.resolvedAttempts.map((attempt, index) => ({
          sequence: firstSequence + index,
          resolvedAt: outcome.attemptResolvedAt[index]!,
          ...attempt,
        }));
        const recentAttempts = [...existing, ...appended].slice(-10);
        await transaction
          .update(characterRefiningState)
          .set({
            runAttempts: state.runAttempts + outcome.resolvedAttempts.length,
            runSuccesses: state.runSuccesses + outcome.successes,
            runFerriteGained: state.runFerriteGained + outcome.ferriteGained,
            runSlagGained: state.runSlagGained + outcome.slagGained,
            runShaleConsumed: state.runShaleConsumed + outcome.shaleConsumed,
            runXpGained: state.runXpGained + outcome.awardedXp,
            recentAttempts,
            updatedAt: new Date(),
          })
          .where(eq(characterRefiningState.characterId, outcome.characterId));
      }
      if (outcome.stopReason) {
        await transaction
          .insert(characterRefiningState)
          .values({ characterId: outcome.characterId, lastStopReason: outcome.stopReason })
          .onConflictDoUpdate({
            target: characterRefiningState.characterId,
            set: { lastStopReason: outcome.stopReason, updatedAt: new Date() },
          });
      }
      onOutcome?.(outcome);
    },
  };
}
