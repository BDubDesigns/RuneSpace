import { and, eq } from "drizzle-orm";
import { characterMissionUnpins, characterResearchAssignments } from "@/db/rune-space";
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
  // A held Wise Old Enby research run (#406) keeps its preference on the run itself;
  // it is reported in the same list so every presentation consumer reads one value.
  const [run] = await transaction
    .select({ jobId: characterResearchAssignments.jobId })
    .from(characterResearchAssignments)
    .where(
      and(
        eq(characterResearchAssignments.characterId, characterId),
        eq(characterResearchAssignments.pinned, false),
      ),
    );
  return [...rows.map((row) => row.missionId), ...(run ? [run.jobId] : [])].sort();
}
