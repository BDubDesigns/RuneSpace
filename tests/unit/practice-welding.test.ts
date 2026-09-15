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

function snapshot(overrides: Partial<PracticeSnapshot> = {}): PracticeSnapshot {
  return {
    practice: UNSTARTED_PRACTICE,
    scrapAvailable: 6,
    slagStackQuantities: [],
    slotsAvailable: 8,
    massAvailableGrams: 50_000,
    autoDiscardSlag: false,
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

describe("Scrap Metal is fungible but non-stacking", () => {
  it("occupies one ordinary inventory slot per piece", () => {
    const definition = getItemDefinition(ITEM_IDS.scrapMetal, balance);
    expect(definition).toEqual({
      itemId: ITEM_IDS.scrapMetal,
      kind: "stack",
      stackLimit: 1,
      massGrams: items.scrapMetal.massGrams,
    });

    // Six pieces is six stacks, so it is a real carrying decision.
    const plan = planStackAddition([], ITEM_IDS.scrapMetal, 6, 1, 8, Number.POSITIVE_INFINITY, 0);
    expect(plan.remainingQuantity).toBe(0);
    expect(plan.createdStacks).toHaveLength(6);
    expect(plan.createdStacks.every((stack) => stack.quantity === 1)).toBe(true);
  });

  it("will not fit six pieces into five free slots", () => {
    const plan = planStackAddition([], ITEM_IDS.scrapMetal, 6, 1, 5, Number.POSITIVE_INFINITY, 0);
    expect(plan.remainingQuantity).toBe(1);
  });

  it("spends whichever pieces are to hand, because one piece is like any other", () => {
    const stacks = [
      { id: "a", itemId: ITEM_IDS.scrapMetal, quantity: 1 },
      { id: "b", itemId: ITEM_IDS.scrapMetal, quantity: 1 },
      { id: "c", itemId: ITEM_IDS.scrapMetal, quantity: 1 },
    ];
    const removal = planExactStackRemoval(stacks, ITEM_IDS.scrapMetal, 2);
    expect(removal.ok).toBe(true);
    if (removal.ok) expect(removal.deletedStackIds).toHaveLength(2);
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
      scrapAvailable: 0,
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
      scrapAvailable: 0,
      slotsAvailable: 0,
      massAvailableGrams: 0,
      slagStackQuantities: [items.slag.stackLimit],
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.slagKept).toBe(0);
    expect(resolved.slagDiscarded).toBe(practiceWelding.slagPerWeld);
  });

  it("always has room for a fresh weld's Slag, because its Scrap freed the slots", () => {
    // Two non-stacking Scrap leave two slots and 600g behind when the weld
    // begins; two Slag need at most two slots and 300g.
    const resolved = resolve(practiceWelding.sectionsPerWeld * sectionTicks, {
      scrapAvailable: 2,
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
      scrapAvailable: 6,
    });
    expect(resolved.completedWelds).toBe(3);
    expect(resolved.scrapConsumed).toBe(6);
    expect(resolved.slagKept).toBe(6);
    expect(resolved.stopReason).toBe("out_of_scrap");
  });

  it("resolves a long offline window into as many welds as the Scrap allows", () => {
    const resolved = resolve(60 * 60 * 1_000, { scrapAvailable: 10 });
    expect(resolved.completedWelds).toBe(5);
    expect(resolved.scrapConsumed).toBe(10);
    expect(resolved.stopReason).toBe("out_of_scrap");
  });

  it("finishes the weld in progress before stopping for want of Scrap", () => {
    const resolved = resolve(practiceWelding.sectionsPerWeld * 2 * sectionTicks, {
      scrapAvailable: 2,
    });
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.stopReason).toBe("out_of_scrap");
    expect(resolved.practice.cycleActive).toBe(false);
    expect(resolved.practice.sectionsCompleted).toBe(0);
  });

  it("stops immediately when the bench never had enough Scrap", () => {
    const resolved = resolve(100 * sectionTicks, { scrapAvailable: 1 });
    expect(resolved.stopReason).toBe("out_of_scrap");
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.sectionsResolved).toBe(0);
    expect(resolved.consumedTicks).toBe(0);
  });
});

describe("a partial weld the player already paid for", () => {
  const partial = {
    sectionsCompleted: 6,
    cycleActive: true,
    cleanPass: { firstSection: 3, secondSection: 6, firstOutcome: null, secondOutcome: null },
  };

  it("resumes with no Scrap left at all", () => {
    expect(hasResumablePracticeWeld(partial)).toBe(true);
    expect(canBeginPracticeWeld(0, balance)).toBe(false);
    expect(canBeginPracticeWeld(practiceWelding.scrapPerWeld, balance)).toBe(true);

    const resolved = resolve(4 * sectionTicks, { practice: partial, scrapAvailable: 0 });
    expect(resolved.scrapConsumed).toBe(0);
    expect(resolved.completedWelds).toBe(1);
    expect(resolved.awardedXp).toBe(4 * sectionXp);
  });

  it("keeps its already-rolled Clean Pass placement across the resume", () => {
    const resolved = resolve(sectionTicks, { practice: partial, scrapAvailable: 0 });
    expect(resolved.practice.cleanPass.firstSection).toBe(3);
    expect(resolved.practice.cleanPass.secondSection).toBe(6);
  });

  it("clears the placement only when that weld is finished", () => {
    const resolved = resolve(4 * sectionTicks, { practice: partial, scrapAvailable: 0 });
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
    expect(first.practice.cleanPass.firstSection).not.toBe(second.practice.cleanPass.firstSection);
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
