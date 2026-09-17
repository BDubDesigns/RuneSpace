import { and, eq, isNotNull, sql } from "drizzle-orm";
import { characters, characterWorkOrderPostings } from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  standardSkillLevelThresholds,
  workOrderSectionXp,
} from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS, type WorkOrderId } from "@/game/config/foundations";
import { getWorkOrder, type WorkOrderDefinition } from "@/game/content/work-orders";
import {
  cleanPassFromPersisted,
  cleanPassToPersisted,
  withOpenCleanPassMissed,
  UNROLLED_CLEAN_PASS,
  type CleanPassRandom,
  type CleanPassState,
} from "@/game/domain/clean-pass";
import {
  eligibleWorkOrders,
  selectInitialWorkOrderBoard,
  selectWorkOrderRefill,
  workOrderComplete,
  type ActiveWorkOrderState,
} from "@/game/domain/work-orders";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { recordTrackedActivity } from "@/server/mission-progress";
import { grantCharacterSkillXp } from "@/server/progression";
import { characterSkillLevel } from "@/server/skill-levels";

/**
 * Work Orders — the durable board, the accepted job, and its completion (#207).
 *
 * The board is three rows in `character_work_order_postings`, and the accepted
 * job is one of those same rows with `accepted_at` set. That is deliberately not
 * two tables: "which posting is In Progress" and "what is on the bench" are the
 * same fact, and giving them two homes is exactly how they come to disagree.
 * The partial unique index on the table is what makes "one active Work Order"
 * a database invariant rather than a rule every command has to remember.
 *
 * Welding a Work Order reuses the shared action model wholesale: one action ID,
 * the ordinary lazy resolution, the generic offline cap, and the same Stop and
 * Travel interruption helpers Practice and the repairs use. There is no Work
 * Order timer engine and no Work-Order-specific cap.
 */

export type WorkOrderPostingState = {
  slotIndex: number;
  workOrderId: WorkOrderId;
  /** Non-null exactly when this posting is the character's active job. */
  acceptedAt: Date | null;
  sectionsCompleted: number;
  cleanPass: CleanPassState;
};

export type WorkOrderBoardState = {
  postings: readonly WorkOrderPostingState[];
  active: ActiveWorkOrderState | undefined;
};

type PostingRow = typeof characterWorkOrderPostings.$inferSelect;

function postingFromRow(row: PostingRow): WorkOrderPostingState {
  return {
    slotIndex: row.slotIndex,
    workOrderId: row.workOrderId as WorkOrderId,
    acceptedAt: row.acceptedAt,
    sectionsCompleted: row.sectionsCompleted,
    cleanPass: cleanPassFromPersisted(row.cleanPass),
  };
}

function boardFromRows(rows: readonly PostingRow[]): WorkOrderBoardState {
  const postings = rows.map(postingFromRow).sort((a, b) => a.slotIndex - b.slotIndex);
  const accepted = postings.find((posting) => posting.acceptedAt !== null);
  return {
    postings,
    active: accepted
      ? {
          workOrderId: accepted.workOrderId,
          sectionsCompleted: accepted.sectionsCompleted,
          cleanPass: accepted.cleanPass,
        }
      : undefined,
  };
}

