import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  practiceSectionXp,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";
import { UNROLLED_CLEAN_PASS, type CleanPassRandom } from "@/game/domain/clean-pass";
import { planStackAddition, planExactStackRemoval } from "@/game/domain/inventory";
import {
  canBeginPracticeWeld,
  hasResumablePracticeWeld,
  resolvePracticeWelding,
  UNSTARTED_PRACTICE,
  type PracticeSnapshot,
} from "@/game/domain/practice-welding";

/**
 * Issue #190 — Practice Welding rules.
 *
 * The cycle, its inputs and outputs, its XP, and how a run stops are all pure
 * and proven here. Exactly-once Scrap consumption, real inventory writes, the
 * Mission counter, and the Clean Pass claim are server authority, proven
 * against real PostgreSQL in tests/integration/practice-welding.test.ts.
 */

const balance = getEffectiveGameBalance();
const { practiceWelding, welding, items } = balance;
const sectionTicks = welding.attemptDurationTicks;
const sectionXp = practiceSectionXp(balance);

/** Rolls the same placement every time; Clean Pass placement has its own suite. */
const steadyRandom: CleanPassRandom = { nextBasisPoints: () => 0 };

/** Carried Scrap packed the way the inventory planner packs it: full stacks first. */
function scrap(quantity: number): number[] {
  const stacks: number[] = [];
  for (let left = quantity; left > 0; left -= items.scrapMetal.stackLimit) {
    stacks.push(Math.min(items.scrapMetal.stackLimit, left));
  }
  return stacks;
}

function snapshot(overrides: Partial<PracticeSnapshot> = {}): PracticeSnapshot {
  return {
    practice: UNSTARTED_PRACTICE,
    scrapStackQuantities: scrap(6),
    slagStackQuantities: [],
    slotsAvailable: 8,
    massAvailableGrams: 50_000,
    autoDiscardSlag: false,
    finishCurrentWeld: false,
    ...overrides,
  };
}

function resolve(elapsedTicks: number, overrides: Partial<PracticeSnapshot> = {}) {
  return resolvePracticeWelding({
    elapsedTicks,
    snapshot: snapshot(overrides),
    random: steadyRandom,
    balance,
  });
}

describe("Scrap Metal stacks to three (#230)", () => {
  it("is a fungible stack with a limit of exactly three", () => {
    const definition = getItemDefinition(ITEM_IDS.scrapMetal, balance);
    expect(definition).toEqual({
      itemId: ITEM_IDS.scrapMetal,
      kind: "stack",
      stackLimit: 3,
      massGrams: items.scrapMetal.massGrams,
    });
  });

  it("packs six pieces into two full stacks through the ordinary planner", () => {
    const plan = planStackAddition([], ITEM_IDS.scrapMetal, 6, 3, 8, Number.POSITIVE_INFINITY, 0);
    expect(plan.remainingQuantity).toBe(0);
    expect(plan.createdStacks.map((stack) => stack.quantity)).toEqual([3, 3]);
  });

  it("tops up a partial stack before opening a new slot", () => {
    const plan = planStackAddition(
      [{ id: "a", itemId: ITEM_IDS.scrapMetal, quantity: 2 }],
      ITEM_IDS.scrapMetal,
      2,
      3,
      8,
      Number.POSITIVE_INFINITY,
      0,
    );
    expect(plan.updatedStacks).toEqual([{ id: "a", quantity: 3 }]);
    expect(plan.createdStacks).toEqual([{ itemId: ITEM_IDS.scrapMetal, quantity: 1 }]);
  });

  it("will not fit seven pieces into two free slots", () => {
    const plan = planStackAddition([], ITEM_IDS.scrapMetal, 7, 3, 2, Number.POSITIVE_INFINITY, 0);
    expect(plan.remainingQuantity).toBe(1);
  });

  it("spends the smallest stacks first, so a split pair empties the loose piece", () => {
    const stacks = [
      { id: "a", itemId: ITEM_IDS.scrapMetal, quantity: 3 },
      { id: "b", itemId: ITEM_IDS.scrapMetal, quantity: 1 },
    ];
    const removal = planExactStackRemoval(stacks, ITEM_IDS.scrapMetal, 2);
    expect(removal).toEqual({
      ok: true,
      deletedStackIds: ["b"],
      updatedStacks: [{ id: "a", quantity: 2 }],
    });
  });
});

