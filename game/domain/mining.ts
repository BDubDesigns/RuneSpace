import type {
  EffectiveGameBalance,
  MiningSourceBalance,
  MiningToolDefinition,
} from "@/game/config/balance";
import {
  planExactStackAdditions,
  type StackAdditionPlan,
  type StackBundleEntry,
  type StackState,
} from "@/game/domain/inventory";
import { effectiveAttemptDurationTicks, scaledAttemptDurationTicks } from "@/game/domain/timing";

export const MINING_STOP_REASONS = [
  "manually_stopped",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
  "compatible_mining_tool_missing",
  "mining_tool_replaced",
  "action_replaced",
] as const;
export type MiningStopReason = (typeof MINING_STOP_REASONS)[number];

export type MiningRandom = {
  nextBasisPoints(): number;
  nextUnit(): number;
  /**
   * A uniform integer in [0, exclusiveMaximum). A Secondary Find table is
   * authored in exact fractions (1 / 40, 1 / 60, ...) that basis points cannot
   * express, so its one roll is drawn here (#308). A random that omits it
   * simply never finds anything; both production sources provide it.
   */
  nextInteger?(exclusiveMaximum: number): number;
};

/**
 * The authoritative award facts for one Mining attempt at one authored source:
 * which item that source produces, its storage facts, and the per-success
 * yield range. The resolver and mission-guidance recommendation validation both
 * read THIS function, so what a source authoritatively produces has exactly one
 * home — changing the resolver's award cannot leave guidance validation stale.
 *
 * The source is a parameter rather than a constant (#209): The Jag yields
 * Ferrite Shale and an opened Deep Jag yields Galvanite, from this one path.
 *
 * `secondaryFinds` is the source's authored table (#308), each entry joined
 * to the item facts it needs and to the bonus Mining XP the ITEM owns — never
 * restated on the source — so every consumer sees one definition of a find.
 */
export function miningAwardFacts(balance: EffectiveGameBalance, source: MiningSourceBalance) {
  const item = Object.values(balance.items).find((candidate) => candidate.itemId === source.itemId);
  if (!item || !("stackLimit" in item)) {
    throw new Error(
      `Mining source "${source.actionId}" produces unstackable item "${source.itemId}"`,
    );
  }
  return {
    itemId: source.itemId,
    stackLimit: item.stackLimit,
    massGrams: item.massGrams,
    yieldMinimum: source.yieldMinimum,
    yieldMaximum: source.yieldMaximum,
    secondaryFinds: miningSecondaryFindFacts(balance, source),
  };
}

/** One authored Secondary Find with the item facts resolution needs (#308). */
export type MiningSecondaryFindFacts = {
  itemId: string;
  /** Absolute chance per successful extraction is 1 / oneIn. */
  oneIn: number;
  announce: boolean;
  stackLimit: number;
  massGrams: number;
  /** Bonus Mining XP the item itself is worth, wherever it is found. */
  bonusXp: number;
  /** Units one find yields. Always one today; a future effect may change it. */
  quantity: number;
};

