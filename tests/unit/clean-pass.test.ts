import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  cleanPassClaim,
  cleanPassFromPersisted,
  cleanPassLifecycle,
  cleanPassOpportunityCount,
  cleanPassOpportunityWindows,
  cleanPassToPersisted,
  cleanPassWindowExpiresAt,
  openCleanPassIndex,
  rollCleanPassSections,
  rolledCleanPass,
  UNROLLED_CLEAN_PASS,
  withCleanPassOutcome,
  withOpenCleanPassMissed,
  type CleanPassRandom,
  type CleanPassState,
} from "@/game/domain/clean-pass";
import { GAME_TICK_MS } from "@/game/config/foundations";

/**
 * Issue #190 — Clean Pass, the general Welding opportunity mechanic.
 * Generalized from a fixed two-opportunity model to N opportunities derived
 * from the work unit's own length by #207.
 *
 * Everything provable without PostgreSQL lives here: how many opportunities a
 * work unit of a given length gets, where they fall, what each one currently
 * is, and whether a claim is valid. That a claim actually advances the work
 * and pays the right XP for Practice and for each repair is server authority,
 * proven against real PostgreSQL in tests/integration/practice-welding.test.ts.
 */

const balance = getEffectiveGameBalance();
const { cleanPass: bounds, attemptDurationTicks } = balance.welding;

/** A roll source that replays exactly the basis points it is handed. */
function scriptedRandom(...rolls: readonly number[]): CleanPassRandom {
  let index = 0;
  return {
    nextBasisPoints: () => rolls[index++ % rolls.length]!,
  };
}

/** A rolled state with opportunities at the given sections, in order. */
function rolled(...sections: readonly number[]): CleanPassState {
  return { opportunities: sections.map((section) => ({ section, outcome: null })) };
}

describe("Clean Pass opportunity count", () => {
  it("is floor(totalSections / sectionsPerOpportunity) from the authored minimum up", () => {
    expect(bounds.minimumSectionsForOpportunity).toBe(6);
    expect(bounds.sectionsPerOpportunity).toBe(5);
    const cases: readonly [number, number][] = [
      [0, 0],
      [1, 0],
      [5, 0],
      [6, 1],
      [9, 1],
      [10, 2],
      [14, 2],
      [15, 3],
      [20, 4],
    ];
    for (const [totalSections, expected] of cases) {
      expect(cleanPassOpportunityCount(totalSections, balance)).toBe(expected);
    }
  });

  it("rejects a total section count that is not a non-negative integer", () => {
    expect(() => cleanPassOpportunityCount(-1, balance)).toThrow(RangeError);
    expect(() => cleanPassOpportunityCount(1.5, balance)).toThrow(RangeError);
  });
});

describe("Clean Pass opportunity windows", () => {
  it("matches the authored worked examples exactly", () => {
    const cases: readonly [number, readonly [number, number][]][] = [
      [6, [[2, 4]]],
      [8, [[2, 4]]],
      [
        10,
        [
          [2, 4],
          [6, 8],
        ],
      ],
      [
        12,
        [
          [2, 4],
          [7, 9],
        ],
      ],
      [
        15,
        [
          [2, 4],
          [7, 9],
          [11, 13],
        ],
      ],
      [
        18,
        [
          [2, 4],
          [7, 9],
          [12, 14],
        ],
      ],
      [
        20,
        [
          [2, 4],
          [7, 9],
          [12, 14],
          [16, 18],
        ],
      ],
    ];
    for (const [totalSections, expected] of cases) {
      const windows = cleanPassOpportunityWindows(totalSections, balance);
      expect(windows).toEqual(
        expected.map(([minSection, maxSection]) => ({ minSection, maxSection })),
      );
    }
  });

  it("never lets the last window's opportunity complete the work unit, at any length", () => {
    // The trailing-section invariant is what makes a claim safe on any length:
    // whatever the job's size, an ordinary tail always survives the last
    // opportunity, and every window stays a real, non-overlapping period.
    for (let totalSections = 6; totalSections <= 30; totalSections += 1) {
      const windows = cleanPassOpportunityWindows(totalSections, balance);
      if (windows.length === 0) continue;
      const last = windows[windows.length - 1]!;
      expect(last.maxSection).toBeLessThanOrEqual(totalSections - 2);

      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index]!;
        expect(window.maxSection).toBeGreaterThanOrEqual(window.minSection);
        const next = windows[index + 1];
        if (next) expect(next.minSection).toBeGreaterThan(window.maxSection);
      }
    }
  });

  it("leaves an ordinary tail on every real work unit in the game", () => {
    for (const totalSections of [
      balance.practiceWelding.sectionsPerWeld,
      balance.repairTargets.crewStop.repairIncrements,
      balance.repairTargets.cargoHold.repairIncrements,
    ]) {
      const windows = cleanPassOpportunityWindows(totalSections, balance);
      const last = windows[windows.length - 1]!;
      expect(last.maxSection).toBeLessThan(totalSections);
      expect(last.maxSection).toBeLessThanOrEqual(totalSections - bounds.trailingOrdinarySections);
    }
  });
});

