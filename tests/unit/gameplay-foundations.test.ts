import { describe, expect, it } from "vitest";
import { ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  calculateCarriedWeight,
  deriveCarryingCapacity,
  inventorySlotCapacityFromContainers,
  inventorySlotsUsed,
  planStackAddition,
} from "@/game/domain/inventory";
import { grantSkillXp, levelFromXp, type LevelThreshold } from "@/game/domain/progression";
import {
  calculateResolutionWindow,
  effectiveAttemptDurationTicks,
  millisecondsToWholeTicks,
  resolvableAttemptCount,
  ticksToMilliseconds,
} from "@/game/domain/timing";
import { ContainerContentsSchema, EquipmentAssignmentKindSchema } from "@/game/schemas/gameplay";

const thresholds: readonly LevelThreshold[] = [
  { level: 1, totalXp: 0 },
  { level: 2, totalXp: 10 },
  { level: 3, totalXp: 30 },
];

describe("gameplay timing", () => {
  it("uses the canonical 600 ms game tick", () => {
    expect(ticksToMilliseconds(3)).toBe(1800);
    expect(millisecondsToWholeTicks(1799)).toBe(2);
    expect(millisecondsToWholeTicks(1800)).toBe(3);
  });

  it("rounds speed-modified attempt durations upward to whole ticks", () => {
    expect(effectiveAttemptDurationTicks(5, 0.5)).toBe(3);
    expect(resolvableAttemptCount(11, 3)).toBe(3);
  });

  it("caps lazy resolution to the most recent hour", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    const window = calculateResolutionWindow(new Date("2026-01-01T00:00:00.000Z"), now);
    expect(window.elapsedTicks).toBe(6000);
    expect(window.resolvedThroughAt).toEqual(now);
  });
});

describe("progression", () => {
  it("derives levels and returns a typed XP grant result", () => {
    expect(levelFromXp(29, thresholds)).toBe(2);
    expect(grantSkillXp({ skillId: SKILL_IDS.mining, totalXp: 9 }, 1, thresholds)).toEqual({
      skillId: SKILL_IDS.mining,
      totalXp: 10,
      awardedXp: 1,
      previousLevel: 1,
      level: 2,
    });
  });

  it("rejects negative XP awards", () => {
    expect(() => grantSkillXp({ skillId: SKILL_IDS.mining, totalXp: 0 }, -1, thresholds)).toThrow(
      /non-negative/i,
    );
  });
});

describe("inventory", () => {
  it("fills compatible partial stacks before opening new slots", () => {
    const plan = planStackAddition(
      [{ itemId: ITEM_IDS.ferriteShale, quantity: 7 }],
      ITEM_IDS.ferriteShale,
      8,
      10,
      1,
    );
    expect(plan.updatedStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 10 }]);
    expect(plan.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 5 }]);
    expect(plan.remainingQuantity).toBe(0);
  });

  it("leaves overflow when inventory slots are exhausted", () => {
    const plan = planStackAddition([], ITEM_IDS.ferriteShale, 11, 10, 1);
    expect(plan.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 10 }]);
    expect(plan.remainingQuantity).toBe(1);
  });

  it("leaves overflow when carried weight is exhausted", () => {
    const plan = planStackAddition([], ITEM_IDS.ferriteShale, 4, 10, 1, 5, 2);
    expect(plan.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 2 }]);
    expect(plan.remainingQuantity).toBe(2);
  });

  it("derives slot capacity from equipped containers", () => {
    expect(inventorySlotCapacityFromContainers([4, 7])).toBe(11);
  });

  it("counts equipped items in weight but not inventory slots", () => {
    expect(inventorySlotsUsed(2, 1)).toBe(3);
    expect(calculateCarriedWeight([3, 2, 5, 4])).toBe(14);
    expect(
      deriveCarryingCapacity({
        strengthCapacity: 10,
        buffCapacities: [2],
        equipmentCapacities: [3],
      }),
    ).toBe(15);
  });

  it("rejects nested containers at the validation boundary", () => {
    expect(
      ContainerContentsSchema.safeParse([
        { itemId: ITEM_IDS.salvageCutter, isContainer: false },
        { itemId: ITEM_IDS.powerCell, isContainer: true },
      ]).success,
    ).toBe(false);
  });

  it("keeps container assignments in dedicated equipment slots", () => {
    expect(EquipmentAssignmentKindSchema.parse("container")).toBe("container");
    expect(EquipmentAssignmentKindSchema.safeParse("cargo").success).toBe(false);
  });
});
