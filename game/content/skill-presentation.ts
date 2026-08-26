import { SKILL_IDS, type SkillId } from "@/game/config/foundations";

/**
 * Player-facing skill presentation is content, not a UI concern (issue #64).
 * The four display names are the approved stable identities from
 * `docs/gameplay-foundations.md` ("Approved identities and boundaries");
 * this registry supplies player-facing names for stable skill IDs so profile
 * and progression surfaces never embed per-skill conditionals.
 */
export type SkillPresentation = {
  displayName: string;
};

const skillPresentations = {
  [SKILL_IDS.mining]: { displayName: "Mining" },
  [SKILL_IDS.refining]: { displayName: "Refining" },
  [SKILL_IDS.welding]: { displayName: "Welding" },
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
