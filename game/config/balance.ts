import { z } from "zod";
import { ACTION_IDS, ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
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
    successAtLevelOneBps: z.literal(3_500),
    guaranteedSuccessLevel: z.literal(30),
    successRangeBps: z.literal(6_500),
    successXp: z.literal(15),
    yieldMinimum: z.literal(1),
    yieldMaximum: z.literal(2),
  }),
  items: z.object({
    ferriteShale: z.object({
      itemId: z.literal(ITEM_IDS.ferriteShale),
      massGrams: z.literal(100),
      stackLimit: z.literal(10),
    }),
    salvageCutter: z.object({
      itemId: z.literal(ITEM_IDS.salvageCutter),
      massGrams: z.literal(5_000),
      suitSlotId: z.literal("mining_tool"),
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
    successAtLevelOneBps: 3_500,
    guaranteedSuccessLevel: 30,
    successRangeBps: 6_500,
    successXp: 15,
    yieldMinimum: 1,
    yieldMaximum: 2,
  },
  items: {
    ferriteShale: { itemId: ITEM_IDS.ferriteShale, massGrams: 100, stackLimit: 10 },
    salvageCutter: { itemId: ITEM_IDS.salvageCutter, massGrams: 5_000, suitSlotId: "mining_tool" },
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

export function miningLevelThresholds(
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
