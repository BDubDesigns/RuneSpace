import { eq } from "drizzle-orm";
import {
  activeActions,
  characterPracticeWelds,
  equippedItems,
  inventoryStacks,
  type ActiveAction,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  practiceSectionXp,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import {
  withOpenCleanPassMissed,
  type CleanPassOutcome,
  type CleanPassState,
  UNROLLED_CLEAN_PASS,
} from "@/game/domain/clean-pass";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { planStackAddition } from "@/game/domain/inventory";
import type { MiningRandom } from "@/game/domain/mining";
import {
  resolvePracticeWelding,
  UNSTARTED_PRACTICE,
  type PracticeResolvedWeld,
  type PracticeSnapshot,
  type PracticeStopReason,
  type PracticeWeldState,
} from "@/game/domain/practice-welding";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import {
  addStackableItem,
  consumeStackableItem,
  loadOwnedItemInstances,
} from "@/server/carried-inventory";
import { isMissionAccepted } from "@/server/mission-state";
import { grantCharacterSkillXp } from "@/server/progression";

/** One `This Run` entry: an immutable server-resolved weld summary. */
export type PracticeRunWeld = PracticeResolvedWeld & {
  sequence: number;
  resolvedAt: string;
};

export type PracticeRunState = {
  welds: number;
  scrapConsumed: number;
  slagKept: number;
  slagDiscarded: number;
  xpGained: number;
  recentWelds: readonly PracticeRunWeld[];
};

export type PersistedPracticeOutcome = {
  characterId: string;
  completedWelds: number;
  sectionsResolved: number;
  scrapConsumed: number;
  slagKept: number;
  slagDiscarded: number;
  awardedXp: number;
  practice: PracticeWeldState;
  resolvedWelds: readonly PracticeResolvedWeld[];
  weldResolvedAt: readonly string[];
  consumedTicks: number;
  stopReason?: PracticeStopReason;
};

type PracticeRow = typeof characterPracticeWelds.$inferSelect;

export function practiceCleanPassFromRow(row: PracticeRow | undefined): CleanPassState {
  if (!row) return UNROLLED_CLEAN_PASS;
  return {
    firstSection: row.cleanPassFirstSection,
    firstOutcome: row.cleanPassFirstOutcome as CleanPassOutcome | null,
    secondSection: row.cleanPassSecondSection,
    secondOutcome: row.cleanPassSecondOutcome as CleanPassOutcome | null,
  };
}

export function practiceStateFromRow(row: PracticeRow | undefined): PracticeWeldState {
  if (!row) return UNSTARTED_PRACTICE;
  return {
    sectionsCompleted: row.sectionsCompleted,
    cycleActive: row.cycleActive,
    cleanPass: practiceCleanPassFromRow(row),
  };
}

/**
 * Create the Practice row on first genuine use.
 *
 * A character who has never practised is simply an absent row, so every
 * existing character is already in their correct state and no backfill exists
 * to go wrong.
 */
export async function ensurePracticeState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction
    .insert(characterPracticeWelds)
    .values({ characterId })
    .onConflictDoNothing({ target: characterPracticeWelds.characterId });
}

/** Load the Practice row under the row lock every Practice command holds. */
export async function loadPracticeRow(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<PracticeRow | undefined> {
  const rows = await transaction
    .select()
    .from(characterPracticeWelds)
    .where(eq(characterPracticeWelds.characterId, characterId))
    .for("update");
  return rows[0];
}

/** The unlocked/locked answer for the Workbench and for Wade's Trade alike. */
export async function loadPracticeUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  return isMissionAccepted(
    transaction,
    characterId,
    RUSK_RECOVERY_CONTENT.practiceAuthorizingMissionId,
  );
}

async function loadPracticeSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<PracticeSnapshot> {
  const balance = getEffectiveGameBalance();
  const [row, stacks, assignments, itemState] = await Promise.all([
    loadPracticeRow(transaction, characterId),
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
    loadOwnedItemInstances(transaction, characterId),
  ]);
  const loadout = deriveEquipmentLoadout({
    assignments,
    instances: itemState.carriedInstances,
    stacks,
    balance,
  });
  return {
    practice: practiceStateFromRow(row),
    // Scrap has a stack limit of one, so a piece and a stack are the same thing.
    scrapAvailable: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.scrapMetal)
      .reduce((total, stack) => total + stack.quantity, 0),
    slagStackQuantities: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.slag)
      .map((stack) => stack.quantity),
    slotsAvailable: Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
    massAvailableGrams: Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
    autoDiscardSlag: row?.autoDiscardSlag ?? false,
  };
}

