import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  practiceSectionXp,
  workOrderSectionXp,
} from "@/game/config/balance";
import { ITEM_IDS, WORK_ORDER_IDS } from "@/game/config/foundations";
import { WORK_ORDERS, type WorkOrderDefinition } from "@/game/content/work-orders";
import {
  cleanPassOpportunityCount,
  cleanPassOpportunityWindows,
  type CleanPassRandom,
} from "@/game/domain/clean-pass";
import {
  acceptedWorkOrderState,
  eligibleWorkOrders,
  selectInitialWorkOrderBoard,
  selectWorkOrderRefill,
  validateWorkOrderDefinitions,
  workOrderComplete,
  workOrderMaterialReplacementValue,
  workOrderPayoutCredits,
  workOrderTotalXp,
} from "@/game/domain/work-orders";

/**
 * Issue #207 — Work Orders, the rules every authored client job obeys.
 *
 * `game/domain/work-orders.ts` is the arithmetic and the selection; the eight
 * shipped jobs are content (`game/content/work-orders`) and the shared cadence
 * is balance (`game/config/balance`). These tests prove the rules against the
 * real shipped pool wherever possible, and fall back to small synthetic pools
 * only for the shapes the shipped eight cannot exercise (a drifted payout, a
 * pool small enough to force the refill exclusions to conflict).
 */

const balance = getEffectiveGameBalance();

/** A roll source that replays exactly the basis points it is handed. */
function scriptedRandom(...rolls: readonly number[]): CleanPassRandom {
  let index = 0;
  return {
    nextBasisPoints: () => rolls[index++ % rolls.length]!,
  };
}

/**
 * One synthetic job, valid by default, for exercising a single validation
 * rule or selection shape the shipped eight cannot. Its payout is recomputed
 * from the merged fields so only a test that deliberately overrides
 * `payoutCredits` gets a drifted one.
 */
function syntheticJob(overrides: Partial<WorkOrderDefinition> = {}): WorkOrderDefinition {
  const draft: WorkOrderDefinition = {
    id: "synthetic_job",
    title: "Synthetic Job",
    clientName: "Synthetic Client",
    description: "A synthetic job used only to exercise one validation or selection rule.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
    sections: 8,
    payoutCredits: 0,
    ...overrides,
  };
  return overrides.payoutCredits === undefined
    ? { ...draft, payoutCredits: workOrderPayoutCredits(draft, balance) }
    : draft;
}

describe("The authored Work Order pool validates (#207)", () => {
  it("passes validateWorkOrderDefinitions for the shipped WORK_ORDERS", () => {
    expect(() => validateWorkOrderDefinitions()).not.toThrow();
  });
});

describe("Every authored payout equals the one payout formula (#207)", () => {
  it("matches workOrderPayoutCredits exactly for all eight jobs, and locks the shipped Credit values", () => {
    const expectedPayouts: Record<string, number> = {
      [WORK_ORDER_IDS.rennCarryFrame]: 75,
      [WORK_ORDER_IDS.vossHeaterHousing]: 100,
      [WORK_ORDER_IDS.bixShopShelving]: 90,
      [WORK_ORDER_IDS.tansyCutterHousing]: 115,
      [WORK_ORDER_IDS.maraBedFrame]: 120,
      [WORK_ORDER_IDS.stempSpeederRack]: 135,
      [WORK_ORDER_IDS.larkinHandWinch]: 120,
      [WORK_ORDER_IDS.mottCargoDolly]: 200,
    };
    expect(WORK_ORDERS).toHaveLength(8);
    for (const job of WORK_ORDERS) {
      expect(workOrderPayoutCredits(job, balance)).toBe(job.payoutCredits);
      expect(job.payoutCredits).toBe(expectedPayouts[job.id]);
    }
  });
});

