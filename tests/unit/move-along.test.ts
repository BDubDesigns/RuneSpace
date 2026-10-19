import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { getShipFlightBalance } from "@/game/config/balance";
import { getDialogue } from "@/game/content/dialogue";
import {
  MISSIONS,
  MOVE_ALONG,
  THRUST_ISSUES,
  type MissionDefinition,
} from "@/game/content/missions";
import { resolveNpcConversation, resolveNpcConversationWith } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionProjection,
} from "@/game/domain/missions";
import { CONVERSATION_TOPICS } from "@/game/content/conversation-topics";

/**
 * Move Along (#358): Wade's first-flight Mission, the first one that a gameplay
 * outcome (the Rivet's landing) completes instead of a conversation.
 */

const observation = {
  equippedItemIds: new Set<string>(),
  carriedQuantities: new Map(),
  stackLimits: new Map(),
  itemNames: new Map(),
};

function project(
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  at: string = LOCATION_IDS.crashSite,
  prerequisiteCompleted = true,
  stationary = true,
): MissionProjection {
  return projectMission(MOVE_ALONG, mission, at, stationary, observation, prerequisiteCompleted);
}

const entries = (projection: MissionProjection) =>
  resolveNpcConversation(NPC_IDS.wadeRusk, [
    {
      missionId: projection.missionId,
      state: projection.state,
      prerequisiteSatisfied: projection.prerequisiteSatisfied,
      stage: projection.stage,
      requirements: projection.requirements,
    },
  ]);

describe("the Mission's shape", () => {
  it("passes registry validation and is registered after Thrust Issues", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    const ids = MISSIONS.map((mission) => mission.id);
    expect(ids.indexOf(MISSION_IDS.moveAlong)).toBe(ids.indexOf(MISSION_IDS.thrustIssues) + 1);
  });

  it("carries the locked title, summary and objective", () => {
    expect(MOVE_ALONG.title).toBe("Move Along");
    expect(MOVE_ALONG.summary).toBe(
      "Take your repaired Rivet Utility Shuttle from the Crash Site to Holo Hollow Landing.",
    );
    // Two ordered objectives: fuel first (the canister is its Sources item),
    // then the flight, which only the landing can satisfy.
    expect(MOVE_ALONG.requirements).toEqual([
      {
        kind: "ship_fuel",
        routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
        itemId: ITEM_IDS.fullSmallFuelCanister,
        objective: "Fuel the Rivet for the trip ({required} FU).",
      },
      {
        kind: "ship_flight",
        routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
        objective: "Fly the Rivet from the Crash Site to Holo Hollow Landing.",
      },
    ]);
  });

  it("is gated only by Thrust Issues and is Thrust Issues' authored continuation", () => {
    expect(MOVE_ALONG.prerequisiteMissionId).toBe(MISSION_IDS.thrustIssues);
    expect(MOVE_ALONG.prerequisiteSkillLevels).toBeUndefined();
    // Reporting the repair starts it in the same transaction (the generic
    // continuation boundary); nothing else continues into it.
    expect(THRUST_ISSUES.continuationMissionId).toBe(MISSION_IDS.moveAlong);
    expect(
      MISSIONS.filter((mission) => mission.continuationMissionId === MISSION_IDS.moveAlong).map(
        (mission) => mission.id,
      ),
    ).toEqual([MISSION_IDS.thrustIssues]);
  });

  it("authors no offer and no acceptance control: it cannot be accepted by hand", () => {
    expect(MOVE_ALONG.offers).toEqual([]);
    expect(MOVE_ALONG.activeNpcDialogue).toEqual([
      { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadeMoveAlongActive },
    ]);
  });

  it("completes by the flight's landing: no turn-in, no reward, no completion scene", () => {
    expect(MOVE_ALONG.autoCompletion).toEqual({
      kind: "ship_flight",
      routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
    });
    expect(MOVE_ALONG.turnIn).toBeUndefined();
    expect(MOVE_ALONG.reward).toBeUndefined();
    expect(MOVE_ALONG.dialogue).toEqual({});
  });

  it("is the only Mission that completes itself: every other one still hands in", () => {
    const automatic = MISSIONS.filter((mission) => mission.autoCompletion !== undefined);
    expect(automatic.map((mission) => mission.id)).toEqual([MISSION_IDS.moveAlong]);
    // Every other Mission hands in, except the one deliberately unfinished stage
    // (#369), which can neither hand in nor complete itself until a later slice.
    for (const mission of MISSIONS.filter(
      (candidate) =>
        candidate.id !== MISSION_IDS.moveAlong &&
        !candidate.requirements.some((requirement) => requirement.kind === "deferred_stage"),
    )) {
      expect(mission.turnIn, mission.id).toBeDefined();
    }
  });
});