describe("Practice capacity with stacked Scrap (#230)", () => {
  const oneWeld = practiceWelding.sectionsPerWeld * sectionTicks;
  const fullSlag = [items.slag.stackLimit];

  it("frees no slot when a weld's two Scrap come out of one stack of three", () => {
    // Every slot is taken and the only Slag stack is full. The weld spends two
    // of the three pieces, so the Scrap stack survives with one in it and not
    // one slot has opened — the Slag has nowhere to go.
    const resolved = resolve(oneWeld, {
      scrapStackQuantities: [3],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: fullSlag,
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.scrapConsumed).toBe(2);
    expect(resolved.slagKept).toBe(0);
    expect(resolved.slagDiscarded).toBe(practiceWelding.slagPerWeld);
    // The mass freed is real; the slots are not.
    expect(resolved.slagBudget).toEqual({ slots: 0, massGrams: 2 * items.scrapMetal.massGrams });
  });

  it("frees exactly one slot when the pair empties a stack of two", () => {
    const resolved = resolve(oneWeld, {
      scrapStackQuantities: [2],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: fullSlag,
    });
    expect(resolved.slagBudget.slots).toBe(1);
    // Both Slag share the one freed slot, because Slag stacks to ten.
    expect(resolved.slagKept).toBe(practiceWelding.slagPerWeld);
    expect(resolved.slagDiscarded).toBe(0);
  });

  it("frees the one slot the loose piece held when the pair spans two stacks", () => {
    // [1, 2]: removal takes the single piece first (its slot frees) and one
    // from the two (which survives at one). Three pieces is one weld only.
    const resolved = resolve(oneWeld, {
      scrapStackQuantities: [1, 2],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: fullSlag,
    });
    expect(resolved.slagBudget.slots).toBe(1);
    expect(resolved.slagKept).toBe(practiceWelding.slagPerWeld);
  });

  it("frees two slots when the pair is two loose single pieces", () => {
    const resolved = resolve(oneWeld, {
      scrapStackQuantities: [1, 1],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: fullSlag,
    });
    expect(resolved.slagBudget.slots).toBe(2);
    expect(resolved.slagKept).toBe(practiceWelding.slagPerWeld);
  });

  it("counts slots across several welds by what the whole consumption empties", () => {
    // Six pieces as [3, 3], three welds: the first weld frees nothing, the
    // second empties the first stack, the third empties the second. Two slots
    // in total, never the six a per-piece count would claim.
    const resolved = resolve(3 * oneWeld, {
      scrapStackQuantities: [3, 3],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: fullSlag,
    });
    expect(resolved.completedWelds).toBe(3);
    expect(resolved.scrapConsumed).toBe(6);
    expect(resolved.slagBudget.slots).toBe(2);
    // Weld one has no slot and discards both; welds two and three share the
    // freed slots, and Slag stacks to ten, so all four of theirs are kept.
    expect(resolved.resolvedWelds.map((weld) => weld.slagKept)).toEqual([0, 2, 2]);
    expect(resolved.slagDiscarded).toBe(2);
  });

  it("never budgets more slots than persistence's one bulk removal actually frees", () => {
    const scrapPerWeld = practiceWelding.scrapPerWeld;
    for (const stacks of [[3], [2], [1, 3], [3, 3], [1, 2, 3], [2, 2, 2], [1, 1, 3, 3]]) {
      const resolved = resolve(10 * oneWeld, {
        scrapStackQuantities: stacks,
        slotsAvailable: 0,
        massAvailableGrams: 0,
      });
      const removal = planExactStackRemoval(
        stacks.map((quantity, index) => ({ id: index, itemId: ITEM_IDS.scrapMetal, quantity })),
        ITEM_IDS.scrapMetal,
        resolved.scrapConsumed,
      );
      expect(removal.ok).toBe(true);
      if (removal.ok) expect(resolved.slagBudget.slots).toBe(removal.deletedStackIds.length);
      expect(resolved.scrapConsumed % scrapPerWeld).toBe(0);
    }
  });

  it("still keeps no Slag once every slot and mass gram is spoken for", () => {
    const resolved = resolve(oneWeld, {
      scrapStackQuantities: [3],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: [items.slag.stackLimit - 1],
    });
    // One unit tops up the partial Slag stack; the other has no slot.
    expect(resolved.slagKept).toBe(1);
    expect(resolved.slagDiscarded).toBe(1);
  });
});

describe("one Practice weld", () => {
  it("takes ten sections at the ordinary Welding cadence", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks);
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.sectionsResolved).toBe(practiceWelding.sectionsPerWeld);
    expect(resolved.consumedTicks).toBe(practiceWelding.sectionsPerWeld * sectionTicks);
  });

  it("pays the authored share of the normal Welding XP, derived rather than frozen", () => {
    expect(sectionXp).toBe(
      Math.floor((welding.xpPerIncrement * practiceWelding.xpShareBps) / 10_000),
    );
    // The approved playtest value (#191): 10 of the global 50 per section, so a
    // whole ten-section weld is worth 100 Welding XP.
    expect(sectionXp).toBe(10);
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks);
    expect(resolved.awardedXp).toBe(practiceWelding.sectionsPerWeld * sectionXp);
    expect(resolved.awardedXp).toBe(100);
  });

  it("consumes its two Scrap when it begins, not when it finishes", () => {
    // Not one whole section of work has resolved, and the Scrap is already gone.
    const resolved = resolve(sectionTicks - 1);
    expect(resolved.scrapConsumed).toBe(practiceWelding.scrapPerWeld);
    expect(resolved.sectionsResolved).toBe(0);
    expect(resolved.practice.cycleActive).toBe(true);
    expect(resolved.consumedTicks).toBe(0);
  });

  it("produces up to two Slag at completion and nothing before it", () => {
    const partial = resolve((practiceWelding.sectionsPerWeld - 1) * sectionTicks);
    expect(partial.completedWelds).toBe(0);
    expect(partial.slagKept).toBe(0);

    const whole = resolve(practiceWelding.sectionsPerWeld * sectionTicks);
    expect(whole.slagKept).toBe(practiceWelding.slagPerWeld);
    expect(whole.slagDiscarded).toBe(0);
  });

  it("resolves only whole sections; a partial section grants nothing", () => {
    const resolved = resolve(3 * sectionTicks + sectionTicks - 1);
    expect(resolved.sectionsResolved).toBe(3);
    expect(resolved.consumedTicks).toBe(3 * sectionTicks);
    expect(resolved.awardedXp).toBe(3 * sectionXp);
  });
});

