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
import {
  getEffectiveGameBalance,
  miningLevelThresholds,
  miningActionIds,
  miningSourceForActionId,
  type MiningSourceBalance,
  type MiningToolDefinition,
} from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import {
  miningSuccessChanceBps,
  miningPreflightStopReason,
  normalizeCutterCharge,
  boostedMiningAttemptDurationTicks,
  resolveMining,
  type MiningRandom,
  type MiningResolution,
  type MiningSecondaryFindAward,
  type MiningStopReason,
} from "@/game/domain/mining";
import { levelFromXp } from "@/game/domain/progression";
import { ticksToMilliseconds } from "@/game/domain/timing";
import { type ActionResolver, type DatabaseTransaction } from "@/server/action-resolution";
import { addStackableItem, loadOwnedItemInstances } from "@/server/carried-inventory";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getLocation } from "@/game/content/locations";
import { grantCharacterSkillXp } from "@/server/progression";
import { recordRareFindAnnouncement } from "@/server/public-system-messages";
import { loadPlaySnapshot } from "@/server/play-state";

const systemRandom: MiningRandom = {
  nextBasisPoints: () => randomInt(10_000),
  nextUnit: () => randomInt(2) / 2,
  nextInteger: (exclusiveMaximum) => randomInt(exclusiveMaximum),
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
    // The last outcome of any Secondary Find roll is outside every authored
    // span, so the browser journey never finds a gem by accident (#308).
    nextInteger: (exclusiveMaximum) => exclusiveMaximum - 1,
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

/**
 * One durable run attempt. `itemId` / `quantityAwarded` replaced the original
 * `shaleAwarded` (#209): a run at Deep Jag awards Galvanite, so neither this
 * record nor the surface that renders it may assume Ferrite Shale.
 */
export type MiningRunAttempt = {
  sequence: number;
  resolvedAt: string;
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  itemId: string;
  quantityAwarded: number;
  /** Bonus items this success found beside the ore (#308); empty for a miss. */
  secondaryFinds: readonly MiningSecondaryFindAward[];
  /** The attempt's combined Mining XP, Secondary Finds included. */
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
  /** What this run has produced, keyed by item ID. */
  itemsGained: Readonly<Record<string, number>>;
  xpGained: number;
  recentAttempts: readonly MiningRunAttempt[];
};

export type MiningSnapshot = {
  miningLevel: number;
  /** The equipped Mining tool's authored definition, or undefined (#233). */
  tool?: MiningToolDefinition;
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
  source: MiningSourceBalance;
  cutterInstanceId?: string;
  cutterChargeBefore: number;
  attemptResolvedAt: readonly string[];
};

/**
 * Load the Mining-specific resolver snapshot, deriving the shared
 * carried/equipment/play-state rows from `loadPlaySnapshot` (the generic
 * loader) and adding the Mining-specific fields (cutter, tool, level).
 *
 * The tool is whichever authored Mining tool the loadout says is equipped
 * right now (#233), read under the same character lock as the resolution
 * itself: a refreshed or offline-resolved attempt can only ever use the tool
 * really in the slot, and a swap stops the run before a new tool is read.
 */
export async function loadMiningSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<MiningSnapshot> {
  const balance = getEffectiveGameBalance();
  const play = await loadPlaySnapshot(transaction, characterId);
  const miningXp = play.xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const tool = play.equipmentLoadout.miningTool;
  const cutter = tool
    ? play.carriedInstances.find((instance) => instance.id === tool.itemInstanceId)
    : undefined;
  return {
    miningLevel: levelFromXp(miningXp, miningLevelThresholds(balance)),
    ...(tool ? { tool: tool.definition } : {}),
    existingStacks: play.stacks,
    slotsAvailable: play.slotsAvailable,
    massAvailableGrams: play.massAvailableGrams,
    slotsUsed: play.slotsUsed,
    slotCapacity: play.slotCapacity,
    equipmentLoadout: play.equipmentLoadout,
    allItemInstances: play.allItemInstances,
    itemInstances: play.carriedInstances,
    equippedCutterInstanceId: cutter?.id,
    cutterCharge: tool ? normalizeCutterCharge(cutter?.currentCharge, tool.definition) : 0,
  };
}

export function createMiningResolver(
  random: MiningRandom,
  onOutcome?: (outcome: PersistedMiningOutcome) => void,
): ActionResolver<MiningSnapshot, PersistedMiningOutcome> {
  return {
    supports: (action) => miningActionIds().includes(action.actionId),
    load: async (transaction, { character }) => loadMiningSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      // The durable action row IS the source identity, so a lazily-resolved or
      // offline run awards the ore the player actually started on (#209).
      const source = miningSourceForActionId(action.actionId);
      if (!source) throw new Error(`No Mining source authors action "${action.actionId}"`);
      const resolved = resolveMining({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        balance: getEffectiveGameBalance(),
        source,
        random,
      });
      let cumulativeAttemptTicks = 0;
      const outcome: PersistedMiningOutcome = {
        characterId: action.characterId,
        source,
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
    persist: async (transaction, outcome, context) => {
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
        const itemsGained: Record<string, number> = {
          ...((state.runItemsGained ?? {}) as Record<string, number>),
        };
        for (const attempt of appended) {
          if (attempt.quantityAwarded > 0) {
            itemsGained[attempt.itemId] =
              (itemsGained[attempt.itemId] ?? 0) + attempt.quantityAwarded;
          }
          // Secondary Finds are items the run produced too, keyed like any
          // other, so the run summary stays honest per item (#308).
          for (const find of attempt.secondaryFinds) {
            itemsGained[find.itemId] = (itemsGained[find.itemId] ?? 0) + find.quantity;
          }
        }
        await transaction
          .update(characterMiningState)
          .set({
            runAttempts: state.runAttempts + outcome.attempts.length,
            runSuccesses: state.runSuccesses + outcome.successes,
            runItemsGained: itemsGained,
            runXpGained: state.runXpGained + outcome.awardedXp,
            recentAttempts,
            updatedAt: new Date(),
          })
          .where(eq(characterMiningState.characterId, outcome.characterId));
      }
      // A find the source authors as announceable posts a public System line,
      // inside this same transaction: the item, the XP, the run history, and the
      // announcement commit together or not at all (#308). Eligibility is the
      // authored entry's, never "the rarest item here".
      const announced = outcome.attempts.flatMap((attempt) =>
        attempt.secondaryFinds.filter(
          (find) =>
            outcome.source.secondaryFinds.find((entry) => entry.itemId === find.itemId)?.announce,
        ),
      );
      if (announced.length > 0) {
        const character = context?.character;
        const location = character ? getLocation(character.currentLocationId) : undefined;
        if (!character || !location)
          throw new Error("A Mining announcement needs the character and the location it found at");
        for (const find of announced) {
          await recordRareFindAnnouncement(transaction, {
            characterName: character.displayName,
            itemName: resolveItemPresentation(find.itemId, find.itemId).displayName,
            locationName: location.displayName,
            now: new Date(),
          });
        }
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
