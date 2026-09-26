import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  miningSourceForActionId,
  refiningRecipeForActionId,
  refiningRecipes,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getLocation, LOCATIONS } from "@/game/content/locations";
import { getMerchant } from "@/game/content/merchants";
import { getMission } from "@/game/content/missions";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import {
  boostedMiningAttemptDurationTicks,
  miningSuccessChanceBps,
  resolveMining,
} from "@/game/domain/mining";
import {
  isActionAvailableInLocationState,
  isLocationTravelable,
  resolveLocationStateById,
} from "@/game/domain/location-state";
import {
  projectMission,
  unmetMissionSkillPrerequisite,
  type MissionObservation,
} from "@/game/domain/missions";
import { refiningRecipeUnlocked, refiningSuccessChanceBps } from "@/game/domain/refining";
import { repairObservation } from "./repair-observation";

/**
 * Issue #209 — the Deep Jag progression's own rules.
 *
 * Everything here is deterministic content and domain: what the Mission
 * demands before it can be taken, what the world looks like at each of Deep
 * Jag's three states, and the exact approved Mining, Refining, item and
 * merchant numbers. The server-authoritative half — a forged walk, a partial
 * contribution, a recipe surviving a refresh — is `tests/integration/deep-jag`,
 * because none of that is provable without real persistence.
 */

const balance = getEffectiveGameBalance();
const braceYourself = getMission(MISSION_IDS.braceYourself)!;
const caveIn = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
const galvanite = miningSourceForActionId(ACTION_IDS.galvaniteMining, balance)!;

/** The named skills at the named levels; anything unnamed reports level 1. */
function atSkills(levels: Readonly<Record<string, number>>): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map<string, number>(),
    stackLimits: new Map<string, number>(),
    itemNames: new Map<string, string>(),
    skillLevels: new Map(Object.entries(levels)),
    repairTargets: repairObservation(),
  };
}

const qualified = { [SKILL_IDS.mining]: 5, [SKILL_IDS.welding]: 5 };

/** Brace Yourself as Tansy's conversation hub would show it at The Jag. */
function offered(observation: MissionObservation, tenThousandHoursComplete = true) {
  return projectMission(
    braceYourself,
    undefined,
    LOCATION_IDS.theJag,
    true,
    observation,
    tenThousandHoursComplete,
  );
}

describe("Brace Yourself eligibility", () => {
  it("is offered once 10,000 Hours is complete and both skills are 5", () => {
    expect(offered(atSkills(qualified)).prerequisiteSatisfied).toBe(true);
  });

  it("is unavailable before 10,000 Hours is complete", () => {
    expect(braceYourself.prerequisiteMissionId).toBe(MISSION_IDS.tenThousandHours);
    expect(offered(atSkills(qualified), false).prerequisiteSatisfied).toBe(false);
  });

  it("is unavailable below Mining 5, and says which skill is short", () => {
    const short = atSkills({ ...qualified, [SKILL_IDS.mining]: 4 });
    expect(offered(short).prerequisiteSatisfied).toBe(false);
    expect(unmetMissionSkillPrerequisite(braceYourself, short.skillLevels)).toEqual({
      skillId: SKILL_IDS.mining,
      level: 5,
    });
  });

  it("is unavailable below Welding 5, and says which skill is short", () => {
    const short = atSkills({ ...qualified, [SKILL_IDS.welding]: 4 });
    expect(offered(short).prerequisiteSatisfied).toBe(false);
    expect(unmetMissionSkillPrerequisite(braceYourself, short.skillLevels)).toEqual({
      skillId: SKILL_IDS.welding,
      level: 5,
    });
  });

  it("does not require 10,001 Hours: Work Orders and Deep Jag are siblings", () => {
    // Its predecessor is 10,000 Hours, and nothing in the authored Mission
    // mentions the Work Order branch at all.
    expect(braceYourself.prerequisiteMissionId).not.toBe(MISSION_IDS.tenThousandOneHours);
    expect(JSON.stringify(braceYourself)).not.toContain(MISSION_IDS.tenThousandOneHours);
  });

  it("carries both skill gates in the shared Mission eligibility model", () => {
    // Not a Deep-Jag-specific check and not a UI-only one: the same authored
    // list the acceptance command reads (#209).
    expect(braceYourself.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.mining, level: 5 },
      { skillId: SKILL_IDS.welding, level: 5 },
    ]);
  });

  it("is offered and turned in by Tansy at The Jag, and rewards 250 Welding XP", () => {
    expect(braceYourself.offers[0]?.locationId).toBe(LOCATION_IDS.theJag);
    expect(braceYourself.turnIn.locationId).toBe(LOCATION_IDS.theJag);
    expect(braceYourself.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.welding,
      amount: 250,
    });
  });

  it("asks for the cave-in repair and nothing else", () => {
    expect(braceYourself.requirements).toHaveLength(1);
    expect(braceYourself.requirements[0]).toMatchObject({
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.deepJagCaveIn,
    });
  });
});

