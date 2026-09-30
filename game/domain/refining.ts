import {
  refiningRecipeIsDeterministic,
  type EffectiveGameBalance,
  type RefiningRecipeBalance,
} from "@/game/config/balance";
import { BOUNDED_RUN_QUANTITY_CEILING, ITEM_IDS } from "@/game/config/foundations";
import type { BoundedRunAllowance } from "@/game/domain/bounded-run";
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
  /** A numeric run attempted every batch the player selected (#229). */
  "run_completed",
  /**
   * A Max run reached the internal safety ceiling (#229). Carried inventory
   * ends every real run long before it; this exists so a defect cannot run
   * forever, and says so rather than pretending the materials ran out.
   */
  "run_safety_limit",
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

export type RefiningAwardFact = {
  itemId: string;
  stackLimit: number;
  massGrams: number;
  quantity: number;
  byproduct: boolean;
};

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
 *
 * Every award says whether it is a `byproduct` (#256): optional material a
 * FAILURE leaves behind, which the player's Auto-discard Slag preference may
 * throw away and whose lack of room can never block an attempt. That is a
 * property of where the award comes from, never of the item's ID — a success
 * output is always the thing the player asked for (so a deliberate Slag recipe
 * keeps its Slag), and a Galvaferrite failure hands an input back, which is
 * returned rather than made.
 */
export function refiningAwardFacts(balance: EffectiveGameBalance, recipe: RefiningRecipeBalance) {
  const inputs = recipe.inputs.map((input) => ({
    ...stackFacts(balance, input.itemId),
    quantity: input.quantity,
  }));
  const successOutputs: RefiningAwardFact[] = [
    {
      ...stackFacts(balance, recipe.outputItemId),
      quantity: recipe.outputQuantity,
      byproduct: false,
    },
  ];
  // A deterministic recipe (#229) has no failure, so nothing else can happen.
  // Only the Slag a fixed-output failure produces is a byproduct; that is the
  // single material the shared preference (#256) covers.
  const failureOutcomes: RefiningAwardFact[][] =
    recipe.failure.kind === "fixed_outputs"
      ? [
          recipe.failure.outputs.map((output) => ({
            ...stackFacts(balance, output.itemId),
            quantity: output.quantity,
            byproduct: output.itemId === ITEM_IDS.slag,
          })),
        ]
      : recipe.failure.kind === "one_input_returned"
        ? recipe.inputs.map((input) => [
            { ...stackFacts(balance, input.itemId), quantity: 1, byproduct: false },
          ])
        : [];
  return { inputs, successOutputs, failureOutcomes };
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
  /** What the attempt actually put into carried inventory. */
  awarded: readonly RefiningItemQuantity[];
  /**
   * Byproduct Slag the attempt produced but did not carry (#256): thrown away
   * by Auto-discard Slag, or for want of room. Omitted when there was none, so
   * an attempt persisted before this existed reads as one that discarded
   * nothing, and a surface must never fold it into `awarded`.
   */
  discarded?: readonly RefiningItemQuantity[];
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
  /** Byproduct Slag produced but not carried, keyed by item ID (#256). */
  outputsDiscarded: Readonly<Record<string, number>>;
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
  //
  // Only what the attempt must PRESERVE gates it (#256): a success output, or
  // an input a failure hands back. A failure's byproduct Slag is optional
  // inventory — the resolver keeps what room allows after the attempt resolves
  // and discards the rest — so reserving room for it here would strand a
  // player over material they may not even want.
  let slotsShortfall = false;
  for (const outcome of [award.successOutputs, ...award.failureOutcomes]) {
    const required = outcome.filter((output) => !output.byproduct);
    if (required.length === 0) continue;
    const possible = planPossibleAwardAdditions(
      removal.stacksAfter,
      required.map((output) => ({
        itemId: output.itemId,
        quantity: output.quantity,
        stackLimit: output.stackLimit,
        itemWeight: output.massGrams,
      })),
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

/**
 * Add awards to the working inventory. A required award must fit in full —
 * the preflight proved it would, so a shortfall here is a defect. A partial
 * award (a byproduct) takes whatever room there is and reports the rest as
 * unplaced, so the caller can say it was discarded.
 */
function addAwards<Id>(
  stacks: WorkingStack<Id>[],
  awards: readonly { itemId: string; quantity: number; stackLimit: number; massGrams: number }[],
  slotsAvailable: number,
  massAvailableGrams: number,
  attemptIndex: number,
  mode: "required" | "partial",
): {
  slotsAvailable: number;
  massAvailableGrams: number;
  placed: RefiningItemQuantity[];
  unplaced: RefiningItemQuantity[];
} {
  let slots = slotsAvailable;
  let mass = massAvailableGrams;
  const placed: RefiningItemQuantity[] = [];
  const unplaced: RefiningItemQuantity[] = [];
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
    if (mode === "required" && plan.remainingQuantity !== 0) {
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
    const placedQuantity = awarded.quantity - plan.remainingQuantity;
    slots -= plan.createdStacks.length;
    mass -= placedQuantity * awarded.massGrams;
    if (placedQuantity > 0) placed.push({ itemId: awarded.itemId, quantity: placedQuantity });
    if (plan.remainingQuantity > 0) {
      unplaced.push({ itemId: awarded.itemId, quantity: plan.remainingQuantity });
    }
  }
  return { slotsAvailable: slots, massAvailableGrams: mass, placed, unplaced };
}

type RefiningOutcomeBranch = readonly RefiningAwardFact[];

type RefiningWorkingState<Id> = {
  stacks: WorkingStack<Id>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

/**
 * One attempt's effect on carried inventory: remove the recipe's inputs, add
 * the outcome branch's required awards in full, then give its byproducts
 * whatever room is left — or none, when the player auto-discards them (#256).
 * `kept` and `discarded` together are exactly the branch, so nothing a surface
 * reports as produced can exceed what was actually carried.
 */
function applyRefiningAttempt<Id>(
  state: RefiningWorkingState<Id>,
  award: ReturnType<typeof refiningAwardFacts>,
  branch: RefiningOutcomeBranch,
  autoDiscardSlag: boolean,
  attemptIndex: number,
): {
  state: RefiningWorkingState<Id>;
  kept: RefiningItemQuantity[];
  discarded: RefiningItemQuantity[];
} {
  const removal = planRecipeInputRemoval(
    state.stacks,
    state.slotsAvailable,
    state.massAvailableGrams,
    award.inputs,
  );
  if (!removal) throw new Error("Refining consumed more input than available after preflight");
  const stacks = removal.stacksAfter;
  const required = addAwards(
    stacks,
    branch.filter((output) => !output.byproduct),
    removal.slotsAvailableAfter,
    removal.massAvailableAfter,
    attemptIndex,
    "required",
  );
  const byproducts = branch.filter((output) => output.byproduct);
  if (autoDiscardSlag) {
    return {
      state: {
        stacks,
        slotsAvailable: required.slotsAvailable,
        massAvailableGrams: required.massAvailableGrams,
      },
      kept: required.placed,
      discarded: byproducts.map(({ itemId, quantity }) => ({ itemId, quantity })),
    };
  }
  const optional = addAwards(
    stacks,
    byproducts,
    required.slotsAvailable,
    required.massAvailableGrams,
    attemptIndex,
    "partial",
  );
  return {
    state: {
      stacks,
      slotsAvailable: optional.slotsAvailable,
      massAvailableGrams: optional.massAvailableGrams,
    },
    kept: [...required.placed, ...optional.placed],
    discarded: optional.unplaced,
  };
}

/**
 * How many batches of this recipe the inputs carried right now pay for (#229):
 * the ceiling a numeric run selection may ask for. It is deliberately not a
 * prediction — it ignores capacity and anything a failure might hand back.
 * Capacity is the ordinary preflight's question, asked before every attempt,
 * and Max is a run-until-blocked mode that follows the real results instead
 * of counting them in advance. Zero for a recipe the level does not unlock.
 */
export function refiningAffordableBatches<Id>(
  snapshot: Pick<RefiningSnapshot<Id>, "refiningLevel" | "existingStacks">,
  balance: EffectiveGameBalance,
  recipe: RefiningRecipeBalance,
): number {
  if (!refiningRecipeUnlocked(snapshot.refiningLevel, recipe)) return 0;
  const batches = Math.min(
    ...refiningAwardFacts(balance, recipe).inputs.map((input) =>
      Math.floor(totalQuantityForItem(snapshot.existingStacks, input.itemId) / input.quantity),
    ),
  );
  return Math.min(BOUNDED_RUN_QUANTITY_CEILING, batches);
}

export function resolveRefining<Id>(input: {
  elapsedTicks: number;
  snapshot: RefiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  recipe: RefiningRecipeBalance;
  random: RefiningRandom;
  /**
   * How many more batches the player's selection may attempt, and what
   * reaching that means (#229). A numeric run stops with `run_completed` the
   * moment it has attempted its count; a failed attempt counts exactly like a
   * successful one. A Max run's allowance is only the internal safety ceiling:
   * what ends it is the ordinary preflight refusing the next attempt, asked
   * against the inventory the real results left behind.
   */
  allowance: BoundedRunAllowance;
  /**
   * The character's shared Auto-discard Slag preference (#256). It decides only
   * whether a failure's byproduct Slag is kept when there is room; it never
   * touches a success output, a deliberate Slag recipe's output, or an input a
   * failure hands back.
   */
  autoDiscardSlag: boolean;
}): RefiningResolution<Id> {
  const { balance, snapshot, recipe, random, autoDiscardSlag } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0)
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  const { allowance } = input;
  if (!Number.isInteger(allowance.remaining) || allowance.remaining < 0)
    throw new RangeError("A Refining run allowance must be a non-negative integer");

  const durationTicks = recipe.attemptDurationTicks;
  const award = refiningAwardFacts(balance, recipe);

  const inputsConsumed: Record<string, number> = {};
  const outputsGained: Record<string, number> = {};
  const outputsDiscarded: Record<string, number> = {};
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
      outputsDiscarded,
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
  // so persisting one would be a no-op UPDATE per carried stack. A selection
  // with nothing left to attempt is checked first, so it reports that it
  // finished rather than whatever it would have run out of.
  const initialStop =
    allowance.remaining === 0
      ? allowance.exhaustedReason
      : refiningPreflightStopReason(snapshot, balance, recipe);
  if (initialStop) {
    return {
      consumedTicks: 0,
      attempts: 0,
      successes: 0,
      failures: 0,
      inputsConsumed: {},
      outputsGained: {},
      outputsDiscarded: {},
      awardedXp: 0,
      stackUpdates: [],
      deletedStackIds: [],
      createdStacks: [],
      resolvedAttempts: [],
      stopReason: initialStop,
    };
  }

  while (true) {
    // The selection is used up: stop at once, before the next preflight, so
    // the run never starts (or waits to start) a batch nobody asked for.
    if (successes + failures >= allowance.remaining) return finish(allowance.exhaustedReason);
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
      autoDiscardSlag,
      resolvedAttempts.length,
    );
    stacks = applied.state.stacks;
    slotsAvailable = applied.state.slotsAvailable;
    massAvailableGrams = applied.state.massAvailableGrams;
    const awarded = applied.kept;
    const discarded = applied.discarded;
    for (const item of awarded) {
      outputsGained[item.itemId] = (outputsGained[item.itemId] ?? 0) + item.quantity;
    }
    for (const item of discarded) {
      outputsDiscarded[item.itemId] = (outputsDiscarded[item.itemId] ?? 0) + item.quantity;
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
      ...(discarded.length > 0 ? { discarded } : {}),
      xpAwarded: success ? recipe.successXp : failureXp,
      durationTicks,
    });
  }

  return finish();
}
