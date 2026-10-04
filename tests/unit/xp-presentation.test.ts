import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillXpTile } from "@/components/items/SkillXpTile";
import { XP_MEDALLION_SRC, XpAmount, XpMark, xpAccentColor } from "@/components/ui/XpAmount";
import { skillAccentColor } from "@/components/ui/skill-accent";
import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { CONVERSATION_BACKGROUND_IDS, SKILL_IDS } from "@/game/config/foundations";
import { SKILL_PRESENTATIONS, getSkillPresentation } from "@/game/content/skill-presentation";

const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("XP artwork (issue #304)", () => {
  it("commits the owner-supplied medallion master unchanged", () => {
    const sha = createHash("sha256")
      .update(readFileSync("assets/xp/xp-medallion-master.png"))
      .digest("hex");
    expect(sha).toBe("6ee6ce6b25f65274decbe12af437944749d01e544997b764329a9a04a59ecd2b");
  });

  it("ships a small, truly transparent raster derivative", () => {
    const file = `public${XP_MEDALLION_SRC}`;
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // An extended header whose alpha flag is set: the medallion really has an alpha channel.
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("VP8X");
    expect(bytes[20]! & 0x10).toBe(0x10);
    expect(statSync(file).size).toBeLessThan(100 * 1024);
  });

  it("sizes the inline mark from the text, never a fixed pixel size", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const rule = /\.rs-xp-mark\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/font-size:\s*0\.7em/);
    expect(rule).toMatch(/line-height:\s*1\s*;/);
    expect(rule).toMatch(/padding:\s*calc\([\d.]+em/);
    // The only pixel value is the 1px floor on the outline stroke, as a border would have.
    expect(rule.match(/\d\s*px/g)).toEqual(["1px"]);
    expect(rule).toMatch(/--rs-xp-stroke:\s*max\(1px,/);
    // The element itself is never filled and has no border: the approved style is an outline.
    expect(rule).not.toMatch(/background/);
    expect(rule).not.toMatch(/border/);
  });

  it("draws the approved asymmetric outline: square top-left and bottom-right, clipped top-right and bottom-left", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const ring = /\.rs-xp-mark::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    // A ring (outer shape minus the same shape inset by the stroke), not a clipped element.
    expect(ring).toMatch(/clip-path:\s*polygon\(\s*evenodd/);
    const points = (/polygon\(\s*evenodd,([^;]*)\)/.exec(ring)?.[1] ?? "")
      .split(/,\s*(?![^()]*\))/)
      .map((point) => point.replace(/\s+/g, " ").trim());
    const cut = "var(--rs-xp-cut)";
    expect(points.slice(0, 7)).toEqual([
      "0 0", // top-left stays square
      `calc(100% - ${cut}) 0`, // top-right is clipped...
      `100% ${cut}`,
      "100% 100%", // bottom-right stays square
      `${cut} 100%`, // bottom-left is clipped...
      `0 calc(100% - ${cut})`,
      "0 0",
    ]);
    // The inner ring has the same six corners, so the diagonals keep their stroke.
    expect(points).toHaveLength(14);
    // Outline only: the ring is the one place currentColor fills, and the label is untouched.
    expect(ring).toMatch(/background:\s*currentColor/);
    expect(ring).toMatch(/content:\s*""/);
  });
});

describe("canonical XP accent", () => {
  it("resolves every accented skill from the one skill registry", () => {
    for (const skill of SKILL_PRESENTATIONS) {
      expect(xpAccentColor(skill.id)).toBe(skillAccentColor(skill.accentTone));
    }
    expect(xpAccentColor(SKILL_IDS.mining)).toBe("var(--rs-skill-mining)");
    expect(xpAccentColor(SKILL_IDS.fabrication)).toBe("var(--rs-skill-fabrication)");
  });

  it("is neutral for a skill with no approved accent, an unknown skill, or no skill", () => {
    expect(getSkillPresentation(SKILL_IDS.strength)?.accentTone).toBeUndefined();
    expect(xpAccentColor(SKILL_IDS.strength)).toBeUndefined();
    expect(xpAccentColor("not_a_skill")).toBeUndefined();
    expect(xpAccentColor(undefined)).toBeUndefined();
  });

  it("lets an explicit accent tone stand in for a missing skill ID", () => {
    expect(xpAccentColor(undefined, "welding")).toBe("var(--rs-skill-welding)");
  });
});

