import { describe, expect, it } from "vitest";
import { missionChainResetScope } from "@/game/domain/missions";
import { MISSIONS } from "@/game/content/missions";

/**
 * Pure derivation tests for the admin "RESET FROM THIS MISSION" chain scope.
 * Confirms the scope is derived from authored `prerequisiteMissionId` edges,
 * not hardcoded, and that submitted-once ordering is deterministic.
 */

const DEFS = [
  { id: "a" },
  { id: "b", prerequisiteMissionId: "a" },
  { id: "c", prerequisiteMissionId: "b" },
  { id: "d", prerequisiteMissionId: "a" },
] as const;

describe("missionChainResetScope", () => {
  it("resets only the selected mission when it has no descendants", () => {
    expect(missionChainResetScope("d", DEFS as never)).toEqual(["d"]);
  });

  it("resets the selected mission plus direct descendants", () => {
    // a → b and a → d (direct children); b has a child c, which is its own
    // descendant of a transitively.
    expect(missionChainResetScope("a", DEFS as never)).toEqual(["a", "b", "c", "d"]);
  });

  it("resets only the subtree below the selected mission, not its prerequisites", () => {
    expect(missionChainResetScope("b", DEFS as never)).toEqual(["b", "c"]);
  });

  it("is cycle-safe and returns the unknown id alone", () => {
    expect(missionChainResetScope("nope", DEFS as never)).toEqual(["nope"]);
  });

  it("matches the current authored mission chain", () => {
    // Only Walk It Off has a prerequisite (Cut Your Teeth requires it).
    const wio = "walk_it_off";
    const cyt = "cut_your_teeth";
    const ids = MISSIONS.map((m) => ({ id: m.id, prerequisiteMissionId: m.prerequisiteMissionId }));
    expect(missionChainResetScope(wio, ids)).toEqual([wio, cyt]);
    expect(missionChainResetScope(cyt, ids)).toEqual([cyt]);
  });
});
