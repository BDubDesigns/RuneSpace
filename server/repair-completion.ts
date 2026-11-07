import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { characterMissions, characterShips, recipeUnlockNotices } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import type { RepairTargetId } from "@/game/config/foundations";
import { MISSIONS } from "@/game/content/missions";
import { getRepairTarget } from "@/game/content/repair-targets";
import { afterCharacterCommandCommits, type DatabaseTransaction } from "@/server/action-resolution";
import { publishRealtimeEvent } from "@/server/realtime";
import { ensureShipRow } from "@/server/ship-state";

/**
 * Everything a repair target's FINAL weld commits besides its own completion
 * stamp (#501), run inside the Welding transaction that stamps it.
 *
 * Two things can ride on a completion, and each is authored, never inferred:
 * the target's `completionEffect` (the ship's tank capacity), and any Mission
 * whose `autoCompletion` names this exact target. Nothing here is a generic event
 * bus: a target with neither authors nothing and this does nothing.
 *
 * Both writes are idempotent by construction, so even a replay of this call could
 * not double anything: the capacity is a monotonic maximum and the Mission stamp
 * is guarded by `completed_at IS NULL`. The caller additionally calls this only
 * for the one resolution that moves the target from incomplete to complete.
 * Current fuel, items, currency and XP are deliberately never touched.
 */
export async function commitRepairCompletion(
  transaction: DatabaseTransaction,
  input: { characterId: string; targetId: RepairTargetId; completedAt: Date },
): Promise<{ completedMissionId?: string }> {
  const definition = getRepairTarget(input.targetId);
  if (definition?.completionEffect?.kind === "ship_long_range_tank") {
    const ship = await ensureShipRow(transaction, input.characterId, input.completedAt);
    const capacity = getEffectiveGameBalance().ship.longRangeTankCapacityFuelUnits;
    if (ship.tankCapacityFuelUnits < capacity) {
      await transaction
        .update(characterShips)
        .set({ tankCapacityFuelUnits: capacity, updatedAt: input.completedAt })
        .where(eq(characterShips.characterId, input.characterId));
    }
  }

  let completedMissionId: string | undefined;
  for (const mission of MISSIONS) {
    if (
      mission.autoCompletion?.kind !== "repair_target_complete" ||
      mission.autoCompletion.targetId !== input.targetId
    ) {
      continue;
    }
    const stamped = await transaction
      .update(characterMissions)
      .set({ completedAt: input.completedAt })
      .where(
        and(
          eq(characterMissions.characterId, input.characterId),
          eq(characterMissions.missionId, mission.id),
          isNotNull(characterMissions.acceptedAt),
          isNull(characterMissions.completedAt),
        ),
      )
      .returning({ missionId: characterMissions.missionId });
    if (stamped.length > 0) {
      completedMissionId ??= mission.id;
      // The durable System notice rides the same stamp (#501): written only by the
      // transaction that actually completed the Mission, and the partial unique
      // index makes a second write impossible even if this ever ran twice. The
      // character's open tabs are prompted only once the transaction commits.
      if (mission.completionSystemNotice) {
        const written = await transaction
          .insert(recipeUnlockNotices)
          .values({
            characterId: input.characterId,
            kind: "mission_completion",
            missionId: mission.id,
            createdAt: input.completedAt,
          })
          .onConflictDoNothing()
          .returning({ id: recipeUnlockNotices.id });
        if (written.length > 0) {
          afterCharacterCommandCommits(transaction, () => {
            publishRealtimeEvent(
              { kind: "character", characterId: input.characterId },
              "system.notice",
              {},
            );
          });
        }
      }
    }
  }
  return completedMissionId ? { completedMissionId } : {};
}