/** Load the board, locking its rows for the rest of the transaction. */
export async function loadWorkOrderBoard(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<WorkOrderBoardState> {
  const rows = await transaction
    .select()
    .from(characterWorkOrderPostings)
    .where(eq(characterWorkOrderPostings.characterId, characterId))
    .for("update");
  return boardFromRows(rows);
}

/**
 * The accepted job, if any, without loading the whole board.
 *
 * Used by the Welding resolver and by the Workbench occupancy check, both of
 * which care only about what is on the bench.
 */
export async function loadActiveWorkOrder(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<ActiveWorkOrderState | undefined> {
  const rows = await transaction
    .select()
    .from(characterWorkOrderPostings)
    .where(
      and(
        eq(characterWorkOrderPostings.characterId, characterId),
        isNotNull(characterWorkOrderPostings.acceptedAt),
      ),
    )
    .for("update");
  return boardFromRows(rows).active;
}

/**
 * Seed the board on the first authoritative touch after it is unlocked.
 *
 * Deliberately lazy rather than a side effect of accepting 10,001 Hours: the
 * generic Mission acceptance command has no business knowing that one Mission
 * opens a board, exactly as it has no business knowing 10,000 Hours opens the
 * Workbench. An untouched board is three absent rows, so nothing needs
 * backfilling, and the insert is idempotent under the character lock every
 * authoritative path already holds.
 *
 * Does nothing when the board is locked, already seeded, or the pool cannot
 * currently fill it.
 */
export async function ensureWorkOrderBoard(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    unlocked: boolean;
    weldingLevel: number;
    random: CleanPassRandom;
    now: Date;
  },
): Promise<void> {
  if (!input.unlocked) return;
  const balance = getEffectiveGameBalance();
  const existing = await transaction
    .select({
      slotIndex: characterWorkOrderPostings.slotIndex,
      workOrderId: characterWorkOrderPostings.workOrderId,
    })
    .from(characterWorkOrderPostings)
    .where(eq(characterWorkOrderPostings.characterId, input.characterId))
    .for("update");
  if (existing.length >= balance.workOrders.postedSlots) return;

  // Whatever is already posted is excluded from the draw, so filling the
  // remaining slots of a partial board cannot pick a job the board already
  // shows. A whole-board draw passes an empty list and behaves as before.
  const board = selectInitialWorkOrderBoard({
    eligible: eligibleWorkOrders(input.weldingLevel).filter(
      (definition) => !existing.some((row) => row.workOrderId === definition.id),
    ),
    slots: balance.workOrders.postedSlots - existing.length,
    random: input.random,
  });
  if (board.length === 0) return;

  const occupied = new Set(existing.map((row) => row.slotIndex));
  let drawn = 0;
  for (let slotIndex = 0; slotIndex < balance.workOrders.postedSlots; slotIndex += 1) {
    if (occupied.has(slotIndex)) continue;
    const definition = board[drawn];
    drawn += 1;
    if (!definition) break;
    await transaction
      .insert(characterWorkOrderPostings)
      .values({
        characterId: input.characterId,
        slotIndex,
        workOrderId: definition.id,
        postedAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing();
  }
}

/**
 * Commit an accepted job to its board slot.
 *
 * Only ever called from the acceptance command, which has already removed the
 * recipe from carried Inventory in the same transaction. Writing the accepted
 * state and removing the materials together is the whole invariant: there is no
 * instant at which the job is accepted but the materials are still freely
 * carried, and none at which the materials are gone but no job holds the bench.
 */
export async function commitAcceptedWorkOrder(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    slotIndex: number;
    workOrderId: WorkOrderId;
    cleanPass: CleanPassState;
    now: Date;
  },
): Promise<boolean> {
  const updated = await transaction
    .update(characterWorkOrderPostings)
    .set({
      acceptedAt: input.now,
      sectionsCompleted: 0,
      cleanPass: cleanPassToPersisted(input.cleanPass),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterWorkOrderPostings.characterId, input.characterId),
        eq(characterWorkOrderPostings.slotIndex, input.slotIndex),
        eq(characterWorkOrderPostings.workOrderId, input.workOrderId),
        // The slot must still hold this unaccepted posting. A retried or
        // concurrent acceptance finds it already accepted and changes nothing,
        // so materials can never be removed twice for one job.
        sql`${characterWorkOrderPostings.acceptedAt} IS NULL`,
      ),
    )
    .returning({ slotIndex: characterWorkOrderPostings.slotIndex });
  return updated.length > 0;
}

/** Persist an accepted job's durable Welding progress and Clean Pass state. */
export async function writeActiveWorkOrderProgress(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    sectionsCompleted: number;
    cleanPass: CleanPassState;
    now: Date;
  },
): Promise<void> {
  await transaction
    .update(characterWorkOrderPostings)
    .set({
      sectionsCompleted: input.sectionsCompleted,
      cleanPass: cleanPassToPersisted(input.cleanPass),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterWorkOrderPostings.characterId, input.characterId),
        isNotNull(characterWorkOrderPostings.acceptedAt),
      ),
    );
}

/**
 * Close an open Clean Pass window on the active job, for Stop and Travel alike.
 *
 * The Work Order counterpart of `missOpenRepairCleanPass` and
 * `interruptPracticeWelding`, and deliberately the same shape: an opportunity
 * the player was in the middle of is spent by walking away from the bench, and
 * one still ahead of the work stays scheduled.
 */