describe("Slag at completion time", () => {
  it("keeps what fits and discards only the overflow", () => {
    // Overflow is a RESUME case by construction: a fresh weld frees two slots
    // and 600g the moment it consumes its Scrap, which is always room enough
    // for two Slag. A resumed weld spent that Scrap on a previous visit.
    const resolved = resolve(4 * sectionTicks, {
      practice: {
        sectionsCompleted: 6,
        cycleActive: true,
        cleanPass: UNROLLED_CLEAN_PASS,
      },
      scrapStackQuantities: scrap(0),
      slotsAvailable: 0,
      slagStackQuantities: [items.slag.stackLimit - 1],
    });
    expect(resolved.slagKept).toBe(1);
    expect(resolved.slagDiscarded).toBe(1);
    // Output capacity never blocks the weld itself.
    expect(resolved.completedWelds).toBe(1);
  });

  it("discards both deliberately when the player has chosen Auto-discard", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks, {
      autoDiscardSlag: true,
    });
    expect(resolved.slagKept).toBe(0);
    expect(resolved.slagDiscarded).toBe(practiceWelding.slagPerWeld);
    expect(resolved.completedWelds).toBe(1);
  });

  it("tops up a partly filled Slag stack before opening a new slot", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks, {
      slagStackQuantities: [items.slag.stackLimit - 2],
      slotsAvailable: 0,
    });
    expect(resolved.slagKept).toBe(practiceWelding.slagPerWeld);
  });

  it("never fails a completed weld for want of room", () => {
    const resolved = resolve(4 * sectionTicks, {
      practice: {
        sectionsCompleted: 6,
        cycleActive: true,
        cleanPass: UNROLLED_CLEAN_PASS,
      },
      scrapStackQuantities: scrap(0),
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: [items.slag.stackLimit],
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.slagKept).toBe(0);
    expect(resolved.slagDiscarded).toBe(practiceWelding.slagPerWeld);
  });

  it("has room for a fresh weld's Slag when its Scrap empties a stack", () => {
    // Two Scrap in one stack of two leave a slot and 600g behind when the weld
    // begins; two Slag need one slot and 300g. (A pair that does not empty its
    // stack frees no slot — see the stacked-Scrap capacity suite.)
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks, {
      scrapStackQuantities: [2],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: [items.slag.stackLimit],
    });
    expect(resolved.slagKept).toBe(practiceWelding.slagPerWeld);
    expect(resolved.slagDiscarded).toBe(0);
  });
});

