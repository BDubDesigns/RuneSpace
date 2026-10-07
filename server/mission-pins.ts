import { eq } from "drizzle-orm";
import { characterMissionUnpins } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The Missions this character has unpinned (#325).
 *
 * Pinning is a presentation preference keyed by character and Mission: absence
 * means pinned, so only explicit unpins are stored. It decides which accepted
 * Missions appear in Current Missions and nothing else — requirements,
 * guidance, dialogue, completion, and rewards never read it.
 *
 * Rows can outlive the work they describe (a Mission completed while unpinned
 * keeps its row); consumers only ever ask about active Missions, so a completed
 * Mission never shows in Current Missions whatever its row says.
 */
export async function loadUnpinnedMissionIds(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string[]> {
  const rows = await transaction
    .select({ missionId: characterMissionUnpins.missionId })
    .from(characterMissionUnpins)
    .where(eq(characterMissionUnpins.characterId, characterId))
    .orderBy(characterMissionUnpins.missionId);
  return rows.map((row) => row.missionId);
}
