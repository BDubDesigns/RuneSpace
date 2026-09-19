import type { EffectiveGameBalance, RefiningRecipeBalance } from "@/game/config/balance";
import {
  planPossibleAwardAdditions,
  planStackAddition,
  type StackState,
} from "@/game/domain/inventory";

export const REFINING_STOP_REASONS = [
  "manually_stopped",
  /**
   * Generalized from the original `insufficient_ferrite_shale` (#209). A recipe
   * now authors its own inputs, so the reason names the situation and the
   * surface names the actual missing material from the recipe.
   */
  "insufficient_inputs",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "action_replaced",
] as const;
export type RefiningStopReason = (typeof REFINING_STOP_REASONS)[number];

/**
 * `nextBasisPoints` decides success. `nextUnit` is consulted only by a recipe
 * whose failure hands one input back, to choose which one — it is never rolled
 * for a recipe with fixed failure outputs, so the shipped Refined Ferrite
 * recipe's random stream is byte-for-byte what it was.
 */
export type RefiningRandom = { nextBasisPoints(): number; nextUnit?: () => number };

export type RefiningItemQuantity = { itemId: string; quantity: number };

/** The storage facts for one item, read from the authoritative item registry. */
function stackFacts(balance: EffectiveGameBalance, itemId: string) {
  const item = Object.values(balance.items).find((candidate) => candidate.itemId === itemId);
  if (!item || !("stackLimit" in item)) {
    throw new Error(`Refining references unstackable or unknown item "${itemId}"`);
  }
  return { itemId, stackLimit: item.stackLimit, massGrams: item.massGrams };
}

/**
 * The authoritative facts for one Refining recipe: what it consumes, what a
 * success produces, and every mutually exclusive thing a failure can produce.
 * The resolver, the preflight, and mission-guidance recommendation validation
 * all read THIS function, so a recipe's inputs and outputs have exactly one
 * home.
 *
 * `failureOutcomes` is a list of mutually exclusive branches, each itself a
 * list of simultaneous awards. A fixed-output failure has one branch (Slag);
 * a one-input-returned failure has one branch per input, because exactly one
 * of them comes back.
 */
export function refiningAwardFacts(
  balance: EffectiveGameBalance,
  recipe: RefiningRecipeBalance,
) {
  const inputs = recipe.inputs.map((input) => ({
    ...stackFacts(balance, input.itemId),
    quantity: input.quantity,
  }));
  const successOutputs = [
    { ...stackFacts(balance, recipe.outputItemId), quantity: recipe.outputQuantity },
  ];
  const failureOutcomes =
    recipe.failure.kind === "fixed_outputs"
      ? [
          recipe.failure.outputs.map((output) => ({
            ...stackFacts(balance, output.itemId),
            quantity: output.quantity,
          })),
        ]
      : recipe.inputs.map((input) => [{ ...stackFacts(balance, input.itemId), quantity: 1 }]);
  return { inputs, successOutputs, failureOutcomes } as const;
}

/**
 * The success chance for one recipe at one Refining level, on the shared
 * whole-basis-point interpolation model.
 */
export function refiningSuccessChanceBps(
  level: number,
  recipe: RefiningRecipeBalance,
): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("Refining level must be positive");
  return Math.min(
    10_000,
    recipe.successAtLevelOneBps +
      Math.floor(
        ((Math.min(level, recipe.guaranteedSuccessLevel) - 1) * recipe.successRangeBps) /
          (recipe.guaranteedSuccessLevel - 1),
      ),
  );
}

/** Whether a character's Refining level authorizes this recipe at all. */
export function refiningRecipeUnlocked(level: number, recipe: RefiningRecipeBalance): boolean {
  return level >= recipe.minimumLevel;
}

