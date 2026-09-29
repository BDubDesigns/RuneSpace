import { describe, expect, it } from "vitest";
import { xpSettableSkills } from "@/features/admin/admin-format";
import { skillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { SKILL_PRESENTATIONS } from "@/game/content/skill-presentation";
import { projectCharacterProgression } from "@/game/domain/character-progression";

/**
 * Issue #242: the operator SET TOTAL XP picker derives from the same
 * presentation rule as the Character surface (`presentedSkills`) instead of a
 * hand-kept list, so it cannot drift from the skills the server command accepts.
 */
describe("xpSettableSkills", () => {
  it("offers Mining, Refining, Welding, and Fabrication with canonical display names", () => {
    const skills = xpSettableSkills();
    expect(skills.map((skill) => skill.skillId).sort()).toEqual(
      [SKILL_IDS.fabrication, SKILL_IDS.mining, SKILL_IDS.refining, SKILL_IDS.welding].sort(),
    );
    expect(skills.map((skill) => skill.displayName)).toEqual([
      "Fabrication",
      "Mining",
      "Refining",
      "Welding",
    ]);
  });

  it("excludes Strength while it has no approved progression curve", () => {
    expect(skillLevelThresholds(SKILL_IDS.strength)).toBeUndefined();
    expect(SKILL_PRESENTATIONS.map((skill) => skill.id)).toContain(SKILL_IDS.strength);
    expect(xpSettableSkills().map((skill) => skill.skillId)).not.toContain(SKILL_IDS.strength);
  });

  it("offers exactly the skills the server command accepts", () => {
    const offered = new Set(xpSettableSkills().map((skill) => skill.skillId));
    for (const skillId of offered) {
      expect(skillLevelThresholds(skillId), `${skillId} must have an approved curve`).toBeDefined();
    }
    for (const { id } of SKILL_PRESENTATIONS) {
      expect(offered.has(id)).toBe(skillLevelThresholds(id) !== undefined);
    }
  });

  it("offers exactly the skills the Character surface presents, in its order", () => {
    const progression = projectCharacterProgression({
      skillXp: [],
      levelThresholds: skillLevelThresholds,
      skillDisplayName: (skillId) =>
        SKILL_PRESENTATIONS.find((skill) => skill.id === skillId)?.displayName,
    });
    expect(xpSettableSkills().map((skill) => skill.displayName)).toEqual(
      progression.skills.map((skill) => skill.displayName),
    );
  });
});
