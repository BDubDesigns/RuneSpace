import { describe, expect, it } from "vitest";
import { SKILL_IDS } from "@/game/config/foundations";
import { getSkillPresentation, SKILL_PRESENTATIONS } from "@/game/content/skill-presentation";

/**
 * Unit coverage for the issue #215 canonical skill accent identity: Mining,
 * Refining, and Welding each resolve to exactly one accent tone, Strength has
 * none (it isn't a presented skill), and Fabrication is not assigned one.
 */
describe("canonical skill accent tone (issue #215)", () => {
  it("assigns Mining, Refining, and Welding their approved tones", () => {
    expect(getSkillPresentation(SKILL_IDS.mining)).toMatchObject({
      displayName: "Mining",
      accentTone: "mining",
    });
    expect(getSkillPresentation(SKILL_IDS.refining)).toMatchObject({
      displayName: "Refining",
      accentTone: "refining",
    });
    expect(getSkillPresentation(SKILL_IDS.welding)).toMatchObject({
      displayName: "Welding",
      accentTone: "welding",
    });
  });

  it("leaves a skill with no approved accent untoned rather than guessing one", () => {
    expect(getSkillPresentation(SKILL_IDS.strength)?.accentTone).toBeUndefined();
  });

  it("does not assign or reserve a Fabrication color", () => {
    expect(SKILL_PRESENTATIONS.map((skill) => skill.id)).not.toContain("fabrication");
  });
});
