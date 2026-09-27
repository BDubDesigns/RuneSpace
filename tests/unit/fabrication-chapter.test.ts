import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import {
  BRACE_YOURSELF,
  BREAK_IT_DOWN,
  MISSIONS,
  RETURN_THE_FAVOR,
  TEN_THOUSAND_HOURS,
  TEN_THOUSAND_ONE_HOURS,
  type MissionDefinition,
} from "@/game/content/missions";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { resolveNpcConversation, type NpcConversationProjection } from "@/game/domain/conversation";
import { validateMissionDefinitions } from "@/game/domain/missions";

/**
 * Tansy's Fabrication chapter as authored content (#232): the chronology, the
 * two Missions' exact shape and rewards, the Brace Yourself gate, and the
 * reactive-dialogue priority that lets Tansy react to what she watched.
 */

const texts = (dialogueId: string) =>
  (getDialogue(dialogueId)?.beats ?? []).map((beat) => beat.text);

describe("the chronology", () => {
  it("offers Return the Favor after 10,000 Hours as a deliberate pickup, never a continuation", () => {
    expect(TEN_THOUSAND_HOURS.continuationMissionId).toBeUndefined();
    expect(RETURN_THE_FAVOR.prerequisiteMissionId).toBe(MISSION_IDS.tenThousandHours);
    expect(RETURN_THE_FAVOR.offers).toEqual([
      expect.objectContaining({
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.ruskRecovery,
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOffer,
      }),
    ]);
  });

  it("continues automatically into Break It Down, which has no offer of its own", () => {
    expect(RETURN_THE_FAVOR.continuationMissionId).toBe(MISSION_IDS.breakItDown);
    expect(BREAK_IT_DOWN.prerequisiteMissionId).toBe(MISSION_IDS.returnTheFavor);
    expect(BREAK_IT_DOWN.offers).toEqual([]);
  });

  it("makes Break It Down the Brace Yourself story gate, keeping Mining 5 and Welding 5", () => {
    expect(BRACE_YOURSELF.prerequisiteMissionId).toBe(MISSION_IDS.breakItDown);
    expect(BRACE_YOURSELF.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.mining, level: 5 },
      { skillId: SKILL_IDS.welding, level: 5 },
    ]);
  });

  it("leaves 10,001 Hours independent of the chapter", () => {
    expect(TEN_THOUSAND_ONE_HOURS.prerequisiteMissionId).toBe(MISSION_IDS.tenThousandHours);
    expect(JSON.stringify(TEN_THOUSAND_ONE_HOURS)).not.toContain(MISSION_IDS.returnTheFavor);
  });

  it("opens Fabricate on accepting Return the Favor and Tinkering on completing it", () => {
    expect(RUSK_RECOVERY_CONTENT.fabricationAuthorizingMissionId).toBe(MISSION_IDS.returnTheFavor);
    expect(RUSK_RECOVERY_CONTENT.tinkeringAuthorizingMissionId).toBe(MISSION_IDS.returnTheFavor);
  });
});

describe("Return the Favor", () => {
  it("counts only a genuinely fabricated Salvage Cutter, then takes any unequipped one", () => {
    expect(RETURN_THE_FAVOR.requirements).toEqual([
      expect.objectContaining({
        kind: "tracked_activity",
        activity: "fabrication",
        metric: "completions",
        actionId: ACTION_IDS.salvageCutterFabrication,
        target: 1,
      }),
      expect.objectContaining({
        kind: "carried_unique_item",
        itemId: ITEM_IDS.salvageCutter,
        turnIn: "consume_one",
      }),
    ]);
    expect(RETURN_THE_FAVOR.turnIn).toMatchObject({
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.ruskRecovery,
    });
  });

  it("pays exactly 100 Fabrication XP and nothing else", () => {
    expect(RETURN_THE_FAVOR.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.fabrication,
      amount: 100,
    });
  });

  it("carries the locked offer scene, including the workshop shorthand", () => {
    const offer = texts(DIALOGUE_IDS.tansyReturnTheFavorOffer);
    expect(offer[0]).toBe("Wade says you've been useful.");
    expect(offer).toContain("You'll see a control marked Manual Override.");
    expect(offer).toContain("She presses it every time.");
    expect(offer).toContain("Usually.");
    expect(offer.at(-1)).toBe("Make me a Cutter.");
  });

  it("shows Tansy's demonstration Scrap from the universal rule, as teaching only", () => {
    const beats = getDialogue(DIALOGUE_IDS.tansyReturnTheFavorCompletion)!.beats;
    const scrap = beats.find((beat) => beat.kind === "item" && beat.itemId === ITEM_IDS.scrapMetal);
    expect(scrap).toMatchObject({ kind: "item", quantity: 3 });
    expect(scrap).not.toHaveProperty("isRewardTotal");
    expect(beats.find((beat) => beat.kind === "skill_xp")).toMatchObject({
      skillId: SKILL_IDS.fabrication,
      amount: 100,
      text: "Tinkering unlocked.",
    });
  });
});

