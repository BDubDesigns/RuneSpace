import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMiningState,
  characterSkillXp,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, miningLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  miningSuccessChanceBps,
  miningPreflightStopReason,
  normalizeCutterCharge,
  boostedMiningAttemptDurationTicks,
  resolveFerriteShaleMining,
  type MiningRandom,
  type MiningResolution,
  type MiningStopReason,
} from "@/game/domain/mining";
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import { type ActionResolver, type DatabaseTransaction } from "@/server/action-resolution";
import { addStackableItem, loadOwnedItemInstances } from "@/server/carried-inventory";
import { grantCharacterSkillXp } from "@/server/progression";
import { loadPlaySnapshot } from "@/server/play-state";

const systemRandom: MiningRandom = {
  nextBasisPoints: () => randomInt(10_000),
  nextUnit: () => randomInt(2) / 2,
};

/**
 * CI-only deterministic source for the focused browser journey. It is selected
 * only by explicit CI configuration, never by a request or normal runtime user.
 */
function e2eMiningRandom(): MiningRandom {
  let attemptIndex = 0;
  return {
    nextBasisPoints: () => [0, 3_500][attemptIndex++ % 2]!,
    nextUnit: () => 0,
  };
}

export function defaultMiningRandom(): MiningRandom {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_MINING === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
    ? e2eMiningRandom()
    : systemRandom;
}

export type MiningRunAttempt = {
  sequence: number;
  resolvedAt: string;
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  shaleAwarded: number;
  xpAwarded: number;
  boosted: boolean;
  durationTicks: number;
  chargeConsumed: boolean;
  remainingCharge: number;
};

export type MiningRunState = {
  attempts: number;
  successes: number;
  failures: number;
  shaleGained: number;
  xpGained: number;
  recentAttempts: readonly MiningRunAttempt[];
};

export type MiningSnapshot = {
  miningLevel: number;
  hasCompatibleTool: boolean;
  existingStacks: readonly import("@/game/domain/inventory").StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
  slotsUsed: number;
  slotCapacity: number;
  equipmentLoadout: import("@/game/domain/equipment").EquipmentLoadout;
  allItemInstances: readonly {
    id: string;
    itemId: string;
    currentCharge: number | null;
    createdAt: Date;
  }[];
  itemInstances: readonly {
    id: string;
    itemId: string;
    currentCharge: number | null;
    createdAt: Date;
  }[];
  equippedCutterInstanceId?: string;
  cutterCharge: number;
};

export type PersistedMiningOutcome = MiningResolution<string> & {
  characterId: string;
  cutterInstanceId?: string;
  cutterChargeBefore: number;
  attemptResolvedAt: readonly string[];
};

/**
 * Load the Mining-specific resolver snapshot, deriving the shared
 * carried/equipment/play-state rows from `loadPlaySnapshot` (the generic
 * loader) and adding the Mining-specific fields (cutter, tool, level).
 */
export async function loadMiningSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<MiningSnapshot> {
  const balance = getEffectiveGameBalance();
  const play = await loadPlaySnapshot(transaction, characterId);
  const miningXp = play.xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const cutterAssignment = play.equipmentLoadout.assignments.find(
    (assignment) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
  );
  const cutter = cutterAssignment
    ? play.carriedInstances.find(
        (instance) =>
          instance.id === cutterAssignment.itemInstanceId &&
          instance.itemId === balance.items.salvageCutter.itemId,
      )
    : undefined;
  return {
    miningLevel: levelFromXp(miningXp, miningLevelThresholds(balance)),
    hasCompatibleTool: play.equipmentLoadout.hasCompatibleMiningTool,
    existingStacks: play.stacks,
    slotsAvailable: play.slotsAvailable,
    massAvailableGrams: play.massAvailableGrams,
    slotsUsed: play.slotsUsed,
    slotCapacity: play.slotCapacity,
    equipmentLoadout: play.equipmentLoadout,
    allItemInstances: play.allItemInstances,
    itemInstances: play.carriedInstances,
    equippedCutterInstanceId: cutter?.id,
    cutterCharge: normalizeCutterCharge(cutter?.currentCharge, balance),
  };
}

export function createMiningResolver(
  random: MiningRandom,
  onOutcome?: (outcome: PersistedMiningOutcome) => void,
): ActionResolver<MiningSnapshot, PersistedMiningOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.ferriteShaleMining,
    load: async (transaction, { character }) => loadMiningSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const resolved = resolveFerriteShaleMining({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        balance: getEffectiveGameBalance(),
        random,
      });
      let cumulativeAttemptTicks = 0;
      const outcome: PersistedMiningOutcome = {
        characterId: action.characterId,
        ...resolved,
        cutterInstanceId: snapshot.equippedCutterInstanceId,
        cutterChargeBefore: snapshot.cutterCharge,
        attemptResolvedAt: resolved.attempts.map((_, index) =>
          new Date(
            window.startsAt.getTime() +
              ticksToMilliseconds(
                (cumulativeAttemptTicks += resolved.attempts[index]!.durationTicks),
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
      if (
        outcome.cutterInstanceId &&
        outcome.remainingCutterCharge !== outcome.cutterChargeBefore
      ) {
        await transaction
          .update(itemInstances)
          .set({ currentCharge: outcome.remainingCutterCharge, updatedAt: new Date() })
          .where(
            and(
              eq(itemInstances.id, outcome.cutterInstanceId),
              eq(itemInstances.characterId, outcome.characterId),
            ),
          );
      }
      if (outcome.awardedXp > 0)
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.mining,
          awardedXp: outcome.awardedXp,
          thresholds: miningLevelThresholds(),
        });
      await addStackableItem(transaction, {
        characterId: outcome.characterId,
        plan: {
          updatedStacks: outcome.stackUpdates,
          createdStacks: outcome.createdStacks,
          remainingQuantity: 0,
        },
        now: new Date(),
      });
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
