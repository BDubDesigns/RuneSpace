import { getItemDefinition } from "@/game/config/balance";
import type { MiningRunAttempt } from "@/server/mining";

export function latestMiningAttempt(
  attempts: readonly MiningRunAttempt[],
): MiningRunAttempt | undefined {
  return attempts.at(-1);
}

/** One visible reward on a successful attempt's result (#308). */
export type MiningRewardCard =
  | {
      kind: "item";
      key: string;
      itemId: string;
      /** What THIS attempt awarded — not any persisted stack's quantity. */
      quantity: number;
      /** True for a Secondary Find: the attempt "found" it rather than "earned" it. */
      found: boolean;
      /** The item's canonical stack limit when it stacks; the fill is quantity / this. */
      stackLimit: number | undefined;
    }
  | { kind: "xp"; key: string; amount: number };

/**
 * The reward cards a resolved attempt actually has, in their semantic order:
 * the source's own ore, then each Secondary Find in resolved order, then the
 * attempt's combined Mining XP last. It maps over whatever exists — nothing
 * here knows how many finds today's content can award — and a failed attempt
 * has none.
 */
export function miningRewardCards(
  attempt: Pick<MiningRunAttempt, "success" | "itemId" | "quantityAwarded" | "secondaryFinds"> & {
    xpAwarded: number;
  },
): readonly MiningRewardCard[] {
  if (!attempt.success) return [];
  return [
    ...(attempt.quantityAwarded > 0
      ? [
          {
            kind: "item" as const,
            key: `primary-${attempt.itemId}`,
            itemId: attempt.itemId,
            quantity: attempt.quantityAwarded,
            found: false,
            stackLimit: stackLimitOf(attempt.itemId),
          },
        ]
      : []),
    ...attempt.secondaryFinds.map((find, index) => ({
      kind: "item" as const,
      key: `find-${index}-${find.itemId}`,
      itemId: find.itemId,
      quantity: find.quantity,
      found: true,
      stackLimit: stackLimitOf(find.itemId),
    })),
    ...(attempt.xpAwarded > 0
      ? [{ kind: "xp" as const, key: "xp", amount: attempt.xpAwarded }]
      : []),
  ];
}

/** The canonical stack limit of an item that stacks (the one home: its definition). */
function stackLimitOf(itemId: string): number | undefined {
  const definition = getItemDefinition(itemId);
  return definition?.kind === "stack" ? definition.stackLimit : undefined;
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

/**
 * "3 / 10 remaining" against the equipped Mining tool's own maximum (#233).
 * With no tool equipped there is no maximum to name, so only what remains is.
 */
export function remainingChargeLabel(
  remainingCharge: number,
  maximumCharge: number | undefined,
): string {
  return maximumCharge === undefined
    ? `${remainingCharge} remaining`
    : `${remainingCharge} / ${maximumCharge} remaining`;
}
