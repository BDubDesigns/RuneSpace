import { describe, expect, it } from "vitest";
import {
  CUT_YOUR_TEETH,
  WALK_IT_OFF,
  MISSIONS,
  type MissionDefinition,
} from "@/game/content/missions";
import {
  getDialogue,
  getMissionCompletionPresentation,
  resolveNpcMissionDialogue,
} from "@/game/content/dialogue";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import type { ContentId } from "@/game/schemas/ids";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import { getItemBeatQuantityRange } from "@/game/content/item-presentation";

function observation(overrides: Partial<MissionObservation> = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map<string, number>(),
    stackLimits: new Map<string, number>([[ITEM_IDS.ferriteShale, 10]]),
    itemNames: new Map<string, string>([
      [ITEM_IDS.salvageCutter, "Salvage Cutter"],
      [ITEM_IDS.ferriteShale, "Ferrite Shale"],
    ]),
    ...overrides,
  };
}

function accepted(completed = false) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return completed ? { acceptedAt: now, completedAt: now } : { acceptedAt: now };
}

const THE_JAG = LOCATION_IDS.theJag;
const CRASH_SITE = LOCATION_IDS.crashSite;

describe("issue #110 Cut Your Teeth authored boundaries (framework migration)", () => {
  it("gates the offer behind a completed Walk It Off prerequisite in content", () => {
    expect(CUT_YOUR_TEETH.prerequisiteMissionId).toBe(MISSION_IDS.walkItOff);
    expect(CUT_YOUR_TEETH.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.mining,
      amount: 100,
    });
    expect(WALK_IT_OFF.reward).toEqual({ kind: "item", itemId: ITEM_IDS.salvageCutter });
  });

  it("routes Tansy to the Cut Your Teeth offer once Walk It Off is completed", () => {
    // Generic router: Walk It Off not accepted → the explorer-first offer.
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        mission(MISSION_IDS.walkItOff, "not_accepted"),
        mission(MISSION_IDS.cutYourTeeth, "not_accepted", { prerequisiteSatisfied: false }),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyBeforeMission);
    // Walk It Off complete, Cut Your Teeth not yet accepted → the CYT offer.
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        mission(MISSION_IDS.walkItOff, "completed"),
        mission(MISSION_IDS.cutYourTeeth, "not_accepted"),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethOffer);
    // The amendment folds the old idle beats into the offer's opening.
    const offer = getDialogue(DIALOGUE_IDS.tansyCutYourTeethOffer);
    expect(offer?.action).toBe("accept_mission");
    expect(offer?.beats[0]).toMatchObject({ text: "Still have all your fingers?" });
    expect(offer?.beats.some((beat) => beat.text.includes("scavenge"))).toBe(true);
  });

  it("keeps the Cut Your Teeth offer owned by the CYT flow with SHOW SHALE action copy", () => {
    const offer = getDialogue(DIALOGUE_IDS.tansyCutYourTeethOffer);
    expect(offer?.action).toBe("accept_mission");
    expect(offer?.actionLabel).toBeUndefined();
    const turnIn = getDialogue(DIALOGUE_IDS.tansyCutYourTeethTurnIn);
    expect(turnIn?.action).toBe("complete_mission");
    expect(turnIn?.actionLabel).toBe("SHOW SHALE");
    // Walk It Off's Cutter claim keeps its existing mission-specific copy.
    expect(getDialogue(DIALOGUE_IDS.tansyCompletion)?.actionLabel).toBe("Claim Cutter");
  });

  it("resolves contextual active sequences for equip, stack, ready, and busy states", () => {
    // Through the generic router, the turn-in NPC branches on semantic stage.
    const route = (projection: MissionProjection) =>
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [projection])?.sequence;

    expect(route(activeProjection({ nextObjectiveKind: "equipped_item" }))?.id).toBe(
      DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
    );
    expect(route(activeProjection({ nextObjectiveKind: "carried_stack" }))?.id).toBe(
      DIALOGUE_IDS.tansyCutYourTeethStackReminder,
    );
    expect(
      route(activeProjection({ requirementsSatisfied: true, turnInAvailable: true }))?.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethTurnIn);
    expect(
      route(activeProjection({ requirementsSatisfied: true, turnInAvailable: false }))?.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethBusy);
    expect(
      getMissionCompletionPresentation(MISSION_IDS.cutYourTeeth)?.beats.map((b) => b.kind),
    ).toEqual(["item", "skill_xp", "npc", "npc", "npc"]);
  });

  it("teaches the Mining loop in the incomplete-stack reminder and never lies about the busy state", () => {
    const stackReminder = getDialogue(DIALOGUE_IDS.tansyCutYourTeethStackReminder);
    expect(stackReminder?.beats.map((beat) => beat.text)).toEqual([
      "I need to see one full stack. Ten pieces of Ferrite Shale.",
      "Put that Salvage Cutter in your Mining Tool slot and work The Jag until you've got them.",
      "You'll miss plenty at first. Keep at it. The better you get at Mining, the more often the Cutter bites.",
      "If you scavenge a few along the way, they still count. Won't teach you much about Mining, though.",
      "Bring me ten. I only need to see them — you keep the shale.",
    ]);
    const busy = getDialogue(DIALOGUE_IDS.tansyCutYourTeethBusy);
    expect(busy?.beats[0]?.text).toContain("full stack on you already");
    expect(busy?.beats.some((beat) => /need (more|ten)|bring me ten/i.test(beat.text))).toBe(false);
  });

  it("keeps the shale reveal within the authoritative stack range and at The Jag", () => {
    const completion = getMissionCompletionPresentation(MISSION_IDS.cutYourTeeth);
    const itemBeat = completion!.beats.find((beat) => beat.kind === "item");
    if (itemBeat?.kind !== "item") throw new Error("fixture must contain an item beat");
    const range = getItemBeatQuantityRange(itemBeat.itemId);
    expect(itemBeat.quantity).toBe(range?.max);
    expect(itemBeat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.theJagExterior);
    for (const dialogueId of [
      DIALOGUE_IDS.tansyCutYourTeethOffer,
      DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
      DIALOGUE_IDS.tansyCutYourTeethStackReminder,
      DIALOGUE_IDS.tansyCutYourTeethTurnIn,
      DIALOGUE_IDS.tansyCutYourTeethBusy,
      DIALOGUE_IDS.tansyCutYourTeethCompletion,
    ]) {
      expect(getDialogue(dialogueId)?.npcId).toBe(NPC_IDS.tansyRusk);
    }
  });
});

