import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  repairTargetForActionId,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import {
  MISSIONS,
  TANKS_FOR_THE_RIDE,
  THRUST_ISSUES,
  type MissionDefinition,
} from "@/game/content/missions";
import { getRepairTarget, REPAIR_TARGETS } from "@/game/content/repair-targets";
import { SHIP_ROUTES } from "@/game/content/ship-routes";
import {
  deriveMissionGuidanceTargets,
  missionRequiredSkillLevel,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
} from "@/game/domain/missions";
import { completedRepairStatus, validateRepairTargets } from "@/game/domain/repair-targets";
import { repairObservation, type RepairProgressInput } from "./repair-observation";

/**
 * Tanks for the Ride (#501): Wade's long-range tank job, the second Mission
 * completed by a gameplay outcome, here the final weld of a berth-relative repair.
 */

const balance = getEffectiveGameBalance();
const TARGET = REPAIR_TARGET_IDS.rivetLongRangeTank;
const recipe = getRepairTargetBalance(TARGET, balance);

const baseObservation = {
  equippedItemIds: new Set<string>(),
  carriedQuantities: new Map(),
  stackLimits: new Map(),
  itemNames: new Map(),
};

function observe(
  extra: Partial<MissionObservation> & { berth?: string } = {},
  progress: RepairProgressInput = {},
): MissionObservation {
  const { berth, ...rest } = extra;
  return {
    ...baseObservation,
    repairTargets: repairObservation({ [TARGET]: progress }),
    skillLevels: new Map([[SKILL_IDS.welding, 16]]),
    ...(berth ? { ship: { fuelUnits: 0, berthLocationId: berth } } : {}),
    ...rest,
  };
}

describe("the Mission's shape", () => {
  it("passes registry validation and follows Move Along", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    const ids = MISSIONS.map((mission) => mission.id);
    expect(ids.indexOf(MISSION_IDS.tanksForTheRide)).toBeGreaterThan(
      ids.indexOf(MISSION_IDS.moveAlong),
    );
    expect(TANKS_FOR_THE_RIDE.prerequisiteMissionId).toBe(MISSION_IDS.moveAlong);
    expect(TANKS_FOR_THE_RIDE.title).toBe("Tanks for the Ride");
  });

  it("is offered by hand by Wade at Rusk Recovery at Welding 16 and nothing else", () => {
    expect(TANKS_FOR_THE_RIDE.offers).toHaveLength(1);
    expect(TANKS_FOR_THE_RIDE.offers[0]).toMatchObject({
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      dialogueId: DIALOGUE_IDS.wadeTanksForTheRideOffer,
    });
    expect(TANKS_FOR_THE_RIDE.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.welding, level: 16 },
    ]);
    expect(missionRequiredSkillLevel(TANKS_FOR_THE_RIDE, SKILL_IDS.welding)).toBe(16);
    expect(TANKS_FOR_THE_RIDE.itemOffer).toBeUndefined();
  });

  it("is completed only by its own repair: no turn-in, reward or continuation", () => {
    expect(TANKS_FOR_THE_RIDE.autoCompletion).toEqual({
      kind: "repair_target_complete",
      targetId: TARGET,
    });
    expect(TANKS_FOR_THE_RIDE.turnIn).toBeUndefined();
    expect(TANKS_FOR_THE_RIDE.reward).toBeUndefined();
    expect(TANKS_FOR_THE_RIDE.continuationMissionId).toBeUndefined();
    expect(TANKS_FOR_THE_RIDE.requirements).toEqual([
      expect.objectContaining({ kind: "repair_target_complete", targetId: TARGET }),
    ]);
  });

  it("is never named by a ship route: the upgrade is not a travel permission", () => {
    const text = JSON.stringify(SHIP_ROUTES);
    expect(text).not.toContain(MISSION_IDS.tanksForTheRide);
    expect(text).not.toContain(TARGET);
  });

  it("carries Wade's approved lines verbatim", () => {
    const lines = (id: string) =>
      (getDialogue(id)!.beats as readonly { text?: string }[]).map((beat) => beat.text);
    expect(lines(DIALOGUE_IDS.wadeTanksForTheRideOffer)).toEqual([
      "Hm. The Rivet flew. So much for my salvage claim.",
      "Engine'll take you farther. Tank won't. Three hundred fuel units only gets you so far.",
      "I've got a retrofit in mind. Three Empty Small Fuel Canisters. Four Mounting Brackets. Four Galvaferrite. One Galvanic Wire Spool. Two Power Cells.",
      "Thirty-two welds. Your torch. I'm not doing it for you.",
    ]);
    expect(lines(DIALOGUE_IDS.wadeTanksForTheRideAccepted)).toEqual([
      "Fit the parts to the Rivet wherever you've got her parked. Bring them in batches. She'll still fly between jobs, but the bigger tank doesn't count until the last weld holds.",
    ]);
    expect(lines(DIALOGUE_IDS.wadeTanksForTheRideActive)).toEqual([
      "Three empty canisters. Four brackets. Four Galvaferrite. One wire spool. Two Power Cells. Install them where you've parked the ship. Not here.",
    ]);
    expect(lines(DIALOGUE_IDS.wadePostTanksForTheRide)).toEqual([
      "Heard you finished the tank job. Seven hundred and fifty fuel units. Good.",
      "Capacity. Not fuel. Don't get those confused.",
    ]);
  });
});

