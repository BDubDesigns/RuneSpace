import { eq } from "drizzle-orm";
import { characterPracticeWelds } from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  practiceSectionXp,
  workOrderSectionXp,
  repairTargetForActionId,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { cleanPassClaim, withCleanPassOutcome } from "@/game/domain/clean-pass";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  loadPracticeRow,
  practiceStateFromRow,
  writePracticeState,
} from "@/server/practice-welding";
import { getWorkOrder } from "@/game/content/work-orders";
import { grantCharacterSkillXp } from "@/server/progression";
import { loadActiveWorkOrder, writeActiveWorkOrderProgress } from "@/server/work-orders";
import { loadRepairTargetRow, repairStateFromRow, writeRepairCleanPass } from "@/server/welding";

/**
 * The Clean Pass claim — one command for every kind of Welding (#190).
 *
 * Practice welds and authored repairs are the same mechanic, so they share this
 * one authoritative claim rather than each growing their own. What differs is
 * only which work unit owns the state and what a section of that work is worth:
 * a Practice section pays the reduced Practice XP, a repair section pays full
 * Welding XP.
 *
 * A successful claim advances the work one extra section immediately and pays
 * exactly that section's ordinary XP. It never changes what the work costs in
 * materials and never invents a higher per-section value. Missing one costs
 * nothing at all.
 */

export type CleanPassClaimStatus =
  | { status: "claimed"; awardedXp: number }
  | { status: "refused"; reason: "no_welding" | "none_open" | "expired"; message: string };

export type CleanPassClaimResult = {
  state: PlayGameplayState;
  cleanPass: CleanPassClaimStatus;
};

const REFUSALS = {
  no_welding: "Clean Pass is only available while you are welding.",
  none_open: "There is no Clean Pass to take right now.",
  expired: "That Clean Pass has already passed.",
} as const;

