import { eq } from "drizzle-orm";
import { characterMissions } from "@/db/rune-space";
import { MISSIONS } from "@/game/content/missions";
import { projectMission, type MissionProjection } from "@/game/domain/missions";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Authoritative mission projection for the play state. Persistence contains
 * only accepted/completed timestamps; state and objective copy are derived
 * from authored content plus the current location/action boundary.
 */
export async function loadMissionProjections(
  transaction: DatabaseTransaction,
  characterId: string,
  input: { currentLocationId: string; activeActionId?: string },
): Promise<readonly MissionProjection[]> {
  const rows = await transaction
    .select()
    .from(characterMissions)
    .where(eq(characterMissions.characterId, characterId));
  const byMissionId = new Map(rows.map((row) => [row.missionId, row]));
  const stationary = input.activeActionId === undefined;
  return MISSIONS.map((mission) =>
    projectMission(mission, byMissionId.get(mission.id), input.currentLocationId, stationary),
  );
}
