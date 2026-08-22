import { eq } from "drizzle-orm";
import { characterCargoHoldRepair, characterSkillXp } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  resolveCargoHoldWelding,
  type CargoHoldWeldingResolution,
  type CargoHoldWeldingSnapshot,
} from "@/game/domain/cargo-hold";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

export type WeldingSnapshot = {
  repair: CargoHoldWeldingSnapshot;
};

export type PersistedWeldingOutcome = CargoHoldWeldingResolution & {
  characterId: string;
  attemptResolvedAt: readonly string[];
};

export async function ensureCargoHoldRepairState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction
    .insert(characterCargoHoldRepair)
    .values({ characterId })
    .onConflictDoNothing({ target: characterCargoHoldRepair.characterId });
}

async function loadWeldingSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<WeldingSnapshot> {
  const rows = await transaction
    .select()
    .from(characterCargoHoldRepair)
    .where(eq(characterCargoHoldRepair.characterId, characterId))
    .for("update");
  const repair = rows[0];
  if (!repair) throw new Error("Cargo Hold repair state must exist before Welding resolution");
  return {
    repair: {
      refinedFerriteContributed: repair.refinedFerriteContributed,
      slagContributed: repair.slagContributed,
      weldingProgress: repair.weldingProgress,
      completedAt: repair.completedAt,
    },
  };
}

export function createWeldingResolver(
  onOutcome?: (outcome: PersistedWeldingOutcome) => void,
): ActionResolver<WeldingSnapshot, PersistedWeldingOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.cargoHoldWelding,
    load: async (transaction, { character }) => loadWeldingSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const resolved = resolveCargoHoldWelding({
        elapsedTicks: window.elapsedTicks,
        snapshot: snapshot.repair,
        balance: getEffectiveGameBalance(),
      });
      let cumulativeAttemptTicks = 0;
      const attemptResolvedAt = Array.from({ length: resolved.completedIncrements }, () =>
        new Date(
          window.startsAt.getTime() +
            ticksToMilliseconds(
              (cumulativeAttemptTicks += getEffectiveGameBalance().welding.attemptDurationTicks),
            ),
        ).toISOString(),
      );
      const outcome: PersistedWeldingOutcome = {
        characterId: action.characterId,
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
      const rows = await transaction
        .select()
        .from(characterCargoHoldRepair)
        .where(eq(characterCargoHoldRepair.characterId, outcome.characterId))
        .for("update");
      const repair = rows[0];
      if (!repair) throw new Error("Cargo Hold repair state must exist before Welding persistence");
      if (outcome.completedIncrements > 0 || outcome.completed) {
        await transaction
          .update(characterCargoHoldRepair)
          .set({
            weldingProgress: outcome.weldingProgress,
            completedAt: outcome.completed
              ? (repair.completedAt ?? new Date())
              : repair.completedAt,
            updatedAt: new Date(),
          })
          .where(eq(characterCargoHoldRepair.characterId, outcome.characterId));
      }
      onOutcome?.(outcome);
    },
  };
}