describe("Deep Jag's three world states", () => {
  const untouched = {
    acceptedMissionIds: new Set<string>(),
    completedRepairTargetIds: new Set<string>(),
  };
  const accepted = {
    acceptedMissionIds: new Set([MISSION_IDS.braceYourself]),
    completedRepairTargetIds: new Set<string>(),
  };
  const braced = {
    acceptedMissionIds: new Set([MISSION_IDS.braceYourself]),
    completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.deepJagCaveIn as string]),
  };

  it("is one authored location southwest of The Jag, adjacent only to it", () => {
    const deepJag = getLocation(LOCATION_IDS.deepJag)!;
    expect(deepJag.adjacentLocationIds).toEqual([LOCATION_IDS.theJag]);
    expect(deepJag.presentation.localMap.axial).toEqual({ q: -3, r: 4 });
    const theJag = getLocation(LOCATION_IDS.theJag)!;
    // Southwest: one column west and one row south of The Jag's (-2, 3).
    expect(theJag.presentation.localMap.axial).toEqual({ q: -2, r: 3 });
    expect(theJag.adjacentLocationIds).toContain(LOCATION_IDS.deepJag);
    // One location, not two: nothing else claims Deep Jag's identity.
    expect(LOCATIONS.filter((location) => location.id === LOCATION_IDS.deepJag)).toHaveLength(1);
  });

  it("shows CAVE-IN and refuses the walk before the Mission is accepted", () => {
    const state = resolveLocationStateById(LOCATION_IDS.deepJag, untouched)!;
    expect(state.variantId).toBeUndefined();
    expect(state.mapStatus).toBe("CAVE-IN");
    expect(state.travelable).toBe(false);
    expect(state.availableActionIds).toEqual([]);
    expect(isLocationTravelable(LOCATION_IDS.deepJag, untouched)).toBe(false);
  });

  it("opens the walk to the worksite on acceptance, with Welding and no Mining", () => {
    const state = resolveLocationStateById(LOCATION_IDS.deepJag, accepted)!;
    expect(state.travelable).toBe(true);
    expect(state.mapStatus).toBe("CAVE-IN");
    expect(state.availableActionIds).toEqual([ACTION_IDS.deepJagWelding]);
    expect(
      isActionAvailableInLocationState(LOCATION_IDS.deepJag, ACTION_IDS.galvaniteMining, accepted),
    ).toBe(false);
  });

  it("becomes a working mine the moment the repair completes, from the repair fact alone", () => {
    const state = resolveLocationStateById(LOCATION_IDS.deepJag, braced)!;
    expect(state.variantId).toBe("deep_jag_opened");
    expect(state.mapStatus).toBe("MINING");
    expect(state.travelable).toBe(true);
    expect(state.availableActionIds).toContain(ACTION_IDS.galvaniteMining);
    // No second unlock flag: the same facts with the repair removed are the
    // worksite again, so nothing but the repair record can be out of step.
    expect(resolveLocationStateById(LOCATION_IDS.deepJag, accepted)!.variantId).toBe(
      "deep_jag_worksite",
    );
  });

  it("uses a matched scene pair — same size, different art — for collapsed and opened", () => {
    const collapsed = resolveLocationStateById(LOCATION_IDS.deepJag, accepted)!.scene;
    const opened = resolveLocationStateById(LOCATION_IDS.deepJag, braced)!.scene;
    expect(opened.asset).not.toBe(collapsed.asset);
    expect({ width: opened.width, height: opened.height }).toEqual({
      width: collapsed.width,
      height: collapsed.height,
    });
    expect(opened.alt).not.toBe(collapsed.alt);
  });

  it("opens no other location's state, so the boundary stays narrow", () => {
    const stateful = LOCATIONS.filter((location) => location.stateVariants.length > 0);
    expect(stateful.map((location) => location.id)).toEqual([LOCATION_IDS.deepJag]);
  });
});