describe("Replacement value comes from the merchant registry, not a second table (#207)", () => {
  it("resolves Refined Ferrite to 10 — Bix is the only merchant who buys it", () => {
    expect(workOrderMaterialReplacementValue(ITEM_IDS.refinedFerrite)).toBe(10);
  });

  it("resolves Power Cell to 8 — Bix's SELL price, not the 3 he buys them back for", () => {
    // Replacement value is what the player would pay to replace the unit, so
    // a consumed Cell must be valued at what it costs to buy another, never at
    // the lower price Bix pays when he buys one back.
    expect(workOrderMaterialReplacementValue(ITEM_IDS.powerCell)).toBe(8);
  });
});

describe("Validation rejects every kind of authoring drift (#207)", () => {
  it("rejects a job whose authored payout is one Credit off the formula, naming the derived value", () => {
    const job = WORK_ORDERS[0]!;
    const drifted = { ...job, payoutCredits: job.payoutCredits + 1 };
    expect(() => validateWorkOrderDefinitions([drifted])).toThrow(
      `authors ${drifted.payoutCredits} Credits but the payout rule derives ${job.payoutCredits}`,
    );
  });

  it("rejects a duplicate id", () => {
    const job = syntheticJob();
    expect(() => validateWorkOrderDefinitions([job, job])).toThrow(
      `Duplicate Work Order id: ${job.id}`,
    );
  });

  it("rejects a non-stackable required item", () => {
    // The Salvage Cutter has no merchant price at all, so the payout formula
    // itself cannot run for it — the stackability check must fail first, which
    // is why this is the one synthetic job with an explicit payoutCredits
    // rather than a formula-derived one.
    const job = syntheticJob({
      materials: [{ itemId: ITEM_IDS.salvageCutter, quantity: 1 }],
      payoutCredits: 999,
    });
    expect(() => validateWorkOrderDefinitions([job])).toThrow(
      `requires a non-stackable item: ${ITEM_IDS.salvageCutter}`,
    );
  });

  it("rejects a zero or negative material quantity", () => {
    const zero = syntheticJob({ materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 0 }] });
    expect(() => validateWorkOrderDefinitions([zero])).toThrow(/positive integer quantity/);

    const negative = syntheticJob({
      materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: -1 }],
    });
    expect(() => validateWorkOrderDefinitions([negative])).toThrow(/positive integer quantity/);
  });

  it("rejects an item named twice in one recipe", () => {
    const job = syntheticJob({
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 1 },
        { itemId: ITEM_IDS.refinedFerrite, quantity: 1 },
      ],
    });
    expect(() => validateWorkOrderDefinitions([job])).toThrow(
      `names ${ITEM_IDS.refinedFerrite} twice in one recipe`,
    );
  });

  it("accepts a job too short to host a Clean Pass opportunity", () => {
    // The generalized cadence supports zero opportunities below the authored
    // minimum length, so a short job simply gets none. Validation must not
    // invent a Work Order minimum on top of that (#207).
    expect(balance.welding.cleanPass.minimumSectionsForOpportunity).toBe(6);
    const short = syntheticJob({ id: "short_job", sections: 5 });
    const pool = [
      short,
      syntheticJob({ id: "a" }),
      syntheticJob({ id: "b" }),
      syntheticJob({ id: "c" }),
    ];
    expect(() => validateWorkOrderDefinitions(pool)).not.toThrow();
    expect(cleanPassOpportunityWindows(short.sections, balance)).toEqual([]);
  });

  it("rejects a pool smaller than postedSlots + 1", () => {
    expect(balance.workOrders.postedSlots).toBe(3);
    expect(() => validateWorkOrderDefinitions([syntheticJob()])).toThrow(
      /needs at least 4 jobs to fill 3 distinct slots and refill one/,
    );
  });
});

