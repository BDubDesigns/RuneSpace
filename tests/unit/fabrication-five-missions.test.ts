import { describe, expect, it } from "vitest";
import { fabricationRecipeForActionId } from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getDialogue, type DialogueBeat } from "@/game/content/dialogue";
import {
  A_CUT_ABOVE,
  CUTTING_COSTS,
  MISSIONS,
  type MissionDefinition,
} from "@/game/content/missions";
import { resolveNpcConversation, type NpcConversationProjection } from "@/game/domain/conversation";
import {
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
} from "@/game/domain/missions";

/**
 * A Cut Above and Cutting Costs as authored content (#233): their distinct
 * triggers and provenance, their exact rewards, the locked dialogue with the
 * player silent, and the conversations each NPC offers at each stage.
 */

const beats = (dialogueId: string): readonly DialogueBeat[] => getDialogue(dialogueId)?.beats ?? [];
const spoken = (dialogueId: string) =>
  beats(dialogueId).map((beat) =>
    beat.kind === "npc" ? [beat.speakerNpcId, beat.expressionId, beat.text] : [beat.kind],
  );

function observation(levels: Record<string, number>): MissionObservation {
  return {
    equippedItemIds: new Set(),
    carriedQuantities: new Map(),
    carriedUniqueItems: new Map(),
    stackLimits: new Map(),
    itemNames: new Map([[ITEM_IDS.loadsteelCutter, "Loadsteel Cutter"]]),
    trackedProgress: new Map(),
    skillLevels: new Map(Object.entries(levels)),
  };
}

function offered(
  definition: MissionDefinition,
  input: { braceComplete: boolean; fabrication: number },
): boolean {
  return projectMission(
    definition,
    undefined,
    LOCATION_IDS.theJag,
    true,
    observation({ [SKILL_IDS.fabrication]: input.fabrication, [SKILL_IDS.mining]: 5 }),
    input.braceComplete,
  ).prerequisiteSatisfied;
}

describe("A Cut Above", () => {
  it("is offered by Tansy at The Jag once Brace Yourself is complete and only at Fabrication 5", () => {
    expect(A_CUT_ABOVE.prerequisiteMissionId).toBe(MISSION_IDS.braceYourself);
    expect(A_CUT_ABOVE.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.fabrication, level: 5 },
    ]);
    expect(A_CUT_ABOVE.offers).toEqual([
      expect.objectContaining({
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.theJag,
        dialogueId: DIALOGUE_IDS.tansyACutAboveOffer,
      }),
    ]);
    expect(offered(A_CUT_ABOVE, { braceComplete: false, fabrication: 8 })).toBe(false);
    expect(offered(A_CUT_ABOVE, { braceComplete: true, fabrication: 4 })).toBe(false);
    expect(offered(A_CUT_ABOVE, { braceComplete: true, fabrication: 5 })).toBe(true);
  });

  it("asks nothing of Refining, and accepting it unlocks nothing: the recipe is Fabrication 5 on its own", () => {
    expect(JSON.stringify(A_CUT_ABOVE)).not.toContain(SKILL_IDS.refining);
    expect(fabricationRecipeForActionId(ACTION_IDS.loadsteelCutterFabrication)).toMatchObject({
      minimumLevel: 5,
    });
    expect(A_CUT_ABOVE).not.toHaveProperty("continuationMissionId");
    expect(A_CUT_ABOVE.offers[0]).not.toHaveProperty("acceptEffect");
  });

  it("counts only a Loadsteel Cutter genuinely fabricated while it is active, and takes nothing", () => {
    expect(A_CUT_ABOVE.requirements).toEqual([
      {
        kind: "tracked_activity",
        progressKey: "loadsteel-cutter-fabricated",
        activity: "fabrication",
        metric: "completions",
        actionId: ACTION_IDS.loadsteelCutterFabrication,
        target: 1,
        objective: "Fabricate a Loadsteel Cutter — {current} / {target}",
        recommendedActionId: ACTION_IDS.loadsteelCutterFabrication,
      },
    ]);
    // No hand-in requirement at all: Tansy never consumes the Cutter.
    expect(A_CUT_ABOVE.requirements.some((each) => each.kind === "carried_unique_item")).toBe(
      false,
    );
    expect(A_CUT_ABOVE.turnIn).toMatchObject({
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
    });
  });

  it("pays exactly 500 Fabrication XP", () => {
    expect(A_CUT_ABOVE.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.fabrication,
      amount: 500,
    });
  });

  it("carries the locked offer, word for word, with the player silent", () => {
    const t = NPC_IDS.tansyRusk;
    expect(spoken(DIALOGUE_IDS.tansyACutAboveOffer)).toEqual([
      [
        t,
        EXPRESSION_IDS.smile,
        "You've been using that Fabrication Station enough that it's starting to trust you.",
      ],
      [t, EXPRESSION_IDS.neutral, "Take another look at the recipe list."],
      [
        t,
        EXPRESSION_IDS.neutral,
        "You'll get more options as your Fabrication gets better. Some of them are just different ways to make a mess.",
      ],
      [t, EXPRESSION_IDS.neutral, "Some are worth paying attention to."],
      [t, EXPRESSION_IDS.smile, "You can build a Loadsteel Cutter now."],
      [
        t,
        EXPRESSION_IDS.smile,
        "Better frame. Better drive. Faster than that Salvage Cutter you've been dragging around.",
      ],
      [
        t,
        EXPRESSION_IDS.smile,
        "And if you feed it a Power Cell, it'll pull a little more out of the rock.",
      ],
      [t, EXPRESSION_IDS.neutral, "Go make one."],
      [
        t,
        EXPRESSION_IDS.neutral,
        "Bring it back when you're done. I want to see what you can do with higher tier materials.",
      ],
    ]);
  });

  it("carries the locked turn-in and its completion, then the 500 XP", () => {
    const t = NPC_IDS.tansyRusk;
    expect(spoken(DIALOGUE_IDS.tansyACutAboveTurnIn)).toEqual([
      [t, EXPRESSION_IDS.smile, "There it is."],
      [t, EXPRESSION_IDS.smile, "Looks like you're done making starter gear."],
    ]);
    expect(spoken(DIALOGUE_IDS.tansyACutAboveCompletion)).toEqual([
      [t, EXPRESSION_IDS.neutral, "Keep checking that recipe list as your Fabrication improves."],
      [
        t,
        EXPRESSION_IDS.neutral,
        "The better you get, the more useful things you'll be able to make.",
      ],
      [t, EXPRESSION_IDS.smile, "And keep the Cutter. You earned it."],
      ["skill_xp"],
    ]);
    expect(beats(DIALOGUE_IDS.tansyACutAboveCompletion).at(-1)).toMatchObject({
      kind: "skill_xp",
      skillId: SKILL_IDS.fabrication,
      amount: 500,
    });
  });

  it("reminds with the offer's own closing instruction, never new prose", () => {
    const offer = spoken(DIALOGUE_IDS.tansyACutAboveOffer);
    expect(spoken(DIALOGUE_IDS.tansyACutAboveReminder)).toEqual(offer.slice(-2));
  });
});

