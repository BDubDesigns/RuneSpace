import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveGameBalance,
  getMiningToolDefinition,
  practiceSectionXp,
  type MiningSourceBalance,
  type RepairTargetBalance,
} from "@/game/config/balance";
import { ITEM_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { MINING_FILM_BUFF, WELDING_FILM_BUFF } from "@/game/content/theatre";
import {
  applyMiningXpBonus,
  miningAwardFacts,
  resolveMining,
  secondaryFindRollSize,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";
import { boundedRunAllowance, BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import { UNROLLED_CLEAN_PASS, type CleanPassRandom } from "@/game/domain/clean-pass";
import {
  resolvePracticeWelding,
  UNSTARTED_PRACTICE,
  type PracticeSnapshot,
} from "@/game/domain/practice-welding";
import { applyFilmXpBonus, weldingSectionAward, weldingSectionsAward } from "@/game/domain/theatre";
import { resolveWelding, type RepairTargetState } from "@/game/domain/welding-repair";
import { getRepairTargetBalance } from "@/game/config/balance";

/**
 * Issue #491, slice 3 — the two film buffs' effects, as pure rules.
 *
 * Mining (That Mines Mine!): +5% activity XP added to worn Legendary gear and rounded once per
 * attempt; one extra independent roll over the source's whole Secondary Find table only when a
 * successful extraction's first roll was blank; one charge per COMPLETED attempt, failures
 * included. Welding (Rare or Weld Done?): +10% XP and one charge per completed XP-paying
 * section. Which transaction spends the charge, retries, offline batches and every work type
 * end to end are proven against real PostgreSQL in tests/integration/film-buffs.test.ts.
 */

const balance = getEffectiveGameBalance();
const jag = balance.mining.sources.ferriteShale as MiningSourceBalance;
const southCut = balance.mining.sources.oilShale as MiningSourceBalance;
const harmonic = balance.mining.sources.harmonicMining as MiningSourceBalance;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;

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

/** The roll at which a source's table selects `itemId` (the start of its span). */
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
/** A roll that selects nothing: the last outcome sits past every authored span. */
const blankRoll = (source: MiningSourceBalance) =>
  secondaryFindRollSize(miningAwardFacts(balance, source).secondaryFinds) - 1;

const roomy = {
  miningLevel: 20,
  tool: salvage,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 40_000,
} satisfies MiningSnapshot;

function mine(input: {
  source?: MiningSourceBalance;
  attempts?: number;
  snapshot?: Partial<MiningSnapshot>;
  draws?: Draws;
}) {
  const source = input.source ?? jag;
  const { random, nextInteger } = scripted(input.draws);
  const resolution = resolveMining({
    elapsedTicks: source.attemptDurationTicks * (input.attempts ?? 1),
    snapshot: { ...roomy, ...input.snapshot },
    balance,
    source,
    random,
  });
  return { resolution, nextInteger, attempt: resolution.attempts[0]! };
}

describe("the film XP bonus helper", () => {
  it("rounds up once and leaves zero at zero", () => {
    expect(applyFilmXpBonus(50, 1_000)).toBe(55);
    expect(applyFilmXpBonus(10, 1_000)).toBe(11);
    expect(applyFilmXpBonus(15, 500)).toBe(16);
    expect(applyFilmXpBonus(0, 1_000)).toBe(0);
    expect(applyFilmXpBonus(7, 0)).toBe(7);
  });

  it("rejects values that are not whole non-negative numbers", () => {
    expect(() => applyFilmXpBonus(-1, 500)).toThrow(RangeError);
    expect(() => applyFilmXpBonus(1.5, 500)).toThrow(RangeError);
    expect(() => applyFilmXpBonus(10, -1)).toThrow(RangeError);
  });

  it("carries the locked magnitudes: +5% Mining, +10% Welding", () => {
    expect(MINING_FILM_BUFF.xpBonusBps).toBe(500);
    expect(WELDING_FILM_BUFF.xpBonusBps).toBe(1_000);
  });
});

describe("Mining: the +5% XP, stacked with worn gear and rounded once", () => {
  it("pays 16 / 17 / 18 on a Jag success of 15 with the film alone, plus one and plus two Legendary pieces", () => {
    const xp = (xpBonusBps: number, filmBuffCharges: number) =>
      mine({ snapshot: { xpBonusBps, filmBuffCharges } }).attempt.xpAwarded;
    expect(xp(0, 0)).toBe(15);
    expect(xp(0, 5)).toBe(16);
    expect(xp(500, 5)).toBe(17);
    expect(xp(1_000, 5)).toBe(18);
    // Gear alone is unchanged by the buff existing in the codebase.
    expect(xp(500, 0)).toBe(16);
    expect(xp(1_000, 0)).toBe(17);
  });

  it("adds the percentages before rounding, never rounding the parts separately", () => {
    for (const base of [15, 35, 36, 55, 100]) {
      for (const gear of [0, 500, 1_000]) {
        const together = applyMiningXpBonus(base, gear + MINING_FILM_BUFF.xpBonusBps);
        expect(together, `${base} @ ${gear}`).toBe(
          Math.ceil((base * (10_000 + gear + MINING_FILM_BUFF.xpBonusBps)) / 10_000),
        );
      }
    }
    // The one-piece, film-buffed 15 is 16, not 15 + a separately rounded +5% of 15 and +5% of 15.
    expect(mine({ snapshot: { xpBonusBps: 500, filmBuffCharges: 1 } }).attempt.xpAwarded).toBe(17);
  });

  it("rounds once over the primary and the actually retained secondary find together", () => {
    const topaz = rollFor(jag, ITEM_IDS.uncutTopaz);
    const { attempt } = mine({
      snapshot: { xpBonusBps: 500, filmBuffCharges: 1 },
      draws: { integers: [topaz] },
    });
    const find = miningAwardFacts(balance, jag).secondaryFinds.find(
      (entry) => entry.itemId === ITEM_IDS.uncutTopaz,
    )!;
    expect(attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }]);
    expect(attempt.xpAwarded).toBe(
      applyMiningXpBonus(jag.successXp + find.bonusXp, 500 + MINING_FILM_BUFF.xpBonusBps),
    );
  });

  it("pays a low-yield miss at the South Cut with the bonus, and leaves a dead miss at zero", () => {
    const miss = () => ({ basisPoints: [9_999] });
    const lowYield = mine({ source: southCut, snapshot: { filmBuffCharges: 3 }, draws: miss() });
    expect(lowYield.attempt).toMatchObject({ success: false, lowYield: true, xpAwarded: 21 });
    expect(
      mine({ source: southCut, snapshot: { filmBuffCharges: 0 }, draws: miss() }).attempt.xpAwarded,
    ).toBe(20);
    // The Jag authors no low yield, so a miss earns nothing and stays nothing, though it spends a charge.
    const dead = mine({ snapshot: { filmBuffCharges: 3 }, draws: miss() });
    expect(dead.attempt).toMatchObject({ success: false, xpAwarded: 0, filmBuffed: true });
    expect(dead.resolution.filmChargesConsumed).toBe(1);
  });

  it("changes neither the success chance, the yield, the speed nor what is stored", () => {
    const base = mine({ attempts: 6, draws: { basisPoints: [0, 9_999, 0, 0, 9_999, 0] } });
    const buffed = mine({
      attempts: 6,
      snapshot: { filmBuffCharges: 99 },
      draws: { basisPoints: [0, 9_999, 0, 0, 9_999, 0] },
    });
    expect(buffed.resolution.consumedTicks).toBe(base.resolution.consumedTicks);
    expect(buffed.resolution.successes).toBe(base.resolution.successes);
    expect(buffed.resolution.failures).toBe(base.resolution.failures);
    expect(buffed.resolution.createdStacks).toEqual(base.resolution.createdStacks);
    expect(buffed.resolution.attempts.map((a) => a.thresholdBasisPoints)).toEqual(
      base.resolution.attempts.map((a) => a.thresholdBasisPoints),
    );
    expect(buffed.resolution.attempts.map((a) => a.quantityAwarded)).toEqual(
      base.resolution.attempts.map((a) => a.quantityAwarded),
    );
  });
});

describe("Mining: the blank-only bonus secondary roll", () => {
  const topaz = rollFor(jag, ITEM_IDS.uncutTopaz);
  const quartz = rollFor(jag, ITEM_IDS.uncutQuartz);
  const blank = blankRoll(jag);

  it("rolls a second time only when the first roll was blank, and awards what it finds", () => {
    const { attempt, nextInteger } = mine({
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [blank, topaz] },
    });
    expect(nextInteger).toHaveBeenCalledTimes(2);
    expect(attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }]);
    expect(attempt).toMatchObject({ success: true, filmBuffed: true, filmBonusRoll: true });
  });

  it("makes no second roll when the first roll already found something", () => {
    const { attempt, nextInteger } = mine({
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [quartz, topaz] },
    });
    expect(nextInteger).toHaveBeenCalledTimes(1);
    // The one find is the first roll's, never the second's, and at most one is ever awarded.
    expect(attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.uncutQuartz, quantity: 1 }]);
    expect(attempt).toMatchObject({ filmBuffed: true, filmBonusRoll: false });
  });

  it("lets the one bonus roll be blank too, with no repeated rolling", () => {
    const { attempt, nextInteger } = mine({
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [blank, blank, topaz] },
    });
    expect(nextInteger).toHaveBeenCalledTimes(2);
    expect(attempt.secondaryFinds).toEqual([]);
    expect(attempt).toMatchObject({ filmBuffed: true, filmBonusRoll: true });
  });

  it("makes no bonus roll without a charge, so an unbuffed attempt is bit-for-bit the old one", () => {
    const { attempt, nextInteger } = mine({
      snapshot: { filmBuffCharges: 0 },
      draws: { integers: [blank, topaz] },
    });
    expect(nextInteger).toHaveBeenCalledTimes(1);
    expect(attempt.secondaryFinds).toEqual([]);
    expect(attempt).toMatchObject({ filmBuffed: false, filmBonusRoll: false });
  });

  it("never rolls the table after a failed extraction, though the charge is spent", () => {
    const { attempt, nextInteger, resolution } = mine({
      snapshot: { filmBuffCharges: 1 },
      draws: { basisPoints: [9_999], integers: [topaz] },
    });
    expect(nextInteger).not.toHaveBeenCalled();
    expect(attempt).toMatchObject({ success: false, filmBuffed: true, filmBonusRoll: false });
    expect(attempt.secondaryFinds).toEqual([]);
    expect(resolution.filmChargesConsumed).toBe(1);
  });

  it("draws the second roll over the whole unfiltered table: rare, ultra-rare and Runestone finds", () => {
    const slab = mine({
      source: southCut,
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [blankRoll(southCut), rollFor(southCut, ITEM_IDS.motherlodeSlab)] },
    });
    expect(slab.attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.motherlodeSlab, quantity: 1 }]);
    const stone = mine({
      source: harmonic,
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [blankRoll(harmonic), rollFor(harmonic, ITEM_IDS.runestone)] },
    });
    expect(stone.attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.runestone, quantity: 1 }]);
    // Every entry the source authors is reachable by the bonus roll: nothing is filtered.
    for (const entry of miningAwardFacts(balance, southCut).secondaryFinds) {
      const { attempt } = mine({
        source: southCut,
        snapshot: { filmBuffCharges: 1 },
        draws: { integers: [blankRoll(southCut), rollFor(southCut, entry.itemId)] },
      });
      expect(attempt.secondaryFinds[0]?.itemId).toBe(entry.itemId);
    }
  });

  it("keeps the second-roll find when the pack is tight, like any find (the preflight reserves its room)", () => {
    // One free slot and enough mass for the minimum yield plus any one find: the find still lands.
    const tight = { slotsAvailable: 2, massAvailableGrams: 40_000 };
    const { attempt } = mine({
      snapshot: { filmBuffCharges: 1, ...tight },
      draws: { integers: [blank, topaz] },
    });
    expect(attempt.secondaryFinds).toEqual([{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }]);
  });

  it("forfeits a second-roll find that has no room under Prioritize primary resources, never rerolling", () => {
    const { attempt, nextInteger, resolution } = mine({
      snapshot: { filmBuffCharges: 1, prioritizePrimaryResources: true, slotsAvailable: 1 },
      draws: { integers: [blank, topaz] },
    });
    expect(nextInteger).toHaveBeenCalledTimes(2);
    expect(attempt.success).toBe(true);
    expect(attempt.secondaryFinds).toEqual([]);
    // No find, so no find XP: the attempt pays the ordinary source XP plus the film bonus.
    expect(attempt.xpAwarded).toBe(applyMiningXpBonus(jag.successXp, MINING_FILM_BUFF.xpBonusBps));
    expect(resolution.filmChargesConsumed).toBe(1);
  });

  it("is inert for a source with no secondary table or a random without integer draws", () => {
    const noTable = { ...jag, secondaryFinds: [] } as unknown as MiningSourceBalance;
    const resolved = mine({ source: noTable, snapshot: { filmBuffCharges: 1 } });
    expect(resolved.attempt).toMatchObject({ filmBuffed: true, filmBonusRoll: false });
    expect(resolved.attempt.secondaryFinds).toEqual([]);
  });
});

