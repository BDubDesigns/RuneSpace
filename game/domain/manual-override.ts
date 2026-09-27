import { getEffectiveGameBalance, type EffectiveGameBalance } from "@/game/config/balance";

/**
 * Manual Override — the optional push-your-luck layer on one Fabrication
 * workpiece (#232).
 *
 * Baseline Fabrication is deterministic and never fails: with Override off, a
 * workpiece is an automatic 1.00× Lock In at its timer. A player who enables
 * Override turns the current workpiece into a machine with a Load (1–10) and a
 * visible Trend (HIGHER or LOWER). Each push names a Feed; the next Load is
 * rolled strictly in the Trend's direction, and a Feed within the safe range
 * of it compounds the workpiece's XP multiplier — by more for an exact match —
 * while a miss busts the workpiece.
 *
 * Everything here is pure: the Load and Trend are rolled by the caller's
 * random source and persisted by the server, so a reload or a retried request
 * observes the same machine rather than a fresh roll. Nothing about the next
 * Load exists before the push that rolls it, so there is no hidden value for a
 * client to read and nothing for waiting to reroll.
 */

export type OverrideTrend = "higher" | "lower";

/** A uniform integer source: `nextInt(n)` returns an integer in `[0, n)`. */
export type OverrideRandom = { nextInt(exclusiveMaximum: number): number };

export type OverrideOutcome = "safe" | "exact";

/** One workpiece's machine state. Present only once Override is enabled on it. */
export type ManualOverrideState = {
  load: number;
  trend: OverrideTrend;
  /** Successful pushes whose Feed landed in the safe range but not on the Load. */
  safePushes: number;
  /** Successful pushes whose Feed was exactly the new Load. */
  exactPushes: number;
  /**
   * The multiplier is committed. Before the timer this lets the workpiece run
   * out normally; at or after it the workpiece resolves at once. Toggling
   * Override off locks at what was earned, and a fifth successful push locks
   * automatically.
   */
  locked: boolean;
  /** The last push, for the live panel: what was fed and where the Load went. */
  lastPush?: { feed: number; load: number; outcome: OverrideOutcome };
};

function uniformInclusive(random: OverrideRandom, minimum: number, maximum: number): number {
  const span = maximum - minimum + 1;
  const draw = random.nextInt(span);
  if (!Number.isInteger(draw) || draw < 0 || draw >= span) {
    throw new RangeError("Override random source returned a value outside its range");
  }
  return minimum + draw;
}

/**
 * The Trend at a Load: forced HIGHER at the machine's floor, forced LOWER at
 * its ceiling, otherwise an even coin.
 */
export function rollOverrideTrend(
  load: number,
  random: OverrideRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): OverrideTrend {
  const { loadMinimum, loadMaximum } = balance.fabrication.manualOverride;
  if (load <= loadMinimum) return "higher";
  if (load >= loadMaximum) return "lower";
  return uniformInclusive(random, 0, 1) === 0 ? "higher" : "lower";
}

/** A fresh Override workpiece: 1.00×, an initial Load from 2–9, and its Trend. */
export function startManualOverride(
  random: OverrideRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): ManualOverrideState {
  const { initialLoadMinimum, initialLoadMaximum } = balance.fabrication.manualOverride;
  const load = uniformInclusive(random, initialLoadMinimum, initialLoadMaximum);
  return {
    load,
    trend: rollOverrideTrend(load, random, balance),
    safePushes: 0,
    exactPushes: 0,
    locked: false,
  };
}

/** Every Load the next push can roll from `load` in `trend`'s direction. */
export function overrideNextLoadRange(
  load: number,
  trend: OverrideTrend,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): { minimum: number; maximum: number } {
  const { loadMinimum, loadMaximum } = balance.fabrication.manualOverride;
  return trend === "higher"
    ? { minimum: load + 1, maximum: loadMaximum }
    : { minimum: loadMinimum, maximum: load - 1 };
}