export async function missOpenWorkOrderCleanPass(
  transaction: DatabaseTransaction,
  input: { characterId: string; now: Date },
): Promise<void> {
  const active = await loadActiveWorkOrder(transaction, input.characterId);
  if (!active) return;
  const cleanPass = withOpenCleanPassMissed(active.cleanPass, active.sectionsCompleted);
  if (cleanPass === active.cleanPass) return;
  await writeActiveWorkOrderProgress(transaction, {
    characterId: input.characterId,
    sectionsCompleted: active.sectionsCompleted,
    cleanPass,
    now: input.now,
  });
}

/**
 * The authoritative completion of one Work Order.
 *
 * This is the single boundary that pays, credits the Mission, releases the
 * bench, and refills the board — whether the last section resolved while the
 * player was watching the Workbench or was discovered by lazy reconciliation on
 * their next authoritative touch. Guarded by the `accepted_at IS NOT NULL`
 * predicate on its own clearing update, so a retry or a concurrent request
 * finds nothing to clear and pays nothing a second time.
 */
export async function completeActiveWorkOrder(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    definition: WorkOrderDefinition;
    slotIndex: number;
    random: CleanPassRandom;
    now: Date;
  },
): Promise<boolean> {
  // Claim the completion first. Everything below happens only for the one
  // request that won this update, which is what makes the payout, the Mission
  // credit and the refill exactly-once without a second mechanism.
  const cleared = await transaction
    .update(characterWorkOrderPostings)
    .set({ acceptedAt: null, sectionsCompleted: 0, cleanPass: null, updatedAt: input.now })
    .where(
      and(
        eq(characterWorkOrderPostings.characterId, input.characterId),
        eq(characterWorkOrderPostings.slotIndex, input.slotIndex),
        isNotNull(characterWorkOrderPostings.acceptedAt),
      ),
    )
    .returning({ slotIndex: characterWorkOrderPostings.slotIndex });
  if (cleared.length === 0) return false;

  // Credits, incremented in SQL rather than from a read value so no in-memory
  // total can go stale.
  await transaction
    .update(characters)
    .set({ credits: sql`${characters.credits} + ${input.definition.payoutCredits}` })
    .where(eq(characters.id, input.characterId));

  // The Mission requirement observes a genuine completion, through the same
  // generic tracked-activity path Mining, Refining and Practice use. Nothing
  // else on the Work Order journey touches it.
  await recordTrackedActivity(transaction, {
    characterId: input.characterId,
    activity: "work_order",
    metric: "attempts",
    attemptCount: 1,
  });

  await refillWorkOrderSlot(transaction, {
    characterId: input.characterId,
    slotIndex: input.slotIndex,
    justClearedWorkOrderId: input.definition.id,
    random: input.random,
    now: input.now,
  });
  return true;
}

/**
 * Replace one board slot's job under the authored anti-repeat rules.
 *
 * Only the completed slot is touched: the other two postings keep their jobs
 * and their positions, because the board is a shop queue rather than something
 * that reshuffles itself whenever the player finishes a job.
 */
export async function refillWorkOrderSlot(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    slotIndex: number;
    justClearedWorkOrderId: WorkOrderId;
    random: CleanPassRandom;
    now: Date;
  },
): Promise<void> {
  const rows = await transaction
    .select()
    .from(characterWorkOrderPostings)
    .where(eq(characterWorkOrderPostings.characterId, input.characterId))
    .for("update");
  const weldingLevel = await characterSkillLevel(
    transaction,
    input.characterId,
    SKILL_IDS.welding,
    standardSkillLevelThresholds(),
  );
  const replacement = selectWorkOrderRefill({
    eligible: eligibleWorkOrders(weldingLevel),
    visibleWorkOrderIds: rows
      .filter((row) => row.slotIndex !== input.slotIndex)
      .map((row) => row.workOrderId as WorkOrderId),
    justClearedWorkOrderId: input.justClearedWorkOrderId,
    random: input.random,
  });
  if (!replacement) return;
  await transaction
    .update(characterWorkOrderPostings)
    .set({
      workOrderId: replacement.id,
      acceptedAt: null,
      sectionsCompleted: 0,
      cleanPass: null,
      postedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterWorkOrderPostings.characterId, input.characterId),
        eq(characterWorkOrderPostings.slotIndex, input.slotIndex),
      ),
    );
}