describe("Mining: one charge per completed attempt", () => {
  const miss = 9_999;

  it("spends a charge on every completed attempt, successes and failures alike", () => {
    const { resolution } = mine({
      attempts: 4,
      snapshot: { filmBuffCharges: 10 },
      draws: { basisPoints: [0, miss, miss, 0] },
    });
    expect(resolution.successes + resolution.failures).toBe(4);
    expect(resolution.filmChargesConsumed).toBe(4);
    expect(resolution.remainingFilmCharges).toBe(6);
    expect(resolution.attempts.every((attempt) => attempt.filmBuffed)).toBe(true);
  });

  it("spends nothing for an attempt the window cannot complete", () => {
    const duration = jag.attemptDurationTicks;
    const partial = resolveMining({
      elapsedTicks: duration - 1,
      snapshot: { ...roomy, filmBuffCharges: 5 },
      balance,
      source: jag,
      random: scripted().random,
    });
    expect(partial.attempts).toHaveLength(0);
    expect(partial.filmChargesConsumed).toBe(0);
    expect(partial.remainingFilmCharges).toBe(5);
    // One whole attempt and a bit more: only the whole one is spent.
    const oneAndABit = resolveMining({
      elapsedTicks: duration + duration - 1,
      snapshot: { ...roomy, filmBuffCharges: 5 },
      balance,
      source: jag,
      random: scripted().random,
    });
    expect(oneAndABit.attempts).toHaveLength(1);
    expect(oneAndABit.filmChargesConsumed).toBe(1);
  });

  it("runs out partway through a batch: exactly the charged attempts are buffed, the rest ordinary", () => {
    const { resolution } = mine({
      attempts: 5,
      snapshot: { filmBuffCharges: 2, xpBonusBps: 0 },
    });
    expect(resolution.attempts.map((attempt) => attempt.filmBuffed)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(resolution.attempts.map((attempt) => attempt.xpAwarded)).toEqual([16, 16, 15, 15, 15]);
    expect(resolution.filmChargesConsumed).toBe(2);
    expect(resolution.remainingFilmCharges).toBe(0);
  });

  it("ends the buff on exactly its last charge: the attempt after it is unbuffed and rolls no bonus", () => {
    const blank = blankRoll(jag);
    const { resolution, nextInteger } = mine({
      attempts: 2,
      snapshot: { filmBuffCharges: 1 },
      draws: { integers: [blank, rollFor(jag, ITEM_IDS.uncutTopaz), blank] },
    });
    expect(resolution.attempts[0]).toMatchObject({ filmBuffed: true, filmBonusRoll: true });
    expect(resolution.attempts[1]).toMatchObject({ filmBuffed: false, filmBonusRoll: false });
    // Attempt one: blank then bonus roll. Attempt two: its one ordinary roll only.
    expect(nextInteger).toHaveBeenCalledTimes(3);
  });

  it("spends nothing when a preflight stop (a full pack) refuses the attempt before it begins", () => {
    const { resolution } = mine({
      attempts: 3,
      snapshot: { filmBuffCharges: 5, slotsAvailable: 0, massAvailableGrams: 0 },
    });
    expect(resolution.stopReason).toBeDefined();
    expect(resolution.attempts).toHaveLength(0);
    expect(resolution.filmChargesConsumed).toBe(0);
    expect(resolution.remainingFilmCharges).toBe(5);
  });

  it("stops mid-run on capacity having spent charges only for the attempts that completed", () => {
    // Room for the first success's ore only: the second attempt's preflight refuses.
    const { resolution } = mine({
      attempts: 3,
      snapshot: { filmBuffCharges: 5, slotsAvailable: 1, massAvailableGrams: 40_000 },
      draws: { basisPoints: [0, 0, 0], units: [0, 0, 0] },
    });
    expect(resolution.stopReason).toBeDefined();
    expect(resolution.filmChargesConsumed).toBe(resolution.attempts.length);
    expect(resolution.remainingFilmCharges).toBe(5 - resolution.attempts.length);
  });

  it("never lets the balance go below zero, and rejects a balance that could not exist", () => {
    for (const charges of [0, 1, 3]) {
      const { resolution } = mine({ attempts: 9, snapshot: { filmBuffCharges: charges } });
      expect(resolution.remainingFilmCharges).toBeGreaterThanOrEqual(0);
      expect(resolution.filmChargesConsumed).toBe(Math.min(charges, resolution.attempts.length));
    }
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => mine({ snapshot: { filmBuffCharges: bad } })).toThrow(RangeError);
    }
  });

  it("resolves a batch the same as the attempts one at a time, charges and XP included", () => {
    const draws = () => ({ basisPoints: [0, miss, 0, 0, miss, 0] });
    const batch = mine({ attempts: 6, snapshot: { filmBuffCharges: 4 }, draws: draws() });
    let remaining = 4;
    const oneByOne: number[] = [];
    const queue = draws().basisPoints;
    for (let index = 0; index < 6; index += 1) {
      const step = mine({
        snapshot: { filmBuffCharges: remaining },
        draws: { basisPoints: [queue[index]!] },
      });
      remaining = step.resolution.remainingFilmCharges;
      oneByOne.push(step.attempt.xpAwarded);
    }
    expect(batch.resolution.attempts.map((attempt) => attempt.xpAwarded)).toEqual(oneByOne);
    expect(batch.resolution.remainingFilmCharges).toBe(remaining);
  });
});

