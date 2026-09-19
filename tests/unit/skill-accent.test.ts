import { describe, expect, it } from "vitest";
import { skillAccentColor } from "@/components/ui/skill-accent";

/**
 * Unit coverage for the issue #215 canonical skill-accent → token mapping:
 * the one place a tone resolves to a color, so activity progression, the
 * Character modal, and Nearby Player profiles can never disagree.
 */
describe("skillAccentColor (issue #215)", () => {
  it("resolves each approved tone to its canonical skill token", () => {
    expect(skillAccentColor("mining")).toBe("var(--rs-skill-mining)");
    expect(skillAccentColor("refining")).toBe("var(--rs-skill-refining)");
    expect(skillAccentColor("welding")).toBe("var(--rs-skill-welding)");
  });

  it("returns undefined for an unassigned or unrecognized tone", () => {
    expect(skillAccentColor(undefined)).toBeUndefined();
    expect(skillAccentColor("fabrication")).toBeUndefined();
  });
});