describe("the cave-in repair recipe", () => {
  it("is 25 Refined Ferrite and 5 Power Cells over 15 Welding sections", () => {
    expect(caveIn.materials).toEqual([
      { itemId: ITEM_IDS.refinedFerrite, quantity: 25 },
      { itemId: ITEM_IDS.powerCell, quantity: 5 },
    ]);
    expect(caveIn.repairIncrements).toBe(15);
  });

  it("is worth exactly 750 Welding XP through the work, plus the Mission's 250", () => {
    expect(balance.welding.xpPerIncrement).toBe(50);
    expect(caveIn.repairIncrements * balance.welding.xpPerIncrement).toBe(750);
    expect(caveIn.repairIncrements * balance.welding.xpPerIncrement + 250).toBe(1_000);
  });

  it("inherits the shared Clean Pass cadence rather than authoring its own", () => {
    // The repair authors no cleanPass field of its own; the global Welding
    // cadence (#190/#207) is the only source.
    expect(Object.keys(caveIn)).not.toContain("cleanPass");
    expect(balance.welding.cleanPass.minimumSectionsForOpportunity).toBe(6);
  });

  it("names its materials generically, with no Power-Cell-specific field", () => {
    const keys = Object.keys(caveIn);
    expect(keys).not.toContain("powerCellsRequired");
    expect(keys).not.toContain("refinedFerriteRequired");
    expect(keys).not.toContain("slagRequired");
  });
});

describe("Galvanite Mining", () => {
  it("uses the exact approved 15-tick / 35%-to-40 / 1-2 / 25-XP rules", () => {
    expect(galvanite.itemId).toBe(ITEM_IDS.galvanite);
    expect(galvanite.attemptDurationTicks).toBe(15);
    expect(miningSuccessChanceBps(1, galvanite)).toBe(3_500);
    expect(miningSuccessChanceBps(40, galvanite)).toBe(10_000);
    expect(miningSuccessChanceBps(99, galvanite)).toBe(10_000);
    expect(galvanite.yieldMinimum).toBe(1);
    expect(galvanite.yieldMaximum).toBe(2);
    expect(galvanite.successXp).toBe(25);
  });

  it("takes 8 ticks on a charged starter Cutter, under the shared rounding rule", () => {
    expect(boostedMiningAttemptDurationTicks(balance, galvanite)).toBe(8);
    expect(balance.mining.powerCellBoost.speedMultiplier).toBe(2);
  });

  it("awards Galvanite and 25 XP on a success, and nothing on a failure", () => {
    const ready = {
      miningLevel: 40,
      hasCompatibleTool: true,
      existingStacks: [],
      slotsAvailable: 8,
      massAvailableGrams: 35_000,
      cutterCharge: 0,
    };
    const hit = resolveMining({
      elapsedTicks: 15,
      snapshot: ready,
      balance,
      source: galvanite,
      random: { nextBasisPoints: () => 0, nextUnit: () => 0 },
    });
    expect(hit.successes).toBe(1);
    expect(hit.awardedXp).toBe(25);
    expect(hit.attempts[0]).toMatchObject({ itemId: ITEM_IDS.galvanite, quantityAwarded: 1 });

    const miss = resolveMining({
      elapsedTicks: 15,
      snapshot: { ...ready, miningLevel: 1 },
      balance,
      source: galvanite,
      random: { nextBasisPoints: () => 9_999, nextUnit: () => 0 },
    });
    expect(miss.failures).toBe(1);
    expect(miss.awardedXp).toBe(0);
    expect(miss.attempts[0]?.quantityAwarded).toBe(0);
  });

  it("stops on Galvanite's own stack and mass facts, not Shale's", () => {
    const full = {
      miningLevel: 40,
      hasCompatibleTool: true,
      existingStacks: [{ id: "g", itemId: ITEM_IDS.galvanite, quantity: 10 }],
      slotsAvailable: 0,
      massAvailableGrams: 35_000,
      cutterCharge: 0,
    };
    expect(
      resolveMining({
        elapsedTicks: 15,
        snapshot: full,
        balance,
        source: galvanite,
        random: { nextBasisPoints: () => 0, nextUnit: () => 0 },
      }).stopReason,
    ).toBe("inventory_slots_full");

    // Two Galvanite weigh 800g, so a 700g allowance cannot take a full yield.
    expect(
      resolveMining({
        elapsedTicks: 15,
        snapshot: { ...full, existingStacks: [], slotsAvailable: 8, massAvailableGrams: 700 },
        balance,
        source: galvanite,
        random: { nextBasisPoints: () => 0, nextUnit: () => 9_999 },
      }).stopReason,
    ).toBe("carried_mass_capacity_reached");
  });

  it("leaves Ferrite Shale's rules exactly as they were", () => {
    const shale = miningSourceForActionId(ACTION_IDS.ferriteShaleMining, balance)!;
    expect(shale).toMatchObject({
      itemId: ITEM_IDS.ferriteShale,
      attemptDurationTicks: 10,
      successAtLevelOneBps: 3_500,
      guaranteedSuccessLevel: 30,
      successXp: 15,
      yieldMinimum: 1,
      yieldMaximum: 2,
    });
    expect(boostedMiningAttemptDurationTicks(balance, shale)).toBe(5);
  });
});

