import { describe, expect, it } from "vitest";
import { xpSettableSkills } from "@/features/admin/admin-format";
import { skillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { SKILL_PRESENTATIONS } from "@/game/content/skill-presentation";

/**
 * Issue #242: the operator SET TOTAL XP picker derives from the canonical
 * skill-presentation and progression-curve registries instead of a hand-kept
 * list, so it cannot drift from the skills the server command accepts.
 */
describe("xpSettableSkills", () => {
  it("offers Mining, Refining, Welding, and Fabrication with canonical display names", () => {
    const skills = xpSettableSkills();
    expect(skills.map((skill) => skill.id)).toEqual([
      SKILL_IDS.mining,
      SKILL_IDS.refining,
      SKILL_IDS.welding,
      SKILL_IDS.fabrication,
    ]);
    expect(skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Refining",
      "Welding",
      "Fabrication",
    ]);
  });

  it("excludes Strength while it has no approved progression curve", () => {
    expect(skillLevelThresholds(SKILL_IDS.strength)).toBeUndefined();
    expect(SKILL_PRESENTATIONS.map((skill) => skill.id)).toContain(SKILL_IDS.strength);
    expect(xpSettableSkills().map((skill) => skill.id)).not.toContain(SKILL_IDS.strength);
  });

  it("offers exactly the skills the server command accepts", () => {
    for (const { id } of xpSettableSkills()) {
      expect(skillLevelThresholds(id), `${id} must have an approved curve`).toBeDefined();
    }
    const offered = new Set(xpSettableSkills().map((skill) => skill.id));
    for (const { id } of SKILL_PRESENTATIONS) {
      expect(offered.has(id)).toBe(skillLevelThresholds(id) !== undefined);
    }
  });

  it("picks up a future approved skill from the registries without a picker edit", () => {
    const presentations = [...SKILL_PRESENTATIONS, { id: "future_skill", displayName: "Future" }];
    const skills = xpSettableSkills(presentations, (skillId) =>
      skillId === "future_skill" ? [{ level: 1, totalXp: 0 }] : skillLevelThresholds(skillId),
    );
    expect(skills.map((skill) => skill.displayName)).toEqual([
      "Mining",
      "Refining",
      "Welding",
      "Fabrication",
      "Future",
    ]);
    // A future presentation with no approved curve stays out.
    expect(xpSettableSkills(presentations).map((skill) => skill.id)).not.toContain("future_skill");
  });
});
