import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getMiningToolDefinition,
  type MiningSourceBalance,
} from "@/game/config/balance";
import { ITEM_IDS, MERCHANT_IDS } from "@/game/config/foundations";
import { getMerchant } from "@/game/content/merchants";
import { getItemPresentation } from "@/game/content/item-presentation";
import { inventoryStackFillFraction } from "@/game/domain/inventory";
import {
  miningAwardFacts,
  miningPreflightStopReason,
  resolveMining,
  secondaryFindRollSize,
  selectSecondaryFind,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";
import { miningRewardCards } from "@/features/mining/latest-result";

/**
 * Mining Secondary Finds (#308): a successful extraction can turn up a bonus
 * item beside the source's own ore. These tests state the authored tables, the
 * exact one-roll odds, the XP each find owns, and the capacity rule that a
 * rolled find is kept — never silently discarded — however tight the pack is.
 */

const balance = getEffectiveGameBalance();
const jag = balance.mining.sources.ferriteShale as MiningSourceBalance;
const deepJag = balance.mining.sources.galvanite as MiningSourceBalance;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;
const loadsteel = getMiningToolDefinition(ITEM_IDS.loadsteelCutter, balance)!;

const { uncutQuartz: QUARTZ, uncutTopaz: TOPAZ, uncutSapphire: SAPPHIRE } = ITEM_IDS;
const SHALE = ITEM_IDS.ferriteShale;
const GALVANITE = ITEM_IDS.galvanite;

type Draws = { basisPoints?: number[]; units?: number[]; integers?: number[] };

/** Scripted draws; an unscripted basis-point or unit draw is 0 (a certain success, minimum yield). */
function scripted(draws: Draws = {}) {
  const nextInteger = vi.fn(
    (exclusiveMaximum: number) => draws.integers?.shift() ?? exclusiveMaximum - 1,
  );
  const random: MiningRandom = {
    nextBasisPoints: () => draws.basisPoints?.shift() ?? 0,
    nextUnit: () => draws.units?.shift() ?? 0,
    nextInteger,
  };
  return { random, nextInteger };
}

/** The roll value at which a source's table selects `itemId`: the first span's start. */
function rollFor(source: MiningSourceBalance, itemId: string): number {
  const facts = miningAwardFacts(balance, source).secondaryFinds;
  const size = secondaryFindRollSize(facts);
  let start = 0;
  for (const entry of facts) {
    if (entry.itemId === itemId) return start;
    start += size / entry.oneIn;
  }
  throw new Error(`${itemId} is not in the table`);
}

const roomy = {
  miningLevel: 5,
  tool: salvage,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 40_000,
} satisfies MiningSnapshot;

function resolveOne(input: {
  source: MiningSourceBalance;
  snapshot?: Partial<MiningSnapshot>;
  draws?: Draws;
}) {
  const { random, nextInteger } = scripted(input.draws);
  const resolution = resolveMining({
    elapsedTicks: input.source.attemptDurationTicks,
    snapshot: { ...roomy, ...input.snapshot },
    balance,
    source: input.source,
    random,
  });
  return { resolution, nextInteger, attempt: resolution.attempts[0] };
}

describe("the authored Secondary Find content", () => {
  it("gives The Jag Quartz at 1 / 40 and Topaz at 1 / 60, announcing only the Topaz", () => {
    expect(jag.secondaryFinds).toEqual([
      { itemId: QUARTZ, oneIn: 40, announce: false },
      { itemId: TOPAZ, oneIn: 60, announce: true },
    ]);
  });

  it("gives Deep Jag Topaz at 1 / 35 and Sapphire at 1 / 55, announcing only the Sapphire", () => {
    expect(deepJag.secondaryFinds).toEqual([
      { itemId: TOPAZ, oneIn: 35, announce: false },
      { itemId: SAPPHIRE, oneIn: 55, announce: true },
    ]);
  });

  it("defines the three gems as two-to-a-stack, 100 g items", () => {
    for (const itemId of [QUARTZ, TOPAZ, SAPPHIRE]) {
      expect(getItemDefinition(itemId, balance)).toEqual({
        itemId,
        kind: "stack",
        stackLimit: 2,
        massGrams: 100,
      });
    }
  });

  it("makes each item own its bonus Mining XP, so one Topaz is worth the same at both mines", () => {
    const xp = (source: MiningSourceBalance, itemId: string) =>
      miningAwardFacts(balance, source).secondaryFinds.find((find) => find.itemId === itemId)
        ?.bonusXp;
    expect(xp(jag, QUARTZ)).toBe(10);
    expect(xp(jag, TOPAZ)).toBe(20);
    expect(xp(deepJag, TOPAZ)).toBe(20);
    expect(xp(deepJag, SAPPHIRE)).toBe(30);
    // The sources carry no XP of their own for a find.
    for (const entry of [...jag.secondaryFinds, ...deepJag.secondaryFinds]) {
      expect(Object.keys(entry).sort()).toEqual(["announce", "itemId", "oneIn"]);
    }
  });

  it("has Bix buy all three at 8, 18 and 35 Credits, and Wade none", () => {
    const bix = getMerchant(MERCHANT_IDS.bixWeller)!;
    const wade = getMerchant(MERCHANT_IDS.wadeRusk)!;
    const price = (merchant: typeof bix, itemId: string) =>
      merchant.prices.find((line) => line.itemId === itemId);
    expect(price(bix, QUARTZ)).toEqual({ itemId: QUARTZ, buyPrice: 8 });
    expect(price(bix, TOPAZ)).toEqual({ itemId: TOPAZ, buyPrice: 18 });
    expect(price(bix, SAPPHIRE)).toEqual({ itemId: SAPPHIRE, buyPrice: 35 });
    for (const itemId of [QUARTZ, TOPAZ, SAPPHIRE]) expect(price(wade, itemId)).toBeUndefined();
  });

  it("presents the gems with the locked descriptions and the approved art", () => {
    expect(getItemPresentation(QUARTZ)).toMatchObject({
      displayName: "Uncut Quartz",
      artworkSrc: "/item-art/uncut-quartz.webp",
      description:
        "A rough translucent crystal chipped free from the rock. Common enough to recognize, valuable enough to keep.",
    });
    expect(getItemPresentation(TOPAZ)).toMatchObject({
      displayName: "Uncut Topaz",
      artworkSrc: "/item-art/uncut-topaz.webp",
      description:
        "A warm amber crystal pulled from the rock intact. Valuable even in its rough state.",
    });
    expect(getItemPresentation(SAPPHIRE)).toMatchObject({
      displayName: "Uncut Sapphire",
      artworkSrc: "/item-art/uncut-sapphire.webp",
      description:
        "A dense blue crystal with a rough, fractured surface. Rare, heavy-looking, and unmistakably valuable.",
    });
  });

  it("never lets a table's odds exceed certainty", () => {
    for (const source of [jag, deepJag]) {
      const total = source.secondaryFinds.reduce((sum, entry) => sum + 1 / entry.oneIn, 0);
      expect(total).toBeLessThan(1);
    }
  });
});

describe("the one mutually exclusive Secondary Find roll", () => {
  it("draws from a roll of the least common multiple of the denominators", () => {
    expect(secondaryFindRollSize(miningAwardFacts(balance, jag).secondaryFinds)).toBe(120);
    expect(secondaryFindRollSize(miningAwardFacts(balance, deepJag).secondaryFinds)).toBe(385);
    expect(secondaryFindRollSize([])).toBe(1);
  });

  it.each([
    ["The Jag", jag, 120, { [QUARTZ]: 3, [TOPAZ]: 2 }],
    ["Deep Jag", deepJag, 385, { [TOPAZ]: 11, [SAPPHIRE]: 7 }],
  ] as const)(
    "%s selects exactly the authored odds across every outcome",
    (_name, source, size, counts) => {
      const facts = miningAwardFacts(balance, source).secondaryFinds;
      const tally: Record<string, number> = {};
      for (let roll = 0; roll < size; roll += 1) {
        const find = selectSecondaryFind(facts, roll);
        // One roll, at most one find: a single outcome per roll by construction.
        if (find) tally[find.itemId] = (tally[find.itemId] ?? 0) + 1;
      }
      expect(tally).toEqual(counts);
      // 1 / 40 of 120 is 3, 1 / 60 is 2, 1 / 35 of 385 is 11, 1 / 55 is 7.
      for (const entry of facts) expect(tally[entry.itemId]! * entry.oneIn).toBe(size);
    },
  );

  it("refuses a roll outside the table", () => {
    const facts = miningAwardFacts(balance, jag).secondaryFinds;
    expect(() => selectSecondaryFind(facts, -1)).toThrow(RangeError);
    expect(() => selectSecondaryFind(facts, 120)).toThrow(RangeError);
    expect(() => selectSecondaryFind(facts, 1.5)).toThrow(RangeError);
  });
});

describe("resolving a Secondary Find", () => {
  it("awards the find beside the ore, never instead of it", () => {
    const { attempt, resolution } = resolveOne({
      source: jag,
      draws: { integers: [rollFor(jag, TOPAZ)] },
    });
    expect(attempt).toMatchObject({
      success: true,
      itemId: SHALE,
      quantityAwarded: 1,
      secondaryFinds: [{ itemId: TOPAZ, quantity: 1 }],
    });
    expect(resolution.createdStacks).toEqual([
      { itemId: SHALE, quantity: 1 },
      { itemId: TOPAZ, quantity: 1 },
    ]);
  });

  it("adds the find's own XP to the source's: Jag Topaz 15 + 20, Deep Jag Topaz 25 + 20", () => {
    const jagTopaz = resolveOne({ source: jag, draws: { integers: [rollFor(jag, TOPAZ)] } });
    expect(jagTopaz.attempt!.xpAwarded).toBe(35);
    expect(jagTopaz.resolution.awardedXp).toBe(35);
    const deepTopaz = resolveOne({
      source: deepJag,
      draws: { integers: [rollFor(deepJag, TOPAZ)] },
    });
    expect(deepTopaz.attempt!.xpAwarded).toBe(45);
    expect(deepTopaz.resolution.awardedXp).toBe(45);
  });

  it("pays Quartz +10 and Sapphire +30 on top of the source", () => {
    expect(
      resolveOne({ source: jag, draws: { integers: [rollFor(jag, QUARTZ)] } }).attempt!.xpAwarded,
    ).toBe(25);
    expect(
      resolveOne({ source: deepJag, draws: { integers: [rollFor(deepJag, SAPPHIRE)] } }).attempt!
        .xpAwarded,
    ).toBe(55);
  });

  it("totals a batch's XP from its attempts, finds included", () => {
    const { random } = scripted({ integers: [rollFor(jag, QUARTZ), 119, rollFor(jag, TOPAZ)] });
    const resolution = resolveMining({
      elapsedTicks: jag.attemptDurationTicks * 3,
      snapshot: roomy,
      balance,
      source: jag,
      random,
    });
    expect(resolution.attempts.map((attempt) => attempt.xpAwarded)).toEqual([25, 15, 35]);
    expect(resolution.awardedXp).toBe(75);
    expect(resolution.successes).toBe(3);
  });

  it("rolls only on a success and only once", () => {
    const miss = resolveOne({ source: jag, draws: { basisPoints: [9_999] } });
    expect(miss.attempt).toMatchObject({ success: false, secondaryFinds: [] });
    expect(miss.nextInteger).not.toHaveBeenCalled();
    const hit = resolveOne({ source: jag });
    expect(hit.nextInteger).toHaveBeenCalledTimes(1);
    expect(hit.nextInteger).toHaveBeenCalledWith(120);
  });

  it("finds nothing when a roll falls outside every span, or the random cannot roll integers", () => {
    expect(resolveOne({ source: jag, draws: { integers: [5] } }).attempt!.secondaryFinds).toEqual(
      [],
    );
    const withoutIntegers = resolveMining({
      elapsedTicks: jag.attemptDurationTicks,
      snapshot: roomy,
      balance,
      source: jag,
      random: { nextBasisPoints: () => 0, nextUnit: () => 0 },
    });
    expect(withoutIntegers.attempts[0]!.secondaryFinds).toEqual([]);
  });

  it("leaves a source with no authored finds exactly as it was", () => {
    const bare = { ...jag, secondaryFinds: [] } as MiningSourceBalance;
    const { attempt, nextInteger, resolution } = resolveOne({ source: bare });
    expect(nextInteger).not.toHaveBeenCalled();
    expect(attempt).toMatchObject({ quantityAwarded: 1, secondaryFinds: [], xpAwarded: 15 });
    expect(resolution.createdStacks).toEqual([{ itemId: SHALE, quantity: 1 }]);
  });

  it("applies a charged Loadsteel Cutter's +1 to the ore only, never to the find", () => {
    const { attempt, resolution } = resolveOne({
      source: jag,
      snapshot: { tool: loadsteel, cutterCharge: 3 },
      draws: { units: [0.5], integers: [rollFor(jag, TOPAZ)] },
    });
    // Rolled 2 ore + 1 charged bonus; still exactly one Topaz.
    expect(attempt).toMatchObject({
      boosted: true,
      quantityAwarded: 3,
      secondaryFinds: [{ itemId: TOPAZ, quantity: 1 }],
    });
    expect(resolution.createdStacks).toContainEqual({ itemId: TOPAZ, quantity: 1 });
  });
});

describe("capacity for a Secondary Find", () => {
  const stack = (itemId: string, quantity: number, id = `${itemId}-${quantity}`) => ({
    id,
    itemId,
    quantity,
  });
  const preflight = (snapshot: Partial<MiningSnapshot>, source = jag) =>
    miningPreflightStopReason({ ...roomy, ...snapshot }, balance, source);

  it("needs the minimum ore plus any one possible find — but no slot per find", () => {
    // Two empty slots hold one ore and whichever single find turns up.
    expect(preflight({ slotsAvailable: 2 })).toBeUndefined();
    // One slot is not enough for an ore stack and a find stack.
    expect(preflight({ slotsAvailable: 1 })).toBe("inventory_slots_full");
    // The Jag has two possible finds; it still asks for just two slots, not three.
    expect(preflight({ slotsAvailable: 2 }, jag)).toBeUndefined();
  });

  it("lets one hypothetical free slot satisfy whichever candidate find is rolled", () => {
    // Ore tops up its partial stack; the single free slot can hold Quartz OR Topaz.
    expect(preflight({ slotsAvailable: 1, existingStacks: [stack(SHALE, 5)] })).toBeUndefined();
  });

  it("lets existing partial stacks satisfy either side of the check", () => {
    expect(
      preflight({
        slotsAvailable: 0,
        existingStacks: [stack(SHALE, 5), stack(QUARTZ, 1), stack(TOPAZ, 1)],
      }),
    ).toBeUndefined();
    // A partial stack for only one of the two finds leaves the other with nowhere to go.
    expect(
      preflight({
        slotsAvailable: 0,
        existingStacks: [stack(SHALE, 5), stack(QUARTZ, 1)],
      }),
    ).toBe("inventory_slots_full");
  });

  it("stops by mass unless the ore and a 100 g find both fit", () => {
    expect(preflight({ massAvailableGrams: 199 })).toBe("carried_mass_capacity_reached");
    expect(preflight({ massAvailableGrams: 200 })).toBeUndefined();
    // Deep Jag's ore is 400 g.
    expect(preflight({ massAvailableGrams: 499 }, deepJag)).toBe("carried_mass_capacity_reached");
    expect(preflight({ massAvailableGrams: 500 }, deepJag)).toBeUndefined();
  });

  it("keeps the find and shrinks only the ore when slots are tight", () => {
    // 9 / 10 Shale: room for one more ore. A rolled 2 falls back to 1; the Topaz takes the free slot.
    const { attempt, resolution } = resolveOne({
      source: jag,
      snapshot: { slotsAvailable: 1, existingStacks: [stack(SHALE, 9, "shale")] },
      draws: { units: [0.5], integers: [rollFor(jag, TOPAZ)] },
    });
    expect(attempt).toMatchObject({
      quantityAwarded: 1,
      secondaryFinds: [{ itemId: TOPAZ, quantity: 1 }],
    });
    expect(resolution.stackUpdates).toEqual([{ id: "shale", quantity: 10 }]);
    expect(resolution.createdStacks).toEqual([{ itemId: TOPAZ, quantity: 1 }]);
  });

  it("keeps the find and shrinks only the ore when mass is tight", () => {
    // Room for exactly 300 g: a rolled 2 ore (200 g) plus the find (100 g) would
    // fit, but a charged Loadsteel's bonus ore (400 g in all) would not.
    const tight = resolveOne({
      source: jag,
      snapshot: { tool: loadsteel, cutterCharge: 2, massAvailableGrams: 300 },
      draws: { units: [0.5], integers: [rollFor(jag, QUARTZ)] },
    });
    expect(tight.attempt).toMatchObject({
      quantityAwarded: 2,
      secondaryFinds: [{ itemId: QUARTZ, quantity: 1 }],
    });
    // Room for 200 g: the rolled 2 ore leaves nothing for the find, so the ore
    // drops to its minimum and the find is kept.
    const tighter = resolveOne({
      source: jag,
      snapshot: { massAvailableGrams: 200 },
      draws: { units: [0.5], integers: [rollFor(jag, QUARTZ)] },
    });
    expect(tighter.attempt).toMatchObject({
      quantityAwarded: 1,
      secondaryFinds: [{ itemId: QUARTZ, quantity: 1 }],
    });
  });

  it("stops the run once a further attempt could not keep ore plus a possible find", () => {
    // 200 g left: the first attempt is admitted, after which only the ore's 100 g... plus nothing.
    const { random } = scripted({ integers: [119, 119] });
    const resolution = resolveMining({
      elapsedTicks: jag.attemptDurationTicks * 2,
      snapshot: { ...roomy, massAvailableGrams: 200 },
      balance,
      source: jag,
      random,
    });
    expect(resolution.attempts).toHaveLength(1);
    expect(resolution.stopReason).toBe("carried_mass_capacity_reached");
  });

  it("never rolls a find and drops it: whatever it awards lands in the pack", () => {
    // A deterministic spread of tight packs and rolls; every awarded unit must be stored.
    let seed = 308;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % max;
    };
    for (let scenario = 0; scenario < 400; scenario += 1) {
      const source = scenario % 2 === 0 ? jag : deepJag;
      const oreId = source === jag ? SHALE : GALVANITE;
      const existingStacks = [
        ...(next(2) ? [stack(oreId, 1 + next(9), "ore")] : []),
        ...(next(2) ? [stack(TOPAZ, 1, "topaz")] : []),
        ...(next(2) ? [stack(QUARTZ, 1, "quartz")] : []),
      ];
      const attempts = 1 + next(6);
      const random: MiningRandom = {
        nextBasisPoints: () => next(2) * 0, // always a success
        nextUnit: () => next(2) / 2,
        // Bias hard toward finds so most attempts hit one.
        nextInteger: (size) => next(size),
      };
      const tool = next(2) ? loadsteel : salvage;
      const resolution = resolveMining({
        elapsedTicks: source.attemptDurationTicks * attempts,
        snapshot: {
          ...roomy,
          tool,
          cutterCharge: tool === loadsteel ? next(4) : 0,
          existingStacks,
          slotsAvailable: next(4),
          massAvailableGrams: next(6) * 250,
        },
        balance,
        source,
        random,
      });
      const awarded: Record<string, number> = {};
      for (const attempt of resolution.attempts) {
        awarded[attempt.itemId] = (awarded[attempt.itemId] ?? 0) + attempt.quantityAwarded;
        for (const find of attempt.secondaryFinds)
          awarded[find.itemId] = (awarded[find.itemId] ?? 0) + find.quantity;
      }
      const stored: Record<string, number> = {};
      for (const created of resolution.createdStacks)
        stored[created.itemId] = (stored[created.itemId] ?? 0) + created.quantity;
      for (const update of resolution.stackUpdates) {
        const before = existingStacks.find((existing) => existing.id === update.id)!;
        stored[before.itemId] = (stored[before.itemId] ?? 0) + update.quantity - before.quantity;
      }
      expect(stored).toEqual(awarded);
    }
  });
});

