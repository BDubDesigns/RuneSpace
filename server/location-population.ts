import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { characterSkillXp, characters, playerAccounts } from "@/db/rune-space";
import { SKILL_IDS } from "@/game/config/foundations";
import { miningLevelThresholds } from "@/game/config/balance";
import {
  projectLocationPopulation,
  type LocationPopulationEntry,
} from "@/game/domain/location-population";
import { requireOwnedCharacter } from "@/server/ownership";

/**
 * Narrow authenticated read boundary for the characters at the active
 * character's authoritative location (issue #62).
 *
 * - The request is scoped by the owned active character: the server resolves
 *   the location from the character row; a client can never enumerate a
 *   location directly or use another player's character.
 * - One set-based query fetches the population, the owner `user.name`, and the
 *   persisted Mining XP without N+1 queries; absent XP rows are authoritative
 *   zero.
 * - The pure domain projection derives levels through the existing progression
 *   boundary and returns only the approved public fields (character name,
 *   derived level, owner name).
 */
export type LocationPopulation = {
  characters: readonly LocationPopulationEntry[];
};

export async function getLocationPopulation(
  userId: string,
  characterId: string,
): Promise<LocationPopulation> {
  const character = await requireOwnedCharacter(userId, characterId);

  const rows = await db
    .select({
      characterId: characters.id,
      displayName: characters.displayName,
      normalizedName: characters.normalizedName,
      ownerName: user.name,
      totalXp: characterSkillXp.totalXp,
    })
    .from(characters)
    .innerJoin(playerAccounts, eq(characters.playerAccountId, playerAccounts.id))
    .innerJoin(user, eq(playerAccounts.userId, user.id))
    .leftJoin(
      characterSkillXp,
      and(
        eq(characterSkillXp.characterId, characters.id),
        eq(characterSkillXp.skillId, SKILL_IDS.mining),
      ),
    )
    .where(
      and(
        eq(characters.currentLocationId, character.currentLocationId),
        ne(characters.id, characterId),
      ),
    );

  return {
    characters: projectLocationPopulation({
      activeCharacterId: characterId,
      rows,
      thresholds: miningLevelThresholds(),
    }),
  };
}
