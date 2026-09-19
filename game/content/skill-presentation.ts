import { SKILL_IDS, type SkillId } from "@/game/config/foundations";

/**
 * Player-facing skill presentation is content, not a UI concern (issue #64).
 * The four display names are the approved stable identities from
 * `docs/gameplay-foundations.md` ("Approved identities and boundaries");
 * this registry supplies player-facing names for stable skill IDs so profile
 * and progression surfaces never embed per-skill conditionals.
 */

/**
 * A skill's canonical player-facing accent identity (issue #215). This is a
 * stable semantic key, not a CSS variable: the UI layer
 * (`components/ui/skill-accent.ts`) owns the tone → token mapping, so content
 * never names a color. A skill with no approved accent yet (a future skill
 * before its owner picks one) has no tone and presents neutrally.
 */
export type SkillAccentTone = "mining" | "refining" | "welding";

export type SkillPresentation = {
  displayName: string;
  accentTone?: SkillAccentTone;
};

const skillPresentations = {
  [SKILL_IDS.mining]: { displayName: "Mining", accentTone: "mining" },
  [SKILL_IDS.refining]: { displayName: "Refining", accentTone: "refining" },
  [SKILL_IDS.welding]: { displayName: "Welding", accentTone: "welding" },
  [SKILL_IDS.strength]: { displayName: "Strength" },
} as const satisfies Partial<Record<SkillId, SkillPresentation>>;

/** Canonical selectable skill identities for skill-XP presentation beats. */
export const SKILL_PRESENTATIONS: readonly (SkillPresentation & { id: SkillId })[] = Object.entries(
  skillPresentations,
).map(([id, presentation]) => ({
  id: id as SkillId,
  ...presentation,
}));

export function getSkillPresentation(skillId: string): SkillPresentation | undefined {
  return skillPresentations[skillId as SkillId];
}
