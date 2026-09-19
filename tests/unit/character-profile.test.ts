import { describe, expect, it } from "vitest";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { projectCharacterProfile, type CharacterProfile } from "@/game/domain/character-profile";
import type { LevelThreshold } from "@/game/domain/progression";

/**
 * Unit coverage for the issue #64 public character-profile projection. SQL
 * joins are never mirrored here; these tests prove the pure projection
 * contract: public identity and portrait resolution on top of the canonical
 * cross-skill progression, per-skill level/next-level progress through the
 * existing progression boundary, maximum-level truthfulness, deterministic
 * skill ordering, the narrow public shape (no skill IDs, emails, or
 * account/character database IDs), and the generic skill presentation that
 * needs no Mining-specific branch.
 *
 * The Character Level rule itself is proven once, in
 * `character-progression.test.ts`; this file proves the profile consumes it.
 */

const THRESHOLDS = standardSkillLevelThresholds();
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

const TEST_SKILL_IDS = ["mining", "second", "metallurgy"];

function project(rows: readonly { skillId: string; totalXp: number }[]) {
  return projectCharacterProfile({
    displayName: "Rada",
    ownerName: "Rada Stonehand",
    skillXp: rows,
    skillIds: TEST_SKILL_IDS,
    levelThresholds: (skillId) =>
      skillId === "mining" ? THRESHOLDS : skillId === "second" ? SECOND_CURVE : undefined,
    skillDisplayName: (skillId) => skillNames.get(skillId),
  });
}

describe("issue #64 character profile projection", () => {
  it("publishes the canonical Character Level rather than a profile-only rule (#213)", () => {
    const oneEarnedLevel = project([
      { skillId: "second", totalXp: 0 },
      { skillId: "mining", totalXp: 500 },
    ]);
    expect(oneEarnedLevel.characterLevel).toBe(2);
    expect(oneEarnedLevel.skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Second Skill",
    ]);

    // Every earned skill level counts: Mining 2 and Second Skill 3 is 1+1+2.
    const acrossSkills = project([
      { skillId: "second", totalXp: 250 },
      { skillId: "mining", totalXp: 500 },
    ]);
    expect(acrossSkills.characterLevel).toBe(4);
  });

  it("is Character Level 1 for an untouched character", () => {
    expect(project([]).characterLevel).toBe(1);
    expect(project([{ skillId: "mining", totalXp: 0 }]).characterLevel).toBe(1);
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
    expect(atMax.characterLevel).toBe(MAX_LEVEL);

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
    // Metallurgy has no curve in the injected source, so it may not appear
    // regardless of persisted XP; Second Skill has one and appears untrained.
    const result = project([
      { skillId: "metallurgy", totalXp: 999_999_999 },
      { skillId: "mining", totalXp: 0 },
    ]);
    expect(result.skills.map((skill) => skill.displayName)).toEqual(["Mining", "Second Skill"]);
  });

  it("renders skills through the generic projection using the content boundary name", () => {
    // The display name comes from the injected authoritative presentation
    // source; there is no Mining-specific branch in the projection.
    const result = projectCharacterProfile({
      displayName: "Rada",
      ownerName: "Rada Stonehand",
      skillXp: [{ skillId: "mining", totalXp: 500 }],
      skillIds: ["mining"],
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
      "characterLevel",
      "displayName",
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

  it("projects the resolved portrait presentation (issues #65 and #98)", () => {
    // A legacy character (null stored value) projects the neutral placeholder;
    // resolution itself is proven in character-portrait.test.ts.
    expect(project([]).portrait).toEqual({ kind: "placeholder" });
    expect(
      projectCharacterProfile({
        displayName: "Rada",
        ownerName: "Rada Stonehand",
        skillXp: [],
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
        skillXp: [],
        levelThresholds: () => undefined,
        skillDisplayName: () => undefined,
        portraitId: "portrait_gramma_01",
      }).portrait,
    ).not.toHaveProperty("portraitId");

    expect(
      projectCharacterProfile({
        displayName: "Rada",
        ownerName: "Rada Stonehand",
        skillXp: [],
        levelThresholds: () => undefined,
        skillDisplayName: () => undefined,
        portraitId: PORTRAIT_IDS.vonScavenger,
        ownedPortraitIds: [PORTRAIT_IDS.vonScavenger],
      }).portrait,
    ).toMatchObject({ kind: "selected", displayName: "Von Scavenger" });
  });
});
