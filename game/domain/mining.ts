import type { EffectiveGameBalance } from "@/game/config/balance";
import { planStackAddition, type StackState } from "@/game/domain/inventory";
import { resolvableAttemptCount } from "@/game/domain/timing";

export const MINING_STOP_REASONS = [
  "manually_stopped",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "compatible_mining_tool_missing",
  "action_replaced",
] as const;
export type MiningStopReason = (typeof MINING_STOP_REASONS)[number];

export type MiningRandom = { nextBasisPoints(): number; nextUnit(): number };

export function miningSuccessChanceBps(level: number, balance: EffectiveGameBalance): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("Mining level must be positive");
  const mining = balance.mining;
  return Math.min(
    10_000,
    mining.successAtLevelOneBps +
      Math.floor(
        ((Math.min(level, mining.guaranteedSuccessLevel) - 1) * mining.successRangeBps) /
          (mining.guaranteedSuccessLevel - 1),
      ),
  );
}

export type MiningSnapshot<Id = string> = {
  miningLevel: number;
  hasCompatibleTool: boolean;
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
  stopReason?: MiningStopReason;
};

export function resolveCrashSiteMining<Id>(input: {
  elapsedTicks: number;
  snapshot: MiningSnapshot<Id>;
  balance: EffectiveGameBalance;
  random: MiningRandom;
}): MiningResolution<Id> {
  const { balance, snapshot, random } = input;
  const attempts = resolvableAttemptCount(input.elapsedTicks, balance.mining.attemptDurationTicks);
  if (!snapshot.hasCompatibleTool)
    return {
      consumedTicks: 0,
      successes: 0,
      failures: 0,
      awardedXp: 0,
      stackUpdates: [],
      createdStacks: [],
      stopReason: "compatible_mining_tool_missing",
    };
  let stacks = snapshot.existingStacks.map((stack) => ({ ...stack }));
  let slotsAvailable = snapshot.slotsAvailable;
  let massAvailableGrams = snapshot.massAvailableGrams;
  let successes = 0;
  let failures = 0;
  for (let index = 0; index < attempts; index += 1) {
    // A minimum successful yield must fit before chance is rolled.
    const minimumPlan = planStackAddition(
      stacks,
      balance.items.ferriteShale.itemId,
      balance.mining.yieldMinimum,
      balance.items.ferriteShale.stackLimit,
      slotsAvailable,
      massAvailableGrams,
      balance.items.ferriteShale.massGrams,
    );
    if (minimumPlan.remainingQuantity > 0) {
      return {
        consumedTicks: index * balance.mining.attemptDurationTicks,
        successes,
        failures,
        awardedXp: successes * balance.mining.successXp,
        stackUpdates: stacks.map(({ id, quantity }) => ({ id, quantity })),
        createdStacks: stacks
          .filter((stack) => !snapshot.existingStacks.some((existing) => existing.id === stack.id))
          .map(({ itemId, quantity }) => ({ itemId, quantity })),
        stopReason:
          massAvailableGrams < balance.items.ferriteShale.massGrams
            ? "carried_mass_capacity_reached"
            : "inventory_slots_full",
      };
    }
    if (random.nextBasisPoints() >= miningSuccessChanceBps(snapshot.miningLevel, balance)) {
      failures += 1;
      continue;
    }
    const rolledQuantity =
      random.nextUnit() < 0.5 ? balance.mining.yieldMinimum : balance.mining.yieldMaximum;
    let quantity = rolledQuantity;
    let plan = planStackAddition(
      stacks,
      balance.items.ferriteShale.itemId,
      quantity,
      balance.items.ferriteShale.stackLimit,
      slotsAvailable,
      massAvailableGrams,
      balance.items.ferriteShale.massGrams,
    );
    // The minimum-fit check authorizes this success. At a final partial stack or
    // mass boundary, retain a valid one-unit yield rather than partially adding a two-unit roll.
    if (plan.remainingQuantity > 0) {
      quantity = balance.mining.yieldMinimum;
      plan = minimumPlan;
    }
    for (const update of plan.updatedStacks) {
      const stack = stacks.find((candidate) => candidate.id === update.id);
      if (stack) stack.quantity = update.quantity;
    }
    for (const created of plan.createdStacks)
      stacks.push({ id: `new-${index}-${stacks.length}` as Id, ...created });
    slotsAvailable -= plan.createdStacks.length;
    massAvailableGrams -= quantity * balance.items.ferriteShale.massGrams;
    successes += 1;
  }
  return {
    consumedTicks: attempts * balance.mining.attemptDurationTicks,
    successes,
    failures,
    awardedXp: successes * balance.mining.successXp,
    stackUpdates: stacks
      .filter((stack) => snapshot.existingStacks.some((existing) => existing.id === stack.id))
      .map(({ id, quantity }) => ({ id, quantity })),
    createdStacks: stacks
      .filter((stack) => !snapshot.existingStacks.some((existing) => existing.id === stack.id))
      .map(({ itemId, quantity }) => ({ itemId, quantity })),
  };
}
