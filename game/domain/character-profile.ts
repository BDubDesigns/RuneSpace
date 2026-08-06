import { skillLevelProgress, type LevelThreshold } from "./progression";
import { resolveCharacterPortrait, type CharacterPortraitPresentation } from "./character-portrait";

/**
 * Public same-location character-profile projection (issue #64).
 *
 * This pure boundary derives every level and next-level progress value through
 * the existing authoritative progression rule (`skillLevelProgress`, which
 * wraps `levelFromXp`); it never invents a formula or a stored level. The
 * caller (server/) supplies:
 *
 * - the target character's persisted per-skill XP rows (deduped; absent rows
 *   are represented as zero XP by the caller),
 * - the authoritative threshold source per skill (`levelThresholds`),
 * - the authoritative player-facing name per skill (`skillDisplayName`).
 *
 * Only skills with BOTH an approved level curve and an approved player-facing
 * name are presented: a skill without a curve (for example Strength today,
 * which has a persisted starter XP row but no approved progression) has no
 * truthful level and is therefore omitted until a curve is approved. Future
 * skills appear automatically when those two content boundaries define them —
 * no Mining-specific component or projection branch.
 *
 * ## Overall-level rule
 *
 * The overall level is the highest derived level across the character's
 * presented skills, with level 1 as the baseline when no skill is presented.
 * With Mining as the only presented skill it therefore equals the Mining
 * level. This narrow aggregate naturally supports additional skills later and
 * adds no persisted or duplicated level formula.
 *
 * ## Public shape
 *
 * Stable skill IDs are used internally (curve lookup, deterministic ordering)
 * but are stripped from the public projection: only player-facing identity
 * and progression values leave the server. The portrait is resolved through
 * the narrow character-portrait boundary (issue #65): a valid `player-starter`
 * stored ID projects its safe presentation, and null/unknown/non-selectable
 * values project the neutral placeholder — the database row is never
 * rewritten. No emails, account IDs, character database IDs, or private
 * gameplay state are projected here or by the server read boundary.
 */

/** One public skill entry in the profile: level and truthful next-level progress. */
export type CharacterProfileSkill = {
  /** Player-facing skill name from the authoritative content boundary. */
  displayName: string;
  level: number;
  totalXp: number;
  /** XP earned within the current level. */
  xpIntoLevel: number;
  /** XP required to reach the next level; absent at the maximum level. */
  xpToNextLevel?: number;
  atMaximumLevel: boolean;
};

/** The narrow public character profile for one visible target. */
export type CharacterProfile = {
  displayName: string;
  /** Public owner/player name from the Better Auth `user.name` boundary. */
  ownerName: string;
  overallLevel: number;
  /** Presented skills in deterministic stable-ID order. */
  skills: readonly CharacterProfileSkill[];
  /** Safe portrait presentation: the selected catalog portrait or the neutral placeholder. */
  portrait: CharacterPortraitPresentation;
};

export function projectCharacterProfile(input: {
  displayName: string;
  ownerName: string;
  /** Persisted per-skill XP rows for the target character. */
  skillProgress: readonly { skillId: string; totalXp: number }[];
  levelThresholds: (skillId: string) => readonly LevelThreshold[] | undefined;
  skillDisplayName: (skillId: string) => string | undefined;
  /** Persisted portrait ID (nullable for legacy characters). */
  portraitId?: string | null;
}): CharacterProfile {
  const presented = input.skillProgress
    .map(({ skillId, totalXp }) => {
      const thresholds = input.levelThresholds(skillId);
      const displayName = input.skillDisplayName(skillId);
      if (!thresholds || !displayName) return undefined;
      const progress = skillLevelProgress(totalXp, thresholds);
      return { skillId, displayName, ...progress };
    })
    .filter((skill) => skill !== undefined)
    .sort((first, second) =>
      first.skillId < second.skillId ? -1 : first.skillId > second.skillId ? 1 : 0,
    );

  // Overall-level rule: highest derived level across presented skills, with
  // level 1 as the baseline (see module documentation).
  const overallLevel = presented.reduce((highest, skill) => Math.max(highest, skill.level), 1);

  return {
    displayName: input.displayName,
    ownerName: input.ownerName,
    overallLevel,
    skills: presented.map((skill) => ({
      displayName: skill.displayName,
      level: skill.level,
      totalXp: skill.totalXp,
      xpIntoLevel: skill.xpIntoLevel,
      ...(skill.xpToNextLevel !== undefined ? { xpToNextLevel: skill.xpToNextLevel } : {}),
      atMaximumLevel: skill.atMaximumLevel,
    })),
    portrait: resolveCharacterPortrait(input.portraitId),
  };
}
