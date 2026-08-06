import { describe, expect, it } from "vitest";
import { miningLevelThresholds } from "@/game/config/balance";
import { projectCharacterProfile, type CharacterProfile } from "@/game/domain/character-profile";
import type { LevelThreshold } from "@/game/domain/progression";

/**
 * Unit coverage for the issue #64 public character-profile projection. SQL
 * joins are never mirrored here; these tests prove the pure projection
 * contract: overall-level aggregation, per-skill level/next-level progress
 * through the existing progression boundary, maximum-level truthfulness,
 * deterministic skill ordering, the narrow public shape (no skill IDs,
 * emails, or account/character database IDs), and the generic skill
 * presentation that needs no Mining-specific branch.
 */

const THRESHOLDS = miningLevelThresholds();
const MAX_LEVEL = THRESHOLDS[THRESHOLDS.length - 1]!.level;
const MAX_LEVEL_XP = THRESHOLDS[THRESHOLDS.length - 1]!.totalXp;

/** A second, test-only curve so aggregation across skills can be proven. */
const SECOND_CURVE: readonly LevelThreshold[] = [
  { level: 1, totalXp: 0 },
  { level: 2, totalXp: 100 },
  { level: 3, totalXp: 250 },
];

const skillNames = new Map([
  ["mining", "Mining"],
  ["second", "Second Skill"],
  ["metallurgy", "Metallurgy"],
]);

function project(rows: readonly { skillId: string; totalXp: number }[]) {
  return projectCharacterProfile({
    displayName: "Rada",
    ownerName: "Rada Stonehand",
    skillProgress: rows,
    levelThresholds: (skillId) =>
      skillId === "mining" ? THRESHOLDS : skillId === "second" ? SECOND_CURVE : undefined,
    skillDisplayName: (skillId) => skillNames.get(skillId),
  });
}

