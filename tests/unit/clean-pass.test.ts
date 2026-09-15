import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  cleanPassClaim,
  cleanPassLifecycle,
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
 *
 * Everything provable without PostgreSQL lives here: where the two
 * opportunities fall, what each one currently is, and whether a claim is valid.
 * That a claim actually advances the work and pays the right XP for Practice
 * and for each repair is server authority, proven against real PostgreSQL in
 * tests/integration/practice-welding.test.ts.
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

function rolled(firstSection: number, secondSection: number): CleanPassState {
  return { firstSection, secondSection, firstOutcome: null, secondOutcome: null };
}

describe("Clean Pass placement", () => {
  it("rolls the first opportunity 2-4 sections in and the second 2-4 after that", () => {
    // Every combination of the two independent rolls, exhaustively.
    for (let first = 0; first < 3; first += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        const sections = rollCleanPassSections(scriptedRandom(first, offset), balance);
        expect(sections.firstSection).toBe(bounds.firstOpportunityMinSection + first);
        expect(sections.secondSection).toBe(
          sections.firstSection + bounds.secondOpportunityMinOffset + offset,
        );
      }
    }
  });

  it("keeps both opportunities inside the authored 2-4 and 4-8 windows", () => {
    for (let roll = 0; roll < 12; roll += 1) {
      const { firstSection, secondSection } = rollCleanPassSections(
        scriptedRandom(roll, roll * 7 + 3),
        balance,
      );
      expect(firstSection).toBeGreaterThanOrEqual(2);
      expect(firstSection).toBeLessThanOrEqual(4);
      expect(secondSection).toBeGreaterThanOrEqual(4);
      expect(secondSection).toBeLessThanOrEqual(8);
    }
  });

  it("spaces the second opportunity so a claimed first can never skip over it", () => {
    // A claimed Clean Pass advances the work exactly one section. With a
    // minimum spacing of two, the second opportunity is still ahead afterwards.
    for (let first = 0; first < 3; first += 1) {
      const state = rolledCleanPass(scriptedRandom(first, 0), balance);
      const claimedAt = state.firstSection!;
      const afterClaim = claimedAt; // progress becomes the claimed section
      expect(state.secondSection!).toBeGreaterThan(afterClaim + 1 - 1);
      expect(cleanPassLifecycle(state, 1, afterClaim)).not.toBe("missed");
    }
  });

  it("leaves an ordinary tail: the last possible opportunity is never the final section", () => {
    // 10-section Practice welds and the 12-section Cargo Hold both end after
    // the last opportunity can fall, so a claim never completes the work unit.
    const latestPossible = bounds.firstOpportunityMaxSection + bounds.secondOpportunityMaxOffset;
    expect(latestPossible).toBe(8);
    expect(latestPossible).toBeLessThan(balance.practiceWelding.sectionsPerWeld);
    expect(latestPossible).toBeLessThan(balance.repairTargets.crewStop.repairIncrements);
    expect(latestPossible).toBeLessThan(balance.repairTargets.cargoHold.repairIncrements);
  });

  it("rejects a randomness source that is not a whole non-negative roll", () => {
    expect(() => rollCleanPassSections({ nextBasisPoints: () => -1 }, balance)).toThrow(RangeError);
    expect(() => rollCleanPassSections({ nextBasisPoints: () => 1.5 }, balance)).toThrow(
      RangeError,
    );
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
    expect(state.firstOutcome).toBeNull();
  });
});

describe("Clean Pass interruption", () => {
  it("durably closes the window the player was in the middle of", () => {
    const interrupted = withOpenCleanPassMissed(rolled(3, 6), 2);
    expect(interrupted.firstOutcome).toBe("missed");
    // And resuming that same partial weld cannot reopen it.
    expect(cleanPassLifecycle(interrupted, 0, 2)).toBe("missed");
    expect(openCleanPassIndex(interrupted, 2)).toBeUndefined();
  });

  it("leaves an opportunity that is still ahead of the work scheduled", () => {
    const interrupted = withOpenCleanPassMissed(rolled(3, 6), 2);
    expect(interrupted.secondOutcome).toBeNull();
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

  it("closes the window exactly one ordinary Welding section after it opens", () => {
    expect(cleanPassWindowExpiresAt(cursor, balance).getTime()).toBe(
      cursor.getTime() + attemptDurationTicks * GAME_TICK_MS,
    );
  });
});