export async function claimCleanPass(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<CleanPassClaimResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();

      const stateFor = async (cleanPass: CleanPassClaimStatus): Promise<CleanPassClaimResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          { successes: 0, failures: 0, awardedXp: 0 },
          undefined,
          undefined,
          undefined,
          undefined,
          now,
        ),
        cleanPass,
      });

      const action = context.action;
      if (!action) {
        return stateFor({
          status: "refused",
          reason: "no_welding",
          message: REFUSALS.no_welding,
        });
      }

      // Practice and every repair target resolve the same way; only the state
      // holder and the per-section XP differ.
      if (action.actionId === ACTION_IDS.practiceWelding) {
        const row = await loadPracticeRow(transaction, context.character.id);
        if (!row) {
          return stateFor({
            status: "refused",
            reason: "no_welding",
            message: REFUSALS.no_welding,
          });
        }
        const practice = practiceStateFromRow(row);
        const claim = cleanPassClaim({
          state: practice.cleanPass,
          sectionsCompleted: practice.sectionsCompleted,
          startedAt: action.startedAt,
          resolvedThroughAt: action.resolvedThroughAt,
          now,
          balance,
        });
        if (!claim.ok) {
          return stateFor({
            status: "refused",
            reason: claim.reason,
            message: REFUSALS[claim.reason],
          });
        }
        // An authored opportunity always leaves an ordinary tail after it, so a
        // claim can never be the section that finishes the weld. Fail closed
        // rather than quietly completing a weld through this path.
        if (practice.sectionsCompleted + 1 >= balance.practiceWelding.sectionsPerWeld) {
          throw new Error("A Clean Pass claim cannot complete a Practice weld");
        }
        const awardedXp = practiceSectionXp(balance);
        await grantCharacterSkillXp(transaction, {
          characterId: context.character.id,
          skillId: SKILL_IDS.welding,
          awardedXp,
          thresholds: standardSkillLevelThresholds(balance),
        });
        await writePracticeState(transaction, {
          characterId: context.character.id,
          practice: {
            ...practice,
            sectionsCompleted: practice.sectionsCompleted + 1,
            cleanPass: withCleanPassOutcome(practice.cleanPass, claim.index, "claimed"),
          },
          now,
        });
        await transaction
          .update(characterPracticeWelds)
          .set({ runXpGained: row.runXpGained + awardedXp, updatedAt: now })
          .where(eq(characterPracticeWelds.characterId, context.character.id));
        return stateFor({ status: "claimed", awardedXp });
      }

      // A customer Work Order is the same mechanic again: the job holds its own
      // rolled opportunities and pays its own section's XP (#207).
      if (action.actionId === ACTION_IDS.workOrderWelding) {
        const active = await loadActiveWorkOrder(transaction, context.character.id);
        const definition = active ? getWorkOrder(active.workOrderId) : undefined;
        if (!active || !definition) {
          return stateFor({
            status: "refused",
            reason: "no_welding",
            message: REFUSALS.no_welding,
          });
        }
        const claim = cleanPassClaim({
          state: active.cleanPass,
          sectionsCompleted: active.sectionsCompleted,
          startedAt: action.startedAt,
          resolvedThroughAt: action.resolvedThroughAt,
          now,
          balance,
        });
        if (!claim.ok) {
          return stateFor({
            status: "refused",
            reason: claim.reason,
            message: REFUSALS[claim.reason],
          });
        }
        // The authored cadence always leaves an ordinary tail after the last
        // opportunity, whatever the job's length, so a claim can never be the
        // section that finishes it. Fail closed rather than quietly completing
        // a customer's job — and its payout — through this path.
        if (active.sectionsCompleted + 1 >= definition.sections) {
          throw new Error("A Clean Pass claim cannot complete a Work Order");
        }
        const awardedXp = workOrderSectionXp(balance);
        await grantCharacterSkillXp(transaction, {
          characterId: context.character.id,
          skillId: SKILL_IDS.welding,
          awardedXp,
          thresholds: standardSkillLevelThresholds(balance),
        });
        await writeActiveWorkOrderProgress(transaction, {
          characterId: context.character.id,
          sectionsCompleted: active.sectionsCompleted + 1,
          cleanPass: withCleanPassOutcome(active.cleanPass, claim.index, "claimed"),
          now,
        });
        return stateFor({ status: "claimed", awardedXp });
      }

      const targetId = repairTargetForActionId(action.actionId, balance);
      if (!targetId) {
        return stateFor({
          status: "refused",
          reason: "no_welding",
          message: REFUSALS.no_welding,
        });
      }
      const row = await loadRepairTargetRow(transaction, context.character.id, targetId);
      if (!row) {
        return stateFor({
          status: "refused",
          reason: "no_welding",
          message: REFUSALS.no_welding,
        });
      }
      const repair = repairStateFromRow(row);
      const claim = cleanPassClaim({
        state: repair.cleanPass,
        sectionsCompleted: repair.weldingProgress,
        startedAt: action.startedAt,
        resolvedThroughAt: action.resolvedThroughAt,
        now,
        balance,
      });
      if (!claim.ok) {
        return stateFor({
          status: "refused",
          reason: claim.reason,
          message: REFUSALS[claim.reason],
        });
      }
      const target = getRepairTargetBalance(targetId, balance);
      // As above: an opportunity always leaves an ordinary tail, so a claim can
      // never be the increment that finishes a repair — which would otherwise
      // have to complete it here, outside the one Welding resolution that owns
      // repair completion.
      if (repair.weldingProgress + 1 >= target.repairIncrements) {
        throw new Error("A Clean Pass claim cannot complete a repair");
      }
      const awardedXp = balance.welding.xpPerIncrement;
      await grantCharacterSkillXp(transaction, {
        characterId: context.character.id,
        skillId: SKILL_IDS.welding,
        awardedXp,
        thresholds: standardSkillLevelThresholds(balance),
      });
      await writeRepairCleanPass(transaction, {
        characterId: context.character.id,
        targetId,
        cleanPass: withCleanPassOutcome(repair.cleanPass, claim.index, "claimed"),
        weldingProgress: repair.weldingProgress + 1,
        now,
      });
      return stateFor({ status: "claimed", awardedXp });
    },
    now,
  );
}