describe("Welding: the section award", () => {
  it("pays +10% and spends one charge per completed section while charges remain", () => {
    expect(weldingSectionAward({ sectionXp: 50, remainingCharges: 3 })).toEqual({
      xp: 55,
      chargeConsumed: true,
    });
    expect(weldingSectionAward({ sectionXp: 10, remainingCharges: 1 })).toEqual({
      xp: 11,
      chargeConsumed: true,
    });
    expect(weldingSectionAward({ sectionXp: 50, remainingCharges: 0 })).toEqual({
      xp: 50,
      chargeConsumed: false,
    });
  });

  it("spends nothing on a section that pays no XP", () => {
    expect(weldingSectionAward({ sectionXp: 0, remainingCharges: 5 })).toEqual({
      xp: 0,
      chargeConsumed: false,
    });
    expect(weldingSectionsAward({ sections: 4, sectionXp: 0, remainingCharges: 5 })).toEqual({
      xp: 0,
      chargesConsumed: 0,
    });
  });

  it("is a batch of single awards: the buff runs out partway and pays ordinary XP after", () => {
    for (const sectionXp of [10, 40, 50]) {
      for (let sections = 0; sections <= 8; sections += 1) {
        for (let charges = 0; charges <= 9; charges += 2) {
          let remaining = charges;
          let xp = 0;
          let consumed = 0;
          for (let index = 0; index < sections; index += 1) {
            const award = weldingSectionAward({ sectionXp, remainingCharges: remaining });
            xp += award.xp;
            if (award.chargeConsumed) {
              remaining -= 1;
              consumed += 1;
            }
          }
          expect(weldingSectionsAward({ sections, sectionXp, remainingCharges: charges })).toEqual({
            xp,
            chargesConsumed: consumed,
          });
        }
      }
    }
  });

  it("rejects a balance or a section count that could not exist", () => {
    expect(() => weldingSectionAward({ sectionXp: 50, remainingCharges: -1 })).toThrow(RangeError);
    expect(() =>
      weldingSectionsAward({ sections: -1, sectionXp: 50, remainingCharges: 1 }),
    ).toThrow(RangeError);
  });
});

