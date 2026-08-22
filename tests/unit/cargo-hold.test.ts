import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import {
  cargoHoldMaterialsComplete,
  cargoHoldRepairComplete,
  planCargoHoldMaterialContribution,
  resolveCargoHoldWelding,
} from "@/game/domain/cargo-hold";
import { grantSkillXp } from "@/game/domain/progression";

const balance = getEffectiveGameBalance();

function repair(overrides: Partial<Parameters<typeof cargoHoldMaterialsComplete>[0]> = {}) {
  return {
    refinedFerriteContributed: 0,
    slagContributed: 0,
    weldingProgress: 0,
    completedAt: null,
    ...overrides,
  };
}

describe("Cargo Hold repair domain", () => {
  it("locks the exact 15 Refined Ferrite and 6 Slag recipe and caps useful contribution", () => {
    expect(
      planCargoHoldMaterialContribution({
        repair: repair({ refinedFerriteContributed: 9, slagContributed: 4 }),
        carriedRefinedFerrite: 8,
        carriedSlag: 10,
        balance,
      }),
    ).toEqual({ refinedFerrite: 6, slag: 2 });
    expect(
      cargoHoldMaterialsComplete(
        repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
        balance,
      ),
    ).toBe(true);
    expect(
      planCargoHoldMaterialContribution({
        repair: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
        carriedRefinedFerrite: 99,
        carriedSlag: 99,
        balance,
      }),
    ).toEqual({ refinedFerrite: 0, slag: 0 });
  });

  it("resolves only whole deterministic five-tick weld passes", () => {
    const partial = resolveCargoHoldWelding({
      elapsedTicks: 4,
      snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
      balance,
    });
    expect(partial).toMatchObject({
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: 0,
      awardedXp: 0,
      completed: false,
    });

    const batch = resolveCargoHoldWelding({
      elapsedTicks: 35,
      snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 6 }),
      balance,
    });
    expect(batch).toMatchObject({
      consumedTicks: 35,
      completedIncrements: 7,
      weldingProgress: 7,
      awardedXp: 350,
      completed: false,
    });
  });

  it("hard-stops at 12/12 and awards exactly 600 Welding XP", () => {
    const result = resolveCargoHoldWelding({
      elapsedTicks: 100,
      snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 6, weldingProgress: 11 }),
      balance,
    });
    expect(result).toMatchObject({
      consumedTicks: 5,
      completedIncrements: 1,
      weldingProgress: 12,
      awardedXp: 50,
      completed: true,
      stopReason: "completed",
    });
    expect(cargoHoldRepairComplete(repair({ ...repair(), weldingProgress: 12 }), balance)).toBe(
      true,
    );

    const grant = grantSkillXp(
      { skillId: SKILL_IDS.welding, totalXp: 0 },
      balance.welding.repairIncrements * balance.welding.xpPerIncrement,
      standardSkillLevelThresholds(balance),
    );
    expect(grant).toMatchObject({ skillId: SKILL_IDS.welding, totalXp: 600, level: 2 });
    expect(grant.totalXp - 500).toBe(100);
  });

  it("refuses to advance before the material phase is complete", () => {
    expect(
      resolveCargoHoldWelding({
        elapsedTicks: 100,
        snapshot: repair({ refinedFerriteContributed: 15, slagContributed: 5 }),
        balance,
      }),
    ).toMatchObject({
      completedIncrements: 0,
      awardedXp: 0,
      stopReason: "materials_incomplete",
    });
  });
});