describe("the three Refining recipes", () => {
  it("authors all three, each with its own durable action ID", () => {
    const recipes = refiningRecipes(balance);
    expect(recipes.map((recipe) => recipe.actionId)).toEqual([
      ACTION_IDS.refining,
      ACTION_IDS.galvanicStockRefining,
      ACTION_IDS.galvaferriteRefining,
    ]);
    // Every recipe resolves back from its own action ID, which is what makes a
    // lazily-resolved or offline attempt refine what the player selected.
    for (const recipe of recipes) {
      expect(refiningRecipeForActionId(recipe.actionId, balance)).toBe(recipe);
    }
  });

  it("gates Galvanic Stock at Refining 5 and Galvaferrite at Refining 8", () => {
    const stock = refiningRecipeForActionId(ACTION_IDS.galvanicStockRefining, balance)!;
    const alloy = refiningRecipeForActionId(ACTION_IDS.galvaferriteRefining, balance)!;
    expect(refiningRecipeUnlocked(4, stock)).toBe(false);
    expect(refiningRecipeUnlocked(5, stock)).toBe(true);
    expect(refiningRecipeUnlocked(7, alloy)).toBe(false);
    expect(refiningRecipeUnlocked(8, alloy)).toBe(true);
    // The shipped recipe is open from the start, as it always was.
    expect(
      refiningRecipeUnlocked(1, refiningRecipeForActionId(ACTION_IDS.refining, balance)!),
    ).toBe(true);
  });

  it("uses the exact approved duration, curve and XP for each recipe", () => {
    const expected = [
      { actionId: ACTION_IDS.refining, ticks: 7, atOne: 4_000, guaranteed: 20, xp: [15, 3] },
      {
        actionId: ACTION_IDS.galvanicStockRefining,
        ticks: 10,
        atOne: 3_500,
        guaranteed: 30,
        xp: [25, 5],
      },
      {
        actionId: ACTION_IDS.galvaferriteRefining,
        ticks: 12,
        atOne: 3_500,
        guaranteed: 30,
        xp: [35, 7],
      },
    ];
    for (const { actionId, ticks, atOne, guaranteed, xp } of expected) {
      const recipe = refiningRecipeForActionId(actionId, balance)!;
      expect(recipe.attemptDurationTicks).toBe(ticks);
      expect(refiningSuccessChanceBps(1, recipe)).toBe(atOne);
      expect(refiningSuccessChanceBps(guaranteed, recipe)).toBe(10_000);
      expect([recipe.successXp, recipe.failureXp]).toEqual(xp);
    }
  });

  it("conserves mass through both approved successful recipes", () => {
    const mass = (itemId: string) =>
      Object.values(balance.items).find((item) => item.itemId === itemId)!.massGrams;
    expect(2 * mass(ITEM_IDS.galvanite)).toBe(mass(ITEM_IDS.galvanicStock));
    expect(mass(ITEM_IDS.galvanicStock) + mass(ITEM_IDS.refinedFerrite)).toBe(
      mass(ITEM_IDS.galvaferrite),
    );
  });
});

