import type { EffectiveGameBalance } from "@/game/config/balance";
import {
  planPossibleAwardAdditions,
  planStackAddition,
  type StackState,
} from "@/game/domain/inventory";

export const REFINING_STOP_REASONS = [
  "manually_stopped",
  "insufficient_ferrite_shale",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "action_replaced",
] as const;
export type RefiningStopReason = (typeof REFINING_STOP_REASONS)[number];

export type RefiningRandom = { nextBasisPoints(): number };

/**
 * The authoritative award facts for Refining: the input it consumes and the
 * two possible outputs one attempt can produce, authored success-output-first
 * (Refined Ferrite on success, Slag on failure). The resolver and quest-guidance
 * recommendation validation both read THIS function, so what Refining
 * authoritatively consumes/produces has exactly one home — changing the
 * resolver's award cannot leave guidance validation stale.
 */
export function refiningAwardFacts(balance: EffectiveGameBalance) {
  return {
    inputItemId: balance.items.ferriteShale.itemId,
    inputQuantity: balance.refining.inputFerriteShale,
    inputMassGrams: balance.items.ferriteShale.massGrams,
    outputs: [
      {
        itemId: balance.items.refinedFerrite.itemId,
        stackLimit: balance.items.refinedFerrite.stackLimit,
        massGrams: balance.items.refinedFerrite.massGrams,
      },
      {
        itemId: balance.items.slag.itemId,
        stackLimit: balance.items.slag.stackLimit,
        massGrams: balance.items.slag.massGrams,
      },
    ],
  } as const;
}

export function refiningSuccessChanceBps(level: number, balance: EffectiveGameBalance): number {
  if (!Number.isInteger(level) || level < 1)
    throw new RangeError("Refining level must be positive");
  const refining = balance.refining;
  return Math.min(
    10_000,
    refining.successAtLevelOneBps +
      Math.floor(
        ((Math.min(level, refining.guaranteedSuccessLevel) - 1) * refining.successRangeBps) /
          (refining.guaranteedSuccessLevel - 1),
      ),
  );
}