describe("issue #64 character profile projection", () => {
  it("derives the overall level as the highest derived level across presented skills", () => {
    const withMiningHigher = project([
      { skillId: "second", totalXp: 0 },
      { skillId: "mining", totalXp: 500 },
    ]);
    expect(withMiningHigher.overallLevel).toBe(2);
    expect(withMiningHigher.skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Second Skill",
    ]);

    const withSecondHigher = project([
      { skillId: "second", totalXp: 250 },
      { skillId: "mining", totalXp: 0 },
    ]);
    expect(withSecondHigher.overallLevel).toBe(3);
  });

  it("uses level 1 as the overall-level baseline when no skill is presented", () => {
    expect(project([]).overallLevel).toBe(1);
    expect(project([{ skillId: "mining", totalXp: 0 }]).overallLevel).toBe(1);
  });

  it("derives current-level XP progress and the next-level requirement", () => {
    // 500 XP is exactly the level-1→2 threshold; 550 XP is the level-2→3 span.
    const atThreshold = project([{ skillId: "mining", totalXp: 500 }]);
    expect(atThreshold.skills[0]).toMatchObject({
      displayName: "Mining",
      level: 2,
      totalXp: 500,
      xpIntoLevel: 0,
      xpToNextLevel: 550,
      atMaximumLevel: false,
    });

    const midLevel = project([{ skillId: "mining", totalXp: 750 }]);
    expect(midLevel.skills[0]).toMatchObject({
      level: 2,
      xpIntoLevel: 250,
      xpToNextLevel: 300,
    });
  });

  it("is truthful at the maximum level: no fabricated next-level requirement", () => {
    const atMax = project([{ skillId: "mining", totalXp: MAX_LEVEL_XP }]);
    expect(atMax.skills[0]).toMatchObject({
      level: MAX_LEVEL,
      atMaximumLevel: true,
    });
    expect(atMax.skills[0]?.xpToNextLevel).toBeUndefined();
    expect(atMax.overallLevel).toBe(MAX_LEVEL);

    const beyondMax = project([{ skillId: "mining", totalXp: MAX_LEVEL_XP + 10_000 }]);
    expect(beyondMax.skills[0]).toMatchObject({
      level: MAX_LEVEL,
      xpIntoLevel: 10_000,
      atMaximumLevel: true,
    });
    expect(beyondMax.skills[0]?.xpToNextLevel).toBeUndefined();
  });

  it("orders skills deterministically by stable skill ID", () => {
    const result = project([
      { skillId: "second", totalXp: 0 },
      { skillId: "mining", totalXp: 0 },
    ]);
    expect(result.skills.map((skill) => skill.displayName)).toEqual(["Mining", "Second Skill"]);
  });

  it("skips skills without an approved level curve", () => {
    // Metallurgy has no curve in the injected source; Strength is not present
    // at all. Neither may appear, regardless of persisted XP.
    const result = project([
      { skillId: "metallurgy", totalXp: 999_999_999 },
      { skillId: "mining", totalXp: 0 },
    ]);
    expect(result.skills.map((skill) => skill.displayName)).toEqual(["Mining"]);
  });

  it("renders skills through the generic projection using the content boundary name", () => {
    // The display name comes from the injected authoritative presentation
    // source; there is no Mining-specific branch in the projection.
    const result = projectCharacterProfile({
      displayName: "Rada",
      ownerName: "Rada Stonehand",
      skillProgress: [{ skillId: "mining", totalXp: 500 }],
      levelThresholds: () => THRESHOLDS,
      skillDisplayName: () => "Miner Skill",
    });
    expect(result.skills).toEqual([
      {
        displayName: "Miner Skill",
        level: 2,
        totalXp: 500,
        xpIntoLevel: 0,
        xpToNextLevel: 550,
        atMaximumLevel: false,
      },
    ]);
  });

  it("exposes only the narrow public profile shape", () => {
    const profile: CharacterProfile = project([
      { skillId: "mining", totalXp: 500 },
      { skillId: "second", totalXp: 0 },
    ]);
    expect(Object.keys(profile).sort()).toEqual([
      "displayName",
      "overallLevel",
      "ownerName",
      "portrait",
      "skills",
    ]);
    for (const skill of profile.skills) {
      // No skillId, character database ID, account ID, email, or timestamp
      // may leak; skill IDs stay internal to the server boundary.
      expect(Object.keys(skill).sort()).toEqual([
        "atMaximumLevel",
        "displayName",
        "level",
        "totalXp",
        "xpIntoLevel",
        "xpToNextLevel",
      ]);
    }
    const atMax = project([{ skillId: "mining", totalXp: MAX_LEVEL_XP }]);
    expect(Object.keys(atMax.skills[0]!).sort()).toEqual([
      "atMaximumLevel",
      "displayName",
      "level",
      "totalXp",
      "xpIntoLevel",
    ]);
  });

  it("projects the resolved portrait presentation (issue #65)", () => {
    // A legacy character (null stored value) projects the neutral placeholder;
    // resolution itself is proven in character-portrait.test.ts.
    expect(project([]).portrait).toEqual({ kind: "placeholder" });
    expect(
      projectCharacterProfile({
        displayName: "Rada",
        ownerName: "Rada Stonehand",
        skillProgress: [],
        levelThresholds: () => undefined,
        skillDisplayName: () => undefined,
        portraitId: "portrait_gramma_01",
      }).portrait,
    ).toMatchObject({
      kind: "selected",
      displayName: "Gramma",
      derivativeWidth: 512,
      derivativeHeight: 512,
    });
    // The public projection never exposes the raw stored portrait ID.
    expect(
      projectCharacterProfile({
        displayName: "Rada",
        ownerName: "Rada Stonehand",
        skillProgress: [],
        levelThresholds: () => undefined,
        skillDisplayName: () => undefined,
        portraitId: "portrait_gramma_01",
      }).portrait,
    ).not.toHaveProperty("portraitId");
  });
});