describe("the reward cards for an attempt", () => {
  const base = { success: true, itemId: SHALE, quantityAwarded: 2, xpAwarded: 35 };

  it("lists the ore, then each find in resolved order, then the combined XP last", () => {
    expect(
      miningRewardCards({ ...base, secondaryFinds: [{ itemId: TOPAZ, quantity: 1 }] }).map(
        (card) => (card.kind === "item" ? `${card.itemId}${card.found ? "*" : ""}` : "xp"),
      ),
    ).toEqual([SHALE, `${TOPAZ}*`, "xp"]);
  });

  it("maps over however many finds exist rather than assuming today's one", () => {
    const finds = [
      { itemId: QUARTZ, quantity: 1 },
      { itemId: TOPAZ, quantity: 1 },
      { itemId: SAPPHIRE, quantity: 1 },
    ];
    const cards = miningRewardCards({ ...base, secondaryFinds: finds });
    expect(cards).toHaveLength(5);
    expect(cards.at(-1)).toEqual({ kind: "xp", key: "xp", amount: 35 });
  });

  it("is two cards for a plain success and none for a miss", () => {
    expect(miningRewardCards({ ...base, secondaryFinds: [] })).toHaveLength(2);
    expect(
      miningRewardCards({
        success: false,
        itemId: SHALE,
        quantityAwarded: 0,
        xpAwarded: 0,
        secondaryFinds: [],
      }),
    ).toEqual([]);
  });
});

