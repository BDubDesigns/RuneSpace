import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getMiningToolDefinition,
  miningSourceForActionId,
  type MiningSourceBalance,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getItemPresentation } from "@/game/content/item-presentation";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import {
  miningAttemptDurationTicks,
  miningAwardFacts,
  miningPreflightStopReason,
  miningSourceUnlocked,
  miningSuccessChanceBps,
  resolveMining,
  secondaryFindRollSize,
  selectSecondaryFind,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";
import { miningRewardCards } from "@/features/mining/latest-result";

/**
 * Skatboll Oil Shale Mining (#342): the locked numbers, the low-yield outcome,
 * the unbiased 2/3/4 draw, the success-only exclusive secondary table, and the
 * two capacity modes of Prioritize primary resources.
 */

const balance = getEffectiveGameBalance();
const oil = balance.mining.sources.oilShale as MiningSourceBalance;
const jag = balance.mining.sources.ferriteShale as MiningSourceBalance;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;
const loadsteel = getMiningToolDefinition(ITEM_IDS.loadsteelCutter, balance)!;
const OIL = ITEM_IDS.oilShale;
const SLAB = ITEM_IDS.motherlodeSlab;
const SAPPHIRE = ITEM_IDS.uncutSapphire;

type Draws = { basisPoints?: number[]; integers?: number[] };

/**
 * Scripted draws. An unscripted basis-point draw is 0 (a certain success); an
 * unscripted integer draw is its exclusive maximum minus one, which is the
 * largest yield and a roll outside every find span (no find).
 */
function scripted(draws: Draws = {}) {
  const nextInteger = vi.fn(
    (exclusiveMaximum: number) => draws.integers?.shift() ?? exclusiveMaximum - 1,
  );
  const nextUnit = vi.fn(() => 0);
  const random: MiningRandom = {
    nextBasisPoints: () => draws.basisPoints?.shift() ?? 0,
    nextUnit,
    nextInteger,
  };
  return { random, nextInteger, nextUnit };
}

const roomy = {
  miningLevel: 5,
  tool: salvage,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 60_000,
} satisfies MiningSnapshot;

function mine(
  snapshot: Partial<MiningSnapshot>,
  draws: Draws,
  elapsedTicks = 100,
  source: MiningSourceBalance = oil,
) {
  const { random, nextInteger } = scripted(draws);
  const outcome = resolveMining({
    elapsedTicks,
    snapshot: { ...roomy, ...snapshot },
    balance,
    source,
    random,
  });
  return { outcome, nextInteger };
}

const total = (outcome: ReturnType<typeof mine>["outcome"], itemId: string) =>
  outcome.createdStacks
    .filter((stack) => stack.itemId === itemId)
    .reduce((sum, stack) => sum + stack.quantity, 0);

describe("the Oil Shale source's locked values", () => {
  it("is the authored source for its action, produced at 600 g and five to a stack", () => {
    expect(miningSourceForActionId(ACTION_IDS.oilShaleMining, balance)).toBe(oil);
    expect(getItemDefinition(OIL, balance)).toEqual({
      itemId: OIL,
      kind: "stack",
      stackLimit: 5,
      massGrams: 600,
    });
    expect(oil).toMatchObject({
      itemId: OIL,
      attemptDurationTicks: 100,
      successAtLevelOneBps: 3_500,
      guaranteedSuccessLevel: 50,
      successXp: 100,
      yieldMinimum: 2,
      yieldMaximum: 4,
      requiredMiningLevel: 5,
      lowYield: { quantity: 1, xp: 20 },
    });
  });

  it("makes the Motherlode Slab one 12 kg specimen worth 150 Mining XP", () => {
    expect(getItemDefinition(SLAB, balance)).toEqual({
      itemId: SLAB,
      kind: "stack",
      stackLimit: 1,
      massGrams: 12_000,
    });
    expect(balance.items.motherlodeSlab.secondaryFindMiningXp).toBe(150);
    expect(balance.items.uncutSapphire.secondaryFindMiningXp).toBe(30);
  });

  it("anchors the success curve at Mining 1, not at the level-5 access gate", () => {
    expect(miningSuccessChanceBps(1, oil)).toBe(3_500);
    expect(miningSuccessChanceBps(4, oil)).toBe(3_897);
    expect(miningSuccessChanceBps(5, oil)).toBe(4_030);
    expect(miningSuccessChanceBps(49, oil)).toBeLessThan(10_000);
    expect(miningSuccessChanceBps(50, oil)).toBe(10_000);
    expect(miningSuccessChanceBps(99, oil)).toBe(10_000);
  });

  it("is gated by the source: Mining 4 cannot mine, Mining 5 can", () => {
    expect(miningSourceUnlocked(4, oil)).toBe(false);
    expect(miningSourceUnlocked(5, oil)).toBe(true);
    // Every shipped source authors a level of 1, so none of them is newly gated.
    expect(miningSourceUnlocked(1, jag)).toBe(true);
  });

  it("takes 100 ticks (60 seconds) before tool and Power Cell modifiers", () => {
    expect(miningAttemptDurationTicks(balance, oil, undefined, false)).toBe(100);
    expect(miningAttemptDurationTicks(balance, oil, salvage, false)).toBe(100);
    expect(miningAttemptDurationTicks(balance, oil, salvage, true)).toBe(50);
    expect(miningAttemptDurationTicks(balance, oil, loadsteel, false)).toBe(80);
    expect(miningAttemptDurationTicks(balance, oil, loadsteel, true)).toBe(80);
  });
});

describe("the secondary table", () => {
  const finds = miningAwardFacts(balance, oil).secondaryFinds;

  it("is exactly 5% Sapphire, 1% Motherlode Slab and 94% nothing, in one exclusive roll", () => {
    const size = secondaryFindRollSize(finds);
    expect(size).toBe(100);
    const counts = new Map<string, number>();
    for (let roll = 0; roll < size; roll += 1) {
      const find = selectSecondaryFind(finds, roll);
      counts.set(find?.itemId ?? "none", (counts.get(find?.itemId ?? "none") ?? 0) + 1);
    }
    expect(counts.get(SAPPHIRE)).toBe(5);
    expect(counts.get(SLAB)).toBe(1);
    expect(counts.get("none")).toBe(94);
  });

  it("announces only the Motherlode Slab, never a Sapphire from this mine", () => {
    expect(oil.secondaryFinds.map((find) => [find.itemId, find.announce])).toEqual([
      [SAPPHIRE, false],
      [SLAB, true],
    ]);
    // Deep Jag's own Sapphire announcement is unchanged.
    expect(
      balance.mining.sources.galvanite.secondaryFinds.find((find) => find.itemId === SAPPHIRE)
        ?.announce,
    ).toBe(true);
  });

  it("gives the Slab Ultra Rare and keeps the Sapphire's Rare presentation", () => {
    expect(getItemPresentation(SLAB)?.rarity).toBe("ultra_rare");
    expect(getItemPresentation(SAPPHIRE)?.rarity).toBe("rare");
    expect(getItemPresentation(OIL)?.rarity).toBeUndefined();
  });
});

describe("a full success", () => {
  it("draws 2, 3 or 4 Oil Shale uniformly from one integer draw", () => {
    const tally = [0, 0, 0];
    for (let draw = 0; draw < 3; draw += 1) {
      const { outcome } = mine({}, { integers: [draw, 99] });
      expect(outcome.successes).toBe(1);
      const quantity = outcome.attempts[0]!.quantityAwarded;
      tally[quantity - 2] = (tally[quantity - 2] ?? 0) + 1;
    }
    expect(tally).toEqual([1, 1, 1]);
    // It is a single three-way draw: never a coin flip.
    const { nextInteger } = mine({}, { integers: [0, 99] });
    expect(nextInteger).toHaveBeenCalledWith(3);
  });

  it("awards 100 base Mining XP, 130 with a Sapphire and 250 with a Motherlode Slab", () => {
    const plain = mine({}, { integers: [0, 99] }).outcome;
    expect(plain.awardedXp).toBe(100);
    expect(plain.attempts[0]!.secondaryFinds).toEqual([]);

    const sapphire = mine({}, { integers: [0, 0] }).outcome;
    expect(sapphire.attempts[0]!.secondaryFinds).toEqual([{ itemId: SAPPHIRE, quantity: 1 }]);
    expect(sapphire.awardedXp).toBe(130);

    const slab = mine({}, { integers: [0, 5] }).outcome;
    expect(slab.attempts[0]!.secondaryFinds).toEqual([{ itemId: SLAB, quantity: 1 }]);
    expect(slab.awardedXp).toBe(250);
    // Never both on one attempt.
    expect(slab.attempts[0]!.secondaryFinds).toHaveLength(1);
  });

  it("adds the charged Loadsteel Cutter's one ore to a true success only", () => {
    const charged = mine({ tool: loadsteel, cutterCharge: 3 }, { integers: [1, 99] }).outcome;
    expect(charged.attempts[0]).toMatchObject({ success: true, quantityAwarded: 4 });
    expect(charged.remainingCutterCharge).toBe(2);
    // Respecting capacity: only 3 shale fit, so the charged ore is not forced in.
    const tight = mine(
      {
        tool: loadsteel,
        cutterCharge: 3,
        prioritizePrimaryResources: true,
        slotsAvailable: 1,
        massAvailableGrams: 1_800,
      },
      { integers: [1, 99] },
    ).outcome;
    expect(tight.attempts[0]!.quantityAwarded).toBe(3);
  });
});

describe("a low-yield roll", () => {
  // A fresh script per call: draws are consumed as they are made.
  const missedRoll = () => ({ basisPoints: [4_030] });

  it("awards exactly one Oil Shale and 20 Mining XP, not nothing", () => {
    const { outcome } = mine({}, missedRoll());
    expect(outcome).toMatchObject({ successes: 0, failures: 1, awardedXp: 20 });
    expect(outcome.attempts[0]).toMatchObject({
      success: false,
      lowYield: true,
      quantityAwarded: 1,
      xpAwarded: 20,
      secondaryFinds: [],
    });
    expect(total(outcome, OIL)).toBe(1);
  });

  it("never rolls a secondary find or a quantity, and never takes the charged bonus", () => {
    const { outcome, nextInteger } = mine({ tool: loadsteel, cutterCharge: 2 }, missedRoll());
    expect(nextInteger).not.toHaveBeenCalled();
    expect(outcome.attempts[0]).toMatchObject({ quantityAwarded: 1, boosted: true });
    expect(outcome.remainingCutterCharge).toBe(1);
  });

  it("lets Ferrite Shale and Galvanite keep a dead miss that awards nothing", () => {
    const { outcome } = mine({ miningLevel: 1 }, { basisPoints: [3_500] }, 10, jag);
    expect(outcome).toMatchObject({ failures: 1, awardedXp: 0, createdStacks: [] });
    expect(outcome.attempts[0]).toMatchObject({ lowYield: false, quantityAwarded: 0 });
  });

  it("shows its ore and XP as reward cards, and a dead miss as none", () => {
    const lowYield = mine({}, missedRoll()).outcome.attempts[0]!;
    expect(miningRewardCards(lowYield).map((card) => card.kind)).toEqual(["item", "xp"]);
    const dead = mine({ miningLevel: 1 }, { basisPoints: [3_500] }, 10, jag).outcome.attempts[0]!;
    expect(miningRewardCards(dead)).toEqual([]);
  });
});

describe("Prioritize primary resources: Off, the protective default", () => {
  it("refuses unless there is room for 2 shale PLUS any one possible find", () => {
    // One free slot holds the two shale but leaves none for the find.
    expect(miningPreflightStopReason({ ...roomy, slotsAvailable: 1 }, balance, oil)).toBe(
      "inventory_slots_full",
    );
    expect(
      miningPreflightStopReason({ ...roomy, slotsAvailable: 2 }, balance, oil),
    ).toBeUndefined();
    // Mass must hold 2 shale (1,200 g) and the heavier find, the 12 kg Slab.
    expect(
      miningPreflightStopReason({ ...roomy, massAvailableGrams: 1_200 + 100 }, balance, oil),
    ).toBe("carried_mass_capacity_reached");
    expect(
      miningPreflightStopReason({ ...roomy, massAvailableGrams: 1_200 + 12_000 }, balance, oil),
    ).toBeUndefined();
  });

  it("refuses before time, roll or XP is spent", () => {
    const { outcome, nextInteger } = mine({ slotsAvailable: 1 }, {});
    expect(outcome).toMatchObject({
      consumedTicks: 0,
      successes: 0,
      failures: 0,
      awardedXp: 0,
      stopReason: "inventory_slots_full",
    });
    expect(nextInteger).not.toHaveBeenCalled();
  });

  it("keeps a rolled find and shrinks the ore toward its minimum instead", () => {
    // Two slots, mass for the Slab beside two shale only: a rolled 4 becomes 2.
    const { outcome } = mine(
      { slotsAvailable: 2, massAvailableGrams: 1_200 + 12_000 },
      { integers: [2, 5] },
    );
    expect(outcome.attempts[0]).toMatchObject({
      quantityAwarded: 2,
      secondaryFinds: [{ itemId: SLAB, quantity: 1 }],
      xpAwarded: 250,
    });
    expect(total(outcome, OIL)).toBe(2);
    expect(total(outcome, SLAB)).toBe(1);
  });

  it("keeps as much ore as fits, between the minimum and the roll", () => {
    // Mass for the Slab beside exactly three shale: a rolled 4 keeps 3, not just 2.
    const { outcome } = mine(
      { slotsAvailable: 2, massAvailableGrams: 12_000 + 1_800 },
      { integers: [2, 5] },
    );
    expect(outcome.attempts[0]!.quantityAwarded).toBe(3);
    expect(outcome.attempts[0]!.secondaryFinds).toEqual([{ itemId: SLAB, quantity: 1 }]);
  });
});

describe("Prioritize primary resources: On", () => {
  const prioritized = { prioritizePrimaryResources: true };

  it("needs room for just ONE Oil Shale to start", () => {
    expect(
      miningPreflightStopReason({ ...roomy, ...prioritized, slotsAvailable: 1 }, balance, oil),
    ).toBeUndefined();
    expect(
      miningPreflightStopReason(
        { ...roomy, ...prioritized, massAvailableGrams: 600 },
        balance,
        oil,
      ),
    ).toBeUndefined();
    expect(
      miningPreflightStopReason(
        { ...roomy, ...prioritized, massAvailableGrams: 599 },
        balance,
        oil,
      ),
    ).toBe("carried_mass_capacity_reached");
    expect(
      miningPreflightStopReason({ ...roomy, ...prioritized, slotsAvailable: 0 }, balance, oil),
    ).toBe("inventory_slots_full");
  });

  it("retains as much primary ore as fits, down to one, keeping the success and full XP", () => {
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 700 },
      { integers: [2, 99] },
    );
    expect(outcome.successes).toBe(1);
    expect(outcome.attempts[0]).toMatchObject({
      success: true,
      quantityAwarded: 1,
      xpAwarded: 100,
    });
    expect(total(outcome, OIL)).toBe(1);
  });

  it("forfeits a rolled find that has no room after the ore, with no XP or record", () => {
    // One slot: the ore fills it, so the Slab that rolled has nowhere to go.
    const { outcome, nextInteger } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 60_000 },
      { integers: [0, 5] },
    );
    expect(outcome.attempts[0]).toMatchObject({
      success: true,
      secondaryFinds: [],
      xpAwarded: 100,
    });
    expect(outcome.awardedXp).toBe(100);
    expect(total(outcome, SLAB)).toBe(0);
    // Drawn once for the yield and once for the table, and never rerolled.
    expect(nextInteger).toHaveBeenCalledTimes(2);
  });

  it("keeps a rolled find that does fit after the ore", () => {
    const { outcome } = mine({ ...prioritized, slotsAvailable: 2 }, { integers: [0, 5] });
    expect(outcome.attempts[0]).toMatchObject({
      secondaryFinds: [{ itemId: SLAB, quantity: 1 }],
      xpAwarded: 250,
    });
  });

  it("does not swap a dropped find for one that fits", () => {
    // The Slab is 12 kg and does not fit; a Sapphire would, but it never rolled.
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 2, massAvailableGrams: 1_200 + 500 },
      { integers: [0, 5] },
    );
    expect(outcome.attempts[0]!.secondaryFinds).toEqual([]);
    expect(total(outcome, SAPPHIRE)).toBe(0);
  });

  it("still pays exactly one shale and 20 XP for a low yield", () => {
    const { outcome } = mine({ ...prioritized, slotsAvailable: 1 }, { basisPoints: [9_999] });
    expect(outcome.attempts[0]).toMatchObject({
      lowYield: true,
      quantityAwarded: 1,
      xpAwarded: 20,
    });
  });

  it("stops when even one ore no longer fits, across a multi-attempt window", () => {
    // One slot of five: three attempts at up to 4 shale fill it, then the run stops.
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 60_000 },
      { integers: [2, 99, 2, 99, 2, 99] },
      600,
    );
    expect(total(outcome, OIL)).toBe(5);
    expect(outcome.stopReason).toBe("inventory_slots_full");
    expect(outcome.successes).toBe(2);
  });

  it("changes nothing for a source whose full minimum is already one ore, given room", () => {
    const off = mine({ miningLevel: 1 }, {}, 10, jag).outcome;
    const on = mine({ miningLevel: 1, ...prioritized }, {}, 10, jag).outcome;
    expect(on.stackUpdates).toEqual(off.stackUpdates);
    expect(on.createdStacks).toEqual(off.createdStacks);
    expect(on.awardedXp).toBe(off.awardedXp);
  });

  it("lets The Jag start on one free slot where the protective default would refuse", () => {
    const tight = { miningLevel: 1, slotsAvailable: 1 };
    expect(miningPreflightStopReason({ ...roomy, ...tight }, balance, jag)).toBe(
      "inventory_slots_full",
    );
    expect(
      miningPreflightStopReason({ ...roomy, ...tight, ...prioritized }, balance, jag),
    ).toBeUndefined();
  });
});

