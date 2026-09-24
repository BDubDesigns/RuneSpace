import {
  projectCharacterProgression,
  type CharacterProgression,
  type CharacterSkillProgression,
} from "./character-progression";
import type { LevelThreshold } from "./progression";
import { resolveCharacterPortrait, type CharacterPortraitPresentation } from "./character-portrait";

/**
 * Public same-location character-profile projection (issue #64).
 *
 * This pure boundary adds public identity to the canonical progression
 * projection in `character-progression.ts`; it derives no level, progress, or
 * skill list of its own. Since issue #213 the Character Level and the
 * presented skill set are therefore literally the same rule the
 * current-character Character modal shows — there is one definition of what
 * skills exist, what progression means, and what Character Level means. The
 * caller (server/) supplies:
 *
 * - the target character's persisted per-skill XP rows (sparse rows are
 *   authoritative zero XP),
 * - the authoritative threshold source per skill (`levelThresholds`),
 * - the authoritative player-facing name per skill (`skillDisplayName`).
 *
 * ## Public shape
 *
 * Stable skill IDs are used internally (curve lookup, deterministic ordering)
 * but are stripped from the public projection: only player-facing identity
 * and progression values leave the server. The portrait is resolved through
 * the narrow character-portrait boundary (issues #65 and #98): a valid
 * `player-starter` or owned `player-unlockable` stored ID projects its safe
 * presentation, and null/unknown/non-selectable values project the neutral
 * placeholder — the database row is never rewritten. No emails, account IDs,
 * character database IDs, or private gameplay state are projected here or by
 * the server read boundary.
 */

/** One public skill entry in the profile: level and truthful next-level progress. */
export type CharacterProfileSkill = CharacterSkillProgression;

/** The narrow public character profile for one visible target. */
export type CharacterProfile = CharacterProgression & {
  displayName: string;
  /**
   * Public Player name of the owning account (Better Auth `displayUsername`,
   * issue #221); null only for a not-yet-migrated pre-cutover account.
   */
  ownerName: string | null;
  /** Safe portrait presentation: the selected catalog portrait or the neutral placeholder. */
  portrait: CharacterPortraitPresentation;
};

export function projectCharacterProfile(input: {
  displayName: string;
  ownerName: string | null;
  /** Persisted per-skill XP rows for the target character. */
  skillXp: readonly { skillId: string; totalXp: number }[];
  levelThresholds: (skillId: string) => readonly LevelThreshold[] | undefined;
  skillDisplayName: (skillId: string) => string | undefined;
  /** The authoritative accent-tone source per skill (issue #215). */
  skillAccentTone?: (skillId: string) => string | undefined;
  /** Defaults to every skill the game defines. */
  skillIds?: readonly string[];
  /** Persisted portrait ID (nullable for legacy characters). */
  portraitId?: string | null;
  /** Stable portrait IDs owned by the target character's player account. */
  ownedPortraitIds?: Iterable<string>;
}): CharacterProfile {
  const progression = projectCharacterProgression({
    skillXp: input.skillXp,
    levelThresholds: input.levelThresholds,
    skillDisplayName: input.skillDisplayName,
    ...(input.skillAccentTone ? { skillAccentTone: input.skillAccentTone } : {}),
    ...(input.skillIds ? { skillIds: input.skillIds } : {}),
  });

  return {
    displayName: input.displayName,
    ownerName: input.ownerName,
    ...progression,
    portrait: resolveCharacterPortrait(input.portraitId, input.ownedPortraitIds),
  };
}