describe("Work Order XP is a derived share of the global Welding XP (#207)", () => {
  it("pays 20 XP per section — 40% of the canonical 50", () => {
    expect(balance.welding.xpPerIncrement).toBe(50);
    expect(balance.workOrders.xpShareBps).toBe(4_000);
    expect(workOrderSectionXp(balance)).toBe(20);
  });

  it("keeps Practice at 10 XP per section — 20% of the same 50 — for comparison", () => {
    expect(balance.practiceWelding.xpShareBps).toBe(2_000);
    expect(practiceSectionXp(balance)).toBe(10);
  });

  it("derives both shares from welding.xpPerIncrement rather than freezing them as second constants", () => {
    expect(workOrderSectionXp(balance)).toBe(
      Math.floor((balance.welding.xpPerIncrement * balance.workOrders.xpShareBps) / 10_000),
    );
    expect(practiceSectionXp(balance)).toBe(
      Math.floor((balance.welding.xpPerIncrement * balance.practiceWelding.xpShareBps) / 10_000),
    );
  });

  it("pays sections × 20 total XP for every authored job", () => {
    const expectedTotals: Record<string, number> = {
      [WORK_ORDER_IDS.rennCarryFrame]: 160,
      [WORK_ORDER_IDS.vossHeaterHousing]: 180,
      [WORK_ORDER_IDS.bixShopShelving]: 200,
      [WORK_ORDER_IDS.tansyCutterHousing]: 240,
      [WORK_ORDER_IDS.maraBedFrame]: 260,
      [WORK_ORDER_IDS.stempSpeederRack]: 280,
      [WORK_ORDER_IDS.larkinHandWinch]: 320,
      [WORK_ORDER_IDS.mottCargoDolly]: 380,
    };
    for (const job of WORK_ORDERS) {
      expect(workOrderTotalXp(job, balance)).toBe(job.sections * 20);
      expect(workOrderTotalXp(job, balance)).toBe(expectedTotals[job.id]);
    }
  });
});

describe("Clean Pass count per job is floor(sections / 5) (#207)", () => {
  it("matches the table's order exactly: 1, 1, 2, 2, 2, 2, 3, 3", () => {
    const expectedCounts = [1, 1, 2, 2, 2, 2, 3, 3];
    expect(WORK_ORDERS.map((job) => cleanPassOpportunityCount(job.sections, balance))).toEqual(
      expectedCounts,
    );
  });
});

describe("Board selection (#207)", () => {
  it("draws exactly three distinct jobs for the initial board", () => {
    const eligible = eligibleWorkOrders(5);
    const board = selectInitialWorkOrderBoard({
      eligible,
      slots: balance.workOrders.postedSlots,
      random: scriptedRandom(0),
    });
    expect(board).toHaveLength(3);
    expect(new Set(board.map((job) => job.id)).size).toBe(3);
  });

  it("never refills with a job already visible on the board", () => {
    const eligible = eligibleWorkOrders(5);
    const visible = eligible.slice(0, 2).map((job) => job.id);
    for (let roll = 0; roll < eligible.length; roll += 1) {
      const drawn = selectWorkOrderRefill({
        eligible,
        visibleWorkOrderIds: visible,
        random: scriptedRandom(roll),
      });
      expect(drawn).toBeDefined();
      expect(visible).not.toContain(drawn!.id);
    }
  });

  it("avoids the just-cleared job when another eligible option exists", () => {
    const eligible = eligibleWorkOrders(5);
    const justCleared = eligible[0]!.id;
    for (let roll = 0; roll < eligible.length; roll += 1) {
      const drawn = selectWorkOrderRefill({
        eligible,
        visibleWorkOrderIds: [],
        justClearedWorkOrderId: justCleared,
        random: scriptedRandom(roll),
      });
      expect(drawn!.id).not.toBe(justCleared);
    }
  });

  it("relaxes the just-cleared exclusion, rather than returning nothing, when the two exclusions conflict", () => {
    // A pool of two: job B is already visible on the board, and job A was just
    // cleared. Distinctness from the visible board must win, which leaves only
    // job A — the just-cleared exclusion is relaxed rather than the slot going
    // unfilled.
    const jobA = syntheticJob({ id: "synthetic_a" });
    const jobB = syntheticJob({ id: "synthetic_b" });
    const drawn = selectWorkOrderRefill({
      eligible: [jobA, jobB],
      visibleWorkOrderIds: [jobB.id],
      justClearedWorkOrderId: jobA.id,
      random: scriptedRandom(0),
    });
    expect(drawn!.id).toBe(jobA.id);
  });

  it("has no client-level weighting: several jobs from one client are each drawable as their own job", () => {
    // Three jobs, all Wade Rusk's. Nothing collapses them into one weighted
    // slot or skips any of them for having a shared client.
    const sameClientJobs = [
      syntheticJob({ id: "wade_job_one", clientName: "Wade Rusk" }),
      syntheticJob({ id: "wade_job_two", clientName: "Wade Rusk" }),
      syntheticJob({ id: "wade_job_three", clientName: "Wade Rusk" }),
    ];
    for (let roll = 0; roll < sameClientJobs.length; roll += 1) {
      const drawn = selectWorkOrderRefill({
        eligible: sameClientJobs,
        visibleWorkOrderIds: [],
        random: scriptedRandom(roll),
      });
      expect(drawn!.id).toBe(sameClientJobs[roll]!.id);
    }
  });
});

