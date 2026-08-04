import type { SkillId } from "@/game/config/foundations";

export type LevelThreshold = {
  level: number;
  totalXp: number;
};

export type SkillProgress = {
  skillId: SkillId;
  totalXp: number;
};

export type XpGrantResult = SkillProgress & {
  previousLevel: number;
  level: number;
  awardedXp: number;
};

export type SkillLevelProgress = {
  level: number;
  totalXp: number;
  /** XP earned within the current level (total XP minus the level's threshold). */
  xpIntoLevel: number;
  /**
   * XP required to reach the next level, or undefined at the maximum level:
   * no requirement is fabricated for a level that does not exist.
   */
  xpToNextLevel?: number;
  /** True when the derived level is the maximum level of the threshold source. */
  atMaximumLevel: boolean;
};

function validateThresholds(thresholds: readonly LevelThreshold[]): void {
  if (thresholds.length === 0) throw new RangeError("At least one level threshold is required");

  let previousLevel = 0;
  let previousXp = -1;
  for (const threshold of thresholds) {
    if (!Number.isInteger(threshold.level) || threshold.level <= previousLevel) {
      throw new RangeError("Level thresholds must be strictly increasing positive integers");
    }
    if (!Number.isInteger(threshold.totalXp) || threshold.totalXp < previousXp) {
      throw new RangeError("XP thresholds must be non-negative increasing integers");
    }
    previousLevel = threshold.level;
    previousXp = threshold.totalXp;
  }
}

/** Derive level from the caller's single authoritative threshold source. */
export function levelFromXp(totalXp: number, thresholds: readonly LevelThreshold[]): number {
  if (!Number.isInteger(totalXp) || totalXp < 0) {
    throw new RangeError("Total XP must be a non-negative integer");
  }
  validateThresholds(thresholds);

  let level = thresholds[0]!.level;
  for (const threshold of thresholds) {
    if (threshold.totalXp > totalXp) break;
    level = threshold.level;
  }
  return level;
}

/** The sole domain boundary for all future XP awards. */
export function grantSkillXp(
  progress: SkillProgress,
  awardedXp: number,
  thresholds: readonly LevelThreshold[],
): XpGrantResult {
  if (!Number.isInteger(progress.totalXp) || progress.totalXp < 0) {
    throw new RangeError("Stored total XP must be a non-negative integer");
  }
  if (!Number.isInteger(awardedXp) || awardedXp < 0) {
    throw new RangeError("XP awards must be non-negative integers");
  }

  const previousLevel = levelFromXp(progress.totalXp, thresholds);
  const totalXp = progress.totalXp + awardedXp;
  return {
    skillId: progress.skillId,
    totalXp,
    awardedXp,
    previousLevel,
    level: levelFromXp(totalXp, thresholds),
  };
}

/**
 * Derive one skill's level and its next-level progress from the caller's
 * single authoritative threshold source. This is the shared boundary for every
 * player-facing level presentation (Mining state projection and the public
 * character-profile projection); consumers never re-implement threshold
 * lookups or XP deltas.
 */
export function skillLevelProgress(
  totalXp: number,
  thresholds: readonly LevelThreshold[],
): SkillLevelProgress {
  const level = levelFromXp(totalXp, thresholds);
  const current = thresholds.find((threshold) => threshold.level === level) ?? thresholds[0]!;
  const next = thresholds.find((threshold) => threshold.level === level + 1);
  return {
    level,
    totalXp,
    xpIntoLevel: totalXp - current.totalXp,
    xpToNextLevel: next ? next.totalXp - totalXp : undefined,
    atMaximumLevel: level === thresholds[thresholds.length - 1]!.level,
  };
}
