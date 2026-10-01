import { and, eq } from "drizzle-orm";
import { characterSkillXp, recipeUnlockNotices } from "@/db/rune-space";
import type { SkillId } from "@/game/config/foundations";
import { grantSkillXp, type LevelThreshold, type XpGrantResult } from "@/game/domain/progression";
import { recipesUnlockedBetween } from "@/game/domain/recipe-unlocks";
import { afterCharacterCommandCommits, type DatabaseTransaction } from "@/server/action-resolution";
import { publishRealtimeEvent } from "@/server/realtime";

/**
 * Persist an XP award through the sole domain progression rule. Callers must
 * hold the character command lock supplied by `withResolvedOwnedCharacter`.
 *
 * This is the gameplay XP boundary, so it also owns recipe-unlock notices
 * (issue #274): when the award raises the level past one or more authored
 * recipes' `minimumLevel`, one grouped System notice is written in this same
 * transaction, and the character's open tabs are prompted only once it
 * commits. The operator's SET TOTAL XP repair never comes through here, so it
 * never fabricates a notice.
 */
export async function grantCharacterSkillXp(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    skillId: SkillId;
    awardedXp: number;
    thresholds: readonly LevelThreshold[];
  },
): Promise<XpGrantResult> {
  const rows = await transaction
    .select()
    .from(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, input.characterId),
        eq(characterSkillXp.skillId, input.skillId),
      ),
    )
    .limit(1);
  const grant = grantSkillXp(
    { skillId: input.skillId, totalXp: rows[0]?.totalXp ?? 0 },
    input.awardedXp,
    input.thresholds,
  );

  if (rows[0]) {
    await transaction
      .update(characterSkillXp)
      .set({ totalXp: grant.totalXp, updatedAt: new Date() })
      .where(
        and(
          eq(characterSkillXp.characterId, input.characterId),
          eq(characterSkillXp.skillId, input.skillId),
        ),
      );
  } else {
    await transaction.insert(characterSkillXp).values({
      characterId: input.characterId,
      skillId: input.skillId,
      totalXp: grant.totalXp,
    });
  }

  const unlocked = recipesUnlockedBetween(input.skillId, grant.previousLevel, grant.level);
  if (unlocked.length > 0) {
    await transaction.insert(recipeUnlockNotices).values({
      characterId: input.characterId,
      skillId: input.skillId,
      previousLevel: grant.previousLevel,
      level: grant.level,
      recipeActionIds: unlocked.map((recipe) => recipe.actionId),
    });
    afterCharacterCommandCommits(transaction, () => {
      publishRealtimeEvent(
        { kind: "character", characterId: input.characterId },
        "system.notice",
        {},
      );
    });
  }
  return grant;
}
