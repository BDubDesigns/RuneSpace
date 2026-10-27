import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
  characters,
  characterSkillXp,
  playerAccounts,
  playerPortraitUnlocks,
} from "@/db/rune-space";
import { skillLevelThresholds } from "@/game/config/balance";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { validateCharacterName } from "@/game/domain/character-name";
import { projectCharacterProfile } from "@/game/domain/character-profile";

/** This deliberately does not call the nearby profile boundary or reconcile actions. */
export async function getPublicCharacterProfile(name: string) {
  const validated = validateCharacterName(name);
  if (!validated.ok) return null;
  const rows = await db
    .select({
      displayName: characters.displayName,
      ownerName: user.displayUsername,
      portraitId: characters.portraitId,
      ownedPortraitId: playerPortraitUnlocks.portraitId,
      skillId: characterSkillXp.skillId,
      totalXp: characterSkillXp.totalXp,
    })
    .from(characters)
    .innerJoin(playerAccounts, eq(characters.playerAccountId, playerAccounts.id))
    .innerJoin(user, eq(playerAccounts.userId, user.id))
    .leftJoin(
      playerPortraitUnlocks,
      and(
        eq(playerPortraitUnlocks.playerAccountId, characters.playerAccountId),
        eq(playerPortraitUnlocks.portraitId, characters.portraitId),
      ),
    )
    .leftJoin(characterSkillXp, eq(characterSkillXp.characterId, characters.id))
    .where(eq(characters.normalizedName, validated.normalized));
  const first = rows[0];
  if (!first) return null;
  const { sameAccount: _sameAccount, ...profile } = projectCharacterProfile({
    displayName: first.displayName,
    ownerName: first.ownerName,
    portraitId: first.portraitId,
    ownedPortraitIds: first.ownedPortraitId ? [first.ownedPortraitId] : [],
    skillXp: rows.flatMap((row) =>
      row.skillId !== null && row.totalXp !== null
        ? [{ skillId: row.skillId, totalXp: row.totalXp }]
        : [],
    ),
    levelThresholds: skillLevelThresholds,
    skillDisplayName: (id) => getSkillPresentation(id)?.displayName,
    skillAccentTone: (id) => getSkillPresentation(id)?.accentTone,
  });
  return profile;
}