describe("the new materials and who buys them", () => {
  it("ships the exact approved stack limits and masses", () => {
    expect(balance.items.galvanite).toMatchObject({ massGrams: 400, stackLimit: 10 });
    expect(balance.items.galvanicStock).toMatchObject({ massGrams: 800, stackLimit: 5 });
    expect(balance.items.galvaferrite).toMatchObject({ massGrams: 950, stackLimit: 3 });
  });

  it("gives each one a display name and art, so nothing renders as a raw ID", () => {
    for (const itemId of [ITEM_IDS.galvanite, ITEM_IDS.galvanicStock, ITEM_IDS.galvaferrite]) {
      const presentation = resolveItemPresentation(itemId, itemId);
      expect(presentation.displayName).not.toBe(itemId);
      expect(presentation.artworkSrc).toBeTruthy();
      expect(presentation.textFallback).toBeTruthy();
    }
  });

  it("adds Bix's two buybacks at the approved prices, leaving his catalog alone", () => {
    const bix = getMerchant(MERCHANT_IDS.bixWeller)!;
    const priceOf = (itemId: string) => bix.prices.find((price) => price.itemId === itemId);
    expect(priceOf(ITEM_IDS.galvanite)?.buyPrice).toBe(4);
    expect(priceOf(ITEM_IDS.galvanicStock)?.buyPrice).toBe(18);
    // Unchanged: he still buys Refined Ferrite and Slag at their old prices.
    expect(priceOf(ITEM_IDS.refinedFerrite)?.buyPrice).toBe(10);
    expect(priceOf(ITEM_IDS.slag)?.buyPrice).toBe(1);
    // He does not buy the alloy, and he sells none of the three.
    expect(priceOf(ITEM_IDS.galvaferrite)).toBeUndefined();
    for (const itemId of [ITEM_IDS.galvanite, ITEM_IDS.galvanicStock]) {
      expect(priceOf(itemId)?.sellPrice).toBeUndefined();
    }
  });

  it("adds Wade's three buybacks at the approved prices, keeping his authorization", () => {
    const wade = getMerchant(MERCHANT_IDS.wadeRusk)!;
    const priceOf = (itemId: string) => wade.prices.find((price) => price.itemId === itemId);
    expect(priceOf(ITEM_IDS.refinedFerrite)?.buyPrice).toBe(10);
    expect(priceOf(ITEM_IDS.galvanicStock)?.buyPrice).toBe(18);
    expect(priceOf(ITEM_IDS.galvaferrite)?.buyPrice).toBe(45);
    expect(wade.authorizingMissionId).toBe(MISSION_IDS.tenThousandHours);
    // Scrap moved to 4 in #230; tests/unit/trade.test.ts owns that price.
    expect(priceOf(ITEM_IDS.scrapMetal)?.sellPrice).toBe(4);
  });

  it("introduces no new sell stock, so none of the three can be arbitraged", () => {
    for (const merchantId of [MERCHANT_IDS.bixWeller, MERCHANT_IDS.wadeRusk]) {
      const merchant = getMerchant(merchantId)!;
      for (const itemId of [ITEM_IDS.galvanite, ITEM_IDS.galvanicStock, ITEM_IDS.galvaferrite]) {
        expect(merchant.prices.find((price) => price.itemId === itemId)?.sellPrice).toBeUndefined();
      }
    }
  });

  it("gives Galvaferrite no consumer in this slice", () => {
    // It is sellable and stockpilable and nothing else: no recipe takes it as
    // an input, and no repair asks for it.
    for (const recipe of refiningRecipes(balance)) {
      expect(recipe.inputs.map((input) => input.itemId)).not.toContain(ITEM_IDS.galvaferrite);
    }
    for (const target of Object.values(balance.repairTargets)) {
      expect(target.materials.map((material) => material.itemId)).not.toContain(
        ITEM_IDS.galvaferrite,
      );
    }
  });
});
