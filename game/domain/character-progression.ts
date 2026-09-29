import { SKILL_IDS } from "@/game/config/foundations";
import { skillLevelProgress, type LevelThreshold } from "./progression";

/**
 * Canonical cross-skill character progression (issue #213).
 *
 * RuneSpace has exactly one definition of what skills a character has, what
 * progression means for each of them, and what a character's overall level is.
 * That definition lives here so the same values reach every surface: the
 * same-location player inspector (`game/domain/character-profile.ts`) and the
 * current-character Character modal both project through this module and
 * neither re-implements a formula, a threshold lookup, or a skill list.
 *
 * ## Character Level
 *
 * ```
 * Character Level = 1 + Σ(skillLevel - 1)
 * ```
 *
 * A character starts at Level 1 and every skill level earned above the
 * starting level adds exactly one Character Level. Because every RuneSpace
 * skill begins at Level 1, an untrained skill contributes zero: adding a new
 * skill to the game cannot move any existing character's level. This is
 * deliberately NOT the sum of raw skill levels, which would grow with the
 * skill catalog rather than with what the player has done.
 *
 * Character Level has no XP track of its own. It is derived, never persisted,
 * and there is nothing to migrate when the skill catalog changes.
 *
 * ## Which skills are presented
 *
 * The skill catalog is `SKILL_IDS` — not a per-surface list. A skill is
 * presented only when it has BOTH an approved level curve and an approved
 * player-facing name; a skill with neither (Strength today, which has a
 * persisted starter XP row but no approved progression) has no truthful level
 * and is omitted until those two content boundaries define it. A future skill
 * therefore appears on every progression surface as soon as it is added to the
 * game, with no UI change anywhere.
 *
 * A presented skill with no persisted XP row is authoritative zero XP, which
 * derives as Level 1 with no progress toward Level 2 — the same answer as a
 * stored row of 0.
 */

/** The level every RuneSpace character and skill starts at. */
export const STARTING_LEVEL = 1;

/** One presented skill: its player-facing name, level, and next-level progress. */
export type CharacterSkillProgression = {
  /** Player-facing skill name from the authoritative content boundary. */
  displayName: string;
  level: number;
  totalXp: number;
  /** XP earned within the current level. */
  xpIntoLevel: number;
  /** XP required to reach the next level; absent at the maximum level. */
  xpToNextLevel?: number;
  atMaximumLevel: boolean;
  /**
   * The skill's canonical accent tone from the content boundary (issue #215),
   * when one has been chosen — absent for a skill with no approved accent yet.
   * A stable semantic key (e.g. `"mining"`), never a CSS value; resolving it to
   * a color is a UI concern (`components/ui/skill-accent.ts`).
   */
  accentTone?: string;
};

/** A character's canonical level and its presented per-skill progression. */
export type CharacterProgression = {
  /** `1 + Σ(skillLevel - 1)` across the presented skills. */
  characterLevel: number;
  /** Presented skills in deterministic stable-ID order. */
  skills: readonly CharacterSkillProgression[];
};

/**
 * The canonical Character Level rule. Every surface that shows a character's
 * overall level calls this; the formula exists nowhere else.
 */
export function characterLevelFromSkillLevels(skillLevels: Iterable<number>): number {
  let level = STARTING_LEVEL;
  for (const skillLevel of skillLevels) {
    if (!Number.isInteger(skillLevel) || skillLevel < STARTING_LEVEL) {
      throw new RangeError(`Skill levels must be integers of at least ${STARTING_LEVEL}`);
    }
    level += skillLevel - STARTING_LEVEL;
  }
  return level;
}

/** A skill that passes the presentation rule, with the curve it was admitted on. */
export type PresentedSkill = {
  skillId: string;
  displayName: string;
  thresholds: readonly LevelThreshold[];
};

/**
 * The one rule for which skills a surface presents: a skill in the catalog
 * (`skillIds`, default every `SKILL_IDS` entry) with BOTH an approved level
 * curve and an approved player-facing name, in deterministic stable-ID order.
 * `projectCharacterProgression` and every other consumer that needs the
 * presented set (the operator SET TOTAL XP picker) call this instead of
 * restating the rule.
 */
export function presentedSkills(input: {
  levelThresholds: (skillId: string) => readonly LevelThreshold[] | undefined;
  skillDisplayName: (skillId: string) => string | undefined;
  /** Defaults to every skill the game defines. */
  skillIds?: readonly string[];
}): readonly PresentedSkill[] {
  return (input.skillIds ?? Object.values(SKILL_IDS))
    .flatMap((skillId) => {
      const thresholds = input.levelThresholds(skillId);
      const displayName = input.skillDisplayName(skillId);
      return thresholds && displayName ? [{ skillId, displayName, thresholds }] : [];
    })
    .sort((first, second) =>
      first.skillId < second.skillId ? -1 : first.skillId > second.skillId ? 1 : 0,
    );
}

/**
 * Project a character's canonical level and per-skill progression from its
 * persisted XP rows.
 *
 * `skillXp` may be sparse: an absent row is authoritative zero XP. The level
 * curve and the player-facing name are injected so the pure projection never
 * reaches into config or content itself, and so future approved balance
 * overrides stay live. `skillIds` defaults to the game's whole skill catalog;
 * callers outside tests have no reason to narrow it.
 */
export function projectCharacterProgression(input: {
  /** Persisted per-skill XP rows; absent rows are authoritative zero. */
  skillXp: readonly { skillId: string; totalXp: number }[];
  levelThresholds: (skillId: string) => readonly LevelThreshold[] | undefined;
  skillDisplayName: (skillId: string) => string | undefined;
  /**
   * The authoritative accent-tone source per skill (issue #215); absent for a
   * skill with no approved accent yet. Defaults to none, so callers that don't
   * present color (e.g. the location-population level list) need not supply it.
   */
  skillAccentTone?: (skillId: string) => string | undefined;
  /** Defaults to every skill the game defines. */
  skillIds?: readonly string[];
}): CharacterProgression {
  const totalXpBySkillId = new Map(input.skillXp.map((row) => [row.skillId, row.totalXp]));
  const skillAccentTone = input.skillAccentTone ?? (() => undefined);

  const skills = presentedSkills(input).map(({ skillId, displayName, thresholds }) => {
    const progress = skillLevelProgress(totalXpBySkillId.get(skillId) ?? 0, thresholds);
    const accentTone = skillAccentTone(skillId);
    return { skillId, displayName, accentTone, ...progress };
  });

  return {
    characterLevel: characterLevelFromSkillLevels(skills.map((skill) => skill.level)),
    skills: skills.map((skill) => ({
      displayName: skill.displayName,
      level: skill.level,
      totalXp: skill.totalXp,
      xpIntoLevel: skill.xpIntoLevel,
      ...(skill.xpToNextLevel !== undefined ? { xpToNextLevel: skill.xpToNextLevel } : {}),
      atMaximumLevel: skill.atMaximumLevel,
      ...(skill.accentTone !== undefined ? { accentTone: skill.accentTone } : {}),
    })),
  };
}