describe("Clean Pass placement", () => {
  it("rolls each opportunity uniformly inside its own window", () => {
    // A ten-section Practice weld gets two opportunities: 2-4, then 6-8.
    const totalSections = balance.practiceWelding.sectionsPerWeld;
    const windows = cleanPassOpportunityWindows(totalSections, balance);
    expect(windows).toEqual([
      { minSection: 2, maxSection: 4 },
      { minSection: 6, maxSection: 8 },
    ]);
    // Every combination of the two independent rolls, exhaustively.
    for (let first = 0; first < 3; first += 1) {
      for (let second = 0; second < 3; second += 1) {
        const sections = rollCleanPassSections(
          scriptedRandom(first, second),
          totalSections,
          balance,
        );
        expect(sections[0]).toBe(windows[0]!.minSection + first);
        expect(sections[1]).toBe(windows[1]!.minSection + second);
      }
    }
  });

  it("keeps every opportunity inside its authored window, on a longer job too", () => {
    // A fifteen-section job gets three opportunities: 2-4, 7-9, 11-13.
    const totalSections = 15;
    const windows = cleanPassOpportunityWindows(totalSections, balance);
    for (let roll = 0; roll < 12; roll += 1) {
      const sections = rollCleanPassSections(
        scriptedRandom(roll, roll * 5 + 1, roll * 7 + 3),
        totalSections,
        balance,
      );
      expect(sections).toHaveLength(3);
      for (let index = 0; index < sections.length; index += 1) {
        expect(sections[index]).toBeGreaterThanOrEqual(windows[index]!.minSection);
        expect(sections[index]).toBeLessThanOrEqual(windows[index]!.maxSection);
      }
    }
  });

  it("spaces opportunities so a claimed one can never skip over the next", () => {
    // A claimed Clean Pass advances the work exactly one section. If a claim
    // lands on the latest possible section of one window, the next window must
    // still be ahead of the work afterwards, not already missed.
    const totalSections = 15;
    for (let first = 0; first < 3; first += 1) {
      const state = rolledCleanPass(scriptedRandom(first, 0, 0), totalSections, balance);
      const claimedAt = state.opportunities![0]!.section;
      expect(cleanPassLifecycle(state, 1, claimedAt)).not.toBe("missed");
    }
  });

  it("gets no opportunities at all below the authored minimum length", () => {
    for (const totalSections of [0, 1, 5]) {
      expect(rollCleanPassSections(scriptedRandom(0), totalSections, balance)).toEqual([]);
      expect(rolledCleanPass(scriptedRandom(0), totalSections, balance)).toEqual({
        opportunities: [],
      });
    }
  });

  it("rejects a randomness source that is not a whole non-negative roll", () => {
    const totalSections = balance.practiceWelding.sectionsPerWeld;
    expect(() =>
      rollCleanPassSections({ nextBasisPoints: () => -1 }, totalSections, balance),
    ).toThrow(RangeError);
    expect(() =>
      rollCleanPassSections({ nextBasisPoints: () => 1.5 }, totalSections, balance),
    ).toThrow(RangeError);
  });
});