describe("eligibleWorkOrders grows the pool with Welding level; it never replaces (#207)", () => {
  it("makes nothing eligible below the required level", () => {
    expect(eligibleWorkOrders(4)).toEqual([]);
  });

  it("keeps a lower-level job eligible forever as higher-tier jobs are added", () => {
    const pool = [
      syntheticJob({ id: "tier_five", requiredWeldingLevel: 5 }),
      syntheticJob({ id: "tier_ten", requiredWeldingLevel: 10 }),
      syntheticJob({ id: "tier_twenty", requiredWeldingLevel: 20 }),
    ];
    expect(eligibleWorkOrders(4, pool)).toEqual([]);
    expect(eligibleWorkOrders(5, pool).map((job) => job.id)).toEqual(["tier_five"]);
    expect(eligibleWorkOrders(10, pool).map((job) => job.id)).toEqual(["tier_five", "tier_ten"]);
    expect(eligibleWorkOrders(20, pool).map((job) => job.id)).toEqual([
      "tier_five",
      "tier_ten",
      "tier_twenty",
    ]);
  });
});

describe("workOrderComplete is true only at or beyond the job's section count (#207)", () => {
  it("resolves a job the instant its last section resolves, and not one section earlier", () => {
    const job = WORK_ORDERS.find((candidate) => candidate.id === WORK_ORDER_IDS.rennCarryFrame)!;
    expect(job.sections).toBe(8);
    expect(workOrderComplete(job, 7)).toBe(false);
    expect(workOrderComplete(job, 8)).toBe(true);
    expect(workOrderComplete(job, 9)).toBe(true);
  });
});

describe("acceptedWorkOrderState rolls the Clean Pass from the job's own length (#207)", () => {
  it("gives a 19-section job three opportunities and an 8-section job one, both starting at 0 sections", () => {
    const longJob = WORK_ORDERS.find((job) => job.id === WORK_ORDER_IDS.mottCargoDolly)!;
    const shortJob = WORK_ORDERS.find((job) => job.id === WORK_ORDER_IDS.rennCarryFrame)!;
    expect(longJob.sections).toBe(19);
    expect(shortJob.sections).toBe(8);

    const longState = acceptedWorkOrderState(longJob, scriptedRandom(0, 0, 0), balance);
    const shortState = acceptedWorkOrderState(shortJob, scriptedRandom(0), balance);

    expect(longState).toMatchObject({ workOrderId: longJob.id, sectionsCompleted: 0 });
    expect(longState.cleanPass.opportunities).toHaveLength(3);

    expect(shortState).toMatchObject({ workOrderId: shortJob.id, sectionsCompleted: 0 });
    expect(shortState.cleanPass.opportunities).toHaveLength(1);
  });
});
