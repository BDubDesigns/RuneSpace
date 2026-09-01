import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";

/**
 * RNG parity guard for Issue #127. The generic `createPlayResolver` (now in
 * server/play.ts) must preserve the pre-#127 RNG behavior exactly:
 *
 * - Outside the canonical-E2E override, a caller-supplied `random` feeds BOTH
 *   Mining and Refining resolution.
 * - Under `CI && RUNESPACE_E2E_MINING && localhost`, the composed Refining
 *   resolver uses its deterministic E2E sequence (`[0, 9000]` alternating),
 *   proving both the success and failure branches of a Refining run.
 *
 * These tests dispatch through the composed resolver's `resolve` path so they
 * prove the random actually reaches each activity's resolution, not merely
 * that `createPlayResolver` accepts an argument.
 */
describe("createPlayResolver RNG wiring (#127)", () => {
  const prevDb = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://x@localhost:5432/x";
  });
  afterAll(() => {
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
  });

  const actionFor = (actionId: string) => ({
    characterId: "c",
    actionId,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedThroughAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  // One full Mining attempt window (10 ticks) and one full Refining window
  // (7 ticks) so `resolve` produces at least one rolled attempt.
  const miningWindow = {
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    elapsedTicks: 10,
    availableThroughAt: new Date("2026-01-01T00:00:10.000Z"),
  };
  const refiningWindow = {
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    elapsedTicks: 7,
    availableThroughAt: new Date("2026-01-01T00:00:07.000Z"),
  };

  function miningSnapshot() {
    return {
      miningLevel: 1,
      hasCompatibleTool: true,
      existingStacks: [],
      slotsAvailable: 8,
      massAvailableGrams: 100_000,
      slotsUsed: 0,
      slotCapacity: 8,
      equipmentLoadout: {
        hasCompatibleMiningTool: true,
        containerSlotCapacity: 8,
        inventorySlotsUsed: 0,
        maximumCarryCapacityGrams: 100_000,
        carriedMassGrams: 0,
        assignments: [],
      },
      allItemInstances: [],
      itemInstances: [],
      cutterCharge: 0,
    };
  }

  function refiningSnapshot() {
    return {
      refiningLevel: 1,
      existingStacks: [{ id: "shale", itemId: ITEM_IDS.ferriteShale, quantity: 100 }],
      slotsAvailable: 8,
      massAvailableGrams: 100_000,
    };
  }

  it("is owned by server/play.ts, not server/mining.ts", async () => {
    const play = await import("@/server/play");
    expect(typeof play.createPlayResolver).toBe("function");
    const mining = await import("@/server/mining");
    expect((mining as Record<string, unknown>).createPlayResolver).toBeUndefined();
  });

  it("outside CI, the caller-supplied random reaches Mining and Refining resolution", async () => {
    vi.resetModules();
    const callerRandom = {
      nextBasisPoints: () => 4_321,
      nextUnit: () => 0,
    };
    const play = await import("@/server/play");
    const resolver = play.createPlayResolver(callerRandom);

    for (const actionId of [ACTION_IDS.ferriteShaleMining, ACTION_IDS.refining]) {
      expect(resolver.supports!(actionFor(actionId))).toBe(true);
    }
    expect(resolver.supports!(actionFor("unknown"))).toBe(false);

    // Mining: the sole controlled roll must come from the caller-supplied random.
    const miningResolution = await resolver.resolve({
      action: actionFor(ACTION_IDS.ferriteShaleMining),
      snapshot: miningSnapshot(),
      window: miningWindow,
    });
    const miningOutcome = miningResolution.outcome as {
      attempts: readonly { rolledBasisPoints: number }[];
    };
    expect(miningOutcome.attempts).toHaveLength(1);
    expect(miningOutcome.attempts[0]!.rolledBasisPoints).toBe(4_321);

    // Refining: the same caller-supplied random feeds Refining outside the E2E override.
    const refiningResolution = await resolver.resolve({
      action: actionFor(ACTION_IDS.refining),
      snapshot: refiningSnapshot(),
      window: refiningWindow,
    });
    const refiningOutcome = refiningResolution.outcome as {
      resolvedAttempts: readonly { rolledBasisPoints: number }[];
    };
    expect(refiningOutcome.resolvedAttempts).toHaveLength(1);
    expect(refiningOutcome.resolvedAttempts[0]!.rolledBasisPoints).toBe(4_321);
  });

  it("under the canonical-E2E override, the composed Refining resolver uses the deterministic [0,9000] sequence", async () => {
    vi.resetModules();
    const prevCI = process.env.CI;
    const prevE2E = process.env.RUNESPACE_E2E_MINING;
    const prevDb = process.env.DATABASE_URL;
    process.env.CI = "true";
    process.env.RUNESPACE_E2E_MINING = "true";
    process.env.DATABASE_URL = "postgres://x@localhost:5432/x";
    try {
      const play = await import("@/server/play");
      // A caller random that would yield a distinctive roll is deliberately
      // provided; under the override Refining must ignore it in favor of e2e.
      const resolver = play.createPlayResolver({
        nextBasisPoints: () => 9_999,
        nextUnit: () => 0,
      });

      const first = await resolver.resolve({
        action: actionFor(ACTION_IDS.refining),
        snapshot: refiningSnapshot(),
        window: refiningWindow,
      });
      const firstOutcome = first.outcome as {
        resolvedAttempts: readonly { rolledBasisPoints: number }[];
      };
      // e2eRefiningRandom sequence starts at 0 (success branch).
      expect(firstOutcome.resolvedAttempts).toHaveLength(1);
      expect(firstOutcome.resolvedAttempts[0]!.rolledBasisPoints).toBe(0);

      const second = await resolver.resolve({
        action: actionFor(ACTION_IDS.refining),
        snapshot: refiningSnapshot(),
        window: refiningWindow,
      });
      const secondOutcome = second.outcome as {
        resolvedAttempts: readonly { rolledBasisPoints: number }[];
      };
      // Second roll of the shared e2e sequence is 9000 (failure branch).
      expect(secondOutcome.resolvedAttempts[0]!.rolledBasisPoints).toBe(9_000);
    } finally {
      process.env.CI = prevCI;
      process.env.RUNESPACE_E2E_MINING = prevE2E;
      process.env.DATABASE_URL = prevDb;
      vi.resetModules();
    }
  });
});
