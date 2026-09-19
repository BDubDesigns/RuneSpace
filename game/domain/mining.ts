import type { EffectiveGameBalance, MiningSourceBalance } from "@/game/config/balance";
import { planStackAddition, type StackState } from "@/game/domain/inventory";
import { effectiveAttemptDurationTicks } from "@/game/domain/timing";

export const MINING_STOP_REASONS = [
  "manually_stopped",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "compatible_mining_tool_missing",
  "mining_tool_replaced",
  "action_replaced",
] as const;
export type MiningStopReason = (typeof MINING_STOP_REASONS)[number];

export type MiningRandom = { nextBasisPoints(): number; nextUnit(): number };

/**
 * The authoritative award facts for one Mining attempt at one authored source:
 * which item that source produces, its storage facts, and the per-success
 * yield range. The resolver and mission-guidance recommendation validation both
 * read THIS function, so what a source authoritatively produces has exactly one
 * home — changing the resolver's award cannot leave guidance validation stale.
 *
 * The source is a parameter rather than a constant (#209): The Jag yields
 * Ferrite Shale and an opened Deep Jag yields Galvanite, from this one path.
 */
export function miningAwardFacts(balance: EffectiveGameBalance, source: MiningSourceBalance) {
  const item = Object.values(balance.items).find(
    (candidate) => candidate.itemId === source.itemId,
  );
  if (!item || !("stackLimit" in item)) {
    throw new Error(`Mining source "${source.actionId}" produces unstackable item "${source.itemId}"`);
  }
  return {
    itemId: source.itemId,
    stackLimit: item.stackLimit,
    massGrams: item.massGrams,
    yieldMinimum: source.yieldMinimum,
    yieldMaximum: source.yieldMaximum,
  };
}

/**
 * The success chance for one source at one Mining level.
 *
 * The interpolation model is the shared one — whole basis points, linear from
 * the source's level-one chance to certainty at its own guaranteed level — so
 * Galvanite's slower climb to Mining 40 is authored data, not a second curve.
 */
export function miningSuccessChanceBps(level: number, source: MiningSourceBalance): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("Mining level must be positive");
  return Math.min(
    10_000,
    source.successAtLevelOneBps +
      Math.floor(
        ((Math.min(level, source.guaranteedSuccessLevel) - 1) * source.successRangeBps) /
          (source.guaranteedSuccessLevel - 1),
      ),
  );
}

export type MiningSnapshot<Id = string> = {
  miningLevel: number;
  hasCompatibleTool: boolean;
  /** Null is the established uncharged representation for legacy Cutter rows. */
  cutterCharge?: number | null;
  existingStacks: readonly StackState<Id>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};
export type MiningResolution<Id = string> = {
  consumedTicks: number;
  successes: number;
  failures: number;
  awardedXp: number;
  stackUpdates: readonly { id: Id; quantity: number }[];
  createdStacks: readonly { itemId: string; quantity: number }[];
  attempts: readonly MiningResolvedAttempt[];
  remainingCutterCharge: number;
  stopReason?: MiningStopReason;
};

/**
 * One resolved attempt. `itemId` and `quantityAwarded` replaced the original
 * `shaleAwarded` (#209): a run at Deep Jag awards Galvanite, so neither the
 * durable run summary nor the player-facing recent-attempt list may assume
 * every Mining output is Ferrite Shale.
 */
export type MiningResolvedAttempt = {
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  itemId: string;
  quantityAwarded: number;
  xpAwarded: number;
  boosted: boolean;
  durationTicks: number;
  chargeConsumed: boolean;
  remainingCharge: number;
};

/**
 * A charged attempt's duration at one source, under the shared whole-tick
 * ceiling rule. Ferrite Shale's 10 ticks become 5; Galvanite's 15 become 8.
 */
export function boostedMiningAttemptDurationTicks(
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
): number {
  return effectiveAttemptDurationTicks(
    source.attemptDurationTicks,
    balance.mining.powerCellBoost.speedMultiplier,
  );
}

export function normalizeCutterCharge(
  currentCharge: number | null | undefined,
  balance: EffectiveGameBalance,
): number {
  const charge = currentCharge ?? 0;
  if (
    !Number.isInteger(charge) ||
    charge < 0 ||
    charge > balance.items.salvageCutter.maximumCharge
  ) {
    throw new RangeError("Salvage Cutter charge is outside the approved range");
  }
  return charge;
}

export function miningNearMissBasisPoints(
  rolledBasisPoints: number,
  thresholdBasisPoints: number,
): number {
  // Rolls are discrete and success is strictly below the threshold. The nearest
  // success is therefore threshold - 1, so equality is a one-basis-point miss.
  return Math.max(0, rolledBasisPoints - thresholdBasisPoints + 1);
}

/** Shared preflight for starting and resolving a Mining attempt. */
export function miningPreflightStopReason<Id>(
  snapshot: MiningSnapshot<Id>,
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
): MiningStopReason | undefined {
  if (!snapshot.hasCompatibleTool) return "compatible_mining_tool_missing";
  const award = miningAwardFacts(balance, source);
  const plan = planStackAddition(
    snapshot.existingStacks,
    award.itemId,
    award.yieldMinimum,
    award.stackLimit,
    snapshot.slotsAvailable,
    snapshot.massAvailableGrams,
    award.massGrams,
  );
  if (plan.remainingQuantity === 0) return undefined;
  return snapshot.massAvailableGrams < award.massGrams
    ? "carried_mass_capacity_reached"
    : "inventory_slots_full";
}

