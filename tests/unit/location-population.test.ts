import { describe, expect, it } from "vitest";
import { skillLevelThresholds, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  projectLocationPopulation,
  type LocationPopulationRow,
} from "@/game/domain/location-population";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { SKILL_IDS } from "@/game/config/foundations";
import { levelFromXp } from "@/game/domain/progression";

/**
 * Unit coverage for the issue #62 public location-population projection. SQL
 * joins are never mirrored here; these tests prove the pure projection
 * contract (exclusion, per-owner multiplicity, deterministic ordering, narrow
 * public shape, and Character Level derivation through the canonical
 * cross-skill boundary).
 */

const THRESHOLDS = standardSkillLevelThresholds();

function row(overrides: Partial<LocationPopulationRow>): LocationPopulationRow {
  return {
    characterId: `char-${overrides.displayName ?? "x"}`,
    displayName: "Rada",
    normalizedName: "rada",
    ownerName: "Rada Stonehand",
    skillId: SKILL_IDS.mining,
    totalXp: 0,
    ...overrides,
  };
}

function project(rows: readonly LocationPopulationRow[], activeCharacterId = "active-char") {
  return projectLocationPopulation({
    activeCharacterId,
    rows,
    levelThresholds: skillLevelThresholds,
    skillDisplayName: (skillId) => getSkillPresentation(skillId)?.displayName,
  });
}

describe("issue #62 location population projection", () => {
  it("excludes the active character from its own location list", () => {
    const result = project(
      [
        row({ characterId: "active-char", displayName: "Me" }),
        row({ characterId: "other", displayName: "Rada" }),
      ],
      "active-char",
    );
    expect(result.map((entry) => entry.displayName)).toEqual(["Rada"]);
  });

  it("keeps multiple characters owned by one player as separate entries", () => {
    const result = project([
      row({ characterId: "a", displayName: "Rada One", ownerName: "Rada Stonehand" }),
      row({ characterId: "b", displayName: "Rada Two", ownerName: "Rada Stonehand" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.ownerName === "Rada Stonehand")).toBe(true);
  });

  it("orders deterministically by folded name then stable character ID", () => {
    const result = project([
      row({ characterId: "z", displayName: "Zed", normalizedName: "zed" }),
      row({ characterId: "y", displayName: "Alpha", normalizedName: "alpha" }),
      // Case-insensitive fold: "beta" sorts before "Gamma" even though the
      // preserved display capitalization differs.
      row({ characterId: "b", displayName: "Gamma", normalizedName: "gamma" }),
      row({ characterId: "a", displayName: "Beta", normalizedName: "beta" }),
    ]);
    expect(result.map((entry) => entry.displayName)).toEqual(["Alpha", "Beta", "Gamma", "Zed"]);
  });

  it("returns only the approved public fields: name, derived level, owner name", () => {
    const result = project([
      row({ characterId: "a", displayName: "Rada", ownerName: "Rada Stonehand", totalXp: 500 }),
    ]);
    expect(result).toEqual([
      {
        displayName: "Rada",
        level: 2,
        ownerName: "Rada Stonehand",
      },
    ]);
    // No email, account ID, character database ID, XP, or timestamp may leak.
    expect(Object.keys(result[0]!).sort()).toEqual(["displayName", "level", "ownerName"]);
  });

  it("publishes the canonical Character Level, not one skill's level (#213)", () => {
    // Boundary behavior of the authoritative per-skill formula.
    expect(levelFromXp(499, THRESHOLDS)).toBe(1);
    expect(levelFromXp(500, THRESHOLDS)).toBe(2);
    // Mining 2 alone is Character Level 2 (1 + 1 earned level)...
    const onlyMining = project([
      row({ characterId: "a", displayName: "Rada", skillId: SKILL_IDS.mining, totalXp: 500 }),
    ]);
    expect(onlyMining[0]?.level).toBe(2);
    // ...but every earned skill level counts, so the listed level is no longer
    // the Mining level: Mining 2 + Refining 2 + Welding 1 is Character Level 3.
    const acrossSkills = project([
      row({ characterId: "a", displayName: "Rada", skillId: SKILL_IDS.mining, totalXp: 500 }),
      row({ characterId: "a", displayName: "Rada", skillId: SKILL_IDS.refining, totalXp: 500 }),
      row({ characterId: "a", displayName: "Rada", skillId: SKILL_IDS.welding, totalXp: 0 }),
    ]);
    expect(acrossSkills).toHaveLength(1);
    expect(acrossSkills[0]?.level).toBe(3);
  });

  it("treats absent XP rows as authoritative zero XP (Character Level 1)", () => {
    const result = project([
      // A character with no persisted XP row at all: the left join yields one
      // row with null skill columns.
      row({ characterId: "a", displayName: "Rada", skillId: null, totalXp: null }),
      row({ characterId: "b", displayName: "Kael", skillId: SKILL_IDS.mining, totalXp: 0 }),
    ]);
    expect(result.map((entry) => entry.level)).toEqual([1, 1]);
  });
});
