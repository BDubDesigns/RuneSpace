import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getMiningToolDefinition,
  miningSourceForActionId,
  type MiningSourceBalance,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import {
  miningAttemptDurationTicks,
  miningAwardFacts,
  miningPreflightStopReason,
  miningSecondaryFindFacts,
  miningSourceUnlocked,
  miningSuccessChanceBps,
  resolveMining,
  secondaryFindRollSize,
  selectSecondaryFind,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";

/**
 * Harmonic Workings' Rune Fragment Mining (#383): the locked numbers, the Mining 8
 * gate, the uniform 1-or-2 Fragment yield at a flat 130 XP, the one success-only
 * 40-outcome find roll (Intact Runestone 5, Uncut Sapphire 2, none 33), and the
 * capacity modes that protect a rolled find.
 */

const balance = getEffectiveGameBalance();
const harmonic = balance.mining.sources.harmonicMining as MiningSourceBalance;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;
const loadsteel = getMiningToolDefinition(ITEM_IDS.loadsteelCutter, balance)!;
const FRAGMENT = ITEM_IDS.runeFragment;
const RUNESTONE = ITEM_IDS.runestone;
const SAPPHIRE = ITEM_IDS.uncutSapphire;

// Spans of the one 40-outcome roll, in authored order.
const FIRST_RUNESTONE = 0;
const FIRST_SAPPHIRE = 5;
const FIRST_NONE = 7;

type Draws = { basisPoints?: number[]; units?: number[]; integers?: number[] };

/**
 * Scripted draws. An unscripted basis-point draw is 0 (a certain success); an
 * unscripted unit draw is 0 (the lower Fragment); an unscripted integer draw is
 * its exclusive maximum minus one, a roll outside every find span (no find).
 */
function scripted(draws: Draws = {}) {
  const nextInteger = vi.fn(
    (exclusiveMaximum: number) => draws.integers?.shift() ?? exclusiveMaximum - 1,
  );
  const nextUnit = vi.fn(() => draws.units?.shift() ?? 0);
  const random: MiningRandom = {
    nextBasisPoints: () => draws.basisPoints?.shift() ?? 0,
    nextUnit,
    nextInteger,
  };
  return { random, nextInteger, nextUnit };
}

const roomy = {
  miningLevel: 8,
  tool: salvage,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 60_000,
} satisfies MiningSnapshot;

function mine(snapshot: Partial<MiningSnapshot>, draws: Draws, elapsedTicks = 75) {
  const { random, nextInteger, nextUnit } = scripted(draws);
  const outcome = resolveMining({
    elapsedTicks,
    snapshot: { ...roomy, ...snapshot },
    balance,
    source: harmonic,
    random,
  });
  return { outcome, nextInteger, nextUnit };
}

const total = (outcome: ReturnType<typeof mine>["outcome"], itemId: string) =>
  outcome.createdStacks
    .filter((stack) => stack.itemId === itemId)
    .reduce((sum, entry) => sum + entry.quantity, 0);

describe("the Harmonic Workings source's locked values", () => {
  it("is the authored source for its own action, at Harmonic Workings only", () => {
    expect(miningSourceForActionId(ACTION_IDS.harmonicMining, balance)).toBe(harmonic);
    expect(getLocation(LOCATION_IDS.harmonicWorkings)?.availableActionIds).toEqual([
      ACTION_IDS.harmonicMining,
    ]);
    expect(getLocation(LOCATION_IDS.harmonicWorkings)?.mapStatus).toBe("Mining");
    expect(getLocation(LOCATION_IDS.theSurveyLine)?.availableActionIds).toEqual([]);
  });

  it("produces Rune Fragments, 200 g and ten to a stack, unchanged", () => {
    expect(harmonic).toMatchObject({
      itemId: FRAGMENT,
      attemptDurationTicks: 75,
      successAtLevelOneBps: 3_500,
      guaranteedSuccessLevel: 40,
      successRangeBps: 6_500,
      successXp: 130,
      yieldMinimum: 1,
      yieldMaximum: 2,
      requiredMiningLevel: 8,
      lowYield: null,
    });
    expect(getItemDefinition(FRAGMENT, balance)).toMatchObject({
      stackLimit: 10,
      massGrams: 200,
    });
  });

  it("gates at Mining 8: Mining 7 is refused and Mining 8 is accepted", () => {
    expect(miningSourceUnlocked(7, harmonic)).toBe(false);
    expect(miningSourceUnlocked(8, harmonic)).toBe(true);
  });

  it("anchors the curve at Mining 1: 35%, 46.66% at Mining 8, certain at Mining 40", () => {
    expect(miningSuccessChanceBps(1, harmonic)).toBe(3_500);
    expect(miningSuccessChanceBps(8, harmonic)).toBe(4_666);
    expect(miningSuccessChanceBps(39, harmonic)).toBeLessThan(10_000);
    expect(miningSuccessChanceBps(40, harmonic)).toBe(10_000);
    expect(miningSuccessChanceBps(99, harmonic)).toBe(10_000);
  });

  it("takes 75 ticks (45 s) with the basic tool, and the shared Power Cell speed when charged", () => {
    expect(miningAttemptDurationTicks(balance, harmonic, undefined, false)).toBe(75);
    expect(miningAttemptDurationTicks(balance, harmonic, salvage, false)).toBe(75);
    expect(miningAttemptDurationTicks(balance, harmonic, salvage, true)).toBe(38);
    expect(miningAttemptDurationTicks(balance, harmonic, loadsteel, false)).toBe(60);
  });
});

describe("the Harmonic Workings success and yield", () => {
  it("awards one or two Fragments on a true success, with the flat 130 XP", () => {
    const low = mine({}, { units: [0] }).outcome;
    expect(low.attempts[0]).toMatchObject({
      success: true,
      itemId: FRAGMENT,
      quantityAwarded: 1,
      secondaryFinds: [],
      xpAwarded: 130,
    });
    expect(total(low, FRAGMENT)).toBe(1);

    const high = mine({}, { units: [0.99] }).outcome;
    expect(high.attempts[0]).toMatchObject({ quantityAwarded: 2, xpAwarded: 130 });
    expect(high.awardedXp).toBe(130);
  });

  it("awards nothing at all on a miss: no Fragment, no find, no XP", () => {
    const { outcome, nextInteger } = mine({}, { basisPoints: [4_666] });
    expect(outcome.failures).toBe(1);
    expect(outcome.successes).toBe(0);
    expect(outcome.attempts[0]).toMatchObject({
      success: false,
      lowYield: false,
      quantityAwarded: 0,
      secondaryFinds: [],
      xpAwarded: 0,
    });
    expect(outcome.createdStacks).toEqual([]);
    // A miss never rolls the find table.
    expect(nextInteger).not.toHaveBeenCalled();
  });

  it("never grants a Fragment's own +20 secondary bonus for a primary Fragment", () => {
    const { outcome } = mine({}, { units: [0.99] });
    expect(outcome.attempts[0]?.xpAwarded).toBe(130);
  });

  it("a charged Loadsteel Cutter adds one primary Fragment on a full success, not a find", () => {
    const { outcome } = mine(
      { tool: loadsteel, cutterCharge: 1 },
      { units: [0], integers: [FIRST_NONE] },
      60,
    );
    expect(outcome.attempts[0]).toMatchObject({
      success: true,
      boosted: true,
      quantityAwarded: 2,
      secondaryFinds: [],
      xpAwarded: 130,
    });
    const top = mine({ tool: loadsteel, cutterCharge: 1 }, { units: [0.99] }, 60).outcome;
    expect(top.attempts[0]?.quantityAwarded).toBe(3);
  });
});

describe("the one Harmonic Workings Secondary Find roll", () => {
  it("is a single 40-outcome roll: Runestone 5, Sapphire 2, none 33", () => {
    const entries = miningSecondaryFindFacts(balance, harmonic);
    expect(secondaryFindRollSize(entries)).toBe(40);
    const pick = (roll: number) => selectSecondaryFind(entries, roll)?.itemId;
    expect(pick(FIRST_RUNESTONE)).toBe(RUNESTONE);
    expect(pick(4)).toBe(RUNESTONE);
    expect(pick(FIRST_SAPPHIRE)).toBe(SAPPHIRE);
    expect(pick(6)).toBe(SAPPHIRE);
    expect(pick(FIRST_NONE)).toBeUndefined();
    expect(pick(39)).toBeUndefined();
  });

  it("rolls at most one find on a success and never on a failure", () => {
    const { outcome, nextInteger } = mine({}, { units: [0], integers: [FIRST_RUNESTONE] });
    expect(nextInteger).toHaveBeenCalledTimes(1);
    expect(nextInteger).toHaveBeenCalledWith(40);
    expect(outcome.attempts[0]?.secondaryFinds).toEqual([{ itemId: RUNESTONE, quantity: 1 }]);
  });

  it("awards the Intact Runestone silently with zero bonus XP", () => {
    const { outcome } = mine({}, { units: [0], integers: [FIRST_RUNESTONE] });
    expect(outcome.attempts[0]).toMatchObject({ xpAwarded: 130, quantityAwarded: 1 });
    expect(total(outcome, RUNESTONE)).toBe(1);
    const runestone = miningSecondaryFindFacts(balance, harmonic).find(
      (find) => find.itemId === RUNESTONE,
    );
    expect(runestone).toMatchObject({
      bonusXp: 0,
      announce: false,
      stackLimit: 5,
      massGrams: 1_000,
    });
  });

  it("awards the Uncut Sapphire its existing +30 XP once, announced", () => {
    const { outcome } = mine({}, { units: [0], integers: [FIRST_SAPPHIRE] });
    expect(outcome.attempts[0]).toMatchObject({
      xpAwarded: 160,
      secondaryFinds: [{ itemId: SAPPHIRE, quantity: 1 }],
    });
    expect(outcome.awardedXp).toBe(160);
    const sapphire = miningSecondaryFindFacts(balance, harmonic).find(
      (find) => find.itemId === SAPPHIRE,
    );
    expect(sapphire).toMatchObject({ bonusXp: 30, announce: true });
  });

  it("awards no find on a roll outside both spans", () => {
    const { outcome } = mine({}, { units: [0], integers: [FIRST_NONE] });
    expect(outcome.attempts[0]).toMatchObject({ secondaryFinds: [], xpAwarded: 130 });
  });
});

describe("Harmonic Workings' capacity protection", () => {
  // One Fragment (200 g) and one Runestone (1,000 g) are each a possible
  // result; the Off preflight must hold the primary plus the largest single find.
  it("with the setting Off, refuses an attempt that cannot keep a primary plus a 1 kg Runestone", () => {
    expect(
      miningPreflightStopReason({ ...roomy, massAvailableGrams: 1_199 }, balance, harmonic),
    ).toBe("carried_mass_capacity_reached");
    expect(
      miningPreflightStopReason({ ...roomy, massAvailableGrams: 1_200 }, balance, harmonic),
    ).toBeUndefined();
  });

  it("with the setting On, needs only one Fragment and forfeits a find that does not fit", () => {
    const snapshot = {
      prioritizePrimaryResources: true,
      massAvailableGrams: 200,
    };
    expect(miningPreflightStopReason({ ...roomy, ...snapshot }, balance, harmonic)).toBeUndefined();
    const { outcome } = mine(snapshot, { units: [0.99], integers: [FIRST_RUNESTONE] });
    expect(outcome.attempts[0]).toMatchObject({
      quantityAwarded: 1,
      secondaryFinds: [],
      xpAwarded: 130,
    });
    expect(total(outcome, RUNESTONE)).toBe(0);
    expect(outcome.awardedXp).toBe(130);
  });

  it("keeps the Sapphire's announcement and XP out of a rolled but forfeited find", () => {
    const { outcome } = mine(
      { prioritizePrimaryResources: true, massAvailableGrams: 200 },
      { units: [0], integers: [FIRST_SAPPHIRE] },
    );
    expect(outcome.attempts[0]).toMatchObject({ secondaryFinds: [], xpAwarded: 130 });
  });
});

describe("the Harmonic Workings award facts", () => {
  it("projects the Runestone as a valid zero-XP secondary without changing Fragment or Sapphire", () => {
    const award = miningAwardFacts(balance, harmonic);
    expect(award).toMatchObject({ itemId: FRAGMENT, yieldMinimum: 1, yieldMaximum: 2 });
    expect(award.secondaryFinds.map((find) => [find.itemId, find.oneIn, find.bonusXp])).toEqual([
      [RUNESTONE, 8, 0],
      [SAPPHIRE, 20, 30],
    ]);
    expect(balance.items.runeFragment.secondaryFindMiningXp).toBe(20);
    expect(balance.items.uncutSapphire.secondaryFindMiningXp).toBe(30);
  });
});

describe("regression: the existing Mining sources keep their tables", () => {
  it("leaves Stillreach's Prospecting Quarry Stone table and its 600-outcome roll unchanged", () => {
    const stone = balance.mining.sources.stone as MiningSourceBalance;
    expect(secondaryFindRollSize(miningSecondaryFindFacts(balance, stone))).toBe(600);
    expect(stone.secondaryFinds.map((find) => [find.itemId, find.oneIn])).toEqual([
      [ITEM_IDS.runeFragment, 4],
      [ITEM_IDS.uncutQuartz, 6],
      [ITEM_IDS.uncutTopaz, 12],
      [ITEM_IDS.boulder, 200],
    ]);
  });

  it("leaves The Jag's Ferrite Shale and Deep Jag's Galvanite tables unchanged", () => {
    const jag = balance.mining.sources.ferriteShale as MiningSourceBalance;
    const deepJag = balance.mining.sources.galvanite as MiningSourceBalance;
    expect(jag.secondaryFinds.map((find) => find.oneIn)).toEqual([40, 60, 25]);
    expect(deepJag.secondaryFinds.map((find) => find.oneIn)).toEqual([35, 55, 8]);
  });
});