describe("conservation across a long window", () => {
  it("never awards more than the inventory can hold, with either setting", () => {
    for (const prioritizePrimaryResources of [false, true]) {
      const { outcome } = mine(
        { prioritizePrimaryResources, slotsAvailable: 3, massAvailableGrams: 9_000 },
        { integers: Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 1 : 3)) },
        100 * 20,
      );
      const slots = outcome.createdStacks.length;
      const grams =
        total(outcome, OIL) * 600 + total(outcome, SLAB) * 12_000 + total(outcome, SAPPHIRE) * 100;
      expect(slots).toBeLessThanOrEqual(3);
      expect(grams).toBeLessThanOrEqual(9_000);
      expect(outcome.createdStacks.every((stack) => stack.quantity > 0)).toBe(true);
    }
  });
});

describe("the two new locations", () => {
  it("chain Crash Site <-> South Access Track <-> The South Cut and nothing else", () => {
    expect(areLocationsAdjacent(LOCATION_IDS.crashSite, LOCATION_IDS.southAccessTrack)).toBe(true);
    expect(areLocationsAdjacent(LOCATION_IDS.southAccessTrack, LOCATION_IDS.crashSite)).toBe(true);
    expect(areLocationsAdjacent(LOCATION_IDS.southAccessTrack, LOCATION_IDS.theSouthCut)).toBe(
      true,
    );
    expect(areLocationsAdjacent(LOCATION_IDS.theSouthCut, LOCATION_IDS.crashSite)).toBe(false);
    expect(getLocation(LOCATION_IDS.theSouthCut)?.adjacentLocationIds).toEqual([
      LOCATION_IDS.southAccessTrack,
    ]);
    expect(getLocation(LOCATION_IDS.southAccessTrack)?.adjacentLocationIds).toEqual([
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theSouthCut,
    ]);
  });

  it("puts them at axial (0,2) and (0,3) with the Track hosting no activity", () => {
    const track = getLocation(LOCATION_IDS.southAccessTrack)!;
    const cut = getLocation(LOCATION_IDS.theSouthCut)!;
    expect(track.presentation.localMap.axial).toEqual({ q: 0, r: 2 });
    expect(cut.presentation.localMap.axial).toEqual({ q: 0, r: 3 });
    expect(track.availableActionIds).toEqual([]);
    expect(track.merchantId).toBeUndefined();
    expect(cut.availableActionIds).toEqual([ACTION_IDS.oilShaleMining]);
    expect(track.presentation.scene).toMatchObject({ width: 1536, height: 384 });
    expect(cut.presentation.scene).toMatchObject({ width: 1536, height: 384 });
  });

  it("leaves every shipped location's coordinate and other edges alone", () => {
    expect(getLocation(LOCATION_IDS.crashSite)?.adjacentLocationIds).toEqual([
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.holoHollow,
      LOCATION_IDS.southAccessTrack,
    ]);
    expect(getLocation(LOCATION_IDS.theLongScramble)?.adjacentLocationIds).toEqual([
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theJag,
      LOCATION_IDS.holoHollow,
    ]);
  });
});