describe("issue #124 ordered requirement projection", () => {
  it("shows no active objective before acceptance and none after completion", () => {
    expect(projectMission(CUT_YOUR_TEETH, undefined, THE_JAG, true, observation())).toMatchObject({
      state: "not_accepted",
      currentObjective: undefined,
    });
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(true), THE_JAG, true, observation()),
    ).toMatchObject({ state: "completed", currentObjective: undefined });
  });

  it("directs the player back to The Jag while away (at_location is the first unmet requirement)", () => {
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(), CRASH_SITE, true, observation()),
    ).toMatchObject({ state: "active", currentObjective: "Return to The Jag" });
  });

  it("derives equip-first precedence from equipment state, never clicks or history", () => {
    const awayFromEquip = observation({
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
    });
    const projected = projectMission(CUT_YOUR_TEETH, accepted(), THE_JAG, true, awayFromEquip);
    expect(projected).toMatchObject({
      state: "active",
      currentObjective: "Equip the Salvage Cutter from Inventory",
      stage: {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "equipped_item",
      },
    });
  });

  it("progresses N / stackLimit from current carried shale including scavenged shale", () => {
    const fourCarried = observation({
      equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 4]]),
    });
    expect(projectMission(CUT_YOUR_TEETH, accepted(), THE_JAG, true, fourCarried)).toMatchObject({
      currentObjective: "Get a full stack of Ferrite Shale — 4 / 10",
    });

    const fullStack = observation({
      equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 12]]),
    });
    expect(projectMission(CUT_YOUR_TEETH, accepted(), THE_JAG, true, fullStack)).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Show a full stack of Ferrite Shale to Tansy Rusk",
    });
  });

  it("keeps Walk It Off's travel/completion objectives through the same ordered projection", () => {
    expect(projectMission(WALK_IT_OFF, accepted(), CRASH_SITE, true)).toMatchObject({
      currentObjective: "Travel to The Jag",
    });
    expect(projectMission(WALK_IT_OFF, accepted(), THE_JAG, true)).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Talk to Tansy Rusk",
    });
  });

  it("exposes the prerequisite gate without advertising the mission", () => {
    const locked = projectMission(CUT_YOUR_TEETH, undefined, THE_JAG, true, observation());
    expect(locked).toMatchObject({ state: "not_accepted", prerequisiteSatisfied: false });
    expect(locked.guidance?.availableNpcIds).toBeUndefined();
    const prerequisiteSatisfied = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      THE_JAG,
      true,
      observation(),
      true,
    );
    expect(prerequisiteSatisfied).toMatchObject({
      state: "not_accepted",
      prerequisiteSatisfied: true,
    });
    expect(prerequisiteSatisfied.guidance?.availableNpcIds).toBeUndefined();
  });

  it("emits semantic stage data for routing without parsing objective copy", () => {
    const equip = projectMission(CUT_YOUR_TEETH, accepted(), THE_JAG, true, observation());
    expect(equip.stage).toMatchObject({
      requirementsSatisfied: false,
      turnInAvailable: false,
      nextObjectiveKind: "equipped_item",
    });
    const stack = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      THE_JAG,
      true,
      observation({ equippedItemIds: new Set([ITEM_IDS.salvageCutter]) }),
    );
    expect(stack.stage).toMatchObject({
      requirementsSatisfied: false,
      turnInAvailable: false,
      nextObjectiveKind: "carried_stack",
    });
    const ready = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      THE_JAG,
      true,
      observation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
      }),
    );
    expect(ready.stage).toMatchObject({
      requirementsSatisfied: true,
      turnInAvailable: true,
      nextObjectiveKind: undefined,
    });
    expect(ready).toMatchObject({ state: "ready_for_completion" });

    // Busy with all requirements satisfied: requirements hold, turn-in blocked.
    const busy = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      THE_JAG,
      false,
      observation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
      }),
    );
    expect(busy.stage).toMatchObject({
      requirementsSatisfied: true,
      turnInAvailable: false,
      nextObjectiveKind: undefined,
    });
    expect(busy).toMatchObject({ state: "active" });
  });

  it("resolves the downstream prerequisite relationship from registry data", () => {
    const cutYourTeeth = MISSIONS.find((mission) => mission.id === MISSION_IDS.cutYourTeeth);
    expect(cutYourTeeth?.prerequisiteMissionId).toBe(MISSION_IDS.walkItOff);
    const walkItOff = MISSIONS.find((mission) => mission.id === MISSION_IDS.walkItOff);
    expect(walkItOff?.prerequisiteMissionId).toBeUndefined();
  });
});

