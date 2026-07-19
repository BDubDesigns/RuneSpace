import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, miningLevelThresholds } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  miningSuccessChanceBps,
  miningNearMissBasisPoints,
  resolveCrashSiteMining,
  type MiningRandom,
} from "@/game/domain/mining";
import { levelFromXp } from "@/game/domain/progression";

function rolls(basisPoints: number[], units: number[] = [0]): MiningRandom {
  return {
    nextBasisPoints: () => basisPoints.shift() ?? 0,
    nextUnit: () => units.shift() ?? 0,
  };
}

const balance = getEffectiveGameBalance();
const ready = {
  miningLevel: 1,
  hasCompatibleTool: true,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 35_000,
};

describe("approved Crash Site Mining balance", () => {
  it("derives recursive requirements and cumulative thresholds through level 99", () => {
    const thresholds = miningLevelThresholds();
    expect(thresholds).toHaveLength(99);
    expect(thresholds.slice(0, 5)).toEqual([
      { level: 1, totalXp: 0 },
      { level: 2, totalXp: 500 },
      { level: 3, totalXp: 1050 },
      { level: 4, totalXp: 1655 },
      { level: 5, totalXp: 2320 },
    ]);
    expect(levelFromXp(thresholds[98]!.totalXp + 1_000_000, thresholds)).toBe(99);
  });

  it("uses approved integer basis-point success interpolation", () => {
    expect(miningSuccessChanceBps(1, balance)).toBe(3500);
    expect(miningSuccessChanceBps(15, balance)).toBe(6637);
    expect(miningSuccessChanceBps(30, balance)).toBe(10_000);
    expect(miningSuccessChanceBps(99, balance)).toBe(10_000);
  });
});

describe("Crash Site Ferrite Shale resolution", () => {
  it("takes ten ticks and preserves partial attempt progress", () => {
    expect(
      resolveCrashSiteMining({ elapsedTicks: 9, snapshot: ready, balance, random: rolls([]) })
        .consumedTicks,
    ).toBe(0);
    expect(
      resolveCrashSiteMining({ elapsedTicks: 11, snapshot: ready, balance, random: rolls([0]) })
        .consumedTicks,
    ).toBe(10);
  });

  it("uses deterministic success and failure rolls", () => {
    const success = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: ready,
      balance,
      random: rolls([3499], [0]),
    });
    expect(success).toMatchObject({ successes: 1, failures: 0, awardedXp: 15 });
    expect(success.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 1 }]);
    const failure = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: ready,
      balance,
      random: rolls([3500]),
    });
    expect(failure).toMatchObject({ successes: 0, failures: 1, awardedXp: 0, createdStacks: [] });
    expect(success.attempts).toEqual([
      {
        success: true,
        rolledBasisPoints: 3499,
        thresholdBasisPoints: 3500,
        shaleAwarded: 1,
        xpAwarded: 15,
      },
    ]);
    expect(failure.attempts).toEqual([
      {
        success: false,
        rolledBasisPoints: 3500,
        thresholdBasisPoints: 3500,
        shaleAwarded: 0,
        xpAwarded: 0,
      },
    ]);
  });

  it("retains one immutable outcome per resolved attempt in chronological order", () => {
    const outcome = resolveCrashSiteMining({
      elapsedTicks: 30,
      snapshot: ready,
      balance,
      random: rolls([0, 3500, 0], [0, 0.5]),
    });
    expect(outcome.attempts).toEqual([
      {
        success: true,
        rolledBasisPoints: 0,
        thresholdBasisPoints: 3500,
        shaleAwarded: 1,
        xpAwarded: 15,
      },
      {
        success: false,
        rolledBasisPoints: 3500,
        thresholdBasisPoints: 3500,
        shaleAwarded: 0,
        xpAwarded: 0,
      },
      {
        success: true,
        rolledBasisPoints: 0,
        thresholdBasisPoints: 3500,
        shaleAwarded: 2,
        xpAwarded: 15,
      },
    ]);
    expect(miningNearMissBasisPoints(3602, 3500)).toBe(103);
  });

  it("measures misses from the highest successful discrete roll", () => {
    expect(miningNearMissBasisPoints(3500, 3500)).toBe(1);
    expect(miningNearMissBasisPoints(3501, 3500)).toBe(2);
    expect(miningNearMissBasisPoints(3499, 3500)).toBe(0);
  });

  it("rolls one or two shale equally and awards the same XP", () => {
    const one = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: ready,
      balance,
      random: rolls([0], [0.49]),
    });
    const two = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: ready,
      balance,
      random: rolls([0], [0.5]),
    });
    expect(one.createdStacks[0]?.quantity).toBe(1);
    expect(two.createdStacks[0]?.quantity).toBe(2);
    expect(one.awardedXp).toBe(15);
    expect(two.awardedXp).toBe(15);
  });

  it("fills a partial stack before opening another slot", () => {
    const outcome = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: {
        ...ready,
        existingStacks: [{ id: "existing", itemId: ITEM_IDS.ferriteShale, quantity: 9 }],
        slotsAvailable: 0,
      },
      balance,
      random: rolls([0], [0.5]),
    });
    expect(outcome.stackUpdates).toEqual([{ id: "existing", quantity: 10 }]);
    expect(outcome.createdStacks).toEqual([]);
  });

  it("keeps created stack output separate after a later capacity stop", () => {
    const outcome = resolveCrashSiteMining({
      elapsedTicks: 110,
      snapshot: {
        ...ready,
        existingStacks: [{ id: "new-0-1", itemId: ITEM_IDS.ferriteShale, quantity: 10 }],
        slotsAvailable: 1,
        massAvailableGrams: 35_000,
      },
      balance,
      random: rolls(
        Array.from({ length: 10 }, () => 0),
        Array.from({ length: 10 }, () => 0),
      ),
    });
    expect(outcome).toMatchObject({
      successes: 10,
      consumedTicks: 100,
      stopReason: "inventory_slots_full",
    });
    expect(outcome.stackUpdates).toEqual([{ id: "new-0-1", quantity: 10 }]);
    expect(outcome.createdStacks).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 10 }]);
  });

  it("stops before rolling for full slots, mass, or missing tool", () => {
    const noSlots = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: { ...ready, slotsAvailable: 0 },
      balance,
      random: rolls([0]),
    });
    expect(noSlots).toMatchObject({ consumedTicks: 0, stopReason: "inventory_slots_full" });
    const noMass = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: { ...ready, massAvailableGrams: 99 },
      balance,
      random: rolls([0]),
    });
    expect(noMass).toMatchObject({ consumedTicks: 0, stopReason: "carried_mass_capacity_reached" });
    const noTool = resolveCrashSiteMining({
      elapsedTicks: 10,
      snapshot: { ...ready, hasCompatibleTool: false },
      balance,
      random: rolls([0]),
    });
    expect(noTool).toMatchObject({
      consumedTicks: 0,
      stopReason: "compatible_mining_tool_missing",
    });
  });
});
