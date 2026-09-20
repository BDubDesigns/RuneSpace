import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { pacificResetDate } from "@/game/domain/daily-reset";
import { eligibleWorkOrders, selectWorkOrderBoardRefresh } from "@/game/domain/work-orders";
import type { MiningRandom } from "@/game/domain/mining";
import { defaultMiningRandom } from "@/server/mining";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import { powerAnnexNow } from "@/server/power-annex-clock";
import { characterSkillLevel } from "@/server/skill-levels";
import {
  currentLocationId,
  workOrdersUnlocked,
  type WorkOrderRefusal,
} from "@/server/work-order-commands";
import {
  commitWorkOrderBoardRefresh,
  loadWorkOrderBoard,
  loadWorkOrderRefreshState,
} from "@/server/work-orders";

/**
 * ForceSales' one-per-Pacific-day full-board refresh (#217).
 *
 * Deliberately its own command file rather than a fourth function in
 * `work-order-commands.ts`: it shares that module's access/unlock helpers
 * (re-exported from there), but its own rules — the Refining gate, the daily
 * entitlement, and batch replacement of every unaccepted slot — belong to a
 * different feature than accepting or Welding one job.
 */

export type WorkOrderRefreshResult = { status: "refreshed" } | WorkOrderRefusal;

export type WorkOrderRefreshCommandState = {
  state: PlayGameplayState;
  refresh: WorkOrderRefreshResult;
};

function refreshStateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  refresh: WorkOrderRefreshResult,
): Promise<WorkOrderRefreshCommandState> {
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
  ).then((state) => ({ state, refresh }));
}

/**
 * Where the player has to be standing.
 *
 * Deliberately narrower than `workOrderAccess`: refreshing while a Work Order
 * is In Progress is explicitly allowed, so an active bench action is never a
 * refusal here — only being away from the yard entirely is.
 */
async function refreshAccess(
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
 * Refresh every currently unaccepted posting at once.
 *
 * The accepted/In Progress posting, if any, is never among the slots handed
 * to `selectWorkOrderBoardRefresh` — it is simply excluded from
 * `clearedPostings` — so it is structurally impossible for a refresh to touch
 * it. The daily entitlement is consumed only by `commitWorkOrderBoardRefresh`
 * actually committing, so a refusal above never spends it.
 */
export async function refreshWorkOrderBoard(
  userId: string,
  characterId: string,
  now = powerAnnexNow(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<WorkOrderRefreshCommandState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();

      const locked = await workOrdersUnlocked(transaction, context.character.id);
      if (locked) return refreshStateWith(transaction, context.character.id, now, locked);

      const access = await refreshAccess(transaction, context.character.id, context.action);
      if (access) return refreshStateWith(transaction, context.character.id, now, access);

      const thresholds = standardSkillLevelThresholds(balance);
      const [weldingLevel, refiningLevel] = await Promise.all([
        characterSkillLevel(transaction, context.character.id, SKILL_IDS.welding, thresholds),
        characterSkillLevel(transaction, context.character.id, SKILL_IDS.refining, thresholds),
      ]);
      const requiredRefiningLevel = balance.workOrders.refresh.requiredRefiningLevel;
      if (refiningLevel < requiredRefiningLevel) {
        return refreshStateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "refining_level",
          message: `ForceSales Free's queue refresh needs Refining level ${requiredRefiningLevel}.`,
        });
      }

      const resetDate = pacificResetDate(now);
      const refreshState = await loadWorkOrderRefreshState(transaction, {
        characterId: context.character.id,
        resetDate,
      });
      if (refreshState.refreshedToday) {
        return refreshStateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "already_refreshed_today",
          message: "ForceSales Free's daily refresh has already been used today.",
        });
      }

      // Locks the board rows for the rest of this transaction, exactly as
      // acceptance does, so a concurrent accept/complete/refresh serializes
      // behind this one.
      const board = await loadWorkOrderBoard(transaction, context.character.id);
      const activePosting = board.postings.find((posting) => posting.acceptedAt !== null);
      const clearedPostings = board.postings.filter((posting) => posting.acceptedAt === null);

      const replacements = selectWorkOrderBoardRefresh({
        eligible: eligibleWorkOrders({ weldingLevel, refiningLevel }),
        activeWorkOrderId: activePosting?.workOrderId,
        clearedWorkOrderIds: clearedPostings.map((posting) => posting.workOrderId),
        random,
      });
      const replacementRows = clearedPostings.flatMap((posting, index) => {
        const definition = replacements[index];
        return definition ? [{ slotIndex: posting.slotIndex, workOrderId: definition.id }] : [];
      });

      const committed = await commitWorkOrderBoardRefresh(transaction, {
        characterId: context.character.id,
        resetDate,
        replacements: replacementRows,
        now,
      });
      if (!committed) {
        // Lost a race against another request for the same reset date.
        return refreshStateWith(transaction, context.character.id, now, {
          status: "refused",
          reason: "already_refreshed_today",
          message: "ForceSales Free's daily refresh has already been used today.",
        });
      }
      return refreshStateWith(transaction, context.character.id, now, { status: "refreshed" });
    },
    now,
  );
}
