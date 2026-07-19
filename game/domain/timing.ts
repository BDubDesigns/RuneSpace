import { GAME_TICK_MS, STANDARD_OFFLINE_RESOLUTION_CAP_MS } from "@/game/config/foundations";

export function millisecondsToWholeTicks(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError("Milliseconds must be a non-negative finite number");
  }
  return Math.floor(milliseconds / GAME_TICK_MS);
}

export function ticksToMilliseconds(ticks: number): number {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError("Ticks must be a non-negative integer");
  }
  return ticks * GAME_TICK_MS;
}

/** Speed multipliers below one reduce duration and always round up to a tick. */
export function effectiveAttemptDurationTicks(baseTicks: number, speedMultiplier: number): number {
  if (!Number.isInteger(baseTicks) || baseTicks <= 0) {
    throw new RangeError("Base attempt duration must be a positive whole tick count");
  }
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new RangeError("Speed multiplier must be a positive finite number");
  }
  return Math.max(1, Math.ceil(baseTicks * speedMultiplier));
}

export function resolvableAttemptCount(elapsedTicks: number, attemptDurationTicks: number): number {
  if (!Number.isInteger(elapsedTicks) || elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  if (!Number.isInteger(attemptDurationTicks) || attemptDurationTicks <= 0) {
    throw new RangeError("Attempt duration must be a positive whole tick count");
  }
  return Math.floor(elapsedTicks / attemptDurationTicks);
}

export type ResolutionWindow = {
  elapsedTicks: number;
  resolvedThroughAt: Date;
};

/**
 * Resolve only the latest configured offline window. Advancing the durable
 * cursor past older elapsed time prevents it from ever being replayed later.
 */
export function calculateResolutionWindow(
  resolvedThroughAt: Date,
  now: Date,
  offlineCapMs: number = STANDARD_OFFLINE_RESOLUTION_CAP_MS,
): ResolutionWindow {
  if (!Number.isFinite(offlineCapMs) || offlineCapMs < 0) {
    throw new RangeError("Offline resolution cap must be a non-negative finite number");
  }

  const cappedStart = new Date(Math.max(resolvedThroughAt.getTime(), now.getTime() - offlineCapMs));
  const elapsedTicks = millisecondsToWholeTicks(Math.max(0, now.getTime() - cappedStart.getTime()));
  return {
    elapsedTicks,
    resolvedThroughAt: new Date(cappedStart.getTime() + ticksToMilliseconds(elapsedTicks)),
  };
}