describe("issue #124 semantic mission guidance projection", () => {
  it("targets the turn-in NPC once requirements are satisfied", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      THE_JAG,
      true,
      observation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
      }),
    );
    const targets = deriveMissionGuidanceTargets([projection]);
    expect([...targets.npcIds]).toEqual([NPC_IDS.tansyRusk]);
  });

  it("targets the Cutter equipment affordance while the equip requirement is unmet", () => {
    const projection = projectMission(CUT_YOUR_TEETH, accepted(), THE_JAG, true, observation());
    const targets = deriveMissionGuidanceTargets([projection]);
    expect([...targets.equipmentItemIds]).toEqual([ITEM_IDS.salvageCutter]);
    expect([...targets.actionIds]).toEqual([]);
  });

  it("targets Start Mining only while the shale requirement is the first unmet step", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      THE_JAG,
      true,
      observation({ equippedItemIds: new Set([ITEM_IDS.salvageCutter]) }),
    );
    const targets = deriveMissionGuidanceTargets([projection]);
    expect([...targets.actionIds]).toEqual(["ferrite_shale_mining"]);
    expect([...targets.equipmentItemIds]).toEqual([]);
  });

  it("never targets Scavenge merely because it can yield Ferrite Shale", () => {
    const projections = MISSIONS.map((definition) =>
      projectMission(definition, undefined, THE_JAG, true, observation()),
    );
    const targets = deriveMissionGuidanceTargets(projections);
    expect(targets.actionIds.has("travel")).toBe(false);
    for (const actionId of targets.actionIds) {
      expect(actionId).toBe("ferrite_shale_mining");
    }
  });

  it("guides toward a prerequisite-free mission via its authored offers", () => {
    // Walk It Off authors no prerequisite (explorer-first). Availability is
    // still projected from every authored offer at the current location, not
    // from objective copy.
    const atCrashSite = projectMission(
      WALK_IT_OFF,
      undefined,
      CRASH_SITE,
      true,
      observation(),
      true,
    );
    const atTheJag = projectMission(WALK_IT_OFF, undefined, THE_JAG, true, observation(), true);
    expect([...deriveMissionGuidanceTargets([atCrashSite]).availableNpcIds]).toEqual([
      NPC_IDS.wadeRusk,
    ]);
    expect([...deriveMissionGuidanceTargets([atTheJag]).availableNpcIds]).toEqual([
      NPC_IDS.tansyRusk,
    ]);
    // No active NPC guidance before acceptance.
    expect([...deriveMissionGuidanceTargets([atCrashSite]).npcIds]).toEqual([]);
  });
});

