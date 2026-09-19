import { describe, expect, it } from "vitest";
import {
  latestMiningAttempt,
  resolvedAttemptCount,
  runBelongsToSource,
} from "@/features/mining/latest-result";

const attempts = [
  {
    sequence: 4,
    resolvedAt: "2026-01-01T00:00:24.000Z",
    success: true,
    rolledBasisPoints: 0,
    thresholdBasisPoints: 3500,
    itemId: "ferrite_shale",
    quantityAwarded: 1,
    xpAwarded: 15,
    boosted: false,
    durationTicks: 10,
    chargeConsumed: false,
    remainingCharge: 0,
  },
  {
    sequence: 5,
    resolvedAt: "2026-01-01T00:00:30.000Z",
    success: false,
    rolledBasisPoints: 3500,
    thresholdBasisPoints: 3500,
    itemId: "ferrite_shale",
    quantityAwarded: 0,
    xpAwarded: 0,
    boosted: false,
    durationTicks: 10,
    chargeConsumed: false,
    remainingCharge: 0,
  },
];

describe("latest Mining attempt presentation", () => {
  it("uses the newest immutable server attempt as the primary result", () => {
    expect(latestMiningAttempt(attempts)).toEqual(attempts[1]);
    expect(latestMiningAttempt([])).toBeUndefined();
  });

  it("counts a catch-up batch from authoritative run totals", () => {
    expect(resolvedAttemptCount(4, 5)).toBe(1);
    expect(resolvedAttemptCount(4, 7)).toBe(3);
    expect(resolvedAttemptCount(7, 0)).toBe(0);
  });
});

describe("a run belongs to the source that produced it", () => {
  /**
   * Issue #211 review — a Mining run survives travel on purpose, so walking up
   * from Deep Jag leaves a Galvanite run persisted while The Jag is offering
   * Ferrite Shale. The run is still true; it is simply not about what is being
   * mined here, and presenting it under this source's panel reads as though it
   * is.
   */
  const galvaniteRun = {
    itemsGained: { galvanite: 4 },
    recentAttempts: [{ ...attempts[0]!, itemId: "galvanite" }],
  };

  it("recognizes the source it actually worked", () => {
    expect(runBelongsToSource(galvaniteRun, "galvanite")).toBe(true);
    expect(runBelongsToSource(galvaniteRun, "ferrite_shale")).toBe(false);
  });

  it("claims an untouched run for whichever source is being looked at", () => {
    // A fresh run belongs to nobody, so it reads as this source's empty run
    // rather than vanishing the panel entirely.
    const untouched = { itemsGained: {}, recentAttempts: [] };
    expect(runBelongsToSource(untouched, "ferrite_shale")).toBe(true);
    expect(runBelongsToSource(untouched, "galvanite")).toBe(true);
  });

  it("recognizes a run whose every attempt missed", () => {
    // No successes means no totals, so the attempts are the only witness.
    const allMisses = {
      itemsGained: {},
      recentAttempts: [{ ...attempts[1]!, itemId: "galvanite" }],
    };
    expect(runBelongsToSource(allMisses, "galvanite")).toBe(true);
    expect(runBelongsToSource(allMisses, "ferrite_shale")).toBe(false);
  });
});
