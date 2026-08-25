import { describe, expect, it } from "vitest";
import { CUT_YOUR_TEETH, WALK_IT_OFF } from "@/game/content/missions";
import {
  CUT_YOUR_TEETH_DIALOGUE,
  DIALOGUE_SEQUENCES,
  getCutYourTeethActiveDialogue,
  getCutYourTeethCompletion,
  getDialogue,
  getWalkItOffDialogue,
  resolveDialogueSkillXp,
} from "@/game/content/dialogue";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { projectMission, type MissionObservation } from "@/game/domain/missions";
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

describe("issue #110 Cut Your Teeth authored boundaries", () => {
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
    expect(getWalkItOffDialogue(NPC_IDS.tansyRusk, "not_accepted")?.id).toBe(
      DIALOGUE_IDS.tansyBeforeMission,
    );
    expect(getWalkItOffDialogue(NPC_IDS.tansyRusk, "completed")?.id).toBe(
      CUT_YOUR_TEETH_DIALOGUE.offer,
    );
    // The amendment folds the old idle beats into the offer's opening.
    const offer = getDialogue(CUT_YOUR_TEETH_DIALOGUE.offer);
    expect(offer?.action).toBe("accept_mission");
    expect(offer?.beats[0]).toMatchObject({ text: "Still have all your fingers?" });
    expect(offer?.beats.some((beat) => beat.text.includes("scavenge"))).toBe(true);
    // The retired dead-end sequence no longer exists as authored content.
    expect(
      DIALOGUE_SEQUENCES.some((sequence) => sequence.id === DIALOGUE_IDS.tansyAfterCompletion),
    ).toBe(false);
  });

  it("keeps the Cut Your Teeth offer owned by the CYT flow with SHOW SHALE action copy", () => {
    // The offer is an accept_mission sequence; its Accept must map to the
    // CYT acceptance (not Walk It Off's) and the turn-in uses SHOW SHALE.
    const offer = getDialogue(CUT_YOUR_TEETH_DIALOGUE.offer);
    expect(offer?.action).toBe("accept_mission");
    expect(offer?.actionLabel).toBeUndefined();
    const turnIn = getDialogue(CUT_YOUR_TEETH_DIALOGUE.turnIn);
    expect(turnIn?.action).toBe("complete_mission");
    expect(turnIn?.actionLabel).toBe("SHOW SHALE");
    // Walk It Off's Cutter claim keeps its existing mission-specific copy.
    expect(getDialogue(DIALOGUE_IDS.tansyCompletion)?.actionLabel).toBe("Claim reward");
  });

  it("resolves contextual active sequences for equip, stack, and turn-in states", () => {
    expect(getCutYourTeethActiveDialogue("equip")?.id).toBe(CUT_YOUR_TEETH_DIALOGUE.equipReminder);
    expect(getCutYourTeethActiveDialogue("stack")?.id).toBe(CUT_YOUR_TEETH_DIALOGUE.stackReminder);
    expect(getCutYourTeethActiveDialogue("ready")?.id).toBe(CUT_YOUR_TEETH_DIALOGUE.turnIn);
    expect(getCutYourTeethCompletion()?.beats.map((beat) => beat.kind)).toEqual([
      "item",
      "skill_xp",
      "npc",
      "npc",
      "npc",
    ]);
  });

  it("resolves skill-XP presentation only against canonical skills", () => {
    const completion = getCutYourTeethCompletion();
    const xpBeat = completion!.beats.find((beat) => beat.kind === "skill_xp");
    if (xpBeat?.kind !== "skill_xp") throw new Error("fixture must contain a skill_xp beat");
    expect(resolveDialogueSkillXp(xpBeat)).toMatchObject({
      skillId: SKILL_IDS.mining,
      amount: 100,
      presentation: { displayName: "Mining" },
    });
    expect(resolveDialogueSkillXp({ ...xpBeat, skillId: "not_a_skill" })).toBeUndefined();
    expect(resolveDialogueSkillXp({ kind: "npc" } as never)).toBeUndefined();
  });

  it("keeps the shale reveal within the authoritative stack range and at The Jag", () => {
    const completion = getCutYourTeethCompletion();
    const itemBeat = completion!.beats.find((beat) => beat.kind === "item");
    if (itemBeat?.kind !== "item") throw new Error("fixture must contain an item beat");
    const range = getItemBeatQuantityRange(itemBeat.itemId);
    expect(itemBeat.quantity).toBe(range?.max);
    expect(itemBeat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.theJagExterior);
    // Every CYT sequence stays on The Jag background with Tansy as its identity.
    for (const dialogueId of Object.values(CUT_YOUR_TEETH_DIALOGUE)) {
      const sequence = getDialogue(dialogueId);
      expect(sequence?.npcId).toBe(NPC_IDS.tansyRusk);
    }
  });
});