describe("the completion System notice", () => {
  it("is the owner-approved copy, and its capacities match the balance", () => {
    expect(TANKS_FOR_THE_RIDE.completionSystemNotice).toEqual({
      title: "Tanks for the Ride — Complete!",
      body: "Your Rivet's long-range tank installation is complete. Maximum fuel capacity increased from 300 to 750 FU. Current fuel unchanged.",
    });
    expect(TANKS_FOR_THE_RIDE.completionSystemNotice!.body).toContain(
      `from ${balance.ship.tankCapacityFuelUnits} to ${balance.ship.longRangeTankCapacityFuelUnits} FU`,
    );
  });

  it("is authored by no other Mission, and only beside an auto-completion", () => {
    expect(
      MISSIONS.filter((mission) => mission.completionSystemNotice).map((mission) => mission.id),
    ).toEqual([MISSION_IDS.tanksForTheRide]);
    expect(() =>
      validateMissionDefinitions([
        {
          ...THRUST_ISSUES,
          prerequisiteMissionId: undefined,
          continuationMissionId: undefined,
          completionSystemNotice: { title: "x", body: "y" },
        },
      ]),
    ).toThrow(/without an auto-completion/);
    expect(() =>
      validateMissionDefinitions([
        {
          ...TANKS_FOR_THE_RIDE,
          prerequisiteMissionId: undefined,
          completionSystemNotice: { title: " ", body: "y" },
        },
      ]),
    ).toThrow(/empty completion System notice/);
  });
});

describe("registry validation of a repair auto-completion", () => {
  const withOverrides = (overrides: Partial<MissionDefinition>) =>
    ({
      ...TANKS_FOR_THE_RIDE,
      prerequisiteMissionId: undefined,
      // Validated alone, so give it an offer-less predecessor-free shape.
      offers: THRUST_ISSUES.offers.map((offer) => ({ ...offer, dialogueId: offer.dialogueId })),
      ...overrides,
    }) as MissionDefinition;
  const validate = (definition: MissionDefinition) => () =>
    validateMissionDefinitions([definition]);

  it("rejects a turn-in or a reward beside it", () => {
    expect(validate(withOverrides({ turnIn: THRUST_ISSUES.turnIn }))).toThrow(
      /both a turn-in and an auto-completion/,
    );
    expect(validate(withOverrides({ reward: { kind: "credits", amount: 5 } }))).toThrow(
      /cannot author a reward/,
    );
  });

  it("rejects an unknown target, another Mission's target, and an unobserved target", () => {
    expect(
      validate(
        withOverrides({
          autoCompletion: { kind: "repair_target_complete", targetId: "nope" as never },
        }),
      ),
    ).toThrow(/unknown repair target/);
    expect(
      validate(
        withOverrides({
          autoCompletion: {
            kind: "repair_target_complete",
            targetId: REPAIR_TARGET_IDS.propulsionSystem,
          },
          requirements: [
            {
              kind: "repair_target_complete",
              targetId: REPAIR_TARGET_IDS.propulsionSystem,
              objective: "x",
            },
          ],
        }),
      ),
    ).toThrow(/does not authorize/);
    expect(validate(withOverrides({ requirements: [] }))).toThrow(/does not require/);
  });

  it("is the only Mission that completes on a repair", () => {
    const completing = MISSIONS.filter(
      (mission) => mission.autoCompletion?.kind === "repair_target_complete",
    );
    expect(completing.map((mission) => mission.id)).toEqual([MISSION_IDS.tanksForTheRide]);
    // Every target it could complete is authorized by that very Mission.
    expect(getRepairTarget(TARGET)?.authorization).toMatchObject({
      kind: "mission",
      missionId: MISSION_IDS.tanksForTheRide,
    });
  });
});

