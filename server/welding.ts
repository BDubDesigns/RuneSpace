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
import {
  cleanPassFromPersisted,
  cleanPassToPersisted,
  rolledCleanPass,
  UNROLLED_CLEAN_PASS,
  withOpenCleanPassMissed,
  type CleanPassRandom,
  type CleanPassState,
} from "@/game/domain/clean-pass";
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
  materials: {},
  weldingProgress: 0,
  cleanPass: UNROLLED_CLEAN_PASS,
  completedAt: null,
};

/** One repair row's Clean Pass state (#190). */
export function repairCleanPassFromRow(
  row: typeof characterRepairTargets.$inferSelect | undefined,
): CleanPassState {
  if (!row) return UNROLLED_CLEAN_PASS;
  return cleanPassFromPersisted(row.cleanPass);
}

/** Persist one repair's Clean Pass state (roll, claim, or interruption miss). */
export async function writeRepairCleanPass(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    targetId: RepairTargetId;
    cleanPass: CleanPassState;
    weldingProgress?: number;
    now: Date;
  },
): Promise<void> {
  await transaction
    .update(characterRepairTargets)
    .set({
      cleanPass: cleanPassToPersisted(input.cleanPass),
      ...(input.weldingProgress === undefined ? {} : { weldingProgress: input.weldingProgress }),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterRepairTargets.characterId, input.characterId),
        eq(characterRepairTargets.targetId, input.targetId),
      ),
    );
}

export function repairStateFromRow(
  row: typeof characterRepairTargets.$inferSelect | undefined,
): RepairTargetState {
  if (!row) return UNSTARTED_REPAIR;
  return {
    materials: (row.materials ?? {}) as Record<string, number>,
    weldingProgress: row.weldingProgress,
    cleanPass: repairCleanPassFromRow(row),
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
 * Roll this repair's Clean Pass opportunities, once, when Welding first starts
 * on it (#190).
 *
 * A repair is ONE Welding work unit, so a roll that already exists is left
 * exactly as it is: Stop and Resume must never reroll, or a player could shop
 * for a better placement by restarting.
 */
export async function ensureRepairCleanPassRoll(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    targetId: RepairTargetId;
    random: CleanPassRandom;
    now: Date;
  },
): Promise<void> {
  const row = await loadRepairTargetRow(transaction, input.characterId, input.targetId);
  if (!row || row.cleanPass !== null) return;
  await writeRepairCleanPass(transaction, {
    characterId: input.characterId,
    targetId: input.targetId,
    // The target's own increment count is the work unit's length, so the
    // cadence comes from the job rather than from a global assumption about
    // how long a piece of Welding is (#207).
    cleanPass: rolledCleanPass(
      input.random,
      getRepairTargetBalance(input.targetId).repairIncrements,
    ),
    now: input.now,
  });
}

/**
 * Close an open Clean Pass window on a repair, for Stop and for Travel alike.
 *
 * An opportunity the player was in the middle of is spent; one still ahead of
 * the work stays scheduled, because the work itself has not moved.
 */
export async function missOpenRepairCleanPass(
  transaction: DatabaseTransaction,
  input: { characterId: string; targetId: RepairTargetId; now: Date },
): Promise<void> {
  const row = await loadRepairTargetRow(transaction, input.characterId, input.targetId);
  if (!row) return;
  const repair = repairStateFromRow(row);
  const cleanPass = withOpenCleanPassMissed(repair.cleanPass, repair.weldingProgress);
  if (cleanPass === repair.cleanPass) return;
  await writeRepairCleanPass(transaction, {
    characterId: input.characterId,
    targetId: input.targetId,
    cleanPass,
    now: input.now,
  });
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