describe("Cutting Costs", () => {
  it("is offered by Renn after Brace Yourself at any Fabrication level, with no A Cut Above", () => {
    expect(CUTTING_COSTS.prerequisiteMissionId).toBe(MISSION_IDS.braceYourself);
    expect(CUTTING_COSTS.prerequisiteSkillLevels).toBeUndefined();
    expect(JSON.stringify(CUTTING_COSTS)).not.toContain(MISSION_IDS.aCutAbove);
    expect(CUTTING_COSTS.offers).toEqual([
      expect.objectContaining({
        npcId: NPC_IDS.rennCalder,
        locationId: LOCATION_IDS.holoHollow,
        dialogueId: DIALOGUE_IDS.rennCuttingCostsOffer,
      }),
    ]);
    expect(offered(CUTTING_COSTS, { braceComplete: false, fabrication: 8 })).toBe(false);
    expect(offered(CUTTING_COSTS, { braceComplete: true, fabrication: 1 })).toBe(true);
  });

  it("takes any one carried, unequipped Loadsteel Cutter — no provenance — and pays 500 Credits", () => {
    expect(CUTTING_COSTS.requirements).toEqual([
      {
        kind: "carried_unique_item",
        itemId: ITEM_IDS.loadsteelCutter,
        turnIn: "consume_one",
        objective: "Bring Renn a {item}",
      },
    ]);
    expect(CUTTING_COSTS.requirements.some((each) => each.kind === "tracked_activity")).toBe(false);
    expect(CUTTING_COSTS.reward).toEqual({ kind: "credits", amount: 500 });
    expect(CUTTING_COSTS.turnIn).toMatchObject({
      npcId: NPC_IDS.rennCalder,
      locationId: LOCATION_IDS.holoHollow,
    });
  });

  it("carries the locked offer, reminder, turn-in and completion, with the player silent", () => {
    const r = NPC_IDS.rennCalder;
    expect(spoken(DIALOGUE_IDS.rennCuttingCostsOffer)).toEqual([
      [r, EXPRESSION_IDS.neutral, "Been looking at those Loadsteel Cutters."],
      [r, EXPRESSION_IDS.neutral, "Faster base cutting speed, without a charge."],
      [
        r,
        EXPRESSION_IDS.neutral,
        "Means I don't have to keep feeding the damn thing a Cell every time I want to get some work done.",
      ],
      [r, EXPRESSION_IDS.guarded, "I've been putting Credits aside for one."],
      [r, EXPRESSION_IDS.guarded, "Five hundred credits."],
      [r, EXPRESSION_IDS.guarded, "Had to save a while."],
      [r, EXPRESSION_IDS.neutral, "If you can get me a Loadsteel Cutter, that's what I'll pay."],
      [r, EXPRESSION_IDS.neutral, "Don't care where or how you get it."],
      [r, EXPRESSION_IDS.neutral, "I need the Cutter, not the story behind it."],
    ]);
    expect(spoken(DIALOGUE_IDS.rennCuttingCostsReminder)).toEqual([
      [r, EXPRESSION_IDS.neutral, "Still looking for that Cutter."],
      [r, EXPRESSION_IDS.neutral, "Five hundred credits waiting for you when you've got one."],
    ]);
    expect(spoken(DIALOGUE_IDS.rennCuttingCostsTurnIn)).toEqual([
      [r, EXPRESSION_IDS.neutral, "That it?"],
      ["item"],
      [r, EXPRESSION_IDS.guarded, "Yeah."],
      [r, EXPRESSION_IDS.guarded, "That'll do."],
      [r, EXPRESSION_IDS.neutral, "Five hundred credits, like I said."],
    ]);
    expect(spoken(DIALOGUE_IDS.rennCuttingCostsCompletion)).toEqual([
      ["item"],
      [r, EXPRESSION_IDS.neutral, "Been saving up for far longer than I care to admit."],
      [
        r,
        EXPRESSION_IDS.neutral,
        "Worth it if I can stop carrying half my weight around in Power Cells.",
      ],
    ]);
    // [Show Loadsteel Cutter] and [Renn takes the Loadsteel Cutter].
    expect(beats(DIALOGUE_IDS.rennCuttingCostsTurnIn)[1]).toMatchObject({
      kind: "item",
      itemId: ITEM_IDS.loadsteelCutter,
      quantity: 1,
    });
    expect(beats(DIALOGUE_IDS.rennCuttingCostsCompletion)[0]).toMatchObject({
      kind: "item",
      itemId: ITEM_IDS.loadsteelCutter,
      text: "Renn takes the Loadsteel Cutter.",
    });
  });

  it("names the same price its reward pays", () => {
    expect(CUTTING_COSTS.reward).toMatchObject({ amount: 500 });
    const text = [
      ...beats(DIALOGUE_IDS.rennCuttingCostsOffer),
      ...beats(DIALOGUE_IDS.rennCuttingCostsTurnIn),
    ]
      .map((beat) => beat.text)
      .join(" ");
    expect(text).toContain("Five hundred credits");
  });
});