describe("XpMark and XpAmount", () => {
  it("renders the literal text XP, keyed to the skill accent", () => {
    const markup = renderToStaticMarkup(
      React.createElement(XpMark, { skillId: SKILL_IDS.refining }),
    );
    expect(text(markup)).toBe("XP");
    expect(markup).toContain("rs-xp-mark");
    expect(markup).toContain("--rs-xp-accent:var(--rs-skill-refining)");
    // Real text: no image, no hidden semantics to lose.
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("aria-hidden");
  });

  it("falls back to the neutral colour without setting an accent", () => {
    const markup = renderToStaticMarkup(React.createElement(XpMark, {}));
    expect(markup).not.toContain("--rs-xp-accent");
    expect(text(markup)).toBe("XP");
  });

  it("reads exactly like the plain phrase it replaces", () => {
    const amount = (props: object) =>
      text(renderToStaticMarkup(React.createElement(XpAmount, { amount: 250, ...props })));
    expect(amount({})).toBe("250 XP");
    expect(amount({ prefix: "+" })).toBe("+250 XP");
    expect(amount({ prefix: "+", skillName: "Mining" })).toBe("+250 Mining XP");
    expect(amount({ children: "1,250" })).toBe("1,250 XP");
  });

  it("keeps data hooks on the wrapper", () => {
    const markup = renderToStaticMarkup(
      React.createElement(XpAmount, { amount: 5, "data-xp-readout": "mining" } as never),
    );
    expect(markup).toMatch(/^<span[^>]*data-xp-readout="mining"/);
  });
});

describe("skill XP reward tile", () => {
  it("presents the shared medallion, skill name, amount and accent", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SkillXpTile, {
        amount: 250,
        skillId: SKILL_IDS.mining,
        skillName: "Mining",
      }),
    );
    expect(markup).toContain('aria-label="250 Mining XP earned"');
    expect(markup).toContain("xp-medallion.webp");
    expect(markup).toContain("border-color:var(--rs-skill-mining)");
    expect(text(markup)).toContain("Mining");
    expect(text(markup)).toContain("+250");
  });

  it("uses the same medallion for every skill and a neutral border without an accent", () => {
    const sources = SKILL_PRESENTATIONS.map((skill) => {
      const markup = renderToStaticMarkup(
        React.createElement(SkillXpTile, {
          amount: 10,
          skillId: skill.id,
          skillName: skill.displayName,
        }),
      );
      expect(markup).toContain(skill.accentTone ? `var(--rs-skill-${skill.accentTone})` : "");
      return markup.match(/xp-medallion\.webp/g)?.length;
    });
    expect(new Set(sources)).toEqual(new Set([sources[0]]));
    const strength = renderToStaticMarkup(
      React.createElement(SkillXpTile, {
        amount: 10,
        skillId: SKILL_IDS.strength,
        skillName: "Strength",
      }),
    );
    expect(strength).toContain("border-color:var(--rs-border-structural)");
  });

  it("is what an authored skill_xp dialogue beat renders, keeping its hook and wording", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DialogueScene, {
        beat: {
          kind: "skill_xp",
          skillId: SKILL_IDS.welding,
          amount: 250,
          backgroundId: CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior,
          text: "",
        },
      }),
    );
    expect(markup).toContain("data-dialogue-skill-xp-tile");
    expect(markup).toContain("xp-medallion.webp");
    expect(markup).toContain('aria-label="250 Welding XP earned"');
    expect(markup).toContain("data-xp-mark");
    const role = /data-dialogue-speaker-role[^>]*>(.*?)<\/p>/.exec(markup)?.[1] ?? "";
    expect(text(role)).toBe("Welding +250 XP");
  });
});
