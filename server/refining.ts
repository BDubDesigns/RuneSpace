import { and, asc, eq } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db } from "@/db";
import {
  activeActions,
  characterRefiningState,
  characterSkillXp,
  inventoryStacks,
  equippedItems,
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
import {
  addStackableItem,
  consumeStackableItem,
  loadOwnedItemInstances,
} from "@/server/carried-inventory";
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

const systemRandom: RefiningRandom = {
  nextBasisPoints: () => randomInt(10_000),
};

let e2eRefiningGlobalIndex = 0;

/**
 * CI-only deterministic Refining random source for the focused browser
 * journey: `[0, 9000]` alternates so the first attempt succeeds at L1
 * (threshold 4000) and the second fails, proving both branches. It is
 * selected only by explicit CI configuration, never by a request or normal
 * runtime user.
 */
export function e2eRefiningRandom(): RefiningRandom {
  return {
    nextBasisPoints: () => [0, 9_000][e2eRefiningGlobalIndex++ % 2]!,
  };
}

/**
 * The default Refining random source: the deterministic E2E sequence under the
 * canonical-E2E override (`CI && RUNESPACE_E2E_MINING && localhost`), otherwise
 * system entropy. Refining owns its RNG selection — this is not a Mining concern.
 */
export function defaultRefiningRandom(): RefiningRandom {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_MINING === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
    ? e2eRefiningRandom()
    : systemRandom;
}

export async function ensureStarterRefiningState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
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
  const [xpRows, stacks, itemState, assignments] = await Promise.all([
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
    loadOwnedItemInstances(transaction, characterId),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const refiningXp = xpRows.find((row) => row.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
  const equipmentLoadout = deriveEquipmentLoadout({
    assignments,
    instances: itemState.carriedInstances,
    stacks,
    balance,
  });
  return {
    refiningLevel: levelFromXp(refiningXp, standardSkillLevelThresholds(balance)),
    existingStacks: stacks,
    slotsAvailable: Math.max(
      0,
      equipmentLoadout.containerSlotCapacity - equipmentLoadout.inventorySlotsUsed,
    ),
    massAvailableGrams: Math.max(
      0,
      equipmentLoadout.maximumCarryCapacityGrams - equipmentLoadout.carriedMassGrams,
    ),
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
              ticksToMilliseconds(
                (cumulativeAttemptTicks += resolved.resolvedAttempts[index]!.durationTicks),
              ),
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
      const persistedStacks = await transaction
        .select({ id: inventoryStacks.id, itemId: inventoryStacks.itemId })
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, outcome.characterId))
        .for("update");
      const itemIdByStackId = new Map(persistedStacks.map((stack) => [stack.id, stack.itemId]));
      const now = new Date();
      const shaleConsumption = await consumeStackableItem(transaction, {
        characterId: outcome.characterId,
        itemId: getEffectiveGameBalance().items.ferriteShale.itemId,
        quantity: outcome.shaleConsumed,
        now,
      });
      if (!shaleConsumption.ok)
        throw new Error("Refining consumed more shale than available at persistence time");

      const balance = getEffectiveGameBalance();
      for (const itemId of [balance.items.refinedFerrite.itemId, balance.items.slag.itemId]) {
        await addStackableItem(transaction, {
          characterId: outcome.characterId,
          plan: {
            updatedStacks: outcome.stackUpdates.filter(
              (update) => itemIdByStackId.get(String(update.id)) === itemId,
            ),
            createdStacks: outcome.createdStacks.filter((stack) => stack.itemId === itemId),
            remainingQuantity: 0,
          },
          now,
        });
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