describe("rarity is the item's own presentation", () => {
  it("authors the three uncut gems as rare, and nothing else", () => {
    const rare = Object.values(ITEM_IDS).filter(
      (itemId) => getItemPresentation(itemId)?.rarity === "rare",
    );
    expect(rare.sort()).toEqual([QUARTZ, SAPPHIRE, TOPAZ].sort());
  });

  it("does not depend on any source's table or on announcements", () => {
    // Quartz is rare yet announced nowhere; the announcement flag is separate.
    expect(getItemPresentation(QUARTZ)?.rarity).toBe("rare");
    const quartzEntry = jag.secondaryFinds.find((entry) => entry.itemId === QUARTZ);
    expect(quartzEntry?.announce).toBe(false);
    expect(Object.keys(quartzEntry!).sort()).toEqual(["announce", "itemId", "oneIn"]);
  });
});

describe("a stackable reward's stack fill", () => {
  const stackFill = (card: ReturnType<typeof miningRewardCards>[number]) =>
    card.kind === "item" && card.stackLimit !== undefined
      ? inventoryStackFillFraction(card.quantity, card.stackLimit)
      : undefined;

  it("is the awarded quantity over the canonical stack limit", () => {
    const cards = (itemId: string, quantity: number, find?: string) =>
      miningRewardCards({
        success: true,
        itemId,
        quantityAwarded: quantity,
        xpAwarded: 35,
        secondaryFinds: find ? [{ itemId: find, quantity: 1 }] : [],
      });
    // Ferrite Shale x2 with a limit of 10 is 20%; each gem x1 with a limit of 2 is 50%.
    expect(stackFill(cards(SHALE, 2)[0]!)).toBe(0.2);
    for (const gem of [QUARTZ, TOPAZ, SAPPHIRE]) {
      expect(stackFill(cards(SHALE, 1, gem)[1]!)).toBe(0.5);
    }
  });

  it("gives the combined XP card no stack at all", () => {
    const xp = miningRewardCards({
      success: true,
      itemId: SHALE,
      quantityAwarded: 1,
      xpAwarded: 15,
      secondaryFinds: [],
    }).at(-1)!;
    expect(xp.kind).toBe("xp");
    expect(stackFill(xp)).toBeUndefined();
    expect(xp).not.toHaveProperty("stackLimit");
  });
});
