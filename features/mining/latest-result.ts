import type { MiningRunAttempt } from "@/server/mining";

export function latestMiningAttempt(
  attempts: readonly MiningRunAttempt[],
): MiningRunAttempt | undefined {
  return attempts.at(-1);
}

export function resolvedAttemptCount(previousAttempts: number, currentAttempts: number): number {
  return Math.max(0, currentAttempts - previousAttempts);
}