/**
 * Persist one Practice resolution's durable state, run totals, and history.
 *
 * Shared by the resolver and by the Clean Pass claim, so a claimed section and
 * a resolved section write the same row through one path.
 */
export async function writePracticeState(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    practice: PracticeWeldState;
    now: Date;
    stopReason?: PracticeStopReason | null;
  },
): Promise<void> {
  await transaction
    .update(characterPracticeWelds)
    .set({
      sectionsCompleted: input.practice.sectionsCompleted,
      cycleActive: input.practice.cycleActive,
      cleanPassFirstSection: input.practice.cleanPass.firstSection,
      cleanPassFirstOutcome: input.practice.cleanPass.firstOutcome,
      cleanPassSecondSection: input.practice.cleanPass.secondSection,
      cleanPassSecondOutcome: input.practice.cleanPass.secondOutcome,
      ...(input.stopReason === undefined ? {} : { lastStopReason: input.stopReason }),
      updatedAt: input.now,
    })
    .where(eq(characterPracticeWelds.characterId, input.characterId));
}

/** Reset the bounded `This Run` totals when a new run begins. */
export async function resetPracticeRun(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(characterPracticeWelds)
    .set({
      runWelds: 0,
      runScrapConsumed: 0,
      runSlagKept: 0,
      runSlagDiscarded: 0,
      runXpGained: 0,
      recentWelds: [],
      lastStopReason: null,
      updatedAt: now,
    })
    .where(eq(characterPracticeWelds.characterId, characterId));
}

export function practiceRunStateFromRow(row: PracticeRow | undefined): PracticeRunState {
  return {
    welds: row?.runWelds ?? 0,
    scrapConsumed: row?.runScrapConsumed ?? 0,
    slagKept: row?.runSlagKept ?? 0,
    slagDiscarded: row?.runSlagDiscarded ?? 0,
    xpGained: row?.runXpGained ?? 0,
    recentWelds: (row?.recentWelds as PracticeRunWeld[] | undefined) ?? [],
  };
}

/**
 * The Practice Welding resolver.
 *
 * Practice runs through the same generic lazy resolution every other activity
 * uses, so a run continues while the player is away and resolves on their next
 * command with the ordinary one-hour offline cap. There is no Practice-specific
 * worker, cap, or scheduler.
 */
