import {
  refiningRecipeIsDeterministic,
  type EffectiveGameBalance,
  type RefiningRecipeBalance,
} from "@/game/config/balance";
import { BOUNDED_RUN_QUANTITY_CEILING } from "@/game/config/foundations";
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
  /** The run attempted every batch the player selected (#229). */
  "run_completed",
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
export function refiningAwardFacts(balance: EffectiveGameBalance, recipe: RefiningRecipeBalance) {
  const inputs = recipe.inputs.map((input) => ({
    ...stackFacts(balance, input.itemId),
    quantity: input.quantity,
  }));
  const successOutputs = [
    { ...stackFacts(balance, recipe.outputItemId), quantity: recipe.outputQuantity },
  ];
  // A deterministic recipe (#229) has no failure, so nothing else can happen.
  const failureOutcomes =
    recipe.failure.kind === "fixed_outputs"
      ? [
          recipe.failure.outputs.map((output) => ({
            ...stackFacts(balance, output.itemId),
            quantity: output.quantity,
          })),
        ]
      : recipe.failure.kind === "one_input_returned"
        ? recipe.inputs.map((input) => [{ ...stackFacts(balance, input.itemId), quantity: 1 }])
        : [];
  return { inputs, successOutputs, failureOutcomes } as const;
}

/**
 * The success chance for one recipe at one Refining level, on the shared
 * whole-basis-point interpolation model. A deterministic recipe always
 * succeeds; it authors no curve at all.
 */
