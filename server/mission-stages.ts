import { and, eq } from "drizzle-orm";
import { characterMissions, characters } from "@/db/rune-space";
import { MISSIONS, type MissionDefinition } from "@/game/content/missions";
import { activeMissionStage, missionAtStage } from "@/game/domain/mission-stages";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadMissionProjections } from "@/server/mission-state";

/** Latch ONE phase at the event boundary. Never feed a batch's remainder forward. */
export async function advanceMissionStage(
  transaction: DatabaseTransaction,
  characterId: string,
  definition: MissionDefinition,
  now = new Date(),
  acknowledged = false,
): Promise<{ completedStageId: string; activeStageId: string } | undefined> {
  if (!definition.stages) return;
  const [row] = await transaction
    .select()
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, definition.id),
      ),
    )
    .for("update");
  if (!row || row.completedAt) return;
  const stage = activeMissionStage(definition, row);
  if (!stage || stage === definition.stages.at(-1) || (stage.onAdvance && !acknowledged)) return;
  const [character] = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  const projection = (
    await loadMissionProjections(transaction, characterId, {
      currentLocationId: character!.currentLocationId,
    })
  ).find((p) => p.missionId === definition.id);
  if (!projection?.requirements?.length || !projection.requirements.every((req) => req.satisfied))
    return;
  const history = [...row.completedStageIds, stage.id];
  await transaction
    .update(characterMissions)
    .set({ completedStageIds: history })
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, definition.id),
      ),
    );
  return { completedStageId: stage.id, activeStageId: definition.stages[history.length]!.id };
}

/** Observe live-state phases within the normal locked Play reconciliation. */
export async function advanceObservedMissionStages(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<void> {
  // Durable activities/conversations advance at their own authoritative event.
  const rows = await transaction
    .select()
    .from(characterMissions)
    .where(eq(characterMissions.characterId, characterId));
  for (const row of rows) {
    if (row.completedAt) continue;
    const definition = MISSIONS.find((m) => m.id === row.missionId);
    if (!definition?.stages) continue;
    const stage = activeMissionStage(definition, row);
    if (
      stage &&
      missionAtStage(definition, stage).requirements.some(
        (req) => req.kind !== "tracked_activity" && req.kind !== "npc_conversation",
      )
    )
      await advanceMissionStage(transaction, characterId, definition, now);
  }
}
