import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  repairTargetForActionId,
  standardSkillLevelThresholds,
  weldingActionIds,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, REPAIR_TARGET_IDS, SKILL_IDS } from "@/game/config/foundations";
import { UNROLLED_CLEAN_PASS } from "@/game/domain/clean-pass";
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

/**
 * A repair state with the two Cargo Hold / Crew Stop materials named directly,
 * because that is what these tests are about. Installed material now lives in
 * one item-keyed map (#209), and a zero is an ABSENT key rather than an
 * explicit 0 — the same representation the migration's backfill writes.
 */
function repair({
  refinedFerrite = 0,
  slag = 0,
  ...overrides
}: Partial<RepairTargetState> & { refinedFerrite?: number; slag?: number } = {}) {
  return {
    materials: {
      ...(refinedFerrite > 0 ? { [ITEM_IDS.refinedFerrite]: refinedFerrite } : {}),
      ...(slag > 0 ? { [ITEM_IDS.slag]: slag } : {}),
    },
    weldingProgress: 0,
    cleanPass: UNROLLED_CLEAN_PASS,
    completedAt: null,
    ...overrides,
  } satisfies RepairTargetState;
}

/** How much of one item a repair state has installed. */
function installed(state: RepairTargetState, itemId: string): number {
  return state.materials[itemId] ?? 0;
}

describe("welding rules are global; recipes belong to the repair target (#172)", () => {
  it("keeps one attempt duration and one XP award for every target", () => {
    expect(balance.welding.attemptDurationTicks).toBe(5);
    expect(balance.welding.xpPerIncrement).toBe(50);
    expect(balance.welding).not.toHaveProperty("repairIncrements");
  });

  it("authors the approved per-target recipes", () => {
    // The recipe is an authored material LIST now (#209), and the Cargo Hold's
    // and the Crew Stop's are byte-for-byte the quantities they always were.
    expect(cargo).toMatchObject({
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 15 },
        { itemId: ITEM_IDS.slag, quantity: 6 },
      ],
      repairIncrements: 12,
      actionId: ACTION_IDS.cargoHoldWelding,
    });
    // The Crew Stop wants no Slag at all, and expresses that by not naming it
    // rather than by authoring a zero.
    expect(crewStop).toMatchObject({
      materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 20 }],
      repairIncrements: 10,
      actionId: ACTION_IDS.crewStopWelding,
    });
  });

  it("resolves which target an active Welding action belongs to", () => {
    expect(repairTargetForActionId(ACTION_IDS.cargoHoldWelding)).toBe(REPAIR_TARGET_IDS.cargoHold);
    expect(repairTargetForActionId(ACTION_IDS.crewStopWelding)).toBe(REPAIR_TARGET_IDS.crewStop);
    expect(repairTargetForActionId(ACTION_IDS.refining)).toBeUndefined();
    expect(weldingActionIds()).toEqual([
      ACTION_IDS.cargoHoldWelding,
      ACTION_IDS.crewStopWelding,
      ACTION_IDS.deepJagWelding,
    ]);
  });
});

describe("Cargo Hold repair is unchanged by the generalization", () => {
  it("locks the exact 15 Refined Ferrite and 6 Slag recipe and caps useful contribution", () => {
    expect(
      planRepairMaterialContribution({
        repair: repair({ refinedFerrite: 9, slag: 4 }),
        carried: { [ITEM_IDS.refinedFerrite]: 8, [ITEM_IDS.slag]: 10 },
        target: cargo,
      }),
    ).toEqual({ [ITEM_IDS.refinedFerrite]: 6, [ITEM_IDS.slag]: 2 });
    expect(repairMaterialsComplete(repair({ refinedFerrite: 15, slag: 6 }), cargo)).toBe(true);
    expect(
      planRepairMaterialContribution({
        repair: repair({ refinedFerrite: 15, slag: 6 }),
        carried: { [ITEM_IDS.refinedFerrite]: 99, [ITEM_IDS.slag]: 99 },
        target: cargo,
      }),
    ).toEqual({});
  });

  it("resolves only whole deterministic five-tick weld passes", () => {
    expect(
      resolveWelding({
        elapsedTicks: 4,
        snapshot: repair({ refinedFerrite: 15, slag: 6 }),
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
        snapshot: repair({ refinedFerrite: 15, slag: 6 }),
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
          refinedFerrite: 15,
          slag: 6,
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
          refinedFerrite: 15,
          slag: 6,
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
        snapshot: repair({ refinedFerrite: 15, slag: 5 }),
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
    expect(crewStop.materials.some((material) => material.itemId === ITEM_IDS.slag)).toBe(false);
    expect(
      planRepairMaterialContribution({
        repair: repair(),
        carried: { [ITEM_IDS.refinedFerrite]: 5, [ITEM_IDS.slag]: 40 },
        target: crewStop,
      }),
    ).toEqual({ [ITEM_IDS.refinedFerrite]: 5 });
    // Carrying no Slag never blocks the Crew Stop's material phase.
    expect(repairMaterialsComplete(repair({ refinedFerrite: 20 }), crewStop)).toBe(true);
  });

  it("accepts partial contributions across several visits, totalling exactly 20", () => {
    let state = repair();
    const visits = [6, 6, 6, 6];
    for (const carried of visits) {
      const useful = planRepairMaterialContribution({
        repair: state,
        carried: { [ITEM_IDS.refinedFerrite]: carried, [ITEM_IDS.slag]: 0 },
        target: crewStop,
      });
      state = repair({
        refinedFerrite:
          installed(state, ITEM_IDS.refinedFerrite) + (useful[ITEM_IDS.refinedFerrite] ?? 0),
      });
    }
    // The fourth visit carried six but only two were still useful.
    expect(installed(state, ITEM_IDS.refinedFerrite)).toBe(20);
    expect(repairMaterialsComplete(state, crewStop)).toBe(true);
    expect(
      planRepairMaterialContribution({
        repair: state,
        carried: { [ITEM_IDS.refinedFerrite]: 99, [ITEM_IDS.slag]: 0 },
        target: crewStop,
      }),
    ).toEqual({});
  });

  it("requires exactly ten genuine increments and pays exactly 500 Welding XP", () => {
    const full = resolveWelding({
      elapsedTicks: 10 * balance.welding.attemptDurationTicks,
      snapshot: repair({ refinedFerrite: 20 }),
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
      snapshot: repair({ refinedFerrite: 20 }),
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
          refinedFerrite: 20,
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
        snapshot: repair({ refinedFerrite: 19 }),
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
