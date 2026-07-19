import { and, eq } from "drizzle-orm";
import { characterSkillXp } from "@/db/rune-space";
import type { SkillId } from "@/game/config/foundations";
import { grantSkillXp, type LevelThreshold, type XpGrantResult } from "@/game/domain/progression";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Persist an XP award through the sole domain progression rule. Callers must
 * hold the character command lock supplied by `withResolvedOwnedCharacter`.
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
  return grant;
}
