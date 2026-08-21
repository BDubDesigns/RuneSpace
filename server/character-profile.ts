import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
  characterSkillXp,
  characters,
  playerAccounts,
  playerPortraitUnlocks,
} from "@/db/rune-space";
import { SKILL_IDS } from "@/game/config/foundations";
import { skillLevelThresholds } from "@/game/config/balance";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { validateCharacterName } from "@/game/domain/character-name";
import { projectCharacterProfile, type CharacterProfile } from "@/game/domain/character-profile";
import { requireOwnedCharacter } from "@/server/ownership";

/**
 * Narrow authenticated public-character-profile read boundary (issue #64).
 *
 * - The request is scoped by the owned active character (same authenticated
 *   scope as issue #62): a client can never inspect a character through
 *   another player's active character, and the server always resolves the
 *   location itself.
 * - The target is identified only by its public display name — no character
 *   database IDs ever enter the browser surface — and is revalidated
 *   server-side on EVERY read: the single profile statement requires, in the
 *   same database snapshot, that the target is a different character whose
 *   authoritative `current_location_id` equals the active character's current
 *   location at read time. A concurrent Travel resolution can therefore never
 *   let a profile for a no-longer-co-located target escape.
 * - All target refusals (invalid name, unknown name, the active character, or
 *   a character at another location) return the same generic error so a
 *   guessed name cannot reveal anything.
 * - One set-based query fetches the target, its owner name, and ALL of its
 *   skill XP rows (no N+1 skill queries); absent XP rows are authoritative
 *   zero. Levels and progress are derived by the pure domain projection
 *   through the existing progression boundary.
 * - Only approved public identity and progression fields are returned: no
 *   emails, account IDs, character database IDs, or private gameplay state.
 */

/** Generic refusal for any target the requester may not inspect. */
export class ProfileError extends Error {
  constructor() {
    super("Character not found");
    this.name = "ProfileError";
  }
}

export async function getCharacterProfile(
  userId: string,
  activeCharacterId: string,
  targetName: string,
): Promise<CharacterProfile> {
  // Ownership of the active character is the authenticated scope for every
  // read (same boundary as #62). The character ID itself is immutable, so this
  // guard cannot go stale; the location is NOT read here — the profile
  // statement below resolves it atomically at read time.
  await requireOwnedCharacter(userId, activeCharacterId);

  // Validate through the name boundary (SSOT): malformed or overlong raw query
  // input is refused rather than normalized into a lookup key.
  const validation = validateCharacterName(targetName);
  if (!validation.ok) {
    throw new ProfileError();
  }

  // Scalar subquery of the active character's authoritative current location,
  // evaluated in the same statement as the target predicates so both locations
  // come from one snapshot.
  const activeLocation = db
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, activeCharacterId));

  const rows = await db
    .select({
      displayName: characters.displayName,
      ownerName: user.name,
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
    .where(
      and(
        eq(characters.normalizedName, validation.normalized),
        ne(characters.id, activeCharacterId),
        eq(characters.currentLocationId, activeLocation),
      ),
    );

  if (rows.length === 0) {
    // Unknown, active, or not co-located — one indistinguishable refusal.
    throw new ProfileError();
  }

  // Dedupe is unnecessary (character_skill_xp is unique per character+skill),
  // but the left join yields one row per persisted XP row; null skill rows are
  // characters without any XP row.
  const xpBySkill = new Map(
    rows
      .filter((row) => row.skillId !== null && row.totalXp !== null)
      .map((row) => [row.skillId!, row.totalXp!]),
  );
  // Present every skill with an approved level curve (Mining today), defaulting
  // absent XP rows to authoritative zero — the same convention as #62.
  const skillProgress = Object.values(SKILL_IDS)
    .filter((skillId) => skillLevelThresholds(skillId) !== undefined)
    .map((skillId) => ({ skillId, totalXp: xpBySkill.get(skillId) ?? 0 }));

  const ownedPortraitIds = rows[0]!.ownedPortraitId ? [rows[0]!.ownedPortraitId] : [];

  return projectCharacterProfile({
    displayName: rows[0]!.displayName,
    ownerName: rows[0]!.ownerName,
    portraitId: rows[0]!.portraitId,
    ownedPortraitIds,
    skillProgress,
    levelThresholds: skillLevelThresholds,
    skillDisplayName: (skillId) => getSkillPresentation(skillId)?.displayName,
  });
}
