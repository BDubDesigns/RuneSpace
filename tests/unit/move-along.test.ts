import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
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
    expect(MOVE_ALONG.requirements).toEqual([
      {
        kind: "ship_flight",
        routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
        objective:
          "Fuel the Rivet, then fly it from the Crash Site to Holo Hollow Landing (10 FU).",
      },
    ]);
  });

  it("is gated only by Thrust Issues and is never an automatic continuation", () => {
    expect(MOVE_ALONG.prerequisiteMissionId).toBe(MISSION_IDS.thrustIssues);
    expect(MOVE_ALONG.prerequisiteSkillLevels).toBeUndefined();
    expect(THRUST_ISSUES.continuationMissionId).toBeUndefined();
    expect(
      MISSIONS.some((mission) => mission.continuationMissionId === MISSION_IDS.moveAlong),
    ).toBe(false);
  });

  it("is offered by hand by Wade at Rusk Recovery with the locked control", () => {
    expect(MOVE_ALONG.offers).toEqual([
      {
        npcId: NPC_IDS.wadeRusk,
        locationId: LOCATION_IDS.ruskRecovery,
        dialogueId: DIALOGUE_IDS.wadeMoveAlongOffer,
        actionLabel: "TAKE HER TO THE PAD",
        activeDialogueId: DIALOGUE_IDS.wadeMoveAlongActive,
      },
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
    expect(
      MOVE_ALONG.offers.some((offer) => "acceptEffect" in offer || "acceptedContinuation" in offer),
    ).toBe(false);
  });

  it("is the only Mission that completes itself: every other one still hands in", () => {
    const automatic = MISSIONS.filter((mission) => mission.autoCompletion !== undefined);
    expect(automatic.map((mission) => mission.id)).toEqual([MISSION_IDS.moveAlong]);
    for (const mission of MISSIONS.filter((candidate) => candidate.id !== MISSION_IDS.moveAlong)) {
      expect(mission.turnIn, mission.id).toBeDefined();
    }
  });
});

describe("registry validation of the new completion", () => {
  const withOverrides = (overrides: Partial<MissionDefinition>): MissionDefinition =>
    ({ ...MOVE_ALONG, prerequisiteMissionId: undefined, ...overrides }) as MissionDefinition;
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
  it("is not offered before Thrust Issues is complete", () => {
    const locked = project(undefined, LOCATION_IDS.ruskRecovery, false);
    expect(locked.prerequisiteSatisfied).toBe(false);
    expect(
      entries(locked).some((entry) => entry.dialogueId === DIALOGUE_IDS.wadeMoveAlongOffer),
    ).toBe(false);
  });

  it("is offered manually once Thrust Issues is complete", () => {
    const available = project(undefined, LOCATION_IDS.ruskRecovery);
    expect(available.state).toBe("not_accepted");
    expect(available.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(entries(available)[0]).toMatchObject({
      kind: "mission",
      role: "offer",
      dialogueId: DIALOGUE_IDS.wadeMoveAlongOffer,
      action: { kind: "accept_mission", label: "TAKE HER TO THE PAD" },
    });
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
        expect(projection.currentObjective).toBe(MOVE_ALONG.requirements[0]!.objective);
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

  it("offers it, then reminds, then shows the post-landing line only once it has landed", () => {
    const offer = hub(project(undefined, LOCATION_IDS.ruskRecovery));
    expect(offer.find((entry) => entry.kind === "mission")).toMatchObject({
      role: "offer",
      dialogueId: DIALOGUE_IDS.wadeMoveAlongOffer,
    });

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

  it("offers in five beats", () => {
    expect(lines(DIALOGUE_IDS.wadeMoveAlongOffer)).toEqual([
      "Hm. Still here?",
      "Hold's fixed. Gear's fixed. Drive's fixed. Keep turning up and I'll find you something else to weld.",
      "Holo Hollow Landing. They've got a proper pad. Take the Rivet there. Ten fuel units for the hop.",
      "You'll need fuel first. Make a Full Small Fuel Canister or buy one at Last Leg Trading. You can walk over to the Landing and back if you need to.",
      "Fly it over. Land it. And for once, don't make me come look at it.",
    ]);
  });

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

  it("leaves Thrust Issues' completion lines unchanged and replaces only the false 'front lawn' jab", () => {
    expect(lines(DIALOGUE_IDS.wadeThrustIssuesCompletion)).toEqual([
      "All right. Landing gear. Propulsion. Hold. Still looks like hell.",
      "But now it's a ship.",
    ]);
    const offer = lines(DIALOGUE_IDS.wadeThrustIssuesOffer);
    expect(offer.join(" ")).not.toMatch(/front lawn/i);
    expect(offer.at(-1)).toBe("Fix it, and you're on your own. I'm done holding your hand.");
  });
});
