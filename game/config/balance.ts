import { z } from "zod";
import { ACTION_IDS, ITEM_IDS, SKILL_IDS, type SkillId } from "@/game/config/foundations";
import type { LevelThreshold } from "@/game/domain/progression";

const balanceSchema = z.object({
  progression: z.object({
    maximumLevel: z.literal(99),
    levelOneToTwoXp: z.literal(500),
    perLevelGrowthBps: z.literal(11_000),
  }),
  mining: z.object({
    actionId: z.literal(ACTION_IDS.crashSiteMining),
    skillId: z.literal(SKILL_IDS.mining),
    attemptDurationTicks: z.literal(10),
    powerCellBoost: z.object({
      speedMultiplier: z.literal(2),
    }),
    successAtLevelOneBps: z.literal(3_500),
    guaranteedSuccessLevel: z.literal(30),
    successRangeBps: z.literal(6_500),
    successXp: z.literal(15),
    yieldMinimum: z.literal(1),
    yieldMaximum: z.literal(2),
  }),
  refining: z.object({
    actionId: z.literal(ACTION_IDS.refining),
    skillId: z.literal(SKILL_IDS.refining),
    attemptDurationTicks: z.literal(7),
    successAtLevelOneBps: z.literal(4_000),
    guaranteedSuccessLevel: z.literal(20),
    successRangeBps: z.literal(6_000),
    successXp: z.literal(15),
    failureXp: z.literal(3),
    inputFerriteShale: z.literal(2),
  }),
  travel: z.object({
    actionId: z.literal(ACTION_IDS.travel),
    /** Approved initial adjacent walking duration (issue #40): 40 ticks / 24s. */
    adjacentWalkDurationTicks: z.literal(40),
  }),
  items: z.object({
    ferriteShale: z.object({
      itemId: z.literal(ITEM_IDS.ferriteShale),
      massGrams: z.literal(100),
      stackLimit: z.literal(10),
    }),
    refinedFerrite: z.object({
      itemId: z.literal(ITEM_IDS.refinedFerrite),
      massGrams: z.literal(150),
      stackLimit: z.literal(5),
    }),
    slag: z.object({
      itemId: z.literal(ITEM_IDS.slag),
      massGrams: z.literal(150),
      stackLimit: z.literal(10),
    }),
    salvageCutter: z.object({
      itemId: z.literal(ITEM_IDS.salvageCutter),
      massGrams: z.literal(5_000),
      suitSlotId: z.literal("mining_tool"),
      maximumCharge: z.literal(10),
    }),
    powerCell: z.object({
      itemId: z.literal(ITEM_IDS.powerCell),
      massGrams: z.literal(500),
      stackLimit: z.literal(5),
    }),
    starterContainer: z.object({
      itemId: z.literal(ITEM_IDS.mykeaSchleppraum8),
      massGrams: z.literal(10_000),
      slotCapacity: z.literal(8),
    }),
  }),
  carrying: z.object({
    startingCapacityGrams: z.literal(50_000),
    containerSuitSlotIds: z.tuple([
      z.literal("container_attachment_1"),
      z.literal("container_attachment_2"),
    ]),
  }),
});

export type EffectiveGameBalance = z.infer<typeof balanceSchema>;

const defaults = balanceSchema.parse({
  progression: { maximumLevel: 99, levelOneToTwoXp: 500, perLevelGrowthBps: 11_000 },
  mining: {
    actionId: ACTION_IDS.crashSiteMining,
    skillId: SKILL_IDS.mining,
    attemptDurationTicks: 10,
    powerCellBoost: { speedMultiplier: 2 },
    successAtLevelOneBps: 3_500,
    guaranteedSuccessLevel: 30,
    successRangeBps: 6_500,
    successXp: 15,
    yieldMinimum: 1,
    yieldMaximum: 2,
  },
  refining: {
    actionId: ACTION_IDS.refining,
    skillId: SKILL_IDS.refining,
    attemptDurationTicks: 7,
    successAtLevelOneBps: 4_000,
    guaranteedSuccessLevel: 20,
    successRangeBps: 6_000,
    successXp: 15,
    failureXp: 3,
    inputFerriteShale: 2,
  },
  travel: {
    actionId: ACTION_IDS.travel,
    adjacentWalkDurationTicks: 40,
  },
  items: {
    ferriteShale: { itemId: ITEM_IDS.ferriteShale, massGrams: 100, stackLimit: 10 },
    refinedFerrite: { itemId: ITEM_IDS.refinedFerrite, massGrams: 150, stackLimit: 5 },
    slag: { itemId: ITEM_IDS.slag, massGrams: 150, stackLimit: 10 },
    salvageCutter: {
      itemId: ITEM_IDS.salvageCutter,
      massGrams: 5_000,
      suitSlotId: "mining_tool",
      maximumCharge: 10,
    },
    powerCell: { itemId: ITEM_IDS.powerCell, massGrams: 500, stackLimit: 5 },
    starterContainer: {
      itemId: ITEM_IDS.mykeaSchleppraum8,
      massGrams: 10_000,
      slotCapacity: 8,
    },
  },
  carrying: {
    startingCapacityGrams: 50_000,
    containerSuitSlotIds: ["container_attachment_1", "container_attachment_2"],
  },
});

/** The sole effective-balance boundary until Issue #19 introduces approved overrides. */
export function getEffectiveGameBalance(): EffectiveGameBalance {
  return defaults;
}

export function standardSkillLevelThresholds(
  balance = getEffectiveGameBalance(),
): readonly LevelThreshold[] {
  const thresholds: LevelThreshold[] = [{ level: 1, totalXp: 0 }];
  let requirement: number = balance.progression.levelOneToTwoXp;
  let totalXp = 0;
  for (let level = 2; level <= balance.progression.maximumLevel; level += 1) {
    totalXp += requirement;
    thresholds.push({ level, totalXp });
    requirement = Math.floor((requirement * balance.progression.perLevelGrowthBps) / 10_000);
  }
  return thresholds;
}

/** @deprecated Use standardSkillLevelThresholds — retained as a shim for callers that referenced miningLevelThresholds directly. */
export const miningLevelThresholds = standardSkillLevelThresholds;

/**
 * Authoritative level-curve sources per stable skill ID — the single place
 * that decides which skills have an approved progression curve. A skill
 * without an entry has no approved curve and is never presented in
 * progression surfaces. Adding a future skill curve is one entry here; the
 * callers (Mining state, location population, character profiles) need no
 * per-skill conditionals. Factories are invoked per call so future approved
 * balance overrides (Issue #19) stay live.
 */
const skillLevelCurves = {
  [SKILL_IDS.mining]: standardSkillLevelThresholds,
  [SKILL_IDS.refining]: standardSkillLevelThresholds,
} as const satisfies Partial<Record<SkillId, () => readonly LevelThreshold[]>>;

/** The approved level-curve source for a skill, or undefined when none exists. */
export function skillLevelThresholds(skillId: string): readonly LevelThreshold[] | undefined {
  return skillLevelCurves[skillId as SkillId]?.();
}
