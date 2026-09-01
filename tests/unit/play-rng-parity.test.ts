import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTION_IDS } from "@/game/config/foundations";

/**
 * RNG parity guard for Issue #127. The generic `createPlayResolver` (now in
 * server/play.ts) must preserve the pre-#127 RNG behavior exactly:
 *
 * - Outside the canonical-E2E override, the caller-supplied `random` feeds
 *   BOTH Mining and Refining.
 * - Under `CI && RUNESPACE_E2E_MINING && localhost`, Refining uses its
 *   deterministic E2E sequence (`[0, 9000]` alternating), proving both the
 *   success and failure branches of a Refining run.
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

  it("is owned by server/play.ts, not server/mining.ts", async () => {
    const play = await import("@/server/play");
    expect(typeof play.createPlayResolver).toBe("function");
    const mining = await import("@/server/mining");
    expect((mining as Record<string, unknown>).createPlayResolver).toBeUndefined();
  });

  it("outside CI, the caller-supplied random feeds both Mining and Refining", async () => {
    vi.resetModules();
    const callSequence: string[] = [];
    const callerRandom = {
      nextBasisPoints: () => {
        callSequence.push("caller");
        return 1234;
      },
      nextUnit: () => 0,
    };
    const play = await import("@/server/play");
    const resolver = play.createPlayResolver(callerRandom);

    const { e2eRefiningRandom } = await import("@/server/refining");
    const actionFor = (actionId: string) => ({
      characterId: "c",
      actionId,
      startedAt: new Date(),
      resolvedThroughAt: new Date(),
    });
    expect(resolver.supports!(actionFor(ACTION_IDS.ferriteShaleMining))).toBe(true);
    expect(resolver.supports!(actionFor(ACTION_IDS.refining))).toBe(true);
    expect(resolver.supports!(actionFor(ACTION_IDS.travel))).toBe(true);
    expect(resolver.supports!(actionFor(ACTION_IDS.cargoHoldWelding))).toBe(true);
    expect(resolver.supports!(actionFor("unknown"))).toBe(false);
    expect(typeof e2eRefiningRandom).toBe("function");
    expect(callSequence.length).toBe(0); // no random call at construction
  });

  it("under the canonical-E2E override, Refining uses the deterministic [0,9000] sequence", async () => {
    vi.resetModules();
    const prevCI = process.env.CI;
    const prevE2E = process.env.RUNESPACE_E2E_MINING;
    const prevDb = process.env.DATABASE_URL;
    process.env.CI = "true";
    process.env.RUNESPACE_E2E_MINING = "true";
    process.env.DATABASE_URL = "postgres://x@localhost:5432/x";
    try {
      const refining = await import("@/server/refining");
      const rng = refining.e2eRefiningRandom();
      // The deterministic sequence alternates [0, 9000]: first succeeds at L1
      // (threshold 4000), second fails.
      expect(rng.nextBasisPoints()).toBe(0);
      expect(rng.nextBasisPoints()).toBe(9_000);
      expect(rng.nextBasisPoints()).toBe(0);
    } finally {
      process.env.CI = prevCI;
      process.env.RUNESPACE_E2E_MINING = prevE2E;
      process.env.DATABASE_URL = prevDb;
      vi.resetModules();
    }
  });
});