export type RefiningSnapshot<Id = string> = {
  refiningLevel: number;
  existingStacks: readonly StackState<Id>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

/**
 * One resolved attempt. The original Ferrite-specific `ferriteAwarded` /
 * `slagAwarded` / `shaleConsumed` fields became generic lists (#209), because
 * a Galvaferrite failure returns an input rather than producing Slag and no
 * fixed trio of counters could describe that.
 */
export type RefiningResolvedAttempt = {
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  consumed: readonly RefiningItemQuantity[];
  awarded: readonly RefiningItemQuantity[];
  xpAwarded: number;
  durationTicks: number;
};

export type RefiningResolution<Id = string> = {
  consumedTicks: number;
  attempts: number;
  successes: number;
  failures: number;
  /** Totals for this resolution window, keyed by item ID. */
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
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

type WorkingStack<Id> = StackState<Id> & { persisted: boolean };

type RemovalPlan<Id> = {
  stacksAfter: WorkingStack<Id>[];
  slotsAvailableAfter: number;
  massAvailableAfter: number;
};

/**
 * Deterministic removal plan for ONE input item, reused by preflight and by
 * authoritative consumption so the two can never disagree.
 *
 * When a slot must be freed for the output, prefer exhausting the smallest
 * stack so fragmentation order does not decide feasibility. This is the
 * shipped Ferrite Shale behaviour, unchanged — it simply takes the item as a
 * parameter now.
 */
function planItemRemoval<Id>(
  stacks: readonly WorkingStack<Id>[],
  slotsAvailable: number,
  massAvailableGrams: number,
  itemId: string,
  quantityToConsume: number,
  massPerUnit: number,
): RemovalPlan<Id> | undefined {
  const matching = stacks.filter((stack) => stack.itemId === itemId);
  const total = matching.reduce((sum, stack) => sum + stack.quantity, 0);
  if (total < quantityToConsume) return undefined;

  const others = stacks.filter((stack) => stack.itemId !== itemId);
  const orderings: Array<readonly WorkingStack<Id>[]> = [
    [...matching],
    [...matching].sort(
      (a, b) => a.quantity - b.quantity || String(a.id).localeCompare(String(b.id)),
    ),
  ];

  const candidates: RemovalPlan<Id>[] = [];
  for (const ordering of orderings) {
    let remaining = quantityToConsume;
    const kept: WorkingStack<Id>[] = [];
    let freedSlots = 0;
    for (const stack of ordering) {
      if (remaining === 0) {
        kept.push({ ...stack });
        continue;
      }
      if (stack.quantity <= remaining) {
        remaining -= stack.quantity;
        freedSlots += 1;
      } else {
        kept.push({ ...stack, quantity: stack.quantity - remaining });
        remaining = 0;
      }
    }
    if (remaining !== 0) continue;
    candidates.push({
      stacksAfter: [...others.map((stack) => ({ ...stack })), ...kept],
      slotsAvailableAfter: slotsAvailable + freedSlots,
      massAvailableAfter: massAvailableGrams + quantityToConsume * massPerUnit,
    });
  }

  if (!candidates.length) return undefined;
  const freeing = candidates.filter((plan) => plan.slotsAvailableAfter > slotsAvailable);
  if (freeing.length === 1) return freeing[0];
  // Both free a slot, or neither does — prefer the sorted plan for determinism.
  return candidates[1] ?? candidates[0];
}

/** Remove every authored input of a recipe, in authored order. */
function planRecipeInputRemoval<Id>(
  stacks: readonly WorkingStack<Id>[],
  slotsAvailable: number,
  massAvailableGrams: number,
  inputs: readonly { itemId: string; quantity: number; massGrams: number }[],
): RemovalPlan<Id> | undefined {
  let current: RemovalPlan<Id> = {
    stacksAfter: stacks.map((stack) => ({ ...stack })),
    slotsAvailableAfter: slotsAvailable,
    massAvailableAfter: massAvailableGrams,
  };
  for (const input of inputs) {
    const next = planItemRemoval(
      current.stacksAfter,
      current.slotsAvailableAfter,
      current.massAvailableAfter,
      input.itemId,
      input.quantity,
      input.massGrams,
    );
    if (!next) return undefined;
    current = next;
  }
  return current;
}

/** Shared preflight for starting and resolving a Refining attempt. */
export function refiningPreflightStopReason<Id>(
  snapshot: RefiningSnapshot<Id>,
  balance: EffectiveGameBalance,
  recipe: RefiningRecipeBalance,
): RefiningStopReason | undefined {
  const award = refiningAwardFacts(balance, recipe);

  for (const input of award.inputs) {
    if (totalQuantityForItem(snapshot.existingStacks, input.itemId) < input.quantity) {
      return "insufficient_inputs";
    }
  }

  const working: WorkingStack<Id>[] = snapshot.existingStacks.map((stack) => ({
    ...stack,
    persisted: true,
  }));
  const removal = planRecipeInputRemoval(
    working,
    snapshot.slotsAvailable,
    snapshot.massAvailableGrams,
    award.inputs,
  );
  if (!removal) return "insufficient_inputs";

  // After removing inputs, every mutually exclusive outcome must fit
  // independently before the success roll is requested. A branch that awards
  // several items at once must fit all of them together.
  let slotsShortfall = false;
  for (const outcome of [award.successOutputs, ...award.failureOutcomes]) {
    const possible = planPossibleAwardAdditions(
      removal.stacksAfter,
      [
        outcome.map((output) => ({
          itemId: output.itemId,
          quantity: output.quantity,
          stackLimit: output.stackLimit,
          itemWeight: output.massGrams,
        })),
      ].flat(),
      removal.slotsAvailableAfter,
      removal.massAvailableAfter,
    );
    if (!possible.ok) {
      if (possible.reason === "mass") return "carried_mass_capacity_reached";
      slotsShortfall = true;
    }
  }
  return slotsShortfall ? "inventory_slots_full" : undefined;
}

function addAwards<Id>(
  stacks: WorkingStack<Id>[],
  awards: readonly { itemId: string; quantity: number; stackLimit: number; massGrams: number }[],
  slotsAvailable: number,
  massAvailableGrams: number,
  attemptIndex: number,
): { slotsAvailable: number; massAvailableGrams: number } {
  let slots = slotsAvailable;
  let mass = massAvailableGrams;
  for (const awarded of awards) {
    const plan = planStackAddition(
      stacks,
      awarded.itemId,
      awarded.quantity,
      awarded.stackLimit,
      slots,
      mass,
      awarded.massGrams,
    );
    if (plan.remainingQuantity !== 0) {
      throw new Error(`Refining award plan for "${awarded.itemId}" failed after preflight`);
    }
    for (const update of plan.updatedStacks) {
      const stack = stacks.find((candidate) => String(candidate.id) === String(update.id));
      if (stack) stack.quantity = update.quantity;
    }
    for (const created of plan.createdStacks) {
      stacks.push({
        id: `refining-temp-${attemptIndex}-${stacks.length}-${created.itemId}` as unknown as Id,
        ...created,
        persisted: false,
      });
    }
    slots -= plan.createdStacks.length;
    mass -= awarded.quantity * awarded.massGrams;
  }
  return { slotsAvailable: slots, massAvailableGrams: mass };
}

export function resolveRefining<Id>(input: {
  elapsedTicks: number;
  snapshot: RefiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  recipe: RefiningRecipeBalance;
  random: RefiningRandom;
}): RefiningResolution<Id> {
  const { balance, snapshot, recipe, random } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0)
    throw new RangeError("Elapsed ticks must be a non-negative integer");

  const durationTicks = recipe.attemptDurationTicks;
  const award = refiningAwardFacts(balance, recipe);

  const inputsConsumed: Record<string, number> = {};
  const outputsGained: Record<string, number> = {};
  let stacks: WorkingStack<Id>[] = snapshot.existingStacks.map((stack) => ({
    ...stack,
    persisted: true,
  }));
  let slotsAvailable = snapshot.slotsAvailable;
  let massAvailableGrams = snapshot.massAvailableGrams;
  let consumedTicks = 0;
  let remainingTicks = input.elapsedTicks;
  let successes = 0;
  let failures = 0;
  const resolvedAttempts: RefiningResolvedAttempt[] = [];
  const thresholdBasisPoints = refiningSuccessChanceBps(snapshot.refiningLevel, recipe);

  const awardedXp = () => successes * recipe.successXp + failures * recipe.failureXp;
  const finish = (stopReason?: RefiningStopReason): RefiningResolution<Id> => {
    const remainingIds = new Set(
      stacks.filter((stack) => stack.persisted).map((stack) => String(stack.id)),
    );
    return {
      consumedTicks,
      attempts: successes + failures,
      successes,
      failures,
      inputsConsumed,
      outputsGained,
      awardedXp: awardedXp(),
      stackUpdates: stacks
        .filter((stack) => stack.persisted)
        .map(({ id, quantity }) => ({ id, quantity })),
      deletedStackIds: snapshot.existingStacks
        .filter((stack) => !remainingIds.has(String(stack.id)))
        .map((stack) => stack.id),
      createdStacks: stacks
        .filter((stack) => !stack.persisted)
        .map(({ itemId, quantity }) => ({ itemId, quantity })),
      resolvedAttempts,
      ...(stopReason ? { stopReason } : {}),
    };
  };

  const initialStop = refiningPreflightStopReason(snapshot, balance, recipe);
  if (initialStop) return finish(initialStop);

  while (true) {
    const stopReason = refiningPreflightStopReason(
      { refiningLevel: snapshot.refiningLevel, existingStacks: stacks, slotsAvailable, massAvailableGrams },
      balance,
      recipe,
    );
    if (stopReason) return finish(stopReason);
    if (remainingTicks < durationTicks) break;
    remainingTicks -= durationTicks;
    consumedTicks += durationTicks;

    const removal = planRecipeInputRemoval(stacks, slotsAvailable, massAvailableGrams, award.inputs);
    if (!removal) throw new Error("Refining consumed more input than available after preflight");
    stacks = removal.stacksAfter;
    slotsAvailable = removal.slotsAvailableAfter;
    massAvailableGrams = removal.massAvailableAfter;
    const consumed = award.inputs.map((item) => ({ itemId: item.itemId, quantity: item.quantity }));
    for (const item of consumed) {
      inputsConsumed[item.itemId] = (inputsConsumed[item.itemId] ?? 0) + item.quantity;
    }

    const rolledBasisPoints = random.nextBasisPoints();
    const success = rolledBasisPoints < thresholdBasisPoints;

    let branch: readonly { itemId: string; quantity: number; stackLimit: number; massGrams: number }[];
    if (success) {
      branch = award.successOutputs;
    } else {
      // A fixed-output failure has exactly one branch. A one-input-returned
      // failure has one per input, and exactly one of them comes back — chosen
      // uniformly, with the other lost.
      const index =
        award.failureOutcomes.length === 1
          ? 0
          : Math.min(
              award.failureOutcomes.length - 1,
              Math.floor((random.nextUnit?.() ?? 0) * award.failureOutcomes.length),
            );
      const chosen = award.failureOutcomes[index];
      if (!chosen) throw new Error("Refining recipe authored no failure outcome");
      branch = chosen;
    }

    const applied = addAwards(
      stacks,
      branch,
      slotsAvailable,
      massAvailableGrams,
      resolvedAttempts.length,
    );
    slotsAvailable = applied.slotsAvailable;
    massAvailableGrams = applied.massAvailableGrams;
    const awarded = branch.map((item) => ({ itemId: item.itemId, quantity: item.quantity }));
    for (const item of awarded) {
      outputsGained[item.itemId] = (outputsGained[item.itemId] ?? 0) + item.quantity;
    }

    if (success) successes += 1;
    else failures += 1;
    resolvedAttempts.push({
      success,
      rolledBasisPoints,
      thresholdBasisPoints,
      consumed,
      awarded,
      xpAwarded: success ? recipe.successXp : recipe.failureXp,
      durationTicks,
    });
  }

  return finish();
}