describe("Welding: repairs", () => {
  const target = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
  const allMaterials = Object.fromEntries(
    (target as RepairTargetBalance).materials.map((requirement) => [
      requirement.itemId,
      requirement.quantity,
    ]),
  );
  const state = (weldingProgress = 0): RepairTargetState => ({
    materials: allMaterials,
    weldingProgress,
    cleanPass: UNROLLED_CLEAN_PASS,
    completedAt: null,
  });
  const weld = (sections: number, filmBuffCharges?: number, progress = 0) =>
    resolveWelding({
      elapsedTicks: sections * balance.welding.attemptDurationTicks,
      snapshot: state(progress),
      target,
      balance,
      ...(filmBuffCharges === undefined ? {} : { filmBuffCharges }),
    });

  it("pays 55 instead of 50 per completed section and spends one charge each", () => {
    expect(weld(1, 5)).toMatchObject({ awardedXp: 55, filmChargesConsumed: 1 });
    expect(weld(4, 10)).toMatchObject({ awardedXp: 220, filmChargesConsumed: 4 });
    expect(weld(4)).toMatchObject({ awardedXp: 200, filmChargesConsumed: 0 });
    expect(weld(4, 0)).toMatchObject({ awardedXp: 200, filmChargesConsumed: 0 });
  });

  it("runs out partway through a batch, paying the bonus to the last charge only", () => {
    expect(weld(5, 3)).toMatchObject({ awardedXp: 3 * 55 + 2 * 50, filmChargesConsumed: 3 });
    expect(weld(5, 5)).toMatchObject({ awardedXp: 5 * 55, filmChargesConsumed: 5 });
  });

  it("changes neither the timing nor the progress, and a partial section earns and spends nothing", () => {
    const withBuff = weld(3, 9);
    const without = weld(3);
    expect(withBuff.consumedTicks).toBe(without.consumedTicks);
    expect(withBuff.completedIncrements).toBe(without.completedIncrements);
    expect(withBuff.weldingProgress).toBe(without.weldingProgress);
    const partial = resolveWelding({
      elapsedTicks: balance.welding.attemptDurationTicks - 1,
      snapshot: state(),
      target,
      balance,
      filmBuffCharges: 5,
    });
    expect(partial).toMatchObject({ completedIncrements: 0, awardedXp: 0, filmChargesConsumed: 0 });
  });

  it("spends nothing when the work cannot weld: materials missing, or already complete", () => {
    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: { ...state(), materials: {} },
        target,
        balance,
        filmBuffCharges: 5,
      }),
    ).toMatchObject({ awardedXp: 0, filmChargesConsumed: 0, stopReason: "materials_incomplete" });
    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: { ...state(target.repairIncrements), completedAt: new Date() },
        target,
        balance,
        filmBuffCharges: 5,
      }),
    ).toMatchObject({ awardedXp: 0, filmChargesConsumed: 0, stopReason: "completed" });
  });

  it("charges only the sections that remain on a nearly finished repair", () => {
    const left = 3;
    const result = weld(10, 10, target.repairIncrements - left);
    expect(result).toMatchObject({
      completedIncrements: left,
      awardedXp: left * 55,
      filmChargesConsumed: left,
      completed: true,
    });
  });
});

