import { describe, expect, it } from "vitest";
import { skillLevelThresholds, standardSkillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import {
  characterLevelFromSkillLevels,
  projectCharacterProgression,
} from "@/game/domain/character-progression";
import type { LevelThreshold } from "@/game/domain/progression";

/**
 * Unit coverage for the issue #213 canonical character progression: the one
 * Character Level rule (`1 + Σ(skillLevel - 1)`), the dynamic skill set, and
 * the per-level progress both the Character modal and the same-location player
 * inspector present.
 */

const THRESHOLDS = standardSkillLevelThresholds();
const MAX_LEVEL = THRESHOLDS[THRESHOLDS.length - 1]!.level;
const MAX_LEVEL_XP = THRESHOLDS[THRESHOLDS.length - 1]!.totalXp;
/** XP totals for levels 1..4 on the standard curve. */
const LEVEL_XP = [0, 1, 2, 3, 4].map(
  (level) => THRESHOLDS.find((threshold) => threshold.level === level)?.totalXp ?? 0,
);

/** A second, test-only curve so aggregation across curves can be proven. */
const SECOND_CURVE: readonly LevelThreshold[] = [
  { level: 1, totalXp: 0 },
  { level: 2, totalXp: 100 },
  { level: 3, totalXp: 250 },
];

const testSkillIds = ["mining", "second", "metallurgy"];
const testSkillNames = new Map([
  ["mining", "Mining"],
  ["second", "Second Skill"],
  ["metallurgy", "Metallurgy"],
]);

function project(
  skillXp: readonly { skillId: string; totalXp: number }[],
  skillIds: readonly string[] = testSkillIds,
) {
  return projectCharacterProgression({
    skillXp,
    skillIds,
    levelThresholds: (skillId) =>
      skillId === "second" ? SECOND_CURVE : skillId === "metallurgy" ? undefined : THRESHOLDS,
    skillDisplayName: (skillId) => testSkillNames.get(skillId),
  });
}

describe("canonical Character Level (issue #213)", () => {
  it("is 1 + the sum of every earned skill level", () => {
    expect(characterLevelFromSkillLevels([])).toBe(1);
    // The issue's worked examples.
    expect(characterLevelFromSkillLevels([1, 1, 1])).toBe(1);
    expect(characterLevelFromSkillLevels([4, 2, 1])).toBe(5);
    expect(characterLevelFromSkillLevels([8, 8, 5])).toBe(19);
  });

  it("is not the sum of raw skill levels", () => {
    // Summing raw levels would give 7 here, and would grow with the skill
    // catalog rather than with what the player has actually done.
    expect(characterLevelFromSkillLevels([4, 2, 1])).not.toBe(4 + 2 + 1);
  });

  it("does not move when another Level-1 skill is added to the game", () => {
    const before = characterLevelFromSkillLevels([4, 2, 1]);
    expect(characterLevelFromSkillLevels([4, 2, 1, 1])).toBe(before);
    expect(characterLevelFromSkillLevels([4, 2, 1, 1, 1, 1])).toBe(before);
  });

  it("refuses a level below the starting level or a non-integer level", () => {
    expect(() => characterLevelFromSkillLevels([0])).toThrow(RangeError);
    expect(() => characterLevelFromSkillLevels([-2])).toThrow(RangeError);
    expect(() => characterLevelFromSkillLevels([2.5])).toThrow(RangeError);
  });
});

describe("character progression projection (issue #213)", () => {
  it("derives the Character Level from the presented skills", () => {
    // Mining level 4 and Second Skill level 3 is 1 + 3 + 2.
    const result = project([
      { skillId: "mining", totalXp: LEVEL_XP[4]! },
      { skillId: "second", totalXp: 250 },
    ]);
    expect(result.skills.map((skill) => [skill.displayName, skill.level])).toEqual([
      ["Mining", 4],
      ["Second Skill", 3],
    ]);
    expect(result.characterLevel).toBe(6);
  });

  it("presents an untrained skill at Level 1 and counts it as zero levels", () => {
    const untouched = project([]);
    expect(untouched.skills.map((skill) => [skill.displayName, skill.level])).toEqual([
      ["Mining", 1],
      ["Second Skill", 1],
    ]);
    expect(untouched.characterLevel).toBe(1);
    expect(untouched.skills[0]).toMatchObject({ level: 1, xpIntoLevel: 0, totalXp: 0 });

    // A stored zero-XP row and an absent row are the same answer.
    expect(project([{ skillId: "mining", totalXp: 0 }])).toEqual(untouched);
  });

  it("adding a new Level-1 skill to the game leaves the Character Level alone", () => {
    const skillXp = [{ skillId: "mining", totalXp: LEVEL_XP[4]! }];
    const before = project(skillXp, ["mining"]);
    const afterNewSkill = project(skillXp, ["mining", "second"]);
    expect(before.characterLevel).toBe(4);
    expect(afterNewSkill.characterLevel).toBe(before.characterLevel);
    // The new skill still appears — it just contributes nothing yet.
    expect(afterNewSkill.skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Second Skill",
    ]);
  });

  it("presents current-level progress rather than lifetime XP as the level's measure", () => {
    const midLevel = project([{ skillId: "mining", totalXp: 750 }]);
    expect(midLevel.skills[0]).toMatchObject({
      displayName: "Mining",
      level: 2,
      totalXp: 750,
      xpIntoLevel: 250,
      xpToNextLevel: 300,
      atMaximumLevel: false,
    });
  });

  it("is truthful at the maximum level: no fabricated next-level requirement", () => {
    const atMax = project([{ skillId: "mining", totalXp: MAX_LEVEL_XP }]);
    expect(atMax.skills[0]).toMatchObject({ level: MAX_LEVEL, atMaximumLevel: true });
    expect(atMax.skills[0]?.xpToNextLevel).toBeUndefined();
    // Second Skill is still at Level 1 and contributes nothing.
    expect(atMax.characterLevel).toBe(MAX_LEVEL);
  });

  it("omits a skill without an approved curve or an approved player-facing name", () => {
    // Metallurgy has a name but no curve, so it has no truthful level and
    // cannot contribute one either.
    const result = project([{ skillId: "metallurgy", totalXp: 999_999_999 }]);
    expect(result.skills.map((skill) => skill.displayName)).toEqual(["Mining", "Second Skill"]);
    expect(result.characterLevel).toBe(1);

    const unnamed = projectCharacterProgression({
      skillXp: [{ skillId: "mining", totalXp: LEVEL_XP[4]! }],
      skillIds: ["mining"],
      levelThresholds: () => THRESHOLDS,
      skillDisplayName: () => undefined,
    });
    expect(unnamed.skills).toEqual([]);
    expect(unnamed.characterLevel).toBe(1);
  });

  it("defaults to the game's own skill catalog rather than a screen-specific list", () => {
    // No skillIds: every skill the game defines with an approved curve and
    // name is presented, so a future skill appears on every surface at once.
    const result = projectCharacterProgression({
      skillXp: [],
      levelThresholds: skillLevelThresholds,
      skillDisplayName: (skillId) => getSkillPresentation(skillId)?.displayName,
    });
    expect(result.skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Refining",
      "Welding",
    ]);
    // Strength is defined but has no approved curve, so it is not presented.
    expect(Object.values(SKILL_IDS)).toContain(SKILL_IDS.strength);
    expect(result.skills.map((skill) => skill.displayName)).not.toContain("Strength");
    expect(result.characterLevel).toBe(1);
  });

  it("exposes only the narrow progression shape", () => {
    const result = project([{ skillId: "mining", totalXp: 750 }]);
    expect(Object.keys(result).sort()).toEqual(["characterLevel", "skills"]);
    for (const skill of result.skills) {
      // Stable skill IDs stay internal to the projection.
      expect(Object.keys(skill).sort()).toEqual([
        "atMaximumLevel",
        "displayName",
        "level",
        "totalXp",
        "xpIntoLevel",
        "xpToNextLevel",
      ]);
    }
  });
});