describe("continuous runs", () => {
  it("begins the next weld the instant the last one finishes", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * 3 * sectionTicks, {
      scrapStackQuantities: scrap(6),
    });
    expect(resolved.completedWelds).toBe(3);
    expect(resolved.scrapConsumed).toBe(6);
    expect(resolved.slagKept).toBe(6);
    expect(resolved.stopReason).toBe("out_of_scrap");
  });

  it("resolves a long offline window into as many welds as the Scrap allows", () => {
    const resolved = resolve(60 * 60 * 1_000, { scrapStackQuantities: scrap(10) });
    expect(resolved.completedWelds).toBe(5);
    expect(resolved.scrapConsumed).toBe(10);
    expect(resolved.stopReason).toBe("out_of_scrap");
  });

  it("finishes the weld in progress before stopping for want of Scrap", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * 2 * sectionTicks, {
      scrapStackQuantities: scrap(2),
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.stopReason).toBe("out_of_scrap");
    expect(resolved.practice.cycleActive).toBe(false);
    expect(resolved.practice.sectionsCompleted).toBe(0);
  });

  it("stops immediately when the bench never had enough Scrap", () => {
    const resolved = resolve(100 * sectionTicks, { scrapStackQuantities: scrap(1) });
    expect(resolved.stopReason).toBe("out_of_scrap");
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.sectionsResolved).toBe(0);
    expect(resolved.consumedTicks).toBe(0);
  });

  it("keeps starting fresh welds normally when finishCurrentWeld is explicitly false", () => {
    // Passing the field through at all must not change ordinary continuous
    // behaviour: this mirrors "begins the next weld the instant the last one
    // finishes" above, with the field set instead of defaulted.
    const resolved = resolve(practiceWelding.sectionsPerWeld * 3 * sectionTicks, {
      scrapStackQuantities: scrap(6),
      finishCurrentWeld: false,
    });
    expect(resolved.completedWelds).toBe(3);
    expect(resolved.scrapConsumed).toBe(6);
    expect(resolved.stopReason).toBe("out_of_scrap");
    expect(resolved.finishCurrentWeldHonoured).toBe(false);
  });
});

/**
 * "Stop After Current Weld" (#207): the narrow third intent between
 * ordinary Stop (preserves the partial weld) and letting the run continue
 * (spends two more Scrap the instant this weld completes).
 */
