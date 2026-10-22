import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getMiningToolDefinition,
  miningSourceForActionId,
  type MiningSourceBalance,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
} from "@/game/config/foundations";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getLocalPlace } from "@/game/content/local-places";
import { getMerchant } from "@/game/content/merchants";
import {
  merchantAtVenue,
  merchantPurchasableItemIds,
  merchantSellableItemIds,
  merchantUnitPrice,
} from "@/game/domain/trade";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getLocation } from "@/game/content/locations";
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
 * Stillreach Prospecting Quarry Stone Mining (#379): the locked numbers, the
 * dead miss, the uniform 1-or-2 yield, the 600-outcome success-only exclusive
 * secondary table, and the two capacity modes of Prioritize primary resources.
 */

const balance = getEffectiveGameBalance();
const stone = balance.mining.sources.stone as MiningSourceBalance;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;
const loadsteel = getMiningToolDefinition(ITEM_IDS.loadsteelCutter, balance)!;
const STONE = ITEM_IDS.stone;
const BOULDER = ITEM_IDS.boulder;
const FRAGMENT = ITEM_IDS.runeFragment;
const QUARTZ = ITEM_IDS.uncutQuartz;
const TOPAZ = ITEM_IDS.uncutTopaz;

// Spans of the one 600-outcome roll, in authored order.
const FIRST_FRAGMENT = 0;
const FIRST_QUARTZ = 150;
const FIRST_TOPAZ = 250;
const FIRST_BOULDER = 300;
const FIRST_NONE = 303;

type Draws = { basisPoints?: number[]; units?: number[]; integers?: number[] };

/**
 * Scripted draws. An unscripted basis-point draw is 0 (a certain success); an
 * unscripted unit draw is 0 (the one-Stone side of the coin); an unscripted
 * integer draw is its exclusive maximum minus one, a roll outside every find
 * span (no find).
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
  miningLevel: 1,
  tool: salvage,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 60_000,
} satisfies MiningSnapshot;

function mine(snapshot: Partial<MiningSnapshot>, draws: Draws, elapsedTicks = 33) {
  const { random, nextInteger, nextUnit } = scripted(draws);
  const outcome = resolveMining({
    elapsedTicks,
    snapshot: { ...roomy, ...snapshot },
    balance,
    source: stone,
    random,
  });
  return { outcome, nextInteger, nextUnit };
}

const total = (outcome: ReturnType<typeof mine>["outcome"], itemId: string) =>
  outcome.createdStacks
    .filter((stack) => stack.itemId === itemId)
    .reduce((sum, entry) => sum + entry.quantity, 0);

describe("the Stone source's locked values", () => {
  it("is the authored source for its action, produced at 1 kg and five to a stack", () => {
    expect(miningSourceForActionId(ACTION_IDS.stoneMining, balance)).toBe(stone);
    expect(getItemDefinition(STONE, balance)).toEqual({
      itemId: STONE,
      kind: "stack",
      stackLimit: 5,
      massGrams: 1_000,
    });
    expect(stone).toMatchObject({
      itemId: STONE,
      attemptDurationTicks: 33,
      successAtLevelOneBps: 3_500,
      guaranteedSuccessLevel: 30,
      successXp: 45,
      yieldMinimum: 1,
      yieldMaximum: 2,
      requiredMiningLevel: 1,
      lowYield: null,
    });
  });

  it("anchors the curve at Mining 1: 35% there, certain at Mining 30", () => {
    expect(miningSuccessChanceBps(1, stone)).toBe(3_500);
    expect(miningSuccessChanceBps(29, stone)).toBeLessThan(10_000);
    expect(miningSuccessChanceBps(30, stone)).toBe(10_000);
    expect(miningSuccessChanceBps(99, stone)).toBe(10_000);
    expect(miningSourceUnlocked(1, stone)).toBe(true);
  });

  it("takes 33 ticks (19.8 s) with a basic tool, not the legacy 30 s", () => {
    expect(miningAttemptDurationTicks(balance, stone, undefined, false)).toBe(33);
    expect(miningAttemptDurationTicks(balance, stone, salvage, false)).toBe(33);
    expect(miningAttemptDurationTicks(balance, stone, salvage, true)).toBe(17);
    expect(miningAttemptDurationTicks(balance, stone, loadsteel, false)).toBe(27);
    expect(stone.successXp).not.toBe(70);
    expect(33 * 0.6).toBeCloseTo(19.8);
  });

  it("makes the Boulder one 5 kg Ultra Rare specimen worth 150 Mining XP", () => {
    expect(getItemDefinition(BOULDER, balance)).toEqual({
      itemId: BOULDER,
      kind: "stack",
      stackLimit: 1,
      massGrams: 5_000,
    });
    expect(balance.items.boulder.secondaryFindMiningXp).toBe(150);
    expect(getItemPresentation(BOULDER)?.rarity).toBe("ultra_rare");
    expect(getItemPresentation(STONE)?.rarity).toBeUndefined();
  });

  it("leaves the shared Fragment and gem items untouched", () => {
    expect(balance.items.runeFragment).toMatchObject({
      massGrams: 200,
      stackLimit: 10,
      secondaryFindMiningXp: 20,
    });
    expect(balance.items.uncutQuartz.secondaryFindMiningXp).toBe(10);
    expect(balance.items.uncutTopaz.secondaryFindMiningXp).toBe(20);
  });
});

describe("the secondary table", () => {
  const finds = miningAwardFacts(balance, stone).secondaryFinds;

  it("is one exclusive 600-outcome roll: 150 Fragment, 100 Quartz, 50 Topaz, 3 Boulder, 297 none", () => {
    const size = secondaryFindRollSize(finds);
    expect(size).toBe(600);
    const counts = new Map<string, number>();
    for (let roll = 0; roll < size; roll += 1) {
      const key = selectSecondaryFind(finds, roll)?.itemId ?? "none";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get(FRAGMENT)).toBe(150);
    expect(counts.get(QUARTZ)).toBe(100);
    expect(counts.get(TOPAZ)).toBe(50);
    expect(counts.get(BOULDER)).toBe(3);
    expect(counts.get("none")).toBe(297);
  });

  it("selects at every span boundary", () => {
    const at = (roll: number) => selectSecondaryFind(finds, roll)?.itemId;
    expect([at(FIRST_FRAGMENT), at(FIRST_QUARTZ - 1)]).toEqual([FRAGMENT, FRAGMENT]);
    expect([at(FIRST_QUARTZ), at(FIRST_TOPAZ - 1)]).toEqual([QUARTZ, QUARTZ]);
    expect([at(FIRST_TOPAZ), at(FIRST_BOULDER - 1)]).toEqual([TOPAZ, TOPAZ]);
    expect([at(FIRST_BOULDER), at(FIRST_NONE - 1)]).toEqual([BOULDER, BOULDER]);
    expect([at(FIRST_NONE), at(599)]).toEqual([undefined, undefined]);
    expect(() => selectSecondaryFind(finds, 600)).toThrow(RangeError);
  });

  it("announces only the Boulder, never a Fragment, Quartz or Topaz", () => {
    expect(stone.secondaryFinds.map((find) => [find.itemId, find.oneIn, find.announce])).toEqual([
      [FRAGMENT, 4, false],
      [QUARTZ, 6, false],
      [TOPAZ, 12, false],
      [BOULDER, 200, true],
    ]);
    // The Jag and Deep Jag keep their own announcements.
    expect(
      balance.mining.sources.ferriteShale.secondaryFinds.find((find) => find.itemId === TOPAZ)
        ?.announce,
    ).toBe(true);
  });

  it("offers about 15.9 Rune Fragments an hour at Mining 1 before inventory and downtime", () => {
    const attemptsPerHour = 3_600 / (33 * 0.6);
    const fragments = attemptsPerHour * 0.35 * (1 / 4);
    expect(fragments).toBeCloseTo(15.9, 1);
  });

  it("never authors a whole Runestone", () => {
    expect(stone.secondaryFinds.map((find) => find.itemId)).not.toContain(ITEM_IDS.runestone);
  });
});

describe("a full success", () => {
  it("draws 1 or 2 Stone from one fair coin flip", () => {
    const one = mine({}, { units: [0.49, 0] }).outcome.attempts[0]!;
    const two = mine({}, { units: [0.5, 0] }).outcome.attempts[0]!;
    expect([one.quantityAwarded, two.quantityAwarded]).toEqual([1, 2]);
  });

  it("awards 45 Mining XP and no find on a plain success", () => {
    const { outcome } = mine({}, {});
    expect(outcome).toMatchObject({ successes: 1, failures: 0, awardedXp: 45 });
    expect(outcome.attempts[0]!.secondaryFinds).toEqual([]);
    expect(total(outcome, STONE)).toBe(1);
  });

  it.each([
    ["Rune Fragment", FIRST_FRAGMENT, FRAGMENT, 65],
    ["Uncut Quartz", FIRST_QUARTZ, QUARTZ, 55],
    ["Uncut Topaz", FIRST_TOPAZ, TOPAZ, 65],
    ["Boulder", FIRST_BOULDER, BOULDER, 195],
  ])("a %s roll awards that one item and its own bonus XP", (_name, roll, itemId, xp) => {
    const { outcome } = mine({}, { integers: [roll] });
    expect(outcome.attempts[0]!.secondaryFinds).toEqual([{ itemId, quantity: 1 }]);
    expect(outcome.awardedXp).toBe(xp);
    expect(total(outcome, itemId)).toBe(1);
    expect(total(outcome, STONE)).toBe(1);
  });

  it("draws the table once per success and never twice", () => {
    const { nextInteger } = mine({}, { integers: [FIRST_BOULDER] });
    expect(nextInteger).toHaveBeenCalledTimes(1);
    expect(nextInteger).toHaveBeenCalledWith(600);
  });

  it("keeps a charged Loadsteel's extra Stone on the primary only", () => {
    const { outcome } = mine(
      { miningLevel: 5, tool: loadsteel, cutterCharge: 3 },
      { units: [0.5], integers: [FIRST_BOULDER] },
      27,
    );
    expect(outcome.attempts[0]).toMatchObject({
      quantityAwarded: 3,
      secondaryFinds: [{ itemId: BOULDER, quantity: 1 }],
      xpAwarded: 195,
    });
  });
});

describe("a failed attempt", () => {
  // Success is strictly below 3,500 basis points at Mining 1.
  const missed = () => ({ basisPoints: [3_500] });

  it("is a dead miss: no Stone, no find and no XP", () => {
    const { outcome } = mine({}, missed());
    expect(outcome).toMatchObject({
      successes: 0,
      failures: 1,
      awardedXp: 0,
      createdStacks: [],
      stackUpdates: [],
    });
    expect(outcome.attempts[0]).toMatchObject({
      success: false,
      lowYield: false,
      quantityAwarded: 0,
      xpAwarded: 0,
      secondaryFinds: [],
    });
  });

  it("never rolls a quantity or a find, even with a charge to spend", () => {
    const { nextInteger, nextUnit } = mine(
      { miningLevel: 5, tool: loadsteel, cutterCharge: 2 },
      { basisPoints: [9_999] },
      27,
    );
    expect(nextInteger).not.toHaveBeenCalled();
    expect(nextUnit).not.toHaveBeenCalled();
  });

  it("shows no reward cards", () => {
    expect(miningRewardCards(mine({}, missed()).outcome.attempts[0]!)).toEqual([]);
  });

  it("shows primary, then secondary, then total XP on a success", () => {
    const attempt = mine({}, { integers: [FIRST_TOPAZ] }).outcome.attempts[0]!;
    expect(miningRewardCards(attempt).map((card) => card.kind)).toEqual(["item", "item", "xp"]);
  });
});

describe("Prioritize primary resources: Off, the protective default", () => {
  it("needs room for 1 Stone (1 kg) PLUS any one find, including the 5 kg Boulder", () => {
    // One slot holds the Stone but leaves none for the find.
    expect(miningPreflightStopReason({ ...roomy, slotsAvailable: 1 }, balance, stone)).toBe(
      "inventory_slots_full",
    );
    expect(
      miningPreflightStopReason({ ...roomy, slotsAvailable: 2 }, balance, stone),
    ).toBeUndefined();
    // Mass must hold the Stone and the heaviest find: 1,000 + 5,000.
    expect(miningPreflightStopReason({ ...roomy, massAvailableGrams: 5_999 }, balance, stone)).toBe(
      "carried_mass_capacity_reached",
    );
    expect(
      miningPreflightStopReason({ ...roomy, massAvailableGrams: 6_000 }, balance, stone),
    ).toBeUndefined();
  });

  it("reserves one find, not all of them, so one extra slot is enough", () => {
    expect(
      miningPreflightStopReason(
        { ...roomy, slotsAvailable: 2, massAvailableGrams: 6_000 },
        balance,
        stone,
      ),
    ).toBeUndefined();
  });

  it("uses partial same-item stacks instead of a free slot", () => {
    const partial = {
      ...roomy,
      slotsAvailable: 1,
      existingStacks: [{ id: "s", itemId: STONE, quantity: 3, stackLimit: 5 }],
    } as unknown as MiningSnapshot;
    // The Stone tops up the partial stack; the one free slot takes the find.
    expect(miningPreflightStopReason(partial, balance, stone)).toBeUndefined();
  });

  it("refuses before time, roll or XP is spent", () => {
    const { outcome, nextInteger, nextUnit } = mine({ slotsAvailable: 1 }, {});
    expect(outcome).toMatchObject({
      consumedTicks: 0,
      successes: 0,
      failures: 0,
      awardedXp: 0,
      stopReason: "inventory_slots_full",
    });
    expect(nextInteger).not.toHaveBeenCalled();
    expect(nextUnit).not.toHaveBeenCalled();
  });

  it("keeps a rolled Boulder and shrinks the Stone toward its minimum instead", () => {
    const { outcome } = mine(
      { slotsAvailable: 2, massAvailableGrams: 6_000 },
      { units: [0.5], integers: [FIRST_BOULDER] },
    );
    expect(outcome.attempts[0]).toMatchObject({
      quantityAwarded: 1,
      secondaryFinds: [{ itemId: BOULDER, quantity: 1 }],
      xpAwarded: 195,
    });
  });
});

describe("Prioritize primary resources: On", () => {
  const prioritized = { prioritizePrimaryResources: true };

  it("needs room for just ONE Stone to start", () => {
    expect(
      miningPreflightStopReason({ ...roomy, ...prioritized, slotsAvailable: 1 }, balance, stone),
    ).toBeUndefined();
    expect(
      miningPreflightStopReason(
        { ...roomy, ...prioritized, massAvailableGrams: 1_000 },
        balance,
        stone,
      ),
    ).toBeUndefined();
    expect(
      miningPreflightStopReason(
        { ...roomy, ...prioritized, massAvailableGrams: 999 },
        balance,
        stone,
      ),
    ).toBe("carried_mass_capacity_reached");
    expect(
      miningPreflightStopReason({ ...roomy, ...prioritized, slotsAvailable: 0 }, balance, stone),
    ).toBe("inventory_slots_full");
  });

  it("retains as much Stone as fits, down to one, and keeps the full 45 XP", () => {
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 1_500 },
      { units: [0.5] },
    );
    expect(outcome.attempts[0]).toMatchObject({ success: true, quantityAwarded: 1, xpAwarded: 45 });
  });

  it("forfeits a rolled Boulder with no room: no item, XP or announcement record", () => {
    const { outcome, nextInteger } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 60_000 },
      { integers: [FIRST_BOULDER] },
    );
    expect(outcome.attempts[0]).toMatchObject({ success: true, secondaryFinds: [], xpAwarded: 45 });
    expect(outcome.awardedXp).toBe(45);
    expect(total(outcome, BOULDER)).toBe(0);
    // Drawn once and never rerolled toward a find that would fit.
    expect(nextInteger).toHaveBeenCalledTimes(1);
  });

  it("forfeits a Boulder on mass alone without swapping in a smaller find", () => {
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 3, massAvailableGrams: 1_000 + 4_999 },
      { integers: [FIRST_BOULDER] },
    );
    expect(outcome.attempts[0]!.secondaryFinds).toEqual([]);
    expect(total(outcome, FRAGMENT) + total(outcome, QUARTZ) + total(outcome, TOPAZ)).toBe(0);
  });

  it("keeps a Boulder that does fit after the Stone", () => {
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 2, massAvailableGrams: 6_000 },
      { integers: [FIRST_BOULDER] },
    );
    expect(outcome.attempts[0]).toMatchObject({
      secondaryFinds: [{ itemId: BOULDER, quantity: 1 }],
      xpAwarded: 195,
    });
  });

  it("stops when even one Stone no longer fits, across a multi-attempt window", () => {
    // One slot of five Stone: five successes fill it, then the run stops.
    const { outcome } = mine(
      { ...prioritized, slotsAvailable: 1, massAvailableGrams: 60_000 },
      { units: [0, 0, 0, 0, 0, 0] },
      33 * 10,
    );
    expect(total(outcome, STONE)).toBe(5);
    expect(outcome.successes).toBe(5);
    expect(outcome.stopReason).toBe("inventory_slots_full");
  });
});

describe("conservation across a long window", () => {
  it("never awards more than the inventory can hold, with either setting", () => {
    for (const prioritizePrimaryResources of [false, true]) {
      const { outcome } = mine(
        { prioritizePrimaryResources, slotsAvailable: 3, massAvailableGrams: 9_000 },
        {
          integers: Array.from({ length: 80 }, (_, index) => (index % 3 === 0 ? 300 : 0)),
          units: Array.from({ length: 80 }, (_, index) => (index % 2 === 0 ? 0 : 0.9)),
        },
        33 * 20,
      );
      const grams =
        total(outcome, STONE) * 1_000 +
        total(outcome, BOULDER) * 5_000 +
        total(outcome, FRAGMENT) * 200;
      expect(outcome.createdStacks.length).toBeLessThanOrEqual(3);
      expect(grams).toBeLessThanOrEqual(9_000);
      expect(total(outcome, BOULDER)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the Prospecting Quarry", () => {
  it("is the one Stillreach location that offers Stone Mining", () => {
    const quarry = getLocation(LOCATION_IDS.prospectingQuarry)!;
    expect(quarry.availableActionIds).toEqual([ACTION_IDS.stoneMining]);
    expect(quarry.presentation.localMap.axial).toEqual({ q: 1, r: 1 });
    expect(quarry.description).toMatch(/Stone/);
  });
});

describe("the Stillreach terminal's venue-local Stone buyback", () => {
  const business = getMerchant(MERCHANT_IDS.lastLegTrading)!;
  const terminal = getLocalPlace(LOCAL_PLACE_IDS.stillreachFuelTerminal)!;
  const tolls = getLocalPlace(LOCAL_PLACE_IDS.lastLegTrading)!;

  it("buys Stone at 2 Credits at the terminal and nowhere else", () => {
    const atTerminal = merchantAtVenue(business, terminal);
    expect(merchantUnitPrice(atTerminal, STONE, "sell")).toBe(2);
    expect(merchantSellableItemIds(atTerminal)).toContain(STONE);
    expect(merchantUnitPrice(merchantAtVenue(business, tolls), STONE, "sell")).toBeUndefined();
    expect(merchantUnitPrice(business, STONE, "sell")).toBeUndefined();
  });

  it("never sells Stone and never trades the Boulder", () => {
    const atTerminal = merchantAtVenue(business, terminal);
    expect(merchantPurchasableItemIds(atTerminal)).not.toContain(STONE);
    for (const direction of ["buy", "sell"] as const)
      expect(merchantUnitPrice(atTerminal, BOULDER, direction)).toBeUndefined();
  });

  it("keeps one merchant: identity, unlock and the canister lines are untouched", () => {
    const atTerminal = merchantAtVenue(business, terminal);
    expect(atTerminal.id).toBe(business.id);
    expect(atTerminal.requiredCompletedMissionId).toBe(business.requiredCompletedMissionId);
    expect(atTerminal.prices.slice(0, business.prices.length)).toEqual(business.prices);
    expect(business.prices.some((price) => price.itemId === STONE)).toBe(false);
  });

  it("rejects a venue line that restates one of the merchant's own", () => {
    expect(() =>
      merchantAtVenue(business, { venuePrices: [{ itemId: ITEM_IDS.oilShale, buyPrice: 1 }] }),
    ).toThrow(/duplicates/);
  });
});

describe("the approved item art", () => {
  it.each([
    [STONE, "/item-art/stone.webp"],
    [BOULDER, "/item-art/boulder.webp"],
  ])("serves %s from a committed derivative", (itemId, src) => {
    expect(getItemPresentation(itemId)?.artworkSrc).toBe(src);
    expect(existsSync(resolve(process.cwd(), "public", `.${src}`))).toBe(true);
  });
});