describe("issue #124 turn-in location is an independent eligibility constraint", () => {
  // A mission whose requirements carry NO at_location step (equip + carry
  // only), with its turn-in authored at The Jag. Proves the turn-in location
  // gates eligibility without authors duplicating it as a requirement.
  const turnInGated: MissionDefinition = {
    id: "synthetic_turn_in_location" as ContentId,
    title: "Synthetic Turn-In Location",
    summary: "Equip and carry, then turn in at The Jag.",
    offers: [
      {
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.theJag,
        dialogueId: DIALOGUE_IDS.tansyCutYourTeethOffer,
      },
    ],
    requirements: [
      {
        kind: "equipped_item",
        itemId: ITEM_IDS.salvageCutter,
        objective: "Equip the {item} from Inventory",
      },
      {
        kind: "carried_stack",
        itemId: ITEM_IDS.ferriteShale,
        turnIn: "show",
        objective: "Get a full stack of {item} — {carried} / {required}",
      },
    ],
    turnIn: {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      requiresStationary: true,
      objective: "Show your work to Tansy Rusk",
      dialogueId: DIALOGUE_IDS.tansyCutYourTeethTurnIn,
    },
    reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 10 },
    dialogue: {},
  };

  const satisfiedObservation = (): MissionObservation => ({
    equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
    carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
    stackLimits: new Map([[ITEM_IDS.ferriteShale, 10]]),
    itemNames: new Map([
      [ITEM_IDS.salvageCutter, "Salvage Cutter"],
      [ITEM_IDS.ferriteShale, "Ferrite Shale"],
    ]),
  });

  it("satisfies requirements away from the turn-in location without becoming completion-ready", () => {
    const accepted = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };
    const away = projectMission(
      turnInGated,
      accepted,
      LOCATION_IDS.crashSite,
      true,
      satisfiedObservation(),
    );
    // Requirements hold even away from The Jag...
    expect(away.stage).toMatchObject({
      requirementsSatisfied: true,
      turnInAvailable: false,
      nextObjectiveKind: undefined,
    });
    // ...the objective correctly advances to the authored turn-in copy...
    expect(away.currentObjective).toBe("Show your work to Tansy Rusk");
    // ...but the mission is NOT completion-ready until the character is
    // stationary at the authored turn-in location.
    expect(away.state).toBe("active");
  });

  it("becomes ready_for_completion only stationary at the authored turn-in location", () => {
    const accepted = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };
    const there = projectMission(
      turnInGated,
      accepted,
      LOCATION_IDS.theJag,
      true,
      satisfiedObservation(),
    );
    expect(there.state).toBe("ready_for_completion");
    expect(there.stage).toMatchObject({ requirementsSatisfied: true, turnInAvailable: true });

    const thereButBusy = projectMission(
      turnInGated,
      accepted,
      LOCATION_IDS.theJag,
      false,
      satisfiedObservation(),
    );
    expect(thereButBusy.state).toBe("active");
    expect(thereButBusy.stage).toMatchObject({
      requirementsSatisfied: true,
      turnInAvailable: false,
    });
  });
});

function mission(
  missionId: string,
  state: MissionProjection["state"],
  overrides: Partial<MissionProjection> = {},
): MissionProjection {
  return {
    missionId,
    state,
    prerequisiteSatisfied: true,
    stage: { requirementsSatisfied: false, turnInAvailable: false },
    ...overrides,
  } as MissionProjection;
}

function activeProjection(
  stage: Partial<NonNullable<MissionProjection["stage"]>>,
): MissionProjection {
  return mission(
    MISSION_IDS.cutYourTeeth,
    stage.turnInAvailable ? "ready_for_completion" : "active",
    {
      stage: { requirementsSatisfied: false, turnInAvailable: false, ...stage },
    },
  );
}
