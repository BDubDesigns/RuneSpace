import type { EffectiveGameBalance } from "@/game/config/balance";
import { planStackAddition, type StackState } from "@/game/domain/inventory";

export const REFINING_STOP_REASONS = [
  "manually_stopped",
  "insufficient_ferrite_shale",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "action_replaced",
] as const;
export type RefiningStopReason = (typeof REFINING_STOP_REASONS)[number];

export type RefiningRandom = { nextBasisPoints(): number };

export function refiningSuccessChanceBps(level: number, balance: EffectiveGameBalance): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("Refining level must be positive");
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
  return stacks.reduce((total, stack) => (stack.itemId === itemId ? total + stack.quantity : total), 0);
}

type SimulatedRemoval<Id> = {
  stacksAfter: StackState<Id>[];
  slotsAvailableAfter: number;
  massAvailableAfter: number;
  canConsume: boolean;
};

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
  if (remaining > 0) return { stacksAfter: [...existingStacks.map((s) => ({ ...s }))], slotsAvailableAfter: slotsAvailable, massAvailableAfter: massAvailableGrams, canConsume: false };
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
  const shaleItemId = balance.items.ferriteShale.itemId;
  const refinedItemId = balance.items.refinedFerrite.itemId;
  const slagItemId = balance.items.slag.itemId;
  const inputQty = balance.refining.inputFerriteShale;

  const totalShale = totalQuantityForItem(snapshot.existingStacks, shaleItemId);
  if (totalShale < inputQty) return "insufficient_ferrite_shale";

  const removal = simulateRemoval(
    snapshot.existingStacks,
    snapshot.slotsAvailable,
    snapshot.massAvailableGrams,
    shaleItemId,
    inputQty,
    balance.items.ferriteShale.massGrams,
  );
  if (!removal.canConsume) return "insufficient_ferrite_shale";

  // After removing inputs, either output must fit. If either branch cannot fit, stop before rolling.
  const refinedPlan = planStackAddition(
    removal.stacksAfter,
    refinedItemId,
    1,
    balance.items.refinedFerrite.stackLimit,
    removal.slotsAvailableAfter,
    removal.massAvailableAfter,
    balance.items.refinedFerrite.massGrams,
  );
  const slagPlan = planStackAddition(
    removal.stacksAfter,
    slagItemId,
    1,
    balance.items.slag.stackLimit,
    removal.slotsAvailableAfter,
    removal.massAvailableAfter,
    balance.items.slag.massGrams,
  );
  if (refinedPlan.remainingQuantity === 0 && slagPlan.remainingQuantity === 0) return undefined;
  // Determine which constraint blocks — mass vs slots — for messaging.
  const massWouldBlock =
    removal.massAvailableAfter < balance.items.refinedFerrite.massGrams ||
    removal.massAvailableAfter < balance.items.slag.massGrams;
  // But more precise: if either plan fails due to mass, report mass.
  // We infer by checking if mass is the tighter constraint than slots.
  // If refinedPlan failed due to mass, refinedPlan.remainingQuantity tracks both; we approximate via mass check.
  // Use planStackAddition weight-limited logic: if availableWeight insufficient.
  if (massWouldBlock) {
    // Only report mass if slots would otherwise be sufficient for at least one? Keep mass priority.
    // Check if massAvailableAfter < min mass required (150). Already true.
    return "carried_mass_capacity_reached";
  }
  return "inventory_slots_full";
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
  const shaleItemId = balance.items.ferriteShale.itemId;
  const refinedItemId = balance.items.refinedFerrite.itemId;
  const slagItemId = balance.items.slag.itemId;
  const inputShale: number = balance.refining.inputFerriteShale;
  const shaleMass = balance.items.ferriteShale.massGrams;
  const refinedMass = balance.items.refinedFerrite.massGrams;
  const slagMass = balance.items.slag.massGrams;

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
      const persistedUpdates = stacks.filter((s) => s.persisted).map(({ id, quantity }) => ({ id, quantity }));
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
        createdStacks: stacks.filter((s) => !s.persisted).map(({ itemId, quantity }) => ({ itemId, quantity })),
        resolvedAttempts,
        stopReason,
      };
    }
    if (remainingTicks < durationTicks) break;
    remainingTicks -= durationTicks;
    consumedTicks += durationTicks;

    // Consume 2 shale deterministically before rolling
    {
      let remaining: number = inputShale;
      const nextStacks: WorkingStack[] = [];
      for (const stack of stacks) {
        if (stack.itemId !== shaleItemId || remaining === 0) {
          nextStacks.push(stack);
          continue;
        }
        if (stack.quantity <= remaining) {
          remaining -= stack.quantity;
          // fully consumed: if persisted, it will be counted as deleted; otherwise drop the temporary stack
          if (stack.persisted) {
            // do not push — deletion
            slotsAvailable += 1;
          } else {
            // temporary stack consumed — still frees a slot that was previously allocated as created
            slotsAvailable += 1;
          }
          massAvailableGrams += stack.quantity * shaleMass;
        } else {
          const newQuantity = stack.quantity - remaining;
          massAvailableGrams += remaining * shaleMass;
          remaining = 0;
          nextStacks.push({ ...stack, quantity: newQuantity });
        }
      }
      // The above mass accounting already added for consumed quantities. For partial consume case, remaining is 0.
      // For full consume case, we added per-stack mass. But for stacks where quantity <= remaining, we added correctly.
      // However slotsAvailable already incremented for each fully consumed stack.
      stacks = nextStacks;
      shaleConsumed += inputShale;
      // Remaining mass for partial-stack consume already handled; if remaining was >0 (should not happen due to preflight) it would be error.
      if (remaining > 0) throw new Error("Refining consumed more shale than available after preflight");
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
      if (plan.remainingQuantity !== 0) throw new Error("Refined Ferrite plan failed after preflight");
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

  const persistedUpdates = stacks.filter((s) => s.persisted).map(({ id, quantity }) => ({ id, quantity }));
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
    createdStacks: stacks.filter((s) => !s.persisted).map(({ itemId, quantity }) => ({ itemId, quantity })),
    resolvedAttempts,
  };
}
