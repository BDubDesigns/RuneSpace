import type { SkillAccentTone } from "@/game/content/skill-presentation";

export type { SkillAccentTone };

/**
 * The one skill-accent-tone → CSS token mapping (issue #215). Content picks a
 * skill's tone; this UI-layer boundary is the only place that resolves a tone
 * to an actual color, so a skill's hue can change in `app/globals.css` alone.
 */
const SKILL_ACCENT_VARS: Record<SkillAccentTone, string> = {
  mining: "var(--rs-skill-mining)",
  refining: "var(--rs-skill-refining)",
  welding: "var(--rs-skill-welding)",
};

/**
 * Resolves a skill's accent tone to its CSS color, or `undefined` when the
 * skill has no chosen tone yet (a future skill, or one like Strength that
 * isn't presented) — callers then fall back to neutral presentation.
 */
export function skillAccentColor(tone: string | undefined): string | undefined {
  return tone !== undefined && tone in SKILL_ACCENT_VARS
    ? SKILL_ACCENT_VARS[tone as SkillAccentTone]
    : undefined;
}