describe("registry validation of the new completion", () => {
  const withOverrides = (overrides: Partial<MissionDefinition>): MissionDefinition =>
    ({
      ...MOVE_ALONG,
      prerequisiteMissionId: undefined,
      // Validated alone, so it has no predecessor to continue it: give it an offer
      // so only the completion rules under test can fail.
      offers: THRUST_ISSUES.offers,
      activeNpcDialogue: undefined,
      ...overrides,
    }) as MissionDefinition;
  const validate = (definition: MissionDefinition) => () =>
    validateMissionDefinitions([definition]);

  it("rejects a Mission that is both handed in and automatic", () => {
    expect(validate(withOverrides({ turnIn: THRUST_ISSUES.turnIn }))).toThrow(
      /both a turn-in and an auto-completion/,
    );
  });

  it("rejects a Mission with neither", () => {
    expect(validate(withOverrides({ autoCompletion: undefined, requirements: [] }))).toThrow(
      /must author a turn-in or an auto-completion/,
    );
  });

  it("rejects an automatic Mission that pays a reward or authors turn-in dialogue", () => {
    expect(validate(withOverrides({ reward: { kind: "credits", amount: 5 } }))).toThrow(
      /cannot author a reward/,
    );
    expect(
      validate(withOverrides({ dialogue: { busyDialogueId: DIALOGUE_IDS.wadeThrustIssuesBusy } })),
    ).toThrow(/cannot author turn-in dialogue/);
  });

  it("rejects a flight requirement that nothing can ever complete", () => {
    expect(validate(withOverrides({ autoCompletion: undefined }))).toThrow();
    expect(
      validate(
        withOverrides({
          requirements: [
            { kind: "at_location", locationId: LOCATION_IDS.crashSite, objective: "x" },
          ],
        }),
      ),
    ).toThrow(/does not require/);
  });

  it("rejects an unknown route", () => {
    expect(
      validate(
        withOverrides({
          autoCompletion: { kind: "ship_flight", routeId: "no_such_route" as never },
          requirements: [
            { kind: "ship_flight", routeId: "no_such_route" as never, objective: "x" },
          ],
        }),
      ),
    ).toThrow(/unknown ship route/);
  });
});

describe("projection", () => {
  it("offers nothing to accept, before or after Thrust Issues", () => {
    for (const prerequisite of [false, true]) {
      const projection = project(undefined, LOCATION_IDS.ruskRecovery, prerequisite);
      expect(projection.guidance).toBeUndefined();
      expect(entries(projection).filter((entry) => entry.kind === "mission")).toEqual([]);
    }
  });

  it("stays active whatever the player does, and is never ready to hand in", () => {
    const accepted = { acceptedAt: new Date() };
    for (const at of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.holoHollowLanding,
      LOCATION_IDS.ruskRecovery,
    ]) {
      for (const stationary of [true, false]) {
        const projection = project(accepted, at, true, stationary);
        // Standing at the destination, or at Wade, completes nothing.
        expect(projection.state, `${at} ${stationary}`).toBe("active");
        expect(projection.stage?.turnInAvailable).toBe(false);
        expect(projection.requirements?.[0]?.satisfied).toBe(false);
        // An empty tank: the fuel step is the current objective, not the flight.
        expect(projection.currentObjective).toBe("Fuel the Rivet for the trip (10 FU).");
      }
    }
  });

  it("guides the player to the Crash Site from elsewhere, and says nothing once there", () => {
    const accepted = { acceptedAt: new Date() };
    expect(project(accepted, LOCATION_IDS.ruskRecovery).guidance).toEqual({
      locationId: LOCATION_IDS.crashSite,
    });
    expect(project(accepted, LOCATION_IDS.crashSite).guidance).toBeUndefined();
    const targets = deriveMissionGuidanceTargets([project(accepted, LOCATION_IDS.crashSite)]);
    expect(targets.turnInNpcIds.size).toBe(0);
  });

  it("projects completed with no reward", () => {
    const done = project({ acceptedAt: new Date(), completedAt: new Date() });
    expect(done.state).toBe("completed");
    expect(done.earnedReward).toBeUndefined();
    expect(done.guidance).toBeUndefined();
  });
});

