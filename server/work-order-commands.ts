import { eq } from "drizzle-orm";
import { activeActions, characters, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { getWorkOrder } from "@/game/content/work-orders";
import { planExactStackRemovals } from "@/game/domain/inventory";
import { acceptedWorkOrderState } from "@/game/domain/work-orders";
import { deriveWorkbenchOccupancy, workbenchOccupiedMessage } from "@/game/domain/workbench";
import type { MiningRandom } from "@/game/domain/mining";
import { defaultMiningRandom } from "@/server/mining";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { applyStackRemovalPlan } from "@/server/carried-inventory";
import { isMissionAccepted } from "@/server/mission-state";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import { loadPracticeRow, practiceStateFromRow } from "@/server/practice-welding";
import { characterSkillLevel } from "@/server/skill-levels";
import {
  commitAcceptedWorkOrder,
  loadWorkOrderBoard,
  missOpenWorkOrderCleanPass,
} from "@/server/work-orders";

/**
 * The player commands for customer Work Orders (#207).
 *
 * The browser submits a slot and a job identity and nothing else. Every rule —
 * the unlock, the Welding level, standing in Wade's yard, the posting still
 * being there, the bench being clear, and carrying the complete recipe — is
 * re-read and revalidated inside the character lock, because a client that can
 * assert any of them is a client that can weld somebody's cargo dolly from
 * another planet with no ferrite.
 */

export type WorkOrderRefusalReason =
  | "unknown_work_order"
  | "work_orders_locked"
  | "welding_level"
  | "wrong_location"
  | "in_transit"
  | "posting_changed"
  | "workbench_occupied"
  | "insufficient_materials"
  | "no_active_work_order";

export type WorkOrderRefusal = {
  status: "refused";
  reason: WorkOrderRefusalReason;
  message: string;
};

export type WorkOrderCommandResult =
  | { status: "accepted"; workOrderId: string }
  | { status: "started" }
  | { status: "stopped" }
  | WorkOrderRefusal;

export type WorkOrderCommandState = {
  state: PlayGameplayState;
  workOrder: WorkOrderCommandResult;
};

async function currentLocationId(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId ?? "";
}

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  workOrder: WorkOrderCommandResult,
): Promise<WorkOrderCommandState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    undefined,
    undefined,
    undefined,
    now,
    { successes: 0, failures: 0, awardedXp: 0 },
  ).then((state) => ({ state, workOrder }));
}

/**
 * Whether the board is the player's to TAKE FROM at all.
 *
 * `10,001 Hours` being ACCEPTED is the permanent authorization — not its
 * completion. Turning the Mission in is Wade looking at the work, and a player
 * whose objective already reads 1/1 keeps a fully usable board while he waits.
 *
 * Deliberately asked only by acceptance. A job already on the bench was already
 * paid for out of the player's own pocket, so the job itself is the
 * authorization to finish it — exactly as a repair the player started stays
 * theirs to finish whatever happens to the Mission that opened it. Gating
 * Start on the Mission instead would strand a paid customer job on the one
 * bench with no way to finish it and no way to clear it.
 */
async function workOrdersUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<WorkOrderRefusal | undefined> {
  if (
    await isMissionAccepted(transaction, characterId, RUSK_RECOVERY_CONTENT.workOrdersMissionId)
  ) {
    return undefined;
  }
  return {
    status: "refused",
    reason: "work_orders_locked",
    message: "Talk to Wade Rusk about Work Orders before taking client work.",
  };
}

/** Where the player has to be standing, for acceptance and for Welding alike. */
async function workOrderAccess(
  transaction: DatabaseTransaction,
  characterId: string,
  action: { actionId: string } | undefined,
): Promise<WorkOrderRefusal | undefined> {
  if (action?.actionId === ACTION_IDS.travel) {
    return {
      status: "refused",
      reason: "in_transit",
      message: "Work Orders are only available at Rusk Recovery.",
    };
  }
  if (action) {
    // Welding at the bench is the one active action the terminal is ever
    // standing next to, and "the bench is busy" is the actionable truth there —
    // not the generic "finish what you are doing" every other activity gets.
    const atTheBench =
      action.actionId === ACTION_IDS.practiceWelding ||
      action.actionId === ACTION_IDS.workOrderWelding;
    return atTheBench
      ? {
          status: "refused",
          reason: "workbench_occupied",
          message:
            action.actionId === ACTION_IDS.practiceWelding
              ? "The Workbench is part-way through a practice weld. Finish it before taking client work."
              : "The Workbench already has a client job on it. Finish it before starting anything else.",
        }
      : {
          status: "refused",
          reason: "in_transit",
          message: "Finish the active activity first.",
        };
  }
  if ((await currentLocationId(transaction, characterId)) !== RUSK_RECOVERY_CONTENT.locationId) {
    return {
      status: "refused",
      reason: "wrong_location",
      message: "The Work Orders terminal is at Rusk Recovery.",
    };
  }
  return undefined;
}

/**
 * Accept a posted Work Order.
 *
 * One transaction commits the whole thing: the exact authored recipe leaves
 * carried Inventory, the posting becomes the character's active job with its
 * Clean Pass rolled once, and the board marks it In Progress. There is
 * deliberately no state in between — no job accepted while its materials are
 * still freely carried, and no materials gone without a job holding the bench.
 *
 * It does NOT start the Welding timer. The player is moved to the Workbench and
 * starts when they are ready, because a job appearing on the bench is not the
 * same event as a torch being lit.
 */
