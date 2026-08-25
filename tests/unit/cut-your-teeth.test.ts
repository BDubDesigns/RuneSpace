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
    expect(projected).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Equip the Salvage Cutter from Inventory",
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
});

function LOCATION() {
  return { crashSite: "crash_site", theJag: "the_jag" } as const;
}