describe("Wade's conversation hub", () => {
  const history = (move: MissionProjection) => [
    {
      missionId: THRUST_ISSUES.id,
      state: "completed" as const,
      prerequisiteSatisfied: true,
    },
    {
      missionId: move.missionId,
      state: move.state,
      prerequisiteSatisfied: move.prerequisiteSatisfied,
      stage: move.stage,
      requirements: move.requirements,
      ...(move.guidance ? { guidance: move.guidance } : {}),
    },
  ];
  const hub = (move: MissionProjection) =>
    resolveNpcConversationWith(NPC_IDS.wadeRusk, history(move), MISSIONS, CONVERSATION_TOPICS);

  it("reminds while open, then shows the post-landing line only once it has landed", () => {
    const active = hub(project({ acceptedAt: new Date() }, LOCATION_IDS_RUSK));
    expect(active.find((entry) => entry.kind === "mission")).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.wadeMoveAlongActive,
    });
    // The reminder never offers a hand-in.
    expect(active.find((entry) => entry.kind === "mission")).not.toHaveProperty("action");

    const done = hub(
      project({ acceptedAt: new Date(), completedAt: new Date() }, LOCATION_IDS_RUSK),
    );
    expect(done.find((entry) => entry.kind === "mission")).toMatchObject({
      role: "completed",
      dialogueId: DIALOGUE_IDS.wadePostMoveAlong,
    });
  });
});

const LOCATION_IDS_RUSK = LOCATION_IDS.ruskRecovery;

describe("Wade's locked Move Along copy, verbatim", () => {
  const lines = (id: string) =>
    getDialogue(id)!.beats.map((beat) => ("text" in beat ? (beat.text as string) : ""));

  it("reminds in one beat", () => {
    expect(lines(DIALOGUE_IDS.wadeMoveAlongActive)).toEqual([
      "Crash Site to Holo Hollow Landing. Ten fuel units. Fuel the Rivet, fly it over, land it. In that order.",
    ]);
  });

  it("idles in two beats once the Rivet has landed", () => {
    expect(lines(DIALOGUE_IDS.wadePostMoveAlong)).toEqual([
      "Heard the Rivet made the Landing.",
      "Nobody's asked me to tow it back yet. Good.",
    ]);
  });

  it("hands Thrust Issues' report straight on to Move Along, with the locked send-off", () => {
    const completion = lines(DIALOGUE_IDS.wadeThrustIssuesCompletion);
    // His two locked completion lines come first, unchanged.
    expect(completion.slice(0, 2)).toEqual([
      "All right. Landing gear. Propulsion. Hold. Still looks like hell.",
      "But now it's a ship.",
    ]);
    // Then the approved Move Along send-off, verbatim.
    expect(completion.slice(2)).toEqual([
      "Holo Hollow Landing. They've got a proper pad. Take the Rivet there. Ten fuel units for the hop.",
      "You'll need fuel first. Make a Full Small Fuel Canister or buy one at Last Leg Trading. You can walk over to the Landing and back if you need to.",
      "Fly it over. Land it. And for once, don't make me come look at it.",
    ]);
    const offer = lines(DIALOGUE_IDS.wadeThrustIssuesOffer);
    expect(offer.join(" ")).not.toMatch(/front lawn/i);
    expect(offer.at(-1)).toBe("Fix it, and you're on your own. I'm done holding your hand.");
  });
});

/**
 * #358 playtest: the ship's live tank is the truth for fuel, so the first
 * objective reads the authoritative tank (never a canister carried or stored),
 * offers its Sources only while unmet, and the flight is the step after it.
 */