describe("the berth-relative repair target", () => {
  const target = getRepairTarget(TARGET)!;

  it("is placed by the ship, never by a fixed location or Local Place", () => {
    expect(target.atShipBerth).toBe(true);
    expect(target.locationId).toBeUndefined();
    expect(target.localPlaceId).toBeUndefined();
    expect(target.completionEffect).toEqual({ kind: "ship_long_range_tank" });
    expect(() =>
      validateRepairTargets(REPAIR_TARGETS, new Set(MISSIONS.map((mission) => mission.id))),
    ).not.toThrow();
    // Every other target keeps its fixed place.
    for (const other of REPAIR_TARGETS.filter((candidate) => candidate.id !== TARGET)) {
      expect(other.atShipBerth, other.id).toBeUndefined();
      expect(other.locationId, other.id).toBeDefined();
    }
  });

  it("rejects a target that is both berth-relative and fixed", () => {
    expect(() =>
      validateRepairTargets(
        [{ ...target, locationId: LOCATION_IDS.crashSite } as never],
        new Set(MISSIONS.map((mission) => mission.id)),
      ),
    ).toThrow(/berth-relative/);
  });

  it("reads Welding 16 from its Mission's offer gate", () => {
    expect(target.authorization).toEqual({
      kind: "mission",
      missionId: MISSION_IDS.tanksForTheRide,
      requiresMissionWeldingLevel: true,
    });
  });

  it("states the approved finished status, from the balance's own capacity", () => {
    expect(completedRepairStatus(target, new Set())).toBe(
      `Long-range tanks installed. Rivet fuel capacity: ${balance.ship.longRangeTankCapacityFuelUnits} FU.`,
    );
  });
});

describe("the approved recipe", () => {
  it("is exactly the locked bill and 32 ordinary sections", () => {
    expect(recipe.materials).toEqual([
      { itemId: ITEM_IDS.emptySmallFuelCanister, quantity: 3 },
      { itemId: ITEM_IDS.mountingBracket, quantity: 4 },
      { itemId: ITEM_IDS.galvaferrite, quantity: 4 },
      { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
      { itemId: ITEM_IDS.powerCell, quantity: 2 },
    ]);
    expect(recipe.repairIncrements).toBe(32);
    expect(recipe.actionId).toBe(ACTION_IDS.rivetLongRangeTankWelding);
    expect(repairTargetForActionId(ACTION_IDS.rivetLongRangeTankWelding)).toBe(TARGET);
    // 32 sections at the global 5 ticks and 50 XP: 1,600 base XP, no Mission award.
    expect(balance.welding.attemptDurationTicks).toBe(5);
    expect(balance.welding.xpPerIncrement * recipe.repairIncrements).toBe(1600);
  });

  it("uses Empty canisters, never Full ones, and no new item", () => {
    const items = recipe.materials.map((material) => material.itemId);
    expect(items).toContain(ITEM_IDS.emptySmallFuelCanister);
    expect(items).not.toContain(ITEM_IDS.fullSmallFuelCanister);
  });
});

describe("projection and guidance", () => {
  const project = (
    mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
    observation: MissionObservation,
    at: string = LOCATION_IDS.holoHollowLanding,
    prerequisiteCompleted = true,
  ) => projectMission(TANKS_FOR_THE_RIDE, mission, at, true, observation, prerequisiteCompleted);

  it("is not offered below Welding 16 or before Move Along", () => {
    const low = observe({ skillLevels: new Map([[SKILL_IDS.welding, 15]]) });
    expect(project(undefined, low).prerequisiteSatisfied).toBe(false);
    expect(
      project(undefined, observe(), LOCATION_IDS.ruskRecovery, false).prerequisiteSatisfied,
    ).toBe(false);
    expect(project(undefined, observe(), LOCATION_IDS.ruskRecovery).prerequisiteSatisfied).toBe(
      true,
    );
  });

  it("stays active, never ready for a turn-in, even with every requirement observed", () => {
    const done = project({ acceptedAt: new Date() }, observe({}, { complete: true }));
    expect(done.state).toBe("active");
  });

  it("guides to wherever the Rivet is parked right now, not to a fixed place", () => {
    const accepted = { acceptedAt: new Date() };
    const carrying = new Map([[ITEM_IDS.mountingBracket, 4]]);
    for (const berth of [LOCATION_IDS.holoHollowLanding, LOCATION_IDS.stillreachLandingStation]) {
      const away = observe({ berth, carriedQuantities: carrying });
      const elsewhere = project(accepted, away, LOCATION_IDS.crashSite);
      expect(elsewhere.guidance, berth).toMatchObject({
        repairTargetId: TARGET,
        locationId: berth,
      });
      const there = project(accepted, away, berth);
      expect(there.guidance?.repairTargetId, berth).toBe(TARGET);
      expect(there.guidance?.locationId, berth).toBeUndefined();
      const targets = deriveMissionGuidanceTargets([there]);
      expect(targets.repairTargetIds.has(TARGET)).toBe(true);
    }
  });

  it("falls back to the untouched ship's berth when no ship information exists", () => {
    const carrying = new Map([[ITEM_IDS.mountingBracket, 4]]);
    const projection = project(
      { acceptedAt: new Date() },
      observe({ carriedQuantities: carrying }),
      LOCATION_IDS.crashSite,
    );
    expect(projection.guidance?.repairTargetId).toBe(TARGET);
  });
});