describe("what each NPC says at each stage", () => {
  const hub = (npcId: string, projection: NpcConversationProjection) =>
    resolveNpcConversation(npcId, [projection]).find((entry) => entry.kind === "mission");

  it("Tansy: offer, reminder without a turn-in, busy, then the turn-in", () => {
    const base = { missionId: MISSION_IDS.aCutAbove };
    expect(
      hub(NPC_IDS.tansyRusk, { ...base, state: "not_accepted", prerequisiteSatisfied: true }),
    ).toMatchObject({ role: "offer", dialogueId: DIALOGUE_IDS.tansyACutAboveOffer });
    expect(
      hub(NPC_IDS.tansyRusk, { ...base, state: "not_accepted", prerequisiteSatisfied: false }),
    ).toBeUndefined();
    const reminder = hub(NPC_IDS.tansyRusk, {
      ...base,
      state: "active",
      prerequisiteSatisfied: true,
      stage: {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "tracked_activity",
      },
    });
    expect(reminder).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.tansyACutAboveReminder,
    });
    expect(reminder).not.toHaveProperty("action");
    expect(
      hub(NPC_IDS.tansyRusk, {
        ...base,
        state: "active",
        prerequisiteSatisfied: true,
        stage: { requirementsSatisfied: true, turnInAvailable: false },
      }),
    ).toMatchObject({ dialogueId: DIALOGUE_IDS.tansyBraceYourselfBusy });
    expect(
      hub(NPC_IDS.tansyRusk, {
        ...base,
        state: "ready_for_completion",
        prerequisiteSatisfied: true,
        stage: { requirementsSatisfied: true, turnInAvailable: true },
      }),
    ).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.tansyACutAboveTurnIn,
      action: { kind: "complete_mission", label: "SHOW HER THE CUTTER" },
    });
  });

  it("Renn: offer, the active reminder while no Cutter is carried, then the turn-in", () => {
    const base = { missionId: MISSION_IDS.cuttingCosts };
    expect(
      hub(NPC_IDS.rennCalder, { ...base, state: "not_accepted", prerequisiteSatisfied: true }),
    ).toMatchObject({ role: "offer", dialogueId: DIALOGUE_IDS.rennCuttingCostsOffer });
    const reminder = hub(NPC_IDS.rennCalder, {
      ...base,
      state: "active",
      prerequisiteSatisfied: true,
      stage: {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "carried_unique_item",
      },
    });
    expect(reminder).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.rennCuttingCostsReminder,
    });
    expect(reminder).not.toHaveProperty("action");
    expect(
      hub(NPC_IDS.rennCalder, {
        ...base,
        state: "ready_for_completion",
        prerequisiteSatisfied: true,
        stage: { requirementsSatisfied: true, turnInAvailable: true },
      }),
    ).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.rennCuttingCostsTurnIn,
      action: { kind: "complete_mission", label: "HAND OVER THE CUTTER" },
    });
  });
});

describe("the registry", () => {
  it("validates with both Missions in it", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    expect(MISSIONS).toContain(A_CUT_ABOVE);
    expect(MISSIONS).toContain(CUTTING_COSTS);
  });
});
