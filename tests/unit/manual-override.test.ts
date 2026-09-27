import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  manualOverrideMultiplierLabel,
  manualOverrideXp,
  overrideCanPush,
  overrideNextLoadRange,
  overrideSafeRange,
  pushManualOverride,
  rollOverrideTrend,
  startManualOverride,
  type ManualOverrideState,
  type OverrideRandom,
  type OverrideTrend,
} from "@/game/domain/manual-override";

/**
 * Manual Override (#232): the exact settled RNG, pushes, compounding, the
 * five-push auto-lock, and a check that the implementation reproduces the
 * design's own balance model.
 */

const balance = getEffectiveGameBalance();

/** A random source that replays the given draws, failing loudly if it runs dry. */
function scripted(...draws: number[]): OverrideRandom & { remaining(): number } {
  const queue = [...draws];
  return {
    nextInt: (exclusiveMaximum) => {
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted random ran out of draws");
      expect(next).toBeLessThan(exclusiveMaximum);
      return next;
    },
    remaining: () => queue.length,
  };
}

function machine(load: number, trend: OverrideTrend, pushes = 0): ManualOverrideState {
  return { load, trend, safePushes: pushes, exactPushes: 0, locked: false };
}

describe("Manual Override starting state", () => {
  it("rolls the initial Load uniformly from 2 through 9 inclusive", () => {
    const seen = new Set<number>();
    for (let draw = 0; draw < 8; draw += 1) {
      seen.add(startManualOverride(scripted(draw, 0), balance).load);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // Eight equally likely draws, one per Load: the span requested is exactly 8.
    let requestedSpan = 0;
    startManualOverride({ nextInt: (n) => ((requestedSpan ||= n), 0) }, balance);
    expect(requestedSpan).toBe(8);
  });

  it("starts at 1.00× with no pushes and unlocked", () => {
    const state = startManualOverride(scripted(3, 1), balance);
    expect(state).toEqual({
      load: 5,
      trend: "lower",
      safePushes: 0,
      exactPushes: 0,
      locked: false,
    });
    expect(manualOverrideMultiplierLabel(state)).toBe("1.00×");
    expect(manualOverrideXp(65, state)).toBe(65);
  });

  it("is an even coin for the Trend at Loads 2–9 and forced at the ends", () => {
    for (let load = 2; load <= 9; load += 1) {
      expect(rollOverrideTrend(load, scripted(0), balance)).toBe("higher");
      expect(rollOverrideTrend(load, scripted(1), balance)).toBe("lower");
    }
    // Forced: no draw is consumed at all.
    const floor = scripted();
    expect(rollOverrideTrend(1, floor, balance)).toBe("higher");
    const ceiling = scripted();
    expect(rollOverrideTrend(10, ceiling, balance)).toBe("lower");
  });
});

describe("Manual Override pushes", () => {
  it("rolls HIGHER uniformly from L+1 through 10 and LOWER from 1 through L-1", () => {
    expect(overrideNextLoadRange(4, "higher", balance)).toEqual({ minimum: 5, maximum: 10 });
    expect(overrideNextLoadRange(4, "lower", balance)).toEqual({ minimum: 1, maximum: 3 });
    expect(overrideNextLoadRange(9, "higher", balance)).toEqual({ minimum: 10, maximum: 10 });
    expect(overrideNextLoadRange(2, "lower", balance)).toEqual({ minimum: 1, maximum: 1 });
    // Every Load in the direction is reachable, and only those.
    const reached = new Set<number>();
    for (let draw = 0; draw < 6; draw += 1) {
      const result = pushManualOverride(machine(4, "higher"), 10, scripted(draw, 0), balance);
      reached.add(result.kind === "bust" ? result.load : result.state.load);
    }
    expect([...reached].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("uses the new Load ±2 as the safe range, clipped to 1–10", () => {
    expect(overrideSafeRange(5, balance)).toEqual({ minimum: 3, maximum: 7 });
    expect(overrideSafeRange(1, balance)).toEqual({ minimum: 1, maximum: 3 });
    expect(overrideSafeRange(2, balance)).toEqual({ minimum: 1, maximum: 4 });
    expect(overrideSafeRange(10, balance)).toEqual({ minimum: 8, maximum: 10 });
  });

  it("compounds ×1.20 in range, ×1.30 exactly on the Load, and busts on a miss", () => {
    // From Load 4 HIGHER, draw 2 rolls Load 7.
    const exact = pushManualOverride(machine(4, "higher"), 7, scripted(2, 0), balance);
    expect(exact).toMatchObject({ kind: "success", outcome: "exact" });
    const safe = pushManualOverride(machine(4, "higher"), 9, scripted(2, 0), balance);
    expect(safe).toMatchObject({ kind: "success", outcome: "safe" });
    const bust = pushManualOverride(machine(4, "higher"), 10, scripted(2), balance);
    expect(bust).toEqual({ kind: "bust", feed: 10, load: 7 });
    if (exact.kind !== "success" || safe.kind !== "success") throw new Error("unreachable");
    expect(exact.state).toMatchObject({ load: 7, exactPushes: 1, safePushes: 0, locked: false });
    expect(exact.state.lastPush).toEqual({ feed: 7, load: 7, outcome: "exact" });
    expect(manualOverrideMultiplierLabel(exact.state)).toBe("1.30×");
    expect(manualOverrideMultiplierLabel(safe.state)).toBe("1.20×");
    // A successful push rolls the Trend at the NEW Load.
    const toCeiling = pushManualOverride(machine(8, "higher"), 10, scripted(1), balance);
    expect(toCeiling).toMatchObject({ kind: "success", state: { load: 10, trend: "lower" } });
  });

  it("compounds XP multiplicatively and rounds the result down", () => {
    expect(manualOverrideXp(65, { safePushes: 1, exactPushes: 0 })).toBe(78);
    expect(manualOverrideXp(65, { safePushes: 0, exactPushes: 1 })).toBe(84); // 84.5
    expect(manualOverrideXp(65, { safePushes: 2, exactPushes: 0 })).toBe(93); // 93.6
    expect(manualOverrideXp(81, { safePushes: 0, exactPushes: 5 })).toBe(300); // 300.747...
    expect(manualOverrideXp(25, { safePushes: 5, exactPushes: 0 })).toBe(62); // 62.208
    expect(manualOverrideMultiplierLabel({ safePushes: 5, exactPushes: 0 })).toBe("2.49×");
    expect(manualOverrideMultiplierLabel({ safePushes: 0, exactPushes: 5 })).toBe("3.71×");
  });

  it("locks in automatically on the fifth successful push and allows no sixth", () => {
    const fourth = machine(3, "higher", 4);
    const fifth = pushManualOverride(fourth, 4, scripted(0, 0), balance);
    expect(fifth).toMatchObject({
      kind: "success",
      state: { safePushes: 4, exactPushes: 1, locked: true },
    });
    if (fifth.kind !== "success") throw new Error("unreachable");
    expect(overrideCanPush(fifth.state, balance)).toBe(false);
    expect(() => pushManualOverride(fifth.state, 4, scripted(0, 0), balance)).toThrow(RangeError);
    // A locked machine cannot be pushed either, whatever its count.
    expect(overrideCanPush({ ...machine(5, "lower"), locked: true }, balance)).toBe(false);
  });

  it("refuses a Feed off the dial", () => {
    expect(() => pushManualOverride(machine(5, "lower"), 0, scripted(0), balance)).toThrow(
      RangeError,
    );
    expect(() => pushManualOverride(machine(5, "lower"), 11, scripted(0), balance)).toThrow(
      RangeError,
    );
    expect(() => pushManualOverride(machine(5, "lower"), 2.5, scripted(0), balance)).toThrow(
      RangeError,
    );
  });
});

/**
 * The Fabrication design models this exact RNG: optimal play expects about
 * 1.339× base XP, busts about 20.2% of workpieces and averages about 2.13
 * pushes; always forcing all five pushes (with the best Feed each time) busts
 * about 62.2% and returns about 1.081×. Enumerating every outcome of the real
 * `pushManualOverride` reproduces those numbers, which is strong evidence the
 * implementation is the settled machine and not a near-miss.
 */
describe("Manual Override balance model", () => {
  /** Expected multiplier still to come, bust chance, and pushes, relative to now. */
  type Value = { expected: number; bust: number; pushes: number };

  /** Every (probability, factor, next machine) a push with `feed` produces, from the real function. */
  function outcomes(state: ManualOverrideState, feed: number) {
    const range = overrideNextLoadRange(state.load, state.trend, balance);
    const span = range.maximum - range.minimum + 1;
    const results: { probability: number; factor: number; state?: ManualOverrideState }[] = [];
    for (let draw = 0; draw < span; draw += 1) {
      const load = range.minimum + draw;
      const forced = load === 1 || load === 10;
      const first = pushManualOverride(state, feed, scripted(draw, 0), balance);
      if (first.kind === "bust") {
        results.push({ probability: 1 / span, factor: 0 });
        continue;
      }
      const factor = first.outcome === "exact" ? 1.3 : 1.2;
      for (const trendDraw of forced ? [0] : [0, 1]) {
        const result = pushManualOverride(state, feed, scripted(draw, trendDraw), balance);
        if (result.kind !== "success") throw new Error("a push cannot both succeed and bust");
        results.push({ probability: (1 / span) * (forced ? 1 : 0.5), factor, state: result.state });
      }
    }
    return results;
  }

  function solver(forceAllPushes: boolean) {
    const memo = new Map<string, Value>();
    const solve = (state: ManualOverrideState): Value => {
      const key = `${state.load}:${state.trend}:${state.safePushes + state.exactPushes}`;
      const known = memo.get(key);
      if (known) return known;
      const lock: Value = { expected: 1, bust: 0, pushes: 0 };
      let best: Value | undefined;
      if (overrideCanPush(state, balance)) {
        for (let feed = 1; feed <= 10; feed += 1) {
          const value: Value = { expected: 0, bust: 0, pushes: 1 };
          for (const outcome of outcomes(state, feed)) {
            if (!outcome.state) {
              value.bust += outcome.probability;
              continue;
            }
            const next = solve(outcome.state);
            value.expected += outcome.probability * outcome.factor * next.expected;
            value.bust += outcome.probability * next.bust;
            value.pushes += outcome.probability * next.pushes;
          }
          if (!best || value.expected > best.expected) best = value;
        }
      }
      const chosen = !best || (!forceAllPushes && lock.expected >= best.expected) ? lock : best;
      memo.set(key, chosen);
      return chosen;
    };
    return solve;
  }

  function averaged(forceAllPushes: boolean): Value {
    const solve = solver(forceAllPushes);
    const total: Value = { expected: 0, bust: 0, pushes: 0 };
    for (let load = 2; load <= 9; load += 1) {
      for (const trend of ["higher", "lower"] as const) {
        const value = solve(machine(load, trend));
        total.expected += value.expected / 16;
        total.bust += value.bust / 16;
        total.pushes += value.pushes / 16;
      }
    }
    return total;
  }

  it("reproduces the optimal-play figures", () => {
    const optimal = averaged(false);
    expect(optimal.expected).toBeCloseTo(1.339, 3);
    expect(optimal.bust).toBeCloseTo(0.202, 3);
    expect(optimal.pushes).toBeCloseTo(2.13, 2);
  });

  it("reproduces the always-push-five figures", () => {
    const reckless = averaged(true);
    expect(reckless.expected).toBeCloseTo(1.081, 3);
    expect(reckless.bust).toBeCloseTo(0.622, 3);
  });
});