/** A source's Secondary Find table, in authored order, joined to its items. */
export function miningSecondaryFindFacts(
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
): readonly MiningSecondaryFindFacts[] {
  return source.secondaryFinds.map((entry) => {
    const item = Object.values(balance.items).find(
      (candidate) => candidate.itemId === entry.itemId,
    );
    if (!item || !("stackLimit" in item) || !("secondaryFindMiningXp" in item)) {
      throw new Error(
        `Mining source "${source.actionId}" authors Secondary Find "${entry.itemId}", which is not a stackable find item`,
      );
    }
    return {
      itemId: entry.itemId,
      oneIn: entry.oneIn,
      announce: entry.announce,
      stackLimit: item.stackLimit,
      massGrams: item.massGrams,
      bonusXp: item.secondaryFindMiningXp,
      quantity: 1,
    };
  });
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * The size of the one roll a Secondary Find table is drawn from: the least
 * common multiple of its entries' denominators, so every entry's 1 / oneIn is
 * a whole number of equally likely outcomes (#308). The Jag's 1 / 40 and 1 / 60
 * share a roll of 120; Deep Jag's 1 / 35 and 1 / 55 share one of 385. Exact
 * integers, so the authored odds are the real odds — no rounding to basis points.
 */
export function secondaryFindRollSize(entries: readonly Pick<MiningSecondaryFindFacts, "oneIn">[]) {
  return entries.reduce((size, entry) => {
    if (!Number.isInteger(entry.oneIn) || entry.oneIn < 1)
      throw new RangeError("A Secondary Find denominator must be a positive integer");
    return (size * entry.oneIn) / greatestCommonDivisor(size, entry.oneIn);
  }, 1);
}

/**
 * The find one roll selects, or undefined for none. Entries own consecutive,
 * non-overlapping spans of the roll in authored order, so the table is
 * mutually exclusive by construction: one roll can never select two finds.
 */
export function selectSecondaryFind<Entry extends Pick<MiningSecondaryFindFacts, "oneIn">>(
  entries: readonly Entry[],
  roll: number,
): Entry | undefined {
  const size = secondaryFindRollSize(entries);
  if (!Number.isInteger(roll) || roll < 0 || roll >= size)
    throw new RangeError("Secondary Find roll is outside the table");
  let upperBound = 0;
  for (const entry of entries) {
    upperBound += size / entry.oneIn;
    if (roll < upperBound) return entry;
  }
  return undefined;
}

/** Draw a source's Secondary Find for one successful extraction, if any. */
function drawSecondaryFind(
  entries: readonly MiningSecondaryFindFacts[],
  random: MiningRandom,
): MiningSecondaryFindFacts | undefined {
  if (entries.length === 0 || !random.nextInteger) return undefined;
  return selectSecondaryFind(entries, random.nextInteger(secondaryFindRollSize(entries)));
}

function stackBundleEntry(
  facts: { itemId: string; stackLimit: number; massGrams: number },
  quantity: number,
): StackBundleEntry {
  return {
    itemId: facts.itemId as StackBundleEntry["itemId"],
    quantity,
    stackLimit: facts.stackLimit,
    itemWeight: facts.massGrams,
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
  /**
   * The authored definition of the Mining tool actually equipped right now
   * (#233), or undefined when the Mining-tool slot holds none. Its duration,
   * charge and yield effects are read from here and nowhere else, so a lazily
   * or offline-resolved attempt always uses the tool that is really equipped.
   */
  tool?: MiningToolDefinition;
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

/** One Secondary Find an attempt actually awarded (#308). */
export type MiningSecondaryFindAward = { itemId: string; quantity: number };

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
  /**
   * Bonus items this success turned up beside the source's own ore (#308).
   * Always empty for a failure and, today, at most one entry.
   */
  secondaryFinds: readonly MiningSecondaryFindAward[];
  /** The attempt's COMBINED Mining XP: the source's own plus any finds'. */
  xpAwarded: number;
  boosted: boolean;
  durationTicks: number;
  chargeConsumed: boolean;
  remainingCharge: number;
};

/**
 * One attempt's duration at one source with one Mining tool (#233), under the
 * shared whole-tick rules. The tool's permanent multiplier applies charged or
 * not; only a tool whose charged effect is speed then takes the global Power
 * Cell speed multiplier. The Salvage Cutter's 1.00× leaves every source's
 * authored duration exactly as it was — Ferrite Shale 10, or 5 charged;
 * Galvanite 15, or 8 charged. The Loadsteel Cutter's 0.8× makes them 8 and 12,
 * charged or not, because its charge buys ore rather than speed. No tool named
 * means the global rule alone.
 */
export function miningAttemptDurationTicks(
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
  tool: Pick<MiningToolDefinition, "baseDurationMultiplierBps" | "chargedEffect"> | undefined,
  charged: boolean,
): number {
  const toolTicks = tool
    ? scaledAttemptDurationTicks(source.attemptDurationTicks, tool.baseDurationMultiplierBps)
    : source.attemptDurationTicks;
  const faster = charged && (tool === undefined || tool.chargedEffect.kind === "speed");
  return faster
    ? effectiveAttemptDurationTicks(toolTicks, balance.mining.powerCellBoost.speedMultiplier)
    : toolTicks;
}

/**
 * A charged attempt's duration at one source, under the shared whole-tick
 * ceiling rule. With the Salvage Cutter (or no tool named), Ferrite Shale's 10
 * ticks become 5 and Galvanite's 15 become 8.
 */
export function boostedMiningAttemptDurationTicks(
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
  tool?: Pick<MiningToolDefinition, "baseDurationMultiplierBps" | "chargedEffect">,
): number {
  return miningAttemptDurationTicks(balance, source, tool, true);
}

/**
 * The ore a charged tool adds to a successful attempt's ordinarily resolved
 * yield (#233): the Loadsteel Cutter's one, and nothing for a tool whose
 * charge buys speed or for an uncharged attempt.
 */
export function miningChargedExtraYield(
  tool: Pick<MiningToolDefinition, "chargedEffect"> | undefined,
  charged: boolean,
): number {
  return charged && tool?.chargedEffect.kind === "extra_yield" ? tool.chargedEffect.units : 0;
}

/**
 * The range a successful attempt yields, as players read it (#233): the
 * source's own 1-or-2 roll, plus any charged extra ore — 2 or 3 for a charged
 * Loadsteel Cutter at today's sources.
 */
export function miningYieldRange(
  source: Pick<MiningSourceBalance, "yieldMinimum" | "yieldMaximum">,
  tool: Pick<MiningToolDefinition, "chargedEffect"> | undefined,
  charged: boolean,
): { minimum: number; maximum: number } {
  const extra = miningChargedExtraYield(tool, charged);
  return { minimum: source.yieldMinimum + extra, maximum: source.yieldMaximum + extra };
}

/** Whether a Mining tool's own level requirement lets this character use it (#233). */
export function miningToolUsable(
  tool: Pick<MiningToolDefinition, "requiredMiningLevel">,
  miningLevel: number,
): boolean {
  return miningLevel >= tool.requiredMiningLevel;
}

/** A tool's durable charge, validated against that tool's own maximum (#233). */
export function normalizeCutterCharge(
  currentCharge: number | null | undefined,
  tool: Pick<MiningToolDefinition, "maximumCharge">,
): number {
  const charge = currentCharge ?? 0;
  if (!Number.isInteger(charge) || charge < 0 || charge > tool.maximumCharge) {
    throw new RangeError("Mining tool charge is outside the approved range");
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

/**
 * Shared preflight for starting and resolving a Mining attempt.
 *
 * The inventory must be able to keep the source's MINIMUM primary yield plus
 * ANY ONE of its possible Secondary Finds (#308). Finds are mutually exclusive,
 * so each candidate is planned against the same snapshot rather than one after
 * another: a single free slot satisfies whichever find turns up, and no slot is
 * demanded per possible find. A find that rolls is therefore never one the
 * inventory could not keep. When candidates fail for different reasons, the
 * mass limit is reported, being the more actionable.
 */
export function miningPreflightStopReason<Id>(
  snapshot: MiningSnapshot<Id>,
  balance: EffectiveGameBalance,
  source: MiningSourceBalance,
): MiningStopReason | undefined {
  // An equipped tool the character's Mining level does not meet is no tool at
  // all (#233): equipping refuses it, and this refuses using it.
  if (!snapshot.tool || !miningToolUsable(snapshot.tool, snapshot.miningLevel))
    return "compatible_mining_tool_missing";
  const award = miningAwardFacts(balance, source);
  const primary = stackBundleEntry(award, award.yieldMinimum);
  const candidates =
    award.secondaryFinds.length > 0
      ? award.secondaryFinds.map((find) => [primary, stackBundleEntry(find, find.quantity)])
      : [[primary]];
  let failure: "slots" | "mass" | undefined;
  for (const entries of candidates) {
    const plan = planExactStackAdditions(
      snapshot.existingStacks,
      entries,
      snapshot.slotsAvailable,
      snapshot.massAvailableGrams,
    );
    if (!plan.ok && (failure === undefined || plan.reason === "mass")) failure = plan.reason;
  }
  if (failure === undefined) return undefined;
  return failure === "mass" ? "carried_mass_capacity_reached" : "inventory_slots_full";
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
  const { tool } = snapshot;
  const normalDurationTicks = miningAttemptDurationTicks(balance, source, tool, false);
  const boostedDurationTicks = miningAttemptDurationTicks(balance, source, tool, true);
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let remainingCutterCharge = tool ? normalizeCutterCharge(snapshot.cutterCharge, tool) : 0;
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
        awardedXp: totalAwardedXp(resolvedAttempts),
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
        secondaryFinds: [],
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
    // One roll over the source's whole Secondary Find table, only on a success
    // (#308). The preflight above proved the minimum yield fits beside ANY find,
    // so whatever this draws can be kept; it is never rolled and then dropped.
    const find = drawSecondaryFind(award.secondaryFinds, random);
    const findEntries = find ? [stackBundleEntry(find, find.quantity)] : [];
    const placement = (primaryQuantity: number) =>
      planExactStackAdditions(
        stacks,
        [stackBundleEntry(award, primaryQuantity), ...findEntries],
        slotsAvailable,
        massAvailableGrams,
      );
    let quantity = rolledQuantity;
    let placed = placement(quantity);
    // The minimum-fit check authorizes this success. At a final partial stack or
    // mass boundary, retain the valid minimum yield rather than partially adding
    // a two-unit roll. A find that rolled keeps its place: it is part of every
    // plan, so tight capacity shrinks the primary ore, never the find.
    if (!placed.ok) {
      quantity = award.yieldMinimum;
      placed = placement(quantity);
    }
    if (!placed.ok)
      throw new Error("Mining preflight admitted an attempt whose minimum yield cannot be kept");
    // A charged tool's extra ore comes on top of that ordinarily resolved yield
    // (#233), and only when it fits too: no room for the bonus keeps the
    // ordinary result rather than falling back any further. It is PRIMARY ore
    // only; a Secondary Find is never duplicated by it (#308).
    const extra = miningChargedExtraYield(tool, boosted);
    if (extra > 0) {
      const withExtra = placement(quantity + extra);
      if (withExtra.ok) {
        quantity += extra;
        placed = withExtra;
      }
    }
    const applyPlan = (
      plan: StackAdditionPlan<Id>,
      facts: { massGrams: number },
      awardedQuantity: number,
    ) => {
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
      massAvailableGrams -= awardedQuantity * facts.massGrams;
    };
    applyPlan(placed.plans[0]!, award, quantity);
    if (find) applyPlan(placed.plans[1]!, find, find.quantity);
    successes += 1;
    if (boosted) remainingCutterCharge -= 1;
    resolvedAttempts.push({
      success: true,
      rolledBasisPoints,
      thresholdBasisPoints,
      itemId: award.itemId,
      quantityAwarded: quantity,
      secondaryFinds: find ? [{ itemId: find.itemId, quantity: find.quantity }] : [],
      xpAwarded: source.successXp + (find ? find.bonusXp * find.quantity : 0),
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
    awardedXp: totalAwardedXp(resolvedAttempts),
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

/** A resolution's Mining XP is whatever its attempts awarded, finds included. */
function totalAwardedXp(attempts: readonly MiningResolvedAttempt[]): number {
  return attempts.reduce((total, attempt) => total + attempt.xpAwarded, 0);
}