describe("the ship's tank", () => {
  const route = SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding;
  const cost = getShipFlightBalance(route).fuelCostFuelUnits;

  function projectWith(
    ship: { fuelUnits: number; flightRouteId?: string },
    carriedCanisters = 0,
  ): MissionProjection {
    return projectMission(
      MOVE_ALONG,
      { acceptedAt: new Date() },
      LOCATION_IDS.crashSite,
      true,
      {
        ...observation,
        carriedQuantities: new Map([[ITEM_IDS.fullSmallFuelCanister, carriedCanisters]]),
        stackLimits: new Map([[ITEM_IDS.fullSmallFuelCanister, 2]]),
        ship,
      },
      true,
    );
  }

  it("is unfuelled with an empty tank, however many canisters are carried", () => {
    const projection = projectWith({ fuelUnits: 0 }, 2);
    const [fuel, flight] = projection.requirements!;
    expect(fuel).toMatchObject({
      kind: "ship_fuel",
      satisfied: false,
      progress: { current: 0, target: cost },
      itemId: ITEM_IDS.fullSmallFuelCanister,
    });
    expect(flight).toMatchObject({ kind: "ship_flight", satisfied: false });
    expect(flight!.itemId).toBeUndefined();
    expect(projection.currentObjective).toBe("Fuel the Rivet for the trip (10 FU).");
  });

  it("is short of the trip at 9 FU and covered at exactly 10", () => {
    expect(projectWith({ fuelUnits: cost - 1 }).requirements![0]).toMatchObject({
      satisfied: false,
      progress: { current: cost - 1, target: cost },
    });
    expect(projectWith({ fuelUnits: cost }).requirements![0]).toMatchObject({
      satisfied: true,
      progress: { current: cost, target: cost },
    });
  });

  it("counts a full tank at once, with no Sources offered once satisfied", () => {
    const projection = projectWith({ fuelUnits: 50 });
    expect(projection.requirements![0]).toMatchObject({
      satisfied: true,
      progress: { current: 10, target: 10 },
    });
    expect(projection.requirements![0]!.itemId).toBeUndefined();
    // Fuel is done, so the flight is the current objective.
    expect(projection.currentObjective).toBe(
      "Fly the Rivet from the Crash Site to Holo Hollow Landing.",
    );
  });

  it("keeps the fuel step satisfied in the air, after the launch has spent it", () => {
    const projection = projectWith({
      fuelUnits: 0,
      flightRouteId: route,
    });
    expect(projection.requirements![0]).toMatchObject({ satisfied: true });
    expect(projection.requirements![0]!.itemId).toBeUndefined();
    expect(projection.requirements![1]).toMatchObject({ kind: "ship_flight", satisfied: false });
  });

  it("is never satisfied by the flight of some other route", () => {
    expect(
      projectWith({ fuelUnits: 0, flightRouteId: "elsewhere" }).requirements![0],
    ).toMatchObject({
      satisfied: false,
    });
  });

  it("reads an absent ship record as the untouched, empty tank", () => {
    const projection = projectMission(
      MOVE_ALONG,
      { acceptedAt: new Date() },
      LOCATION_IDS.crashSite,
      true,
      observation,
      true,
    );
    expect(projection.requirements![0]).toMatchObject({
      satisfied: false,
      progress: { current: 0 },
    });
  });
});

/**
 * Every item-bearing requirement names its item while it is unmet, so the Mission
 * Log can offer that item's Sources. Repair material rows are covered by their own
 * projection; this audit pins the requirement kinds that carry an item directly.
 */
describe("item Sources on unmet requirements", () => {
  it("names the item on every unmet item-bearing requirement across all Missions", () => {
    const gaps: string[] = [];
    let checked = 0;
    for (const definition of MISSIONS) {
      const projection = projectMission(
        definition,
        { acceptedAt: new Date() },
        LOCATION_IDS.crashSite,
        true,
        observation,
        true,
      );
      definition.requirements.forEach((requirement, index) => {
        if (!("itemId" in requirement)) return;
        const status = projection.requirements?.[index];
        if (status?.satisfied !== false) return;
        checked += 1;
        if (status.itemId !== requirement.itemId) {
          gaps.push(`${definition.id}#${index} (${requirement.kind})`);
        }
      });
    }
    // The audit must actually have looked at something, or it proves nothing.
    expect(checked).toBeGreaterThan(0);
    expect(gaps).toEqual([]);
  });
});