/** The Feeds that survive a newly rolled Load: ±safe range, clipped to the machine. */
export function overrideSafeRange(
  load: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): { minimum: number; maximum: number } {
  const { loadMinimum, loadMaximum, safeRange } = balance.fabrication.manualOverride;
  return {
    minimum: Math.max(loadMinimum, load - safeRange),
    maximum: Math.min(loadMaximum, load + safeRange),
  };
}

export function overridePushes(state: Pick<ManualOverrideState, "safePushes" | "exactPushes">) {
  return state.safePushes + state.exactPushes;
}

/** Whether another push is allowed on this workpiece at all. */
export function overrideCanPush(
  state: ManualOverrideState,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): boolean {
  return !state.locked && overridePushes(state) < balance.fabrication.manualOverride.maximumPushes;
}

/** How one push can go: a compounded multiplier on the machine, or a bust. */
export type OverridePushResult =
  | { kind: "success"; outcome: OverrideOutcome; state: ManualOverrideState }
  | { kind: "bust"; feed: number; load: number };

/**
 * Push the machine once with the player's Feed.
 *
 * The next Load is rolled here — not before — uniformly across every Load in
 * the Trend's direction. A Feed on it is exact (×1.30), within the safe range
 * is safe (×1.20), anything else busts the workpiece. A successful push rolls
 * the Trend at the new Load; the fifth locks in automatically.
 */
export function pushManualOverride(
  state: ManualOverrideState,
  feed: number,
  random: OverrideRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): OverridePushResult {
  const { loadMinimum, loadMaximum, maximumPushes } = balance.fabrication.manualOverride;
  if (!Number.isInteger(feed) || feed < loadMinimum || feed > loadMaximum) {
    throw new RangeError("Feed must be a whole number on the machine's dial");
  }
  if (!overrideCanPush(state, balance)) {
    throw new RangeError("This workpiece cannot be pushed again");
  }
  const range = overrideNextLoadRange(state.load, state.trend, balance);
  const load = uniformInclusive(random, range.minimum, range.maximum);
  const safe = overrideSafeRange(load, balance);
  if (feed < safe.minimum || feed > safe.maximum) return { kind: "bust", feed, load };
  const outcome: OverrideOutcome = feed === load ? "exact" : "safe";
  const safePushes = state.safePushes + (outcome === "safe" ? 1 : 0);
  const exactPushes = state.exactPushes + (outcome === "exact" ? 1 : 0);
  return {
    kind: "success",
    outcome,
    state: {
      load,
      trend: rollOverrideTrend(load, random, balance),
      safePushes,
      exactPushes,
      locked: safePushes + exactPushes >= maximumPushes,
      lastPush: { feed, load, outcome },
    },
  };
}

/**
 * The workpiece's XP for a successful resolution: base XP compounded by every
 * successful push, rounded down to a whole point. Exact integer arithmetic, so
 * five pushes of compounding can never drift.
 */
export function manualOverrideXp(
  baseXp: number,
  state: Pick<ManualOverrideState, "safePushes" | "exactPushes"> | undefined,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  if (!state) return baseXp;
  const { safePushMultiplierBps, exactPushMultiplierBps } = balance.fabrication.manualOverride;
  const numerator =
    BigInt(baseXp) *
    BigInt(safePushMultiplierBps) ** BigInt(state.safePushes) *
    BigInt(exactPushMultiplierBps) ** BigInt(state.exactPushes);
  const denominator = 10_000n ** BigInt(state.safePushes + state.exactPushes);
  return Number(numerator / denominator);
}

/** The current multiplier, for display only, to two decimal places. */
export function manualOverrideMultiplierLabel(
  state: Pick<ManualOverrideState, "safePushes" | "exactPushes"> | undefined,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): string {
  const { safePushMultiplierBps, exactPushMultiplierBps } = balance.fabrication.manualOverride;
  const value =
    (safePushMultiplierBps / 10_000) ** (state?.safePushes ?? 0) *
    (exactPushMultiplierBps / 10_000) ** (state?.exactPushes ?? 0);
  return `${value.toFixed(2)}×`;
}