export function refiningSuccessChanceBps(level: number, recipe: RefiningRecipeBalance): number {
  if (!Number.isInteger(level) || level < 1)
    throw new RangeError("Refining level must be positive");
  if (refiningRecipeIsDeterministic(recipe)) return 10_000;
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
  /**
   * The recipe has no failure path, so nothing was rolled (#229). The roll
   * fields then carry no information and a surface must not present them.
   */
  deterministic?: true;
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

type RefiningOutcomeBranch = readonly {
  itemId: string;
  quantity: number;
  stackLimit: number;
  massGrams: number;
}[];

type RefiningWorkingState<Id> = {
  stacks: WorkingStack<Id>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

/**
 * One attempt's effect on carried inventory: remove the recipe's inputs, then
 * add one outcome branch. The resolver and the run maximum both step through
 * this, so the maximum is computed against exactly the transitions a run makes.
 */
function applyRefiningAttempt<Id>(
  state: RefiningWorkingState<Id>,
  award: ReturnType<typeof refiningAwardFacts>,
  branch: RefiningOutcomeBranch,
  attemptIndex: number,
): RefiningWorkingState<Id> {
  const removal = planRecipeInputRemoval(
    state.stacks,
    state.slotsAvailable,
    state.massAvailableGrams,
    award.inputs,
  );
  if (!removal) throw new Error("Refining consumed more input than available after preflight");
  const stacks = removal.stacksAfter;
  const applied = addAwards(
    stacks,
    branch,
    removal.slotsAvailableAfter,
    removal.massAvailableAfter,
    attemptIndex,
  );
  return { stacks, ...applied };
}

/** Everything a recipe's attempt can produce: success, then every failure branch. */
function refiningOutcomeBranches(
  award: ReturnType<typeof refiningAwardFacts>,
): readonly RefiningOutcomeBranch[] {
  return [award.successOutputs, ...award.failureOutcomes];
}

/**
 * The server-authoritative maximum for a bounded Refining run (#229): the most
 * attempted batches of this recipe that can be started one after another from
 * the character's current inventory under at least one possible sequence of
 * outcomes.
 *
 * It asks the ordinary Refining preflight before every attempt — the same
 * inputs, and the same rule that every mutually exclusive outcome must fit
 * before the roll — and steps through every possible outcome with the same
 * transition the resolver applies, taking the longest sequence. Max is an
 * attempt ceiling, not a promise: the real run still rolls, and if its actual
 * outcomes leave the next attempt unable to start before the selection is
 * used up, it stops early with that attempt's ordinary stop reason.
 *
 * A deterministic recipe has one outcome, so this is a straight walk.
 */
export function refiningRunMaximum<Id>(
  snapshot: RefiningSnapshot<Id>,
  balance: EffectiveGameBalance,
  recipe: RefiningRecipeBalance,
): number {
  if (!refiningRecipeUnlocked(snapshot.refiningLevel, recipe)) return 0;
  const award = refiningAwardFacts(balance, recipe);
  // A branch the character's level makes impossible is not a sequence the run
  // can take: at certain success only the success branch is explored, so a
  // failure's output never makes a path look longer than any real run can be.
  const branches =
    refiningSuccessChanceBps(snapshot.refiningLevel, recipe) >= 10_000
      ? [award.successOutputs]
      : refiningOutcomeBranches(award);
  const memo = new Map<string, number>();

  // States are keyed by each item's sorted stack sizes, not by stack order.
  // That is sound because no transition's future depends on order: input
  // removal always settles on the smallest-first plan (it frees at least as
  // many slots as any other order), which also leaves each input's stacks in
  // ascending order for a returned input to top up; and an output item is never
  // removed, so only its total free room matters. Keying on order instead made
  // every success/failure interleaving a distinct state — exponential work.
  const signature = (state: RefiningWorkingState<Id>) =>
    `${state.slotsAvailable}|${state.massAvailableGrams}|${state.stacks
      .map((stack) => `${stack.itemId}:${String(stack.quantity).padStart(4, "0")}`)
      .sort()
      .join(",")}`;

  // Every attempt consumes at least one input unit net of anything a failure
  // hands back, so this recursion always reaches a state the preflight
  // refuses. The ceiling keeps it finite regardless.
  //
  // The key ignores depth even though the ceiling truncates by depth. That is
  // sound for a maximum: a state is only ever cut off by the ceiling on a path
  // that has already reached it, so the root is the ceiling whatever a later,
  // shallower visit to that state reads back. Every value below the ceiling is
  // the state's own longest run, which does not depend on how it was reached.
  const longest = (state: RefiningWorkingState<Id>, depth: number): number => {
    if (depth >= BOUNDED_RUN_QUANTITY_CEILING) return 0;
    const key = signature(state);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const stop = refiningPreflightStopReason(
      {
        refiningLevel: snapshot.refiningLevel,
        existingStacks: state.stacks,
        slotsAvailable: state.slotsAvailable,
        massAvailableGrams: state.massAvailableGrams,
      },
      balance,
      recipe,
    );
    let result = 0;
    if (!stop) {
      for (const branch of branches) {
        const next = applyRefiningAttempt(state, award, branch, depth);
        result = Math.max(result, 1 + longest(next, depth + 1));
        // Nothing longer is possible once a branch reaches the ceiling.
        if (depth + result >= BOUNDED_RUN_QUANTITY_CEILING) break;
      }
    }
    memo.set(key, result);
    return result;
  };

  return Math.min(
    BOUNDED_RUN_QUANTITY_CEILING,
    longest(
      {
        stacks: snapshot.existingStacks.map((stack) => ({ ...stack, persisted: true })),
        slotsAvailable: snapshot.slotsAvailable,
        massAvailableGrams: snapshot.massAvailableGrams,
      },
      0,
    ),
  );
}

export function resolveRefining<Id>(input: {
  elapsedTicks: number;
  snapshot: RefiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  recipe: RefiningRecipeBalance;
  random: RefiningRandom;
  /**
   * How many more batches the player's selected run may attempt (#229). The
   * run stops with `run_completed` the moment it has attempted that many; a
   * failed attempt counts exactly like a successful one.
   */
  attemptLimit: number;
}): RefiningResolution<Id> {
  const { balance, snapshot, recipe, random } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0)
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  if (!Number.isInteger(input.attemptLimit) || input.attemptLimit < 0)
    throw new RangeError("A Refining attempt limit must be a non-negative integer");

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
  const deterministic = refiningRecipeIsDeterministic(recipe);
  const failureXp = deterministic ? 0 : recipe.failureXp;

  const awardedXp = () => successes * recipe.successXp + failures * failureXp;
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

  // A run that cannot even start writes nothing. The loop's own stop echoes
  // the stacks it has been working on, but there is no working copy yet here,
  // so persisting one would be a no-op UPDATE per carried stack. A selected run
  // that has already attempted everything it asked for is checked first, so it
  // reports that it finished rather than whatever it would have run out of.
  const initialStop =
    input.attemptLimit === 0
      ? ("run_completed" as const)
      : refiningPreflightStopReason(snapshot, balance, recipe);
  if (initialStop) {
    return {
      consumedTicks: 0,
      attempts: 0,
      successes: 0,
      failures: 0,
      inputsConsumed: {},
      outputsGained: {},
      awardedXp: 0,
      stackUpdates: [],
      deletedStackIds: [],
      createdStacks: [],
      resolvedAttempts: [],
      stopReason: initialStop,
    };
  }

  while (true) {
    // The selected count is reached: stop at once, before the next preflight,
    // so the run never starts (or waits to start) a batch nobody asked for.
    if (successes + failures >= input.attemptLimit) return finish("run_completed");
    const stopReason = refiningPreflightStopReason(
      {
        refiningLevel: snapshot.refiningLevel,
        existingStacks: stacks,
        slotsAvailable,
        massAvailableGrams,
      },
      balance,
      recipe,
    );
    if (stopReason) return finish(stopReason);
    if (remainingTicks < durationTicks) break;
    remainingTicks -= durationTicks;
    consumedTicks += durationTicks;

    const consumed = award.inputs.map((item) => ({ itemId: item.itemId, quantity: item.quantity }));
    for (const item of consumed) {
      inputsConsumed[item.itemId] = (inputsConsumed[item.itemId] ?? 0) + item.quantity;
    }

    // A deterministic recipe never consults the random source, so adding one
    // leaves every rolled recipe's random stream exactly as it was.
    const rolledBasisPoints = deterministic ? 0 : random.nextBasisPoints();
    const success = deterministic || rolledBasisPoints < thresholdBasisPoints;

    let branch: RefiningOutcomeBranch;
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

    const applied = applyRefiningAttempt(
      { stacks, slotsAvailable, massAvailableGrams },
      award,
      branch,
      resolvedAttempts.length,
    );
    stacks = applied.stacks;
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
      ...(deterministic ? { deterministic: true as const } : {}),
      rolledBasisPoints,
      thresholdBasisPoints,
      consumed,
      awarded,
      xpAwarded: success ? recipe.successXp : failureXp,
      durationTicks,
    });
  }

  return finish();
}