/**
 * Resolve Mining at one authored source.
 *
 * The loop is unchanged from the shipped Ferrite Shale resolver; what was
 * hardcoded to `balance.mining` now comes from the source the active action
 * identifies, so Ferrite behaviour is bit-for-bit what it was and a second ore
 * is authored data rather than a second resolver (#209).
 */
export function resolveMining<Id>(input: {
  elapsedTicks: number;
  snapshot: MiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  source: MiningSourceBalance;
  random: MiningRandom;
}): MiningResolution<Id> {
  const { balance, snapshot, source, random } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0)
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  const normalDurationTicks = source.attemptDurationTicks;
  const boostedDurationTicks = boostedMiningAttemptDurationTicks(balance, source);
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let remainingCutterCharge = normalizeCutterCharge(snapshot.cutterCharge, balance);
  const initialStopReason = miningPreflightStopReason(snapshot, balance, source);
  if (initialStopReason)
    return {
      consumedTicks: 0,
      successes: 0,
      failures: 0,
      awardedXp: 0,
      stackUpdates: [],
      createdStacks: [],
      attempts: [],
      remainingCutterCharge,
      stopReason: initialStopReason,
    };
  const stacks = snapshot.existingStacks.map((stack) => ({ ...stack, persisted: true }));
  let slotsAvailable = snapshot.slotsAvailable;
  let massAvailableGrams = snapshot.massAvailableGrams;
  let successes = 0;
  let failures = 0;
  const resolvedAttempts: MiningResolvedAttempt[] = [];
  const thresholdBasisPoints = miningSuccessChanceBps(snapshot.miningLevel, source);
  while (true) {
    // A minimum successful yield must fit before chance is rolled.
    const currentSnapshot = {
      ...snapshot,
      existingStacks: stacks,
      slotsAvailable,
      massAvailableGrams,
    };
    const stopReason = miningPreflightStopReason(currentSnapshot, balance, source);
    if (stopReason) {
      return {
        consumedTicks,
        successes,
        failures,
        awardedXp: successes * source.successXp,
        stackUpdates: stacks
          .filter((stack) => stack.persisted)
          .map(({ id, quantity }) => ({ id, quantity })),
        createdStacks: stacks
          .filter((stack) => !stack.persisted)
          .map(({ itemId, quantity }) => ({ itemId, quantity })),
        attempts: resolvedAttempts,
        remainingCutterCharge,
        stopReason,
      };
    }
    const boosted = remainingCutterCharge > 0;
    const durationTicks = boosted ? boostedDurationTicks : normalDurationTicks;
    if (remainingTicks < durationTicks) break;
    remainingTicks -= durationTicks;
    consumedTicks += durationTicks;
    const rolledBasisPoints = random.nextBasisPoints();
    if (rolledBasisPoints >= thresholdBasisPoints) {
      failures += 1;
      if (boosted) remainingCutterCharge -= 1;
      resolvedAttempts.push({
        success: false,
        rolledBasisPoints,
        thresholdBasisPoints,
        itemId: source.itemId,
        quantityAwarded: 0,
        xpAwarded: 0,
        boosted,
        durationTicks,
        chargeConsumed: boosted,
        remainingCharge: remainingCutterCharge,
      });
      continue;
    }
    const award = miningAwardFacts(balance, source);
    const rolledQuantity = random.nextUnit() < 0.5 ? award.yieldMinimum : award.yieldMaximum;
    let quantity = rolledQuantity;
    let plan = planStackAddition(
      stacks,
      award.itemId,
      quantity,
      award.stackLimit,
      slotsAvailable,
      massAvailableGrams,
      award.massGrams,
    );
    // The minimum-fit check authorizes this success. At a final partial stack or
    // mass boundary, retain a valid one-unit yield rather than partially adding a two-unit roll.
    if (plan.remainingQuantity > 0) {
      quantity = award.yieldMinimum;
      plan = planStackAddition(
        stacks,
        award.itemId,
        quantity,
        award.stackLimit,
        slotsAvailable,
        massAvailableGrams,
        award.massGrams,
      );
    }
    for (const update of plan.updatedStacks) {
      const stack = stacks.find((candidate) => candidate.id === update.id);
      if (stack) stack.quantity = update.quantity;
    }
    for (const created of plan.createdStacks)
      stacks.push({
        // A symbol prevents temporary planning IDs from colliding with persisted text IDs.
        id: Symbol(`mining-stack-${resolvedAttempts.length}-${stacks.length}`) as unknown as Id,
        ...created,
        persisted: false,
      });
    slotsAvailable -= plan.createdStacks.length;
    massAvailableGrams -= quantity * award.massGrams;
    successes += 1;
    if (boosted) remainingCutterCharge -= 1;
    resolvedAttempts.push({
      success: true,
      rolledBasisPoints,
      thresholdBasisPoints,
      itemId: award.itemId,
      quantityAwarded: quantity,
      xpAwarded: source.successXp,
      boosted,
      durationTicks,
      chargeConsumed: boosted,
      remainingCharge: remainingCutterCharge,
    });
  }
  return {
    consumedTicks,
    successes,
    failures,
    awardedXp: successes * source.successXp,
    stackUpdates: stacks
      .filter((stack) => stack.persisted)
      .map(({ id, quantity }) => ({ id, quantity })),
    createdStacks: stacks
      .filter((stack) => !stack.persisted)
      .map(({ itemId, quantity }) => ({ itemId, quantity })),
    attempts: resolvedAttempts,
    remainingCutterCharge,
  };
}