export type RefiningSnapshot<Id = string> = {
  refiningLevel: number;
  existingStacks: readonly StackState<Id>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

export type RefiningResolvedAttempt = {
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  ferriteAwarded: number;
  slagAwarded: number;
  shaleConsumed: number;
  xpAwarded: number;
  durationTicks: number;
};

export type RefiningResolution<Id = string> = {
  consumedTicks: number;
  attempts: number;
  successes: number;
  failures: number;
  shaleConsumed: number;
  ferriteGained: number;
  slagGained: number;
  awardedXp: number;
  stackUpdates: readonly { id: Id; quantity: number }[];
  /** Stacks whose quantity dropped to zero and must be deleted. */
  deletedStackIds: readonly Id[];
  createdStacks: readonly { itemId: string; quantity: number }[];
  resolvedAttempts: readonly RefiningResolvedAttempt[];
  stopReason?: RefiningStopReason;
};

function totalQuantityForItem<Id>(stacks: readonly StackState<Id>[], itemId: string): number {
  return stacks.reduce(
    (total, stack) => (stack.itemId === itemId ? total + stack.quantity : total),
    0,
  );
}

type SimulatedRemoval<Id> = {
  stacksAfter: StackState<Id>[];
  slotsAvailableAfter: number;
  massAvailableAfter: number;
  canConsume: boolean;
};

type ShaleRemovalDetail<Id> = {
  simulated: SimulatedRemoval<Id>;
  consumedStackIds: Id[];
  partiallyReducedStack?: { id: Id; remainingQuantity: number };
};

/**
 * Deterministic shale removal plan reused by preflight and authoritative consumption.
 * When a slot must be freed for the output, prefer exhausting the smallest shale
 * stack so fragmentation order does not decide feasibility.
 */
function planShaleRemoval<Id>(
  existingStacks: readonly StackState<Id>[],
  slotsAvailable: number,
  massAvailableGrams: number,
  shaleItemId: string,
  quantityToConsume: number,
  massPerUnit: number,
): ShaleRemovalDetail<Id> | undefined {
  const shaleStacks = existingStacks.filter((s) => s.itemId === shaleItemId);
  const total = shaleStacks.reduce((sum, s) => sum + s.quantity, 0);
  if (total < quantityToConsume) return undefined;

  const otherStacks = existingStacks.filter((s) => s.itemId !== shaleItemId);

  // Two orderings: original input order, and capacity-aware (smallest first)
  const orderings: Array<readonly StackState<Id>[]> = [
    [...shaleStacks],
    [...shaleStacks].sort(
      (a, b) => a.quantity - b.quantity || String(a.id).localeCompare(String(b.id)),
    ),
  ];

  const candidates: ShaleRemovalDetail<Id>[] = [];
  for (const ordering of orderings) {
    let remaining = quantityToConsume;
    const kept: StackState<Id>[] = [];
    const consumedIds: Id[] = [];
    let partiallyReduced: { id: Id; remainingQuantity: number } | undefined;
    let freedSlots = 0;
    for (const stack of ordering) {
      if (remaining === 0) {
        kept.push({ ...stack });
        continue;
      }
      if (stack.quantity <= remaining) {
        remaining -= stack.quantity;
        consumedIds.push(stack.id);
        freedSlots += 1;
      } else {
        const remainingQty = stack.quantity - remaining;
        kept.push({ ...stack, quantity: remainingQty });
        partiallyReduced = { id: stack.id, remainingQuantity: remainingQty };
        remaining = 0;
      }
    }
    if (remaining !== 0) continue;
    const stacksAfter: StackState<Id>[] = [...otherStacks.map((s) => ({ ...s })), ...kept];
    candidates.push({
      simulated: {
        stacksAfter,
        slotsAvailableAfter: slotsAvailable + freedSlots,
        massAvailableAfter: massAvailableGrams + quantityToConsume * massPerUnit,
        canConsume: true,
      },
      consumedStackIds: consumedIds,
      partiallyReducedStack: partiallyReduced,
    });
  }

  if (!candidates.length) return undefined;
  // Prefer the plan that frees a slot; if both or neither do, prefer deterministic sorted order
  const freeing = candidates.filter((c) => c.simulated.slotsAvailableAfter > slotsAvailable);
  if (freeing.length === 1) return freeing[0];
  if (freeing.length === 2) {
    // Both free a slot — prefer the sorted (second) one for determinism
    return candidates[1];
  }
  // Neither frees a slot — return the sorted plan for determinism
  return candidates[1] ?? candidates[0];
}

function simulateRemoval<Id>(
  existingStacks: readonly StackState<Id>[],
  slotsAvailable: number,
  massAvailableGrams: number,
  itemId: string,
  quantityToConsume: number,
  massPerUnit: number,
): SimulatedRemoval<Id> {
  let remaining = quantityToConsume;
  const next: StackState<Id>[] = [];
  let freedSlots = 0;
  for (const stack of existingStacks) {
    if (stack.itemId !== itemId || remaining === 0) {
      next.push({ ...stack });
      continue;
    }
    if (stack.quantity <= remaining) {
      remaining -= stack.quantity;
      freedSlots += 1;
      // fully consumed — do not push
    } else {
      next.push({ ...stack, quantity: stack.quantity - remaining });
      remaining = 0;
    }
  }
  if (remaining > 0)
    return {
      stacksAfter: [...existingStacks.map((s) => ({ ...s }))],
      slotsAvailableAfter: slotsAvailable,
      massAvailableAfter: massAvailableGrams,
      canConsume: false,
    };
  return {
    stacksAfter: next,
    slotsAvailableAfter: slotsAvailable + freedSlots,
    massAvailableAfter: massAvailableGrams + quantityToConsume * massPerUnit,
    canConsume: true,
  };
}

/** Shared preflight for starting and resolving a Refining attempt. */
export function refiningPreflightStopReason<Id>(
  snapshot: RefiningSnapshot<Id>,
  balance: EffectiveGameBalance,
): RefiningStopReason | undefined {
  const award = refiningAwardFacts(balance);
  const shaleItemId = award.inputItemId;
  const inputQty = award.inputQuantity;

  const totalShale = totalQuantityForItem(snapshot.existingStacks, shaleItemId);
  if (totalShale < inputQty) return "insufficient_ferrite_shale";

  const plan = planShaleRemoval(
    snapshot.existingStacks,
    snapshot.slotsAvailable,
    snapshot.massAvailableGrams,
    shaleItemId,
    inputQty,
    award.inputMassGrams,
  );
  if (!plan) return "insufficient_ferrite_shale";
  const removal = plan.simulated;

  // After removing inputs, every mutually exclusive output branch must fit
  // independently before the success roll is requested.
  const possibleAwards = planPossibleAwardAdditions(
    removal.stacksAfter,
    award.outputs.map((output) => ({
      itemId: output.itemId,
      quantity: 1,
      stackLimit: output.stackLimit,
      itemWeight: output.massGrams,
    })),
    removal.slotsAvailableAfter,
    removal.massAvailableAfter,
  );
  if (possibleAwards.ok) return undefined;
  return possibleAwards.reason === "mass"
    ? "carried_mass_capacity_reached"
    : "inventory_slots_full";
}

export function resolveRefining<Id>(input: {
  elapsedTicks: number;
  snapshot: RefiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  random: RefiningRandom;
}): RefiningResolution<Id> {
  const { balance, snapshot, random } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0)
    throw new RangeError("Elapsed ticks must be a non-negative integer");

  const durationTicks = balance.refining.attemptDurationTicks;
  // Award facts live in refiningAwardFacts; the resolver consumes them. The
  // outputs are authored success-output-first (Refined Ferrite on success,
  // Slag on failure).
  const award = refiningAwardFacts(balance);
  const shaleItemId = award.inputItemId;
  const inputShale: number = award.inputQuantity;
  const shaleMass = award.inputMassGrams;
  const [refinedOutput, slagOutput] = award.outputs;
  const refinedItemId = refinedOutput.itemId;
  const slagItemId = slagOutput.itemId;
  const refinedMass = refinedOutput.massGrams;
  const slagMass = slagOutput.massGrams;

  const initialStop = refiningPreflightStopReason(snapshot, balance);
  if (initialStop) {
    return {
      consumedTicks: 0,
      attempts: 0,
      successes: 0,
      failures: 0,
      shaleConsumed: 0,
      ferriteGained: 0,
      slagGained: 0,
      awardedXp: 0,
      stackUpdates: [],
      deletedStackIds: [],
      createdStacks: [],
      resolvedAttempts: [],
      stopReason: initialStop,
    };
  }

  // Mutable working state: track persisted flag for diffing.
  type WorkingStack = StackState<Id> & { persisted: boolean };
  let stacks: WorkingStack[] = snapshot.existingStacks.map((s) => ({ ...s, persisted: true }));
  let slotsAvailable = snapshot.slotsAvailable;
  let massAvailableGrams = snapshot.massAvailableGrams;
  let consumedTicks = 0;
  let remainingTicks = input.elapsedTicks;
  let successes = 0;
  let failures = 0;
  let shaleConsumed = 0;
  let ferriteGained = 0;
  let slagGained = 0;
  const resolvedAttempts: RefiningResolvedAttempt[] = [];
  const thresholdBasisPoints = refiningSuccessChanceBps(snapshot.refiningLevel, balance);

  while (true) {
    const currentSnapshot: RefiningSnapshot<Id> = {
      refiningLevel: snapshot.refiningLevel,
      existingStacks: stacks,
      slotsAvailable,
      massAvailableGrams,
    };
    const stopReason = refiningPreflightStopReason(currentSnapshot, balance);
    if (stopReason) {
      const persistedUpdates = stacks
        .filter((s) => s.persisted)
        .map(({ id, quantity }) => ({ id, quantity }));
      // Identify deleted persisted stacks: those that were in snapshot but no longer present.
      const snapshotIds = new Set(snapshot.existingStacks.map((s) => String(s.id)));
      const remainingIds = new Set(stacks.filter((s) => s.persisted).map((s) => String(s.id)));
      // Also persisted stacks that were removed entirely are deletions.
      // To get accurate deleted IDs, compare original IDs not present in current stacks.
      const deletedStackIds: Id[] = snapshot.existingStacks
        .filter((s) => !remainingIds.has(String(s.id)))
        .map((s) => s.id);
      // But also stacks that were persisted and now filtered? Already covered.
      // Filter snapshotIds vs remaining.
      void snapshotIds;
      return {
        consumedTicks,
        attempts: successes + failures,
        successes,
        failures,
        shaleConsumed,
        ferriteGained,
        slagGained,
        awardedXp: successes * balance.refining.successXp + failures * balance.refining.failureXp,
        stackUpdates: persistedUpdates,
        deletedStackIds,
        createdStacks: stacks
          .filter((s) => !s.persisted)
          .map(({ itemId, quantity }) => ({ itemId, quantity })),
        resolvedAttempts,
        stopReason,
      };
    }
    if (remainingTicks < durationTicks) break;
    remainingTicks -= durationTicks;
    consumedTicks += durationTicks;

    // Consume 2 shale via deterministic plan (must match preflight's planShaleRemoval)
    {
      const detail = planShaleRemoval(
        stacks,
        slotsAvailable,
        massAvailableGrams,
        shaleItemId,
        inputShale,
        shaleMass,
      );
      if (!detail) throw new Error("Refining consumed more shale than available after preflight");
      const { consumedStackIds, partiallyReducedStack } = detail;
      const nextStacks: WorkingStack[] = [];
      const consumedSet = new Set(consumedStackIds.map(String));
      for (const stack of stacks) {
        if (consumedSet.has(String(stack.id))) {
          slotsAvailable += 1;
          continue;
        }
        if (partiallyReducedStack && String(stack.id) === String(partiallyReducedStack.id)) {
          nextStacks.push({ ...stack, quantity: partiallyReducedStack.remainingQuantity });
          continue;
        }
        nextStacks.push(stack);
      }
      massAvailableGrams += inputShale * shaleMass;
      stacks = nextStacks;
      shaleConsumed += inputShale;
    }

    const rolledBasisPoints = random.nextBasisPoints();
    const success = rolledBasisPoints < thresholdBasisPoints;
    if (success) {
      const plan = planStackAddition(
        stacks,
        refinedItemId,
        1,
        balance.items.refinedFerrite.stackLimit,
        slotsAvailable,
        massAvailableGrams,
        refinedMass,
      );
      if (plan.remainingQuantity !== 0)
        throw new Error("Refined Ferrite plan failed after preflight");
      for (const update of plan.updatedStacks) {
        const stack = stacks.find((candidate) => String(candidate.id) === String(update.id));
        if (stack) stack.quantity = update.quantity;
      }
      for (const created of plan.createdStacks) {
        stacks.push({
          id: `refining-temp-${resolvedAttempts.length}-${stacks.length}-${created.itemId}` as unknown as Id,
          ...created,
          persisted: false,
        });
      }
      slotsAvailable -= plan.createdStacks.length;
      massAvailableGrams -= refinedMass;
      successes += 1;
      ferriteGained += 1;
      resolvedAttempts.push({
        success: true,
        rolledBasisPoints,
        thresholdBasisPoints,
        ferriteAwarded: 1,
        slagAwarded: 0,
        shaleConsumed: inputShale,
        xpAwarded: balance.refining.successXp,
        durationTicks,
      });
    } else {
      const plan = planStackAddition(
        stacks,
        slagItemId,
        1,
        balance.items.slag.stackLimit,
        slotsAvailable,
        massAvailableGrams,
        slagMass,
      );
      if (plan.remainingQuantity !== 0) throw new Error("Slag plan failed after preflight");
      for (const update of plan.updatedStacks) {
        const stack = stacks.find((candidate) => String(candidate.id) === String(update.id));
        if (stack) stack.quantity = update.quantity;
      }
      for (const created of plan.createdStacks) {
        stacks.push({
          id: `refining-temp-${resolvedAttempts.length}-${stacks.length}-${created.itemId}` as unknown as Id,
          ...created,
          persisted: false,
        });
      }
      slotsAvailable -= plan.createdStacks.length;
      massAvailableGrams -= slagMass;
      failures += 1;
      slagGained += 1;
      resolvedAttempts.push({
        success: false,
        rolledBasisPoints,
        thresholdBasisPoints,
        ferriteAwarded: 0,
        slagAwarded: 1,
        shaleConsumed: inputShale,
        xpAwarded: balance.refining.failureXp,
        durationTicks,
      });
    }
  }

  const persistedUpdates = stacks
    .filter((s) => s.persisted)
    .map(({ id, quantity }) => ({ id, quantity }));
  const deletedStackIds: Id[] = snapshot.existingStacks
    .filter((s) => !stacks.some((candidate) => String(candidate.id) === String(s.id)))
    .map((s) => s.id);

  return {
    consumedTicks,
    attempts: successes + failures,
    successes,
    failures,
    shaleConsumed,
    ferriteGained,
    slagGained,
    awardedXp: successes * balance.refining.successXp + failures * balance.refining.failureXp,
    stackUpdates: persistedUpdates,
    deletedStackIds,
    createdStacks: stacks
      .filter((s) => !s.persisted)
      .map(({ itemId, quantity }) => ({ itemId, quantity })),
    resolvedAttempts,
  };
}
