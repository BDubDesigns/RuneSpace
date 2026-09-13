import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  repairTargetForActionId,
  standardSkillLevelThresholds,
  weldingActionIds,
} from "@/game/config/balance";
import { ACTION_IDS, REPAIR_TARGET_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  deriveCompletedRepairTargetIds,
  planRepairMaterialContribution,
  repairComplete,
  repairMaterialsComplete,
  resolveWelding,
  type RepairTargetState,
} from "@/game/domain/welding-repair";
import { grantSkillXp } from "@/game/domain/progression";
import { deriveRepairAccess } from "@/server/repair-access";

const balance = getEffectiveGameBalance();
const cargo = getRepairTargetBalance(REPAIR_TARGET_IDS.cargoHold, balance);
const crewStop = getRepairTargetBalance(REPAIR_TARGET_IDS.crewStop, balance);

function repair(overrides: Partial<RepairTargetState> = {}): RepairTargetState {
  return {
    refinedFerriteContributed: 0,
    slagContributed: 0,
    weldingProgress: 0,
    completedAt: null,
    ...overrides,
  };
}

describe("welding rules are global; recipes belong to the repair target (#172)", () => {
  it("keeps one attempt duration and one XP award for every target", () => {
    expect(balance.welding.attemptDurationTicks).toBe(5);
    expect(balance.welding.xpPerIncrement).toBe(50);
    expect(balance.welding).not.toHaveProperty("repairIncrements");
  });

  it("authors the approved per-target recipes", () => {
    expect(cargo).toMatchObject({
      refinedFerriteRequired: 15,
      slagRequired: 6,
      repairIncrements: 12,
      actionId: ACTION_IDS.cargoHoldWelding,
    });
    expect(crewStop).toMatchObject({
      refinedFerriteRequired: 20,
      slagRequired: 0,
      repairIncrements: 10,
      actionId: ACTION_IDS.crewStopWelding,
    });
  });

  it("resolves which target an active Welding action belongs to", () => {
    expect(repairTargetForActionId(ACTION_IDS.cargoHoldWelding)).toBe(REPAIR_TARGET_IDS.cargoHold);
    expect(repairTargetForActionId(ACTION_IDS.crewStopWelding)).toBe(REPAIR_TARGET_IDS.crewStop);
    expect(repairTargetForActionId(ACTION_IDS.refining)).toBeUndefined();
    expect(weldingActionIds()).toEqual([ACTION_IDS.cargoHoldWelding, ACTION_IDS.crewStopWelding]);
  });
});

describe("Cargo Hold repair is unchanged by the generalization", () => {
  it("locks the exact 15 Refined Ferrite and 6 Slag recipe and caps useful contribution", () => {
    expect(
      planRepairMaterialContribution({
        repair: repair({ refinedFerriteContributed: 9, slagContributed: 4 }),
        carriedRefinedFerrite: 8,
        carriedSlag: 10,
        target: cargo,
      }),
    ).toEqual({ refinedFerrite: 6, slag: 2 });
    expect(
      repairMaterialsComplete(repair({ refinedFerriteContributed: 15, slagContributed: 6 }), cargo),
    ).toBe(true);
    expect(
      planRepairMaterialContribution({
        repair: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
        carriedRefinedFerrite: 99,
        carriedSlag: 99,
        target: cargo,
      }),
    ).toEqual({ refinedFerrite: 0, slag: 0 });
  });

  it("resolves only whole deterministic five-tick weld passes", () => {
    expect(
      resolveWelding({
        elapsedTicks: 4,
        snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
        target: cargo,
        balance,
      }),
    ).toMatchObject({
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: 0,
      awardedXp: 0,
      completed: false,
    });

    expect(
      resolveWelding({
        elapsedTicks: 35,
        snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
        target: cargo,
        balance,
      }),
    ).toMatchObject({
      consumedTicks: 35,
      completedIncrements: 7,
      weldingProgress: 7,
      awardedXp: 350,
      completed: false,
    });
  });

  it("hard-stops at 12/12 and awards exactly 600 Welding XP", () => {
    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: repair({
          refinedFerriteContributed: 15,
          slagContributed: 6,
          weldingProgress: 11,
        }),
        target: cargo,
        balance,
      }),
    ).toMatchObject({
      consumedTicks: 5,
      completedIncrements: 1,
      weldingProgress: 12,
      awardedXp: 50,
      completed: true,
      stopReason: "completed",
    });
    expect(
      repairComplete(
        repair({ weldingProgress: 12, completedAt: new Date("2026-08-21T18:00:00Z") }),
      ),
    ).toBe(true);
    expect(repairComplete(repair({ weldingProgress: 12 }))).toBe(false);

    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: repair({
          refinedFerriteContributed: 15,
          slagContributed: 6,
          weldingProgress: 12,
        }),
        target: cargo,
        balance,
      }),
    ).toMatchObject({ completed: false, awardedXp: 0, completedIncrements: 0 });

    const grant = grantSkillXp(
      { skillId: SKILL_IDS.welding, totalXp: 0 },
      cargo.repairIncrements * balance.welding.xpPerIncrement,
      standardSkillLevelThresholds(balance),
    );
    expect(grant).toMatchObject({ skillId: SKILL_IDS.welding, totalXp: 600, level: 2 });
  });

  it("refuses to advance before the material phase is complete", () => {
    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 5 }),
        target: cargo,
        balance,
      }),
    ).toMatchObject({
      completedIncrements: 0,
      awardedXp: 0,
      stopReason: "materials_incomplete",
    });
  });
});

