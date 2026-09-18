import { and, eq } from "drizzle-orm";
import { characterSkillXp } from "@/db/rune-space";
import { skillLevelProgress, type LevelThreshold } from "@/game/domain/progression";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Read one character's current level on one skill (#207).
 *
 * The shared play-state assembly already derives every skill's level for
 * projection, but authoritative commands need a single level in isolation — a
 * Mission's authored skill prerequisite, or the Welding level that decides which
 * Work Orders are eligible. Reading it here, through the same
 * `skillLevelProgress` curve the projection uses, is what keeps a command's
 * answer and the player's displayed level the same answer.
 */
export async function characterSkillLevel(
  transaction: DatabaseTransaction,
  characterId: string,
  skillId: string,
  thresholds: readonly LevelThreshold[],
): Promise<number> {
  const rows = await transaction
    .select({ totalXp: characterSkillXp.totalXp })
    .from(characterSkillXp)
    .where(
      and(eq(characterSkillXp.characterId, characterId), eq(characterSkillXp.skillId, skillId)),
    )
    .limit(1);
  return skillLevelProgress(rows[0]?.totalXp ?? 0, thresholds).level;
}

/** Every requested skill's current level, as the Mission projection consumes it. */
export async function characterSkillLevels(
  transaction: DatabaseTransaction,
  characterId: string,
  skills: readonly { skillId: string; thresholds: readonly LevelThreshold[] }[],
): Promise<ReadonlyMap<string, number>> {
  const rows = await transaction
    .select({ skillId: characterSkillXp.skillId, totalXp: characterSkillXp.totalXp })
    .from(characterSkillXp)
    .where(eq(characterSkillXp.characterId, characterId));
  const levels = new Map<string, number>();
  for (const skill of skills) {
    const totalXp = rows.find((row) => row.skillId === skill.skillId)?.totalXp ?? 0;
    levels.set(skill.skillId, skillLevelProgress(totalXp, skill.thresholds).level);
  }
  return levels;
}