describe("Break It Down", () => {
  it("needs one completed Tinkering batch of anything eligible, then Tansy, for 250 XP", () => {
    expect(BREAK_IT_DOWN.requirements).toEqual([
      expect.objectContaining({
        kind: "tracked_activity",
        activity: "tinkering",
        metric: "completions",
        target: 1,
      }),
    ]);
    expect(BREAK_IT_DOWN.requirements[0]).not.toHaveProperty("actionId");
    expect(BREAK_IT_DOWN.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.fabrication,
      amount: 250,
    });
    expect(BREAK_IT_DOWN.turnIn).toMatchObject({
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      objective: "Return to Tansy at Rusk Recovery",
    });
  });

  it("closes on the ordinary Friday routine and nothing deeper", () => {
    const closing = texts(DIALOGUE_IDS.tansyBreakItDownCompletion).join(" ");
    expect(closing).toContain("Friday. Do not forget.");
    expect(closing).toContain("The trailers were still playing.");
    expect(closing).toContain("Come find me when you're ready for real trouble.");
  });
});

describe("reactive Override dialogue (#232)", () => {
  const projection = (
    facts: readonly string[],
    stage: NpcConversationProjection["stage"],
  ): NpcConversationProjection[] => [
    {
      missionId: MISSION_IDS.returnTheFavor,
      state: stage?.turnInAvailable ? "ready_for_completion" : "active",
      prerequisiteSatisfied: true,
      stage,
      facts,
    },
  ];
  const turnIn = { requirementsSatisfied: true, turnInAvailable: true };
  const fabricating = {
    requirementsSatisfied: false,
    turnInAvailable: false,
    nextObjectiveKind: "tracked_activity" as const,
  };
  const entry = (projections: NpcConversationProjection[]) =>
    resolveNpcConversation(NPC_IDS.tansyRusk, projections).find(
      (candidate) => candidate.kind === "mission",
    );

  it("opens with the bust branch whenever a bust happened, even after a clean Override", () => {
    expect(entry(projection(["override-bust", "override-success"], turnIn))).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn,
      action: { kind: "complete_mission" },
    });
  });

  it("approves a clean Override success, and otherwise opens normally", () => {
    expect(entry(projection(["override-success"], turnIn))).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn,
      action: { kind: "complete_mission" },
    });
    expect(entry(projection([], turnIn))).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
      action: { kind: "complete_mission" },
    });
  });

  it("gives the amused reminder after a bust while the Cutter is still to make, and no turn-in", () => {
    const reminder = entry(projection(["override-bust"], fabricating));
    expect(reminder).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustReminder,
    });
    expect(reminder).not.toHaveProperty("action");
    expect(entry(projection([], fabricating))).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorReminder,
    });
  });

  it("rejoins one completion whatever the opening", () => {
    const openings = [
      DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
      DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn,
      DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn,
    ];
    expect(openings.every((id) => getDialogue(id)?.npcId === NPC_IDS.tansyRusk)).toBe(true);
    expect(RETURN_THE_FAVOR.dialogue.completionPresentationDialogueId).toBe(
      DIALOGUE_IDS.tansyReturnTheFavorCompletion,
    );
  });
});

describe("validation of the framework extensions", () => {
  const withRtf = (changed: MissionDefinition) =>
    MISSIONS.map((mission) => (mission.id === changed.id ? changed : mission));

  it("accepts the authored registry", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("rejects a reactive variant reading a fact the Mission does not author", () => {
    expect(() =>
      validateMissionDefinitions(
        withRtf({
          ...RETURN_THE_FAVOR,
          dialogue: {
            ...RETURN_THE_FAVOR.dialogue,
            reactive: [
              {
                factKey: "unknown",
                moment: "turn_in",
                dialogueId: DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
              },
            ],
          },
        }),
      ),
    ).toThrow(/unknown fact/);
  });

  it("rejects a unique-item turn-in of a stackable item", () => {
    expect(() =>
      validateMissionDefinitions(
        withRtf({
          ...RETURN_THE_FAVOR,
          requirements: [
            RETURN_THE_FAVOR.requirements[0]!,
            {
              kind: "carried_unique_item",
              itemId: ITEM_IDS.refinedFerrite,
              turnIn: "consume_one",
              objective: "x",
            },
          ],
        }),
      ),
    ).toThrow(/unique item/);
  });

  it("rejects Fabrication counted as attempts: a bust is never a fabricated item", () => {
    expect(() =>
      validateMissionDefinitions(
        withRtf({
          ...RETURN_THE_FAVOR,
          requirements: [
            {
              ...(RETURN_THE_FAVOR.requirements[0] as Extract<
                MissionDefinition["requirements"][number],
                { kind: "tracked_activity" }
              >),
              metric: "attempts",
            },
            RETURN_THE_FAVOR.requirements[1]!,
          ],
        }),
      ),
    ).toThrow(/metric/);
  });
});