export function createPracticeWeldingResolver(
  random: MiningRandom,
  onOutcome?: (outcome: PersistedPracticeOutcome) => void,
): ActionResolver<PracticeSnapshot, PersistedPracticeOutcome> {
  return {
    supports: (action: ActiveAction) => action.actionId === ACTION_IDS.practiceWelding,
    load: async (transaction, { character }) => loadPracticeSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const balance = getEffectiveGameBalance();
      const resolved = resolvePracticeWelding({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        random,
        balance,
      });
      // One timestamp per completed weld, walked forward through the window by
      // the sections that weld actually consumed.
      let cumulativeTicks = 0;
      const weldResolvedAt = resolved.resolvedWelds.map((weld) => {
        cumulativeTicks += weld.sections * balance.welding.attemptDurationTicks;
        return new Date(
          window.startsAt.getTime() + ticksToMilliseconds(cumulativeTicks),
        ).toISOString();
      });
      const outcome: PersistedPracticeOutcome = {
        characterId: action.characterId,
        completedWelds: resolved.completedWelds,
        sectionsResolved: resolved.sectionsResolved,
        scrapConsumed: resolved.scrapConsumed,
        slagKept: resolved.slagKept,
        slagDiscarded: resolved.slagDiscarded,
        awardedXp: resolved.awardedXp,
        practice: resolved.practice,
        resolvedWelds: resolved.resolvedWelds,
        weldResolvedAt,
        consumedTicks: resolved.consumedTicks,
        ...(resolved.stopReason ? { stopReason: resolved.stopReason } : {}),
      };
      return {
        outcome,
        transition: outcome.stopReason
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => {
      const balance = getEffectiveGameBalance();
      const now = new Date();

      if (outcome.scrapConsumed > 0) {
        const consumption = await consumeStackableItem(transaction, {
          characterId: outcome.characterId,
          itemId: ITEM_IDS.scrapMetal,
          quantity: outcome.scrapConsumed,
          now,
        });
        if (!consumption.ok) {
          throw new Error("Practice consumed more Scrap Metal than available at persistence time");
        }
      }

      if (outcome.slagKept > 0) {
        // Resolution already decided how much Slag fits, weld by weld, against
        // a running budget no larger than the inventory now has — the Scrap it
        // consumed has since freed its slots. Planning against the REAL current
        // capacity rather than asserting the answer means a disagreement fails
        // loudly here instead of quietly overfilling the player's inventory.
        const [stacks, assignments, itemState] = await Promise.all([
          transaction
            .select()
            .from(inventoryStacks)
            .where(eq(inventoryStacks.characterId, outcome.characterId))
            .for("update"),
          transaction
            .select()
            .from(equippedItems)
            .where(eq(equippedItems.characterId, outcome.characterId))
            .for("update"),
          loadOwnedItemInstances(transaction, outcome.characterId),
        ]);
        const loadout = deriveEquipmentLoadout({
          assignments,
          instances: itemState.carriedInstances,
          stacks,
          balance,
        });
        const plan = planStackAddition(
          stacks,
          ITEM_IDS.slag,
          outcome.slagKept,
          balance.items.slag.stackLimit,
          Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
          Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
          balance.items.slag.massGrams,
        );
        if (plan.remainingQuantity !== 0) {
          throw new Error("Practice Slag plan failed after resolution proved it would fit");
        }
        await addStackableItem(transaction, {
          characterId: outcome.characterId,
          plan,
          now,
        });
      }

      if (outcome.awardedXp > 0) {
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.welding,
          awardedXp: outcome.awardedXp,
          thresholds: standardSkillLevelThresholds(balance),
        });
      }

      const row = await loadPracticeRow(transaction, outcome.characterId);
      if (!row) throw new Error("Practice state must exist before Practice persistence");
      if (outcome.resolvedWelds.length > 0) {
        const existing = (row.recentWelds as PracticeRunWeld[]) ?? [];
        const firstSequence = row.runWelds + 1;
        const appended = outcome.resolvedWelds.map((weld, index) => ({
          sequence: firstSequence + index,
          resolvedAt: outcome.weldResolvedAt[index]!,
          ...weld,
        }));
        await transaction
          .update(characterPracticeWelds)
          .set({
            runWelds: row.runWelds + outcome.resolvedWelds.length,
            runScrapConsumed: row.runScrapConsumed + outcome.scrapConsumed,
            runSlagKept: row.runSlagKept + outcome.slagKept,
            runSlagDiscarded: row.runSlagDiscarded + outcome.slagDiscarded,
            runXpGained: row.runXpGained + outcome.awardedXp,
            recentWelds: [...existing, ...appended].slice(-10),
            updatedAt: now,
          })
          .where(eq(characterPracticeWelds.characterId, outcome.characterId));
      } else if (outcome.scrapConsumed > 0 || outcome.awardedXp > 0) {
        // A window that welded sections without finishing one still spent Scrap
        // and earned XP; the run totals must reflect that.
        await transaction
          .update(characterPracticeWelds)
          .set({
            runScrapConsumed: row.runScrapConsumed + outcome.scrapConsumed,
            runXpGained: row.runXpGained + outcome.awardedXp,
            updatedAt: now,
          })
          .where(eq(characterPracticeWelds.characterId, outcome.characterId));
      }

      await writePracticeState(transaction, {
        characterId: outcome.characterId,
        practice: outcome.practice,
        now,
        stopReason: outcome.stopReason ?? null,
      });
      onOutcome?.(outcome);
    },
  };
}

/**
 * The single Practice interruption. Manual Stop and Travel both run this, so
 * the two can never drift apart on what an interruption means.
 *
 * The caller has already reconciled due work exactly once through the shared
 * action-resolution boundary; this only clears the action row and closes an
 * open Clean Pass window.
 */
export async function interruptPracticeWelding(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<void> {
  const row = await loadPracticeRow(transaction, characterId);
  if (row) {
    const practice = practiceStateFromRow(row);
    await writePracticeState(transaction, {
      characterId,
      practice: {
        ...practice,
        cleanPass: withOpenCleanPassMissed(practice.cleanPass, practice.sectionsCompleted),
      },
      now,
      stopReason: null,
    });
  }
  await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
}

/** XP one Practice section is worth, for the Clean Pass claim to reuse. */
export function practiceClaimXp(): number {
  return practiceSectionXp();
}
