import type { MiningRunAttempt } from "@/server/mining";

export function latestMiningAttempt(
  attempts: readonly MiningRunAttempt[],
): MiningRunAttempt | undefined {
  return attempts.at(-1);
}

export function resolvedAttemptCount(previousAttempts: number, currentAttempts: number): number {
  return Math.max(0, currentAttempts - previousAttempts);
}

/**
 * Whether a persisted Mining run is a run at *this* source (#211 review).
 *
 * A run deliberately survives stopping and travel, resetting only when a
 * genuinely new Mining action starts — so after walking up from Deep Jag the
 * Galvanite run is still the persisted one while The Jag is offering Ferrite
 * Shale. That is correct persistence and wrong presentation: the totals and
 * the latest attempt sit under a panel that now names a different ore, and
 * read as though they belong to it.
 *
 * The run says what it worked on: its totals are keyed by item, and every
 * attempt records the item its source awards. An untouched run has neither and
 * belongs to nobody, so it reads as this source's empty run.
 */
export function runBelongsToSource(
  run: {
    itemsGained: Readonly<Record<string, number>>;
    recentAttempts: readonly MiningRunAttempt[];
  },
  sourceItemId: string,
): boolean {
  const workedItemIds = new Set<string>([
    ...Object.keys(run.itemsGained),
    ...run.recentAttempts.map((attempt) => attempt.itemId),
  ]);
  return workedItemIds.size === 0 || workedItemIds.has(sourceItemId);
}
