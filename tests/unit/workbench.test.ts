import { describe, expect, it } from "vitest";
import { WORK_ORDER_IDS } from "@/game/config/foundations";
import { UNROLLED_CLEAN_PASS } from "@/game/domain/clean-pass";
import { UNSTARTED_PRACTICE, type PracticeWeldState } from "@/game/domain/practice-welding";
import type { ActiveWorkOrderState } from "@/game/domain/work-orders";
import {
  deriveWorkbenchOccupancy,
  workbenchIsClear,
  workbenchOccupiedMessage,
  type WorkbenchObservation,
} from "@/game/domain/workbench";

/**
 * Issue #207 — Wade's Workbench holds one unfinished piece of work at a time.
 *
 * Occupancy is derived from the durable state Practice and Work Orders already
 * keep, never from a separate busy flag, so there is exactly one answer to "is
 * anything already on it?" The key case is a STOPPED Practice weld: it is
 * unfinished work, not absent work, and must still occupy the bench.
 */

function observation(overrides: Partial<WorkbenchObservation> = {}): WorkbenchObservation {
  return {
    practice: UNSTARTED_PRACTICE,
    activeWorkOrder: undefined,
    ...overrides,
  };
}

function partialPractice(sectionsCompleted: number): PracticeWeldState {
  return { sectionsCompleted, cycleActive: true, cleanPass: UNROLLED_CLEAN_PASS };
}

const activeWorkOrder: ActiveWorkOrderState = {
  workOrderId: WORK_ORDER_IDS.rennCarryFrame,
  sectionsCompleted: 2,
  cleanPass: UNROLLED_CLEAN_PASS,
};

describe("A clear bench (#207)", () => {
  it("reads as clear with no active Work Order and cycleActive: false", () => {
    const clear = observation();
    expect(deriveWorkbenchOccupancy(clear)).toEqual({ kind: "clear" });
    expect(workbenchIsClear(clear)).toBe(true);
  });
});

describe("An unfinished Practice weld occupies the bench (#207)", () => {
  it("occupies the bench while a weld is still running", () => {
    const running = observation({ practice: partialPractice(4) });
    expect(deriveWorkbenchOccupancy(running)).toEqual({ kind: "practice" });
    expect(workbenchIsClear(running)).toBe(false);
  });

  it("STILL occupies the bench once it has been stopped — the key case", () => {
    // Stopping never refunds the two Scrap already spent, so `cycleActive`
    // stays true with a partial `sectionsCompleted` and no action running.
    // Occupancy is about unfinished work, not a live timer, so this must read
    // exactly the same as the running weld above.
    const stopped = observation({ practice: partialPractice(4) });
    expect(deriveWorkbenchOccupancy(stopped)).toEqual({ kind: "practice" });
    expect(workbenchIsClear(stopped)).toBe(false);
  });
});

describe("An active Work Order occupies the bench (#207)", () => {
  it("occupies the bench and names the Work Order", () => {
    const withJob = observation({ activeWorkOrder });
    expect(deriveWorkbenchOccupancy(withJob)).toEqual({
      kind: "work_order",
      workOrderId: WORK_ORDER_IDS.rennCarryFrame,
    });
    expect(workbenchIsClear(withJob)).toBe(false);
  });

  it("wins over a stopped Practice weld if both are somehow present", () => {
    const both = observation({ practice: partialPractice(4), activeWorkOrder });
    expect(deriveWorkbenchOccupancy(both)).toEqual({
      kind: "work_order",
      workOrderId: WORK_ORDER_IDS.rennCarryFrame,
    });
  });
});

describe("workbenchOccupiedMessage (#207)", () => {
  it("is undefined when the bench is clear", () => {
    expect(workbenchOccupiedMessage(deriveWorkbenchOccupancy(observation()))).toBeUndefined();
  });

  it("differs between an unfinished Practice weld and an active Work Order", () => {
    const practiceMessage = workbenchOccupiedMessage(
      deriveWorkbenchOccupancy(observation({ practice: partialPractice(4) })),
    );
    const workOrderMessage = workbenchOccupiedMessage(
      deriveWorkbenchOccupancy(observation({ activeWorkOrder })),
    );
    expect(practiceMessage).toBe(
      "The Workbench still has an unfinished practice weld on it. Finish it before taking client work.",
    );
    expect(workOrderMessage).toBe(
      "The Workbench already has a client job on it. Finish it before starting anything else.",
    );
    expect(practiceMessage).not.toBe(workOrderMessage);
  });
});