describe("Clean Pass lifecycle", () => {
  it("is pending ahead of the work, open during its own section, and missed after", () => {
    const state = rolled(3, 6);
    expect(cleanPassLifecycle(state, 0, 0)).toBe("pending");
    expect(cleanPassLifecycle(state, 0, 1)).toBe("pending");
    expect(cleanPassLifecycle(state, 0, 2)).toBe("open");
    expect(cleanPassLifecycle(state, 0, 3)).toBe("missed");
    expect(cleanPassLifecycle(state, 1, 5)).toBe("open");
  });

  it("has no lifecycle at all before the work unit has rolled", () => {
    expect(cleanPassLifecycle(UNROLLED_CLEAN_PASS, 0, 0)).toBeUndefined();
    expect(openCleanPassIndex(UNROLLED_CLEAN_PASS, 0)).toBeUndefined();
  });

  it("has no lifecycle for an index beyond how many opportunities were rolled", () => {
    const state = rolled(3);
    expect(cleanPassLifecycle(state, 1, 0)).toBeUndefined();
  });

  it("keeps a recorded outcome regardless of how far the work has since got", () => {
    const claimed = withCleanPassOutcome(rolled(3, 6), 0, "claimed");
    expect(cleanPassLifecycle(claimed, 0, 2)).toBe("claimed");
    expect(cleanPassLifecycle(claimed, 0, 9)).toBe("claimed");
    expect(openCleanPassIndex(claimed, 2)).toBeUndefined();
  });

  it("treats an opportunity welded past while away as missed, with no durable write", () => {
    // Offline resolution advances the work; nothing has to be recorded for the
    // opportunities it went through.
    const state = rolled(3, 6);
    expect(cleanPassLifecycle(state, 0, 8)).toBe("missed");
    expect(cleanPassLifecycle(state, 1, 8)).toBe("missed");
    expect(state.opportunities![0]!.outcome).toBeNull();
  });

  it("finds whichever opportunity is open right now, however many were rolled", () => {
    const state = rolled(3, 8, 13);
    expect(openCleanPassIndex(state, 7)).toBe(1);
    expect(openCleanPassIndex(state, 12)).toBe(2);
    expect(openCleanPassIndex(state, 20)).toBeUndefined();
  });
});

describe("Clean Pass interruption", () => {
  it("durably closes the window the player was in the middle of", () => {
    const interrupted = withOpenCleanPassMissed(rolled(3, 6), 2);
    expect(interrupted.opportunities![0]!.outcome).toBe("missed");
    // And resuming that same partial weld cannot reopen it.
    expect(cleanPassLifecycle(interrupted, 0, 2)).toBe("missed");
    expect(openCleanPassIndex(interrupted, 2)).toBeUndefined();
  });

  it("leaves an opportunity that is still ahead of the work scheduled", () => {
    const interrupted = withOpenCleanPassMissed(rolled(3, 6), 2);
    expect(interrupted.opportunities![1]!.outcome).toBeNull();
    expect(cleanPassLifecycle(interrupted, 1, 5)).toBe("open");
  });

  it("changes nothing when no window is open", () => {
    const state = rolled(3, 6);
    expect(withOpenCleanPassMissed(state, 0)).toBe(state);
  });
});