describe("Welding: Practice", () => {
  const sectionXp = practiceSectionXp(balance);
  const { practiceWelding, welding, items } = balance;
  const steady: CleanPassRandom = { nextBasisPoints: () => 0 };
  const scrapStacks = (quantity: number): number[] => {
    const stacks: number[] = [];
    for (let left = quantity; left > 0; left -= items.scrapMetal.stackLimit) {
      stacks.push(Math.min(items.scrapMetal.stackLimit, left));
    }
    return stacks;
  };
  const snapshot = (overrides: Partial<PracticeSnapshot> = {}): PracticeSnapshot => ({
    practice: UNSTARTED_PRACTICE,
    scrapStackQuantities: scrapStacks(8),
    slagStackQuantities: [],
    slotsAvailable: 8,
    massAvailableGrams: 50_000,
    autoDiscardSlag: false,
    finishCurrentWeld: false,
    runAllowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    ...overrides,
  });
  const practice = (sections: number, overrides: Partial<PracticeSnapshot> = {}) =>
    resolvePracticeWelding({
      elapsedTicks: sections * welding.attemptDurationTicks,
      snapshot: snapshot(overrides),
      random: steady,
      balance,
    });

  it("pays 22 instead of 20 per completed Practice section and spends one charge each", () => {
    expect(sectionXp).toBe(20);
    expect(practice(4, { filmBuffCharges: 20 })).toMatchObject({
      sectionsResolved: 4,
      awardedXp: 88,
      filmChargesConsumed: 4,
    });
    expect(practice(4)).toMatchObject({ awardedXp: 80, filmChargesConsumed: 0 });
  });

  it("runs out mid-weld, and the weld's own XP record shows exactly what it paid", () => {
    const sections = practiceWelding.sectionsPerWeld;
    const result = practice(sections, { filmBuffCharges: 4 });
    expect(result.completedWelds).toBe(1);
    expect(result.awardedXp).toBe(4 * 22 + (sections - 4) * 20);
    expect(result.filmChargesConsumed).toBe(4);
    expect(result.resolvedWelds[0]!.xpGained).toBe(result.awardedXp);
  });

  it("runs out partway through a multi-weld batch, with per-weld XP summing to the total", () => {
    const sections = practiceWelding.sectionsPerWeld;
    const result = practice(sections * 3, { filmBuffCharges: sections + 5 });
    expect(result.completedWelds).toBe(3);
    expect(result.filmChargesConsumed).toBe(sections + 5);
    expect(result.resolvedWelds.map((weld) => weld.xpGained)).toEqual([
      sections * 22,
      5 * 22 + (sections - 5) * 20,
      sections * 20,
    ]);
    expect(result.resolvedWelds.reduce((sum, weld) => sum + weld.xpGained, 0)).toBe(
      result.awardedXp,
    );
  });

  it("charges a partial weld's completed sections and never a partial section", () => {
    const result = practice(3, { filmBuffCharges: 20 });
    expect(result.completedWelds).toBe(0);
    expect(result.filmChargesConsumed).toBe(3);
    const partialSection = resolvePracticeWelding({
      elapsedTicks: welding.attemptDurationTicks * 2 - 1,
      snapshot: snapshot({ filmBuffCharges: 20 }),
      random: steady,
      balance,
    });
    expect(partialSection.sectionsResolved).toBe(1);
    expect(partialSection.filmChargesConsumed).toBe(1);
  });

  it("changes no Scrap, Slag or timing", () => {
    const sections = practiceWelding.sectionsPerWeld;
    const withBuff = practice(sections, { filmBuffCharges: 50 });
    const without = practice(sections);
    expect(withBuff.scrapConsumed).toBe(without.scrapConsumed);
    expect(withBuff.slagKept).toBe(without.slagKept);
    expect(withBuff.consumedTicks).toBe(without.consumedTicks);
    expect(withBuff.sectionsResolved).toBe(without.sectionsResolved);
  });

  it("spends nothing when no section completes (no Scrap, or too little time)", () => {
    expect(
      practice(5, {
        filmBuffCharges: 9,
        scrapStackQuantities: [],
        runAllowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
      }),
    ).toMatchObject({ sectionsResolved: 0, filmChargesConsumed: 0, awardedXp: 0 });
    expect(
      resolvePracticeWelding({
        elapsedTicks: welding.attemptDurationTicks - 1,
        snapshot: snapshot({ filmBuffCharges: 9 }),
        random: steady,
        balance,
      }),
    ).toMatchObject({ filmChargesConsumed: 0, awardedXp: 0 });
  });
});