export async function acceptWorkOrder(
  userId: string,
  characterId: string,
  workOrderId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<WorkOrderCommandState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();

      const definition = getWorkOrder(workOrderId);
      if (!definition) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "unknown_work_order",
          message: "That is not a job on the board.",
        });
      }

      const locked = await workOrdersUnlocked(transaction, context.character.id);
      if (locked) return stateWith(transaction, context.character.id, now, locked);
      const access = await workOrderAccess(transaction, context.character.id, context.action);
      if (access) return stateWith(transaction, context.character.id, now, access);

      const weldingLevel = await characterSkillLevel(
        transaction,
        context.character.id,
        SKILL_IDS.welding,
        standardSkillLevelThresholds(balance),
      );
      if (weldingLevel < definition.requiredWeldingLevel) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "welding_level",
          message: `${definition.title} needs Welding level ${definition.requiredWeldingLevel}.`,
        });
      }

      // The board rows are locked from here, so a concurrent acceptance of the
      // same posting serializes behind this one and finds it already accepted.
      const board = await loadWorkOrderBoard(transaction, context.character.id);
      if (board.active) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "workbench_occupied",
          message: "You already have a client job on the bench. Finish it first.",
        });
      }
      const posting = board.postings.find(
        (candidate) => candidate.workOrderId === definition.id && candidate.acceptedAt === null,
      );
      if (!posting) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "posting_changed",
          message: "That job is no longer posted on the board.",
        });
      }

      // The other half of the one-bench rule: an unfinished Practice weld the
      // player paid for must be finished before a customer's property can take
      // its place, and must never be silently overwritten.
      const practice = practiceStateFromRow(
        await loadPracticeRow(transaction, context.character.id),
      );
      const occupancy = deriveWorkbenchOccupancy({ practice, activeWorkOrder: undefined });
      if (occupancy.kind !== "clear") {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "workbench_occupied",
          message: workbenchOccupiedMessage(occupancy) ?? "The Workbench is not clear.",
        });
      }

      // The complete recipe or nothing. Planned as one cumulative removal, so a
      // mixed Ferrite-and-Cells job cannot take the ferrite and then discover
      // the cells are short.
      const stacks = await transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, context.character.id))
        .for("update");
      const removal = planExactStackRemovals(stacks, definition.materials);
      if (!removal.ok) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "insufficient_materials",
          message: `${definition.title} needs its full material list before it can go on the bench.`,
        });
      }

      const committed = await commitAcceptedWorkOrder(transaction, {
        characterId: context.character.id,
        slotIndex: posting.slotIndex,
        workOrderId: definition.id,
        cleanPass: acceptedWorkOrderState(definition, random, balance).cleanPass,
        now,
      });
      if (!committed) {
        // A concurrent request won the slot. Nothing has been removed yet, so
        // there is nothing to undo — the materials are still the player's.
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "posting_changed",
          message: "That job is no longer posted on the board.",
        });
      }
      await applyStackRemovalPlan(transaction, {
        characterId: context.character.id,
        plan: removal,
        now,
      });

      return stateWith(transaction, context.character.id, now, {
        status: "accepted",
        workOrderId: definition.id,
      });
    },
    now,
  );
}

/**
 * Start or resume Welding the accepted job.
 *
 * A separate authoritative action from acceptance, and the only thing that ever
 * begins section timing. Resuming costs nothing and rerolls nothing: the job's
 * opportunities were rolled when it went on the bench.
 */
export async function startWorkOrderWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<WorkOrderCommandState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);

      // Idempotent: a retried Start on a job already being welded changes
      // nothing, exactly as Practice's does.
      if (context.action?.actionId === ACTION_IDS.workOrderWelding) {
        return stateWith(transaction, context.character.id, now, { status: "started" });
      }
      const access = await workOrderAccess(transaction, context.character.id, context.action);
      if (access) return stateWith(transaction, context.character.id, now, access);

      const board = await loadWorkOrderBoard(transaction, context.character.id);
      if (!board.active) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "no_active_work_order",
          message: "There is no client job on the bench.",
        });
      }

      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.workOrderWelding,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return stateWith(transaction, context.character.id, now, { status: "started" });
    },
    now,
  );
}

/**
 * Stop Welding the accepted job, preserving it.
 *
 * The job stays on the bench with every resolved section intact. Only an open
 * Clean Pass window is spent, through the same interruption Travel uses, so
 * walking away and stopping deliberately can never mean different things.
 */
export async function stopWorkOrderWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<WorkOrderCommandState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      if (context.action?.actionId !== ACTION_IDS.workOrderWelding) {
        return stateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "no_active_work_order",
          message: context.action
            ? "Finish the active activity first."
            : "There is no client job being welded.",
        });
      }
      await missOpenWorkOrderCleanPass(transaction, { characterId: context.character.id, now });
      await transaction
        .delete(activeActions)
        .where(eq(activeActions.characterId, context.character.id));
      return stateWith(transaction, context.character.id, now, { status: "stopped" });
    },
    now,
  );
}