describe("finishing the current weld and stopping", () => {
  const partial = {
    sectionsCompleted: practiceWelding.sectionsPerWeld - 4,
    cycleActive: true,
    cleanPass: UNROLLED_CLEAN_PASS,
  };

  it("lets the already-paid weld finish, spends no further Scrap, and starts no next one", () => {
    const resolved = resolve(4 * sectionTicks, {
      practice: partial,
      scrapStackQuantities: scrap(6),
      finishCurrentWeld: true,
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.stopReason).toBe("finished_current_weld");
    expect(resolved.finishCurrentWeldHonoured).toBe(true);
    expect(resolved.practice.cycleActive).toBe(false);
    expect(resolved.practice.sectionsCompleted).toBe(0);
  });

  it("completes exactly one weld, however much time is left over afterwards", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * 5 * sectionTicks, {
      practice: partial,
      scrapStackQuantities: scrap(20),
      finishCurrentWeld: true,
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.stopReason).toBe("finished_current_weld");
    expect(resolved.practice.cycleActive).toBe(false);
  });

  it("stops immediately, with nothing to finish, when no weld was in progress", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks, {
      scrapStackQuantities: scrap(6),
      finishCurrentWeld: true,
    });
    expect(resolved.completedWelds).toBe(0);
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.stopReason).toBe("finished_current_weld");
    expect(resolved.finishCurrentWeldHonoured).toBe(true);
  });
});

describe("a partial weld the player already paid for", () => {
  const partial = {
    sectionsCompleted: 6,
    cycleActive: true,
    cleanPass: {
      opportunities: [
        { section: 3, outcome: null },
        { section: 6, outcome: null },
      ],
    },
  };

  it("resumes with no Scrap left at all", () => {
    expect(hasResumablePracticeWeld(partial)).toBe(true);
    expect(canBeginPracticeWeld(0, balance)).toBe(false);
    expect(canBeginPracticeWeld(practiceWelding.scrapPerWeld, balance)).toBe(true);

    const resolved = resolve(4 * sectionTicks, {
      practice: partial,
      scrapStackQuantities: scrap(0),
    });
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.awardedXp).toBe(4 * sectionXp);
  });

  it("keeps its already-rolled Clean Pass placement across the resume", () => {
    const resolved = resolve(sectionTicks, { practice: partial, scrapStackQuantities: scrap(0) });
    expect(resolved.practice.cleanPass.opportunities![0]!.section).toBe(3);
    expect(resolved.practice.cleanPass.opportunities![1]!.section).toBe(6);
  });

  it("clears the placement only when that weld is finished", () => {
    const resolved = resolve(4 * sectionTicks, {
      practice: partial,
      scrapStackQuantities: scrap(0),
    });
    expect(resolved.practice.cleanPass).toEqual(UNROLLED_CLEAN_PASS);
    expect(resolved.practice.cycleActive).toBe(false);
  });

  it("rolls a fresh placement for each new weld", () => {
    let call = 0;
    const varying: CleanPassRandom = { nextBasisPoints: () => call++ };
    const first = resolvePracticeWelding({
      elapsedTicks: sectionTicks,
      snapshot: snapshot(),
      random: varying,
      balance,
    });
    const second = resolvePracticeWelding({
      elapsedTicks: sectionTicks,
      snapshot: snapshot(),
      random: varying,
      balance,
    });
    expect(first.practice.cleanPass.opportunities![0]!.section).not.toBe(
      second.practice.cleanPass.opportunities![0]!.section,
    );
  });
});

describe("Practice interruption seams", () => {
  it("is travel-replaceable, like every other ongoing work action", () => {
    expect(isTravelReplaceableAction(ACTION_IDS.practiceWelding)).toBe(true);
  });

  it("rejects a negative or fractional elapsed window", () => {
    expect(() => resolve(-1)).toThrow(RangeError);
    expect(() => resolve(1.5)).toThrow(RangeError);
  });
});
