import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  getScavengeOutcome,
  SCAVENGE_OUTCOMES,
  SCAVENGE_TOTAL_WEIGHT_BPS,
  scavengeAwardBranches,
  type ScavengeOutcome,
  type ScavengeOutcomeId,
} from "@/game/content/scavenge";
import { GAME_TICK_MS } from "@/game/config/foundations";
import type { PossibleAward } from "@/game/domain/inventory";

export type ScavengeLifecycle = "waiting" | "available" | "missed" | "claimed";

export function scavengeOpportunityStartTick(nextBasisPoints: number): number {
  if (
    !Number.isInteger(nextBasisPoints) ||
    nextBasisPoints < 0 ||
    nextBasisPoints >= SCAVENGE_TOTAL_WEIGHT_BPS
  ) {
    throw new RangeError("Scavenge randomness must be an integer basis-point roll");
  }
  const { opportunityStartMinTick, opportunityStartMaxTick } =
    getEffectiveGameBalance().travel.scavenge;
  return (
    opportunityStartMinTick +
    (nextBasisPoints % (opportunityStartMaxTick - opportunityStartMinTick + 1))
  );
}

export function scavengeWindowAt(input: {
  travelStartedAt: Date;
  opportunityStartTick: number;
  now: Date;
  claimed: boolean;
}): {
  lifecycle: ScavengeLifecycle;
  opensAt: Date;
  expiresAt: Date;
} {
  const balance = getEffectiveGameBalance();
  const { opportunityStartMinTick, opportunityStartMaxTick, opportunityWindowTicks } =
    balance.travel.scavenge;
  if (
    !Number.isInteger(input.opportunityStartTick) ||
    input.opportunityStartTick < opportunityStartMinTick ||
    input.opportunityStartTick > opportunityStartMaxTick
  ) {
    throw new RangeError("Scavenge opportunity start tick is outside the approved range");
  }
  const opensAt = new Date(
    input.travelStartedAt.getTime() + input.opportunityStartTick * GAME_TICK_MS,
  );
  const expiresAt = new Date(opensAt.getTime() + opportunityWindowTicks * GAME_TICK_MS);
  const lifecycle: ScavengeLifecycle = input.claimed
    ? "claimed"
    : input.now.getTime() < opensAt.getTime()
      ? "waiting"
      : input.now.getTime() < expiresAt.getTime()
        ? "available"
        : "missed";
  return { lifecycle, opensAt, expiresAt };
}

export function resolveScavengeOutcome(nextBasisPoints: number): ScavengeOutcome {
  if (
    !Number.isInteger(nextBasisPoints) ||
    nextBasisPoints < 0 ||
    nextBasisPoints >= SCAVENGE_TOTAL_WEIGHT_BPS
  ) {
    throw new RangeError("Scavenge randomness must be an integer basis-point roll");
  }
  let cumulative = 0;
  for (const outcome of SCAVENGE_OUTCOMES) {
    cumulative += outcome.weightBps;
    if (nextBasisPoints < cumulative) return outcome;
  }
  throw new Error("Scavenge table does not cover the full basis-point range");
}

export function resolvedScavengeOutcome(input: {
  outcomeId: string;
  quantity: number;
}): ScavengeOutcome & { quantity: number; outcomeId: ScavengeOutcomeId } {
  const outcome = getScavengeOutcome(input.outcomeId);
  if (!outcome || outcome.quantity !== input.quantity) {
    throw new Error("Persisted Scavenge outcome is invalid");
  }
  return { ...outcome, outcomeId: outcome.id };
}

/** Capacity facts for the universal v1 award branches, kept out of handlers/UI. */
export function scavengeAwardCapacitySpec(
  itemId: string,
  quantity: number,
  balance = getEffectiveGameBalance(),
): PossibleAward {
  if (itemId === balance.items.ferriteShale.itemId) {
    return {
      itemId: balance.items.ferriteShale.itemId,
      quantity,
      stackLimit: balance.items.ferriteShale.stackLimit,
      itemWeight: balance.items.ferriteShale.massGrams,
    };
  }
  if (itemId === balance.items.powerCell.itemId) {
    return {
      itemId: balance.items.powerCell.itemId,
      quantity,
      stackLimit: balance.items.powerCell.stackLimit,
      itemWeight: balance.items.powerCell.massGrams,
    };
  }
  if (itemId === balance.items.refinedFerrite.itemId) {
    return {
      itemId: balance.items.refinedFerrite.itemId,
      quantity,
      stackLimit: balance.items.refinedFerrite.stackLimit,
      itemWeight: balance.items.refinedFerrite.massGrams,
    };
  }
  throw new Error(`Scavenge table references an unsupported item: ${itemId}`);
}

export function scavengePossibleAwardSpecs(
  balance = getEffectiveGameBalance(),
): readonly PossibleAward[] {
  return scavengeAwardBranches().map((outcome) =>
    scavengeAwardCapacitySpec(outcome.itemId!, outcome.quantity, balance),
  );
}