describe("Clean Pass claim", () => {
  const startedAt = new Date("2026-09-15T00:00:00.000Z");
  const cursor = new Date("2026-09-15T00:01:00.000Z");

  it("accepts a claim during the open section", () => {
    expect(
      cleanPassClaim({
        state: rolled(3, 6),
        sectionsCompleted: 2,
        startedAt,
        resolvedThroughAt: cursor,
        now: new Date(cursor.getTime() + 500),
        balance,
      }),
    ).toEqual({ ok: true, index: 0 });
  });

  it("refuses when nothing is open", () => {
    expect(
      cleanPassClaim({
        state: rolled(3, 6),
        sectionsCompleted: 0,
        startedAt,
        resolvedThroughAt: cursor,
        now: cursor,
        balance,
      }),
    ).toEqual({ ok: false, reason: "none_open" });
  });

  it("accepts a claim inside the network grace after its section resolved", () => {
    expect(
      cleanPassClaim({
        state: rolled(3, 6),
        sectionsCompleted: 3,
        startedAt,
        resolvedThroughAt: cursor,
        now: new Date(cursor.getTime() + bounds.claimGraceMs - 1),
        balance,
      }),
    ).toEqual({ ok: true, index: 0 });
  });

  it("refuses once the grace has elapsed", () => {
    expect(
      cleanPassClaim({
        state: rolled(3, 6),
        sectionsCompleted: 3,
        startedAt,
        resolvedThroughAt: cursor,
        now: new Date(cursor.getTime() + bounds.claimGraceMs + 1),
        balance,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("never back-dates a claim onto a fresh Resume", () => {
    // Resuming a partial weld starts the action with the cursor at its start:
    // no section has resolved in this run, so the grace path must not apply to
    // an opportunity this weld went past long ago.
    expect(
      cleanPassClaim({
        state: rolled(3, 6),
        sectionsCompleted: 3,
        startedAt: cursor,
        resolvedThroughAt: cursor,
        now: cursor,
        balance,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a second claim on an opportunity already resolved", () => {
    expect(
      cleanPassClaim({
        state: withCleanPassOutcome(rolled(3, 6), 0, "claimed"),
        sectionsCompleted: 2,
        startedAt,
        resolvedThroughAt: cursor,
        now: cursor,
        balance,
      }),
    ).toEqual({ ok: false, reason: "none_open" });
  });

  it("finds the later opportunity open when the work has already passed the first", () => {
    expect(
      cleanPassClaim({
        state: rolled(3, 8, 13),
        sectionsCompleted: 7,
        startedAt,
        resolvedThroughAt: cursor,
        now: cursor,
        balance,
      }),
    ).toEqual({ ok: true, index: 1 });
  });

  it("closes the window exactly one ordinary Welding section after it opens", () => {
    expect(cleanPassWindowExpiresAt(cursor, balance).getTime()).toBe(
      cursor.getTime() + attemptDurationTicks * GAME_TICK_MS,
    );
  });
});

describe("Clean Pass persistence", () => {
  it("round-trips a rolled state through the persisted JSON shape", () => {
    const state = withCleanPassOutcome(rolled(3, 8, 13), 0, "claimed");
    const persisted = cleanPassToPersisted(state);
    expect(persisted).toEqual([
      { section: 3, outcome: "claimed" },
      { section: 8, outcome: null },
      { section: 13, outcome: null },
    ]);
    expect(cleanPassFromPersisted(persisted)).toEqual(state);
  });

  it("round-trips the unrolled state as null", () => {
    expect(cleanPassToPersisted(UNROLLED_CLEAN_PASS)).toBeNull();
    expect(cleanPassFromPersisted(null)).toEqual(UNROLLED_CLEAN_PASS);
  });

  it("reads anything malformed as unrolled rather than throwing", () => {
    // A corrupt column should cost the player one reroll, not lock them out of
    // their own bench.
    expect(cleanPassFromPersisted("not an array")).toEqual(UNROLLED_CLEAN_PASS);
    expect(cleanPassFromPersisted(undefined)).toEqual(UNROLLED_CLEAN_PASS);
    expect(cleanPassFromPersisted([{ section: 0, outcome: null }])).toEqual(UNROLLED_CLEAN_PASS);
    expect(cleanPassFromPersisted([{ section: 1.5, outcome: null }])).toEqual(UNROLLED_CLEAN_PASS);
    expect(cleanPassFromPersisted([{ section: 3, outcome: "invalid" }])).toEqual(
      UNROLLED_CLEAN_PASS,
    );
    expect(cleanPassFromPersisted([{ outcome: null }])).toEqual(UNROLLED_CLEAN_PASS);
  });
});
