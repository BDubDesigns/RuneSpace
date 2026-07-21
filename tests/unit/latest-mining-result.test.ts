import { describe, expect, it } from "vitest";
import { latestMiningAttempt, resolvedAttemptCount } from "@/features/mining/latest-result";

describe("latest Mining attempt presentation", () => {
  const attempts = [
    {
      sequence: 4,
      resolvedAt: "2026-01-01T00:00:24.000Z",
      success: true,
      rolledBasisPoints: 0,
      thresholdBasisPoints: 3500,
      shaleAwarded: 1,
      xpAwarded: 15,
    },
    {
      sequence: 5,
      resolvedAt: "2026-01-01T00:00:30.000Z",
      success: false,
      rolledBasisPoints: 3500,
      thresholdBasisPoints: 3500,
      shaleAwarded: 0,
      xpAwarded: 0,
    },
  ];

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
