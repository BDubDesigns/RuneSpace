import { describe, expect, it } from "vitest";
import { ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  calculateCarriedWeight,
  deriveCarriedUniqueItems,
  deriveCarryingCapacity,
  inventorySlotCapacityFromContainers,
  inventorySlotsUsed,
  planExactStackRemoval,
  planStackAddition,
} from "@/game/domain/inventory";
import { grantSkillXp, levelFromXp, type LevelThreshold } from "@/game/domain/progression";
import {
  calculateResolutionWindow,
  cursorAfterConsumedTicks,
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
    expect(effectiveAttemptDurationTicks(10, 2)).toBe(5);
    expect(effectiveAttemptDurationTicks(9, 2)).toBe(5);
    expect(resolvableAttemptCount(11, 10)).toBe(1);
  });

  it("caps lazy resolution to the most recent hour", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    const window = calculateResolutionWindow(new Date("2026-01-01T00:00:00.000Z"), now);
    expect(window.elapsedTicks).toBe(6000);
    expect(window.availableThroughAt).toEqual(now);
  });

  it("retains partial attempt progress in the durable cursor", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const window = calculateResolutionWindow(start, new Date("2026-01-01T00:00:06.600Z"));
    expect(window.elapsedTicks).toBe(11);
    expect(resolvableAttemptCount(window.elapsedTicks, 10)).toBe(1);
    expect(cursorAfterConsumedTicks(window, 10)).toEqual(new Date("2026-01-01T00:00:06.000Z"));
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
      [{ id: "stack-1", itemId: ITEM_IDS.ferriteShale, quantity: 7 }],
      ITEM_IDS.ferriteShale,
      8,
      10,
      1,
    );
    expect(plan.updatedStacks).toEqual([{ id: "stack-1", quantity: 10 }]);
    expect(plan.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 5 }]);
    expect(plan.remainingQuantity).toBe(0);
  });

  it("retains persistent stack identity for planned updates", () => {
    const plan = planStackAddition(
      [{ id: 42, itemId: ITEM_IDS.ferriteShale, quantity: 9 }],
      ITEM_IDS.ferriteShale,
      1,
      10,
      0,
    );
    expect(plan.updatedStacks).toEqual([{ id: 42, quantity: 10 }]);
  });

  it("fills a closest-to-full partial stack before opening a new stack", () => {
    const plan = planStackAddition(
      [
        {
          id: "full",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 5,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "partial",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 2,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      ITEM_IDS.ferriteShale,
      3,
      5,
      0,
    );
    expect(plan.updatedStacks).toEqual([{ id: "partial", quantity: 5 }]);
    expect(plan.createdStacks).toEqual([]);
    expect(plan.remainingQuantity).toBe(0);
  });

  it("fills [4, 2] as [5, 4] when three items are added", () => {
    const plan = planStackAddition(
      [
        { id: "two", itemId: ITEM_IDS.ferriteShale, quantity: 2 },
        { id: "four", itemId: ITEM_IDS.ferriteShale, quantity: 4 },
      ],
      ITEM_IDS.ferriteShale,
      3,
      5,
      0,
    );
    expect(plan.updatedStacks).toEqual([
      { id: "four", quantity: 5 },
      { id: "two", quantity: 4 },
    ]);
    expect(plan.createdStacks).toEqual([]);
    expect(plan.remainingQuantity).toBe(0);
  });

  it("fills the higher-quantity partial stack first when either can receive the award", () => {
    const plan = planStackAddition(
      [
        { id: "lower", itemId: ITEM_IDS.ferriteShale, quantity: 1 },
        { id: "higher", itemId: ITEM_IDS.ferriteShale, quantity: 3 },
      ],
      ITEM_IDS.ferriteShale,
      1,
      5,
      0,
    );
    expect(plan.updatedStacks).toEqual([{ id: "higher", quantity: 4 }]);
    expect(plan.createdStacks).toEqual([]);
    expect(plan.remainingQuantity).toBe(0);
  });

  it("uses creation time, then ID, for equal-quantity addition ties", () => {
    const byCreationTime = planStackAddition(
      [
        {
          id: "newer",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 2,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "older",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      ITEM_IDS.ferriteShale,
      1,
      5,
      0,
    );
    expect(byCreationTime.updatedStacks).toEqual([{ id: "older", quantity: 3 }]);

    const byId = planStackAddition(
      [
        {
          id: "stack-b",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "stack-a",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      ITEM_IDS.ferriteShale,
      1,
      5,
      0,
    );
    expect(byId.updatedStacks).toEqual([{ id: "stack-a", quantity: 3 }]);
  });

  it("consumes the smallest stacks first, then creation order and ID", () => {
    const plan = planExactStackRemoval(
      [
        {
          id: "newer-five",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 5,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "one",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 1,
          createdAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "older-five",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 5,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      ITEM_IDS.ferriteShale,
      6,
    );
    expect(plan).toEqual({
      ok: true,
      updatedStacks: [],
      deletedStackIds: ["one", "older-five"],
    });
  });

  it("uses stack ID as the final consumption tie-breaker", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const plan = planExactStackRemoval(
      [
        { id: "stack-b", itemId: ITEM_IDS.ferriteShale, quantity: 2, createdAt },
        { id: "stack-a", itemId: ITEM_IDS.ferriteShale, quantity: 2, createdAt },
      ],
      ITEM_IDS.ferriteShale,
      2,
    );
    expect(plan).toEqual({ ok: true, updatedStacks: [], deletedStackIds: ["stack-a"] });
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

  it("projects carried unique items excluding equipped instances", () => {
    const carried = deriveCarriedUniqueItems(
      [
        { id: "cutter", itemId: ITEM_IDS.salvageCutter, createdAt: "2026-01-01T00:00:00.000Z" },
        {
          id: "container",
          itemId: ITEM_IDS.mykeaSchleppraum8,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      new Set(["cutter"]),
    );
    expect(carried.map((item) => item.id)).toEqual(["container"]);
  });

  it("orders carried unique items deterministically by creation time and ID", () => {
    const instances = [
      { id: "b", itemId: ITEM_IDS.salvageCutter, createdAt: "2026-01-01T00:00:01.000Z" },
      { id: "a", itemId: ITEM_IDS.salvageCutter, createdAt: "2026-01-01T00:00:01.000Z" },
      { id: "c", itemId: ITEM_IDS.mykeaSchleppraum8, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const once = deriveCarriedUniqueItems(instances, new Set());
    const twice = deriveCarriedUniqueItems([...instances].reverse(), new Set());
    expect(once.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(twice.map((item) => item.id)).toEqual(["c", "a", "b"]);
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
