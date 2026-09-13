import { and, eq } from "drizzle-orm";
import { characterRepairTargets } from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  repairTargetForActionId,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { SKILL_IDS, type RepairTargetId } from "@/game/config/foundations";
import {
  resolveWelding,
  type RepairTargetState,
  type WeldingResolution,
} from "@/game/domain/welding-repair";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

export type WeldingSnapshot = {
  targetId: RepairTargetId;
  repair: RepairTargetState;
};

export type PersistedWeldingOutcome = WeldingResolution & {
  characterId: string;
  targetId: RepairTargetId;
  attemptResolvedAt: readonly string[];
};

/** The zero state of a repair target that has never been worked on. */
export const UNSTARTED_REPAIR: RepairTargetState = {
  refinedFerriteContributed: 0,
  slagContributed: 0,
  weldingProgress: 0,
  completedAt: null,
};

export function repairStateFromRow(
  row: typeof characterRepairTargets.$inferSelect | undefined,
): RepairTargetState {
  if (!row) return UNSTARTED_REPAIR;
  return {
    refinedFerriteContributed: row.refinedFerriteContributed,
    slagContributed: row.slagContributed,
    weldingProgress: row.weldingProgress,
    completedAt: row.completedAt,
  };
}

/**
 * Create the repair-target row if this character has never touched this target.
 *
 * A repair target that has not been started is simply an absent row, so every
 * character provisioned before a target existed is already in its correct
 * state and needs no backfill.
 */
export async function ensureRepairTargetState(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
): Promise<void> {
  await transaction
    .insert(characterRepairTargets)
    .values({ characterId, targetId })
    .onConflictDoNothing({
      target: [characterRepairTargets.characterId, characterRepairTargets.targetId],
    });
}

/** Load one repair-target row under the row lock every repair command holds. */
export async function loadRepairTargetRow(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
): Promise<typeof characterRepairTargets.$inferSelect | undefined> {
  const rows = await transaction
    .select()
    .from(characterRepairTargets)
    .where(
      and(
        eq(characterRepairTargets.characterId, characterId),
        eq(characterRepairTargets.targetId, targetId),
      ),
    )
    .for("update");
  return rows[0];
}

/** Every repair-target row this character owns, for the play-state projection. */
export async function loadRepairTargetStates(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<ReadonlyMap<string, RepairTargetState>> {
  const rows = await transaction
    .select()
    .from(characterRepairTargets)
    .where(eq(characterRepairTargets.characterId, characterId));
  return new Map(rows.map((row) => [row.targetId, repairStateFromRow(row)]));
}

/**
 * The one Welding resolver, for every repair target.
 *
 * Which target is being welded comes from the active action's own ID — the
 * repair-target registry owns that mapping — so `active_actions` keeps its
 * narrow shape and never grows an arbitrary per-action payload. The resolution
 * rules, XP award, and whole-pass semantics are identical for every target;
 * only the recipe differs.
 */
export function createWeldingResolver(
  onOutcome?: (outcome: PersistedWeldingOutcome) => void,
): ActionResolver<WeldingSnapshot, PersistedWeldingOutcome> {
  return {
    supports: (action) => repairTargetForActionId(action.actionId) !== undefined,
    load: async (transaction, { character, action }) => {
      const targetId = repairTargetForActionId(action.actionId);
      if (!targetId) throw new Error(`No repair target owns action "${action.actionId}"`);
      const row = await loadRepairTargetRow(transaction, character.id, targetId);
      if (!row) throw new Error("Repair state must exist before Welding resolution");
      return { targetId, repair: repairStateFromRow(row) };
    },
    resolve: ({ action, snapshot, window }) => {
      const balance = getEffectiveGameBalance();
      const resolved = resolveWelding({
        elapsedTicks: window.elapsedTicks,
        snapshot: snapshot.repair,
        target: getRepairTargetBalance(snapshot.targetId, balance),
        balance,
      });
      let cumulativeAttemptTicks = 0;
      const attemptResolvedAt = Array.from({ length: resolved.completedIncrements }, () =>
        new Date(
          window.startsAt.getTime() +
            ticksToMilliseconds((cumulativeAttemptTicks += balance.welding.attemptDurationTicks)),
        ).toISOString(),
      );
      const outcome: PersistedWeldingOutcome = {
        characterId: action.characterId,
        targetId: snapshot.targetId,
        ...resolved,
        attemptResolvedAt,
      };
      return {
        outcome,
        transition: outcome.stopReason
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => {
      if (outcome.awardedXp > 0) {
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.welding,
          awardedXp: outcome.awardedXp,
          thresholds: standardSkillLevelThresholds(),
        });
      }
      const repair = await loadRepairTargetRow(transaction, outcome.characterId, outcome.targetId);
      if (!repair) throw new Error("Repair state must exist before Welding persistence");
      if (outcome.completedIncrements > 0 || outcome.completed) {
        await transaction
          .update(characterRepairTargets)
          .set({
            weldingProgress: outcome.weldingProgress,
            completedAt: outcome.completed
              ? (repair.completedAt ?? new Date())
              : repair.completedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterRepairTargets.characterId, outcome.characterId),
              eq(characterRepairTargets.targetId, outcome.targetId),
            ),
          );
      }
      onOutcome?.(outcome);
    },
  };
}