describe("Crew Stop repair (#172)", () => {
  it("needs 20 Refined Ferrite and no Slag at all", () => {
    expect(crewStop.slagRequired).toBe(0);
    expect(
      planRepairMaterialContribution({
        repair: repair(),
        carriedRefinedFerrite: 5,
        carriedSlag: 40,
        target: crewStop,
      }),
    ).toEqual({ refinedFerrite: 5, slag: 0 });
    // Carrying no Slag never blocks the Crew Stop's material phase.
    expect(repairMaterialsComplete(repair({ refinedFerriteContributed: 20 }), crewStop)).toBe(true);
  });

  it("accepts partial contributions across several visits, totalling exactly 20", () => {
    let state = repair();
    const visits = [6, 6, 6, 6];
    for (const carried of visits) {
      const useful = planRepairMaterialContribution({
        repair: state,
        carriedRefinedFerrite: carried,
        carriedSlag: 0,
        target: crewStop,
      });
      state = repair({
        refinedFerriteContributed: state.refinedFerriteContributed + useful.refinedFerrite,
      });
    }
    // The fourth visit carried six but only two were still useful.
    expect(state.refinedFerriteContributed).toBe(20);
    expect(repairMaterialsComplete(state, crewStop)).toBe(true);
    expect(
      planRepairMaterialContribution({
        repair: state,
        carriedRefinedFerrite: 99,
        carriedSlag: 0,
        target: crewStop,
      }),
    ).toEqual({ refinedFerrite: 0, slag: 0 });
  });

  it("requires exactly ten genuine increments and pays exactly 500 Welding XP", () => {
    const full = resolveWelding({
      elapsedTicks: 10 * balance.welding.attemptDurationTicks,
      snapshot: repair({ refinedFerriteContributed: 20 }),
      target: crewStop,
      balance,
    });
    expect(full).toMatchObject({
      completedIncrements: 10,
      weldingProgress: 10,
      awardedXp: 500,
      completed: true,
      stopReason: "completed",
    });

    // Nine increments is not a repair, and a partial tenth pass banks nothing.
    const nine = resolveWelding({
      elapsedTicks: 9 * balance.welding.attemptDurationTicks + 4,
      snapshot: repair({ refinedFerriteContributed: 20 }),
      target: crewStop,
      balance,
    });
    expect(nine).toMatchObject({
      completedIncrements: 9,
      awardedXp: 450,
      completed: false,
    });
  });

  it("never re-awards work on an already completed repair", () => {
    expect(
      resolveWelding({
        elapsedTicks: 1_000,
        snapshot: repair({
          refinedFerriteContributed: 20,
          weldingProgress: 10,
          completedAt: new Date("2026-09-01T00:00:00Z"),
        }),
        target: crewStop,
        balance,
      }),
    ).toMatchObject({
      completedIncrements: 0,
      awardedXp: 0,
      consumedTicks: 0,
      completed: true,
      stopReason: "completed",
    });
  });

  it("refuses Welding until the full twenty are in the brace", () => {
    expect(
      resolveWelding({
        elapsedTicks: 100,
        snapshot: repair({ refinedFerriteContributed: 19 }),
        target: crewStop,
        balance,
      }),
    ).toMatchObject({ completedIncrements: 0, awardedXp: 0, stopReason: "materials_incomplete" });
  });
});

describe("repair access is derived, never persisted", () => {
  it("keeps an incomplete repair locked until its authorizing mission is accepted", () => {
    expect(deriveRepairAccess(repair(), false)).toEqual({
      complete: false,
      repairAvailable: false,
    });
    expect(deriveRepairAccess(repair(), true)).toEqual({
      complete: false,
      repairAvailable: true,
    });
  });

  it("keeps a completed repair available without any mission state", () => {
    expect(deriveRepairAccess(repair({ completedAt: new Date() }), false)).toEqual({
      complete: true,
      repairAvailable: true,
    });
  });

  it("derives completed target IDs from the repair records themselves", () => {
    expect(
      deriveCompletedRepairTargetIds([
        { targetId: REPAIR_TARGET_IDS.cargoHold, complete: true },
        { targetId: REPAIR_TARGET_IDS.crewStop, complete: false },
      ]),
    ).toEqual(new Set([REPAIR_TARGET_IDS.cargoHold]));
  });
});