describe("issue #110 objective projection from authoritative observations", () => {
  it("shows no active objective before acceptance and none after completion", () => {
    expect(
      projectMission(CUT_YOUR_TEETH, undefined, LOCATION().theJag, true, observation()),
    ).toMatchObject({ state: "not_accepted", currentObjective: undefined });
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(true), LOCATION().theJag, true, observation()),
    ).toMatchObject({ state: "completed", currentObjective: undefined });
  });

  it("directs the player back to The Jag while away", () => {
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(), LOCATION().crashSite, true, observation()),
    ).toMatchObject({ state: "active", currentObjective: "Return to The Jag" });
  });

  it("derives equip-first precedence from equipment state, never clicks or history", () => {
    const awayFromEquip = observation({
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
    });
    const projected = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      LOCATION().theJag,
      true,
      awayFromEquip,
    );
    // Even at The Jag and stationary with a full stack, the Cutter not being
    // equipped keeps the mission ACTIVE (not completion-ready): ready_for_completion
    // requires every authored step to hold.
    expect(projected).toMatchObject({
      state: "active",
      currentObjective: "Equip the Salvage Cutter from Inventory",
      stage: { readyForCompletion: false, nextObjectiveKind: "equip_item" },
    });
  });

  it("progresses N / stackLimit from current carried shale including scavenged shale", () => {
    const fourCarried = observation({
      equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 4]]),
    });
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(), LOCATION().theJag, true, fourCarried),
    ).toMatchObject({
      currentObjective: "Get a full stack of Ferrite Shale — 4 / 10",
    });

    // Ten-plus carried shows the turn-in objective; extra units clamp.
    const fullStack = observation({
      equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 12]]),
    });
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(), LOCATION().theJag, true, fullStack),
    ).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Show a full stack of Ferrite Shale to Tansy Rusk",
    });
  });

  it("falls back when shale drops below a full stack before turn-in", () => {
    const droppedBelowStack = observation({
      equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
      carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 3]]),
    });
    expect(
      projectMission(CUT_YOUR_TEETH, accepted(), LOCATION().theJag, true, droppedBelowStack),
    ).toMatchObject({
      currentObjective: "Get a full stack of Ferrite Shale — 3 / 10",
    });
  });

  it("keeps Walk It Off's travel/completion objectives working through the same projection", () => {
    expect(projectMission(WALK_IT_OFF, accepted(), LOCATION().crashSite, true)).toMatchObject({
      currentObjective: "Travel to The Jag",
    });
    expect(projectMission(WALK_IT_OFF, accepted(), LOCATION().theJag, true)).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Talk to Tansy Rusk",
    });
  });

  it("exposes prerequisite-satisfied availability only when the prerequisite is complete", () => {
    // Not yet accepted and its prerequisite (Walk It Off) NOT complete: the
    // projection is not_accepted and NOT available to the player.
    const locked = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION().theJag,
      true,
      observation(),
    );
    expect(locked).toMatchObject({
      state: "not_accepted",
      prerequisiteSatisfied: false,
    });

    // Not yet accepted but its prerequisite IS complete (the post-Walk-It-Off
    // boundary): the projection becomes available and leads the player in.
    const available = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION().theJag,
      true,
      observation(),
      true,
    );
    expect(available).toMatchObject({
      state: "not_accepted",
      prerequisiteSatisfied: true,
      availableObjective: "Speak with Tansy Rusk at The Jag to begin Cut Your Teeth.",
      offeringNpcName: "Tansy Rusk",
    });
  });

  it("emits semantic stage data for routing without parsing objective copy", () => {
    // Equip unsatisfied → nextObjectiveKind equip_item, not ready.
    const equip = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      LOCATION().theJag,
      true,
      observation(),
    );
    expect(equip.stage).toMatchObject({
      readyForCompletion: false,
      nextObjectiveKind: "equip_item",
    });

    // Stack unsatisfied → nextObjectiveKind carry_stack.
    const stack = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      LOCATION().theJag,
      true,
      observation({ equippedItemIds: new Set([ITEM_IDS.salvageCutter]) }),
    );
    expect(stack.stage).toMatchObject({
      readyForCompletion: false,
      nextObjectiveKind: "carry_stack",
    });

    // All steps hold at The Jag → readyForCompletion true.
    const ready = projectMission(
      CUT_YOUR_TEETH,
      accepted(),
      LOCATION().theJag,
      true,
      observation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
      }),
    );
    expect(ready.stage).toMatchObject({ readyForCompletion: true, nextObjectiveKind: undefined });
    expect(ready).toMatchObject({ state: "ready_for_completion" });
  });
});

function LOCATION() {
  return { crashSite: "crash_site", theJag: "the_jag" } as const;
}