export type WorkOrderWeldingSnapshot = {
  active: ActiveWorkOrderState | undefined;
  slotIndex: number | undefined;
};

export type PersistedWorkOrderOutcome = {
  characterId: string;
  workOrderId: WorkOrderId | undefined;
  slotIndex: number | undefined;
  sectionsResolved: number;
  awardedXp: number;
  sectionsCompleted: number;
  cleanPass: CleanPassState;
  completed: boolean;
  consumedTicks: number;
  /** A bench with no accepted job cannot weld; the action stops rather than idling. */
  stopped: boolean;
};

/**
 * The Welding resolver for a customer Work Order.
 *
 * Structurally the repair resolver with a different work unit: whole 5-tick
 * sections only, a partial section granting neither progress nor XP, and a hard
 * stop at the job's own section count. What differs is the XP share and that
 * completion is a transaction rather than a permanent `completed_at` stamp,
 * because the next job will use the same bench tomorrow.
 */
export function createWorkOrderWeldingResolver(
  random: CleanPassRandom,
  onOutcome?: (outcome: PersistedWorkOrderOutcome) => void,
): ActionResolver<WorkOrderWeldingSnapshot, PersistedWorkOrderOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.workOrderWelding,
    load: async (transaction, { character }) => {
      const board = await loadWorkOrderBoard(transaction, character.id);
      const accepted = board.postings.find((posting) => posting.acceptedAt !== null);
      return { active: board.active, slotIndex: accepted?.slotIndex };
    },
    resolve: ({ action, snapshot, window }) => {
      const balance = getEffectiveGameBalance();
      const definition = snapshot.active ? getWorkOrder(snapshot.active.workOrderId) : undefined;
      if (!snapshot.active || !definition) {
        // The bench holds no client job, so there is nothing to weld. Stop the
        // action rather than leaving a cursor advancing against nothing.
        return {
          outcome: {
            characterId: action.characterId,
            workOrderId: undefined,
            slotIndex: undefined,
            sectionsResolved: 0,
            awardedXp: 0,
            sectionsCompleted: 0,
            cleanPass: UNROLLED_CLEAN_PASS,
            completed: false,
            consumedTicks: 0,
            stopped: true,
          },
          transition: { kind: "stop", consumedTicks: 0 },
        };
      }

      const sectionTicks = balance.welding.attemptDurationTicks;
      const remainingSections = definition.sections - snapshot.active.sectionsCompleted;
      const availableSections = Math.floor(window.elapsedTicks / sectionTicks);
      const sectionsResolved = Math.max(0, Math.min(remainingSections, availableSections));
      const sectionsCompleted = snapshot.active.sectionsCompleted + sectionsResolved;
      const completed = workOrderComplete(definition, sectionsCompleted);

      const outcome: PersistedWorkOrderOutcome = {
        characterId: action.characterId,
        workOrderId: snapshot.active.workOrderId,
        slotIndex: snapshot.slotIndex,
        sectionsResolved,
        awardedXp: sectionsResolved * workOrderSectionXp(balance),
        sectionsCompleted,
        cleanPass: snapshot.active.cleanPass,
        completed,
        consumedTicks: sectionsResolved * sectionTicks,
        stopped: completed,
      };
      return {
        outcome,
        transition: completed
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => {
      if (outcome.stopped && outcome.workOrderId === undefined) return;
      const now = new Date();

      if (outcome.awardedXp > 0) {
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.welding,
          awardedXp: outcome.awardedXp,
          thresholds: standardSkillLevelThresholds(),
        });
      }

      await writeActiveWorkOrderProgress(transaction, {
        characterId: outcome.characterId,
        sectionsCompleted: outcome.sectionsCompleted,
        cleanPass: outcome.cleanPass,
        now,
      });

      if (
        outcome.completed &&
        outcome.workOrderId !== undefined &&
        outcome.slotIndex !== undefined
      ) {
        const definition = getWorkOrder(outcome.workOrderId);
        if (definition) {
          await completeActiveWorkOrder(transaction, {
            characterId: outcome.characterId,
            definition,
            slotIndex: outcome.slotIndex,
            random,
            now,
          });
        }
      }
      onOutcome?.(outcome);
    },
  };
}
