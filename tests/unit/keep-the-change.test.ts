import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import {
  HOLD_IT_TOGETHER,
  KEEP_THE_CHANGE,
  MISSIONS,
  type MissionDefinition,
} from "@/game/content/missions";
import { getResidentNpc } from "@/game/content/npcs";
import { getNpcConversationTopics } from "@/game/content/conversation-topics";
import {
  resolveNpcConversation,
  type NpcConversationEntry,
  type NpcConversationProjection,
} from "@/game/domain/conversation";
import {
  projectMission,
  deriveMissionGuidanceTargets,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";

/**
 * Issue #170 — Keep the Change.
 *
 * The mission's product rules live here because they are all derivable without
 * PostgreSQL or a browser: which requirements exist and in what order, who the
 * player is guided to, which conversation each NPC offers at each stage, and
 * that the one-time Bix/Mara encounter stops being offered once it has really
 * happened. Server authority (the exactly-once Credit grant, the conversation
 * command, three-Cell consumption, and the B&B unlock) is proven against real
 * PostgreSQL in tests/integration/keep-the-change.test.ts.
 */

const POWER_CELL_STACK_LIMIT = 5;

function observation(input: { cells?: number; metBix?: boolean } = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map([[ITEM_IDS.powerCell, input.cells ?? 0]]),
    stackLimits: new Map([[ITEM_IDS.powerCell, POWER_CELL_STACK_LIMIT]]),
    itemNames: new Map([[ITEM_IDS.powerCell, "Power Cell"]]),
    trackedProgress: new Map(input.metBix ? [["bix-introduction", 1]] : []),
    cargoHoldRepairComplete: true,
  };
}

const accepted = () => ({ acceptedAt: new Date("2026-09-12T00:00:00.000Z") });
const completed = () => ({
  acceptedAt: new Date("2026-09-12T00:00:00.000Z"),
  completedAt: new Date("2026-09-12T01:00:00.000Z"),
});

/**
 * The mission as every consumer sees it: one real projection, which the
 * conversation layer accepts structurally.
 */
function projectionFor(
  record: ReturnType<typeof accepted> | ReturnType<typeof completed> | undefined,
  locationId: string,
  input: { cells?: number; metBix?: boolean } = {},
  prerequisiteCompleted = true,
): MissionProjection {
  return projectMission(
    KEEP_THE_CHANGE,
    record,
    locationId,
    true,
    observation(input),
    prerequisiteCompleted,
  );
}

function missionEntries(npcId: string, projections: readonly NpcConversationProjection[]) {
  return resolveNpcConversation(npcId, projections).filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission",
  );
}

function topicLabels(npcId: string, projections: readonly NpcConversationProjection[]) {
  return resolveNpcConversation(npcId, projections)
    .filter((entry) => entry.kind === "topic")
    .map((entry) => entry.label);
}

describe("Keep the Change definition", () => {
  it("becomes available after Hold It Together without auto-accepting", () => {
    expect(KEEP_THE_CHANGE.prerequisiteMissionId).toBe(MISSION_IDS.holdItTogether);
    // No predecessor names it as a continuation, which is what would auto-accept
    // it; the player has to go back to Wade and take the job.
    expect(HOLD_IT_TOGETHER.continuationMissionId).toBeUndefined();
    expect(
      MISSIONS.filter((mission) => mission.continuationMissionId === KEEP_THE_CHANGE.id),
    ).toHaveLength(0);
    expect(KEEP_THE_CHANGE.continuationMissionId).toBeUndefined();
  });

  it("is offered only by Wade at the Crash Site, and hands over exactly 24 Credits", () => {
    expect(KEEP_THE_CHANGE.offers).toHaveLength(1);
    const [offer] = KEEP_THE_CHANGE.offers;
    expect(offer).toMatchObject({
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.crashSite,
      dialogueId: DIALOGUE_IDS.wadeKeepTheChangeOffer,
      acceptEffect: { kind: "credits", amount: 24 },
    });
  });

  it("adds no completion reward", () => {
    // The budget is paid up front; the outcome at the end is world state, not a
    // second payout. Projection must not invent an earned reward either.
    expect(KEEP_THE_CHANGE.reward).toBeUndefined();
    expect(
      projectionFor(completed(), LOCATION_IDS.theJag, { cells: 3, metBix: true }),
    ).not.toHaveProperty("earnedReward", expect.anything());
    expect(
      projectMission(KEEP_THE_CHANGE, completed(), LOCATION_IDS.theJag, true).earnedReward,
    ).toBeUndefined();
  });

  it("requires meeting Bix first, then exactly three consumed Power Cells", () => {
    expect(KEEP_THE_CHANGE.requirements).toEqual([
      {
        kind: "npc_conversation",
        npcId: NPC_IDS.bixWeller,
        locationId: LOCATION_IDS.holoHollow,
        dialogueId: DIALOGUE_IDS.bixKeepTheChangeIntroduction,
        progressKey: "bix-introduction",
        objective: expect.stringContaining("Bix"),
        actionLabel: expect.any(String),
      },
      {
        kind: "carried_stack",
        itemId: ITEM_IDS.powerCell,
        quantity: 3,
        turnIn: "consume_required_quantity",
        objective: expect.any(String),
      },
    ]);
    // Nothing recommends a purchase, and no action produces Power Cells, so the
    // carried step guides the player nowhere in particular on purpose.
    expect(KEEP_THE_CHANGE.requirements[1]).not.toHaveProperty("recommendedActionId");
  });

  it("turns in to Tansy at The Jag", () => {
    expect(KEEP_THE_CHANGE.turnIn).toMatchObject({
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      requiresStationary: true,
      dialogueId: DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
    });
  });

  it("passes registry validation as authored", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });
});

describe("Keep the Change framework validation", () => {
  const conversationRequirement = KEEP_THE_CHANGE.requirements[0] as Extract<
    MissionDefinition["requirements"][number],
    { kind: "npc_conversation" }
  >;
  const carriedRequirement = KEEP_THE_CHANGE.requirements[1]!;

  /**
   * Validates one deliberately broken variant in isolation. The prerequisite is
   * dropped so the fixture needs no supporting definitions — the point is the
   * new rules, not the chain.
   */
  function validateVariant(overrides: Partial<MissionDefinition>) {
    const { prerequisiteMissionId: _prerequisite, ...base } = KEEP_THE_CHANGE;
    return () => validateMissionDefinitions([{ ...base, ...overrides } as MissionDefinition]);
  }

  it("rejects a mandatory conversation at the turn-in or offer NPC", () => {
    // Those two NPCs already own their hub entries (stage routing for the
    // turn-in, an active follow-up for the offer), so a conversation
    // requirement there would fight an existing owner.
    expect(
      validateVariant({
        requirements: [
          {
            ...conversationRequirement,
            npcId: NPC_IDS.tansyRusk,
            dialogueId: DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
          },
          carriedRequirement,
        ],
      }),
    ).toThrow(/turn-in NPC/);
    expect(
      validateVariant({
        requirements: [
          {
            ...conversationRequirement,
            npcId: NPC_IDS.wadeRusk,
            dialogueId: DIALOGUE_IDS.wadeKeepTheChangeActive,
          },
          carriedRequirement,
        ],
      }),
    ).toThrow(/offer NPC/);
  });

  it("rejects a malformed progress key and an NPC/dialogue mismatch", () => {
    expect(
      validateVariant({
        requirements: [{ ...conversationRequirement, progressKey: "Bix Introduction" }],
      }),
    ).toThrow(/lowercase hyphenated/);
    expect(
      validateVariant({
        requirements: [
          { ...conversationRequirement, dialogueId: DIALOGUE_IDS.tansyKeepTheChangeTurnIn },
        ],
      }),
    ).toThrow(/belongs to NPC/);
  });

  it("rejects a duplicated conversation and a progress key shared with a tracked activity", () => {
    expect(
      validateVariant({ requirements: [conversationRequirement, conversationRequirement] }),
    ).toThrow(/duplicates a conversation requirement/);
    // Conversation and tracked-activity requirements share one durable
    // progress-key space, because they share one progress row shape.
    expect(
      validateVariant({
        requirements: [
          conversationRequirement,
          {
            kind: "tracked_activity",
            progressKey: conversationRequirement.progressKey,
            activity: "mining",
            metric: "attempts",
            target: 1,
            objective: "Mine once",
          },
        ],
      }),
    ).toThrow(/progress key/);
  });

  it("rejects a non-positive acceptance Credit grant", () => {
    for (const amount of [0, -24, 1.5]) {
      expect(
        validateVariant({
          offers: [{ ...KEEP_THE_CHANGE.offers[0]!, acceptEffect: { kind: "credits", amount } }],
        }),
      ).toThrow(/positive integer/);
    }
  });
});

describe("Keep the Change objectives and guidance", () => {
  it("keeps Bix as the first objective even for a player who already has Cells", () => {
    const carrying = projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 5 });
    expect(carrying.state).toBe("active");
    expect(carrying.currentObjective).toContain("Bix");
    expect(carrying.stage?.nextObjectiveKind).toBe("npc_conversation");
    expect(carrying.stage?.requirementsSatisfied).toBe(false);
    // Green guidance points at the person to go and meet, and at the town they
    // are in while the player is elsewhere.
    const targets = deriveMissionGuidanceTargets([carrying]);
    expect(targets.npcIds).toContain(NPC_IDS.bixWeller);
    expect(targets.locationIds).toEqual(new Set([LOCATION_IDS.holoHollow]));
  });

  it("advances to the Cells and then to Tansy", () => {
    const metBix = projectionFor(accepted(), LOCATION_IDS.holoHollow, { metBix: true });
    expect(metBix.currentObjective).toContain("Power Cell");
    expect(metBix.stage?.nextObjectiveKind).toBe("carried_stack");
    expect(metBix.requirements?.map((requirement) => requirement.satisfied)).toEqual([true, false]);
    expect(metBix.requirements?.[1]?.progress).toEqual({ current: 0, target: 3 });
    // The Cells may come from Inventory, the Annex, or Bix: no source is invented.
    expect(metBix.guidance).toBeUndefined();

    // Every requirement holds while still in Holo Hollow: the turn-in phase has
    // begun, so The Jag is the blue TURN IN destination before arrival.
    const remote = projectionFor(accepted(), LOCATION_IDS.holoHollow, { cells: 3, metBix: true });
    expect(remote.state).toBe("active");
    expect(remote.stage?.requirementsSatisfied).toBe(true);
    expect(remote.guidance).toEqual({
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      turnIn: true,
    });
    expect(deriveMissionGuidanceTargets([remote]).turnInLocationIds).toEqual(
      new Set([LOCATION_IDS.theJag]),
    );

    const ready = projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 3, metBix: true });
    expect(ready.state).toBe("ready_for_completion");
    expect(ready.stage?.turnInAvailable).toBe(true);
    const readyTargets = deriveMissionGuidanceTargets([ready]);
    expect(readyTargets.turnInNpcIds).toContain(NPC_IDS.tansyRusk);
    expect(readyTargets.turnInLocationIds.size).toBe(0);
  });

  it("counts extra Cells toward the requirement without asking for them", () => {
    const extras = projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 5, metBix: true });
    expect(extras.requirements?.[1]?.progress).toEqual({ current: 3, target: 3 });
    expect(extras.state).toBe("ready_for_completion");
  });

  it("never advertises itself before Hold It Together is completed", () => {
    const locked = projectionFor(undefined, LOCATION_IDS.crashSite, {}, false);
    expect(locked.state).toBe("not_accepted");
    expect(locked.prerequisiteSatisfied).toBe(false);
    // No satisfied prerequisite means no offer, so no blue availability even
    // standing in front of Wade.
    expect(deriveMissionGuidanceTargets([locked]).availableNpcIds.size).toBe(0);
  });
});

/**
 * Regression for the preview finding: the hub listed KEEP THE CHANGE —
 * AVAILABLE at Wade while neither Wade's Talk control nor that entry glowed
 * blue, because availability ignored every prerequisite-gated mission. The
 * rule is now that eligible, unaccepted work advertises LOCALLY through its
 * offering NPC and nowhere else.
 */
describe("Keep the Change local availability guidance", () => {
  const available = () => projectionFor(undefined, LOCATION_IDS.crashSite);

  it("lights Wade's Talk control and his hub entry with the same blue answer", () => {
    const projection = available();
    expect(projection.state).toBe("not_accepted");
    expect(projection.guidance).toEqual({ availableNpcIds: [NPC_IDS.wadeRusk] });
    // The Talk control reads the union of projected availability...
    expect(deriveMissionGuidanceTargets([projection]).availableNpcIds).toEqual(
      new Set([NPC_IDS.wadeRusk]),
    );
    // ...and the hub entry reads the same projection, so they cannot disagree.
    const [offer] = missionEntries(NPC_IDS.wadeRusk, [projection]);
    expect(offer).toMatchObject({ role: "offer", guidance: "available" });
  });

  it("is local discovery only — no global, progression, or destination signal", () => {
    const targets = deriveMissionGuidanceTargets([available()]);
    expect(targets.npcIds.size).toBe(0);
    expect(targets.actionIds.size).toBe(0);
    expect(targets.equipmentItemIds.size).toBe(0);
    expect(targets.cargoRepair).toBe(false);
    // Away from Wade's offer location nothing advertises at all.
    for (const locationId of [LOCATION_IDS.holoHollow, LOCATION_IDS.theJag]) {
      expect(
        deriveMissionGuidanceTargets([projectionFor(undefined, locationId)]).availableNpcIds.size,
      ).toBe(0);
    }
  });

  it("stays out of the Mission Log and objective surfaces until accepted", () => {
    // Those surfaces render accepted missions from their objective and
    // requirement projection; an available mission carries neither.
    const projection = available();
    expect(projection.currentObjective).toBeUndefined();
    expect(projection.requirements).toBeUndefined();
  });

  it("swaps blue discovery for green progression once accepted", () => {
    const accepted = projectionFor(
      { acceptedAt: new Date("2026-09-11T00:00:00.000Z") },
      LOCATION_IDS.crashSite,
    );
    const targets = deriveMissionGuidanceTargets([accepted]);
    expect(targets.availableNpcIds.size).toBe(0);
    // The next progression step is meeting Bix, not talking to Wade again.
    expect(targets.npcIds).toEqual(new Set([NPC_IDS.bixWeller]));
    const [wadeEntry] = missionEntries(NPC_IDS.wadeRusk, [accepted]);
    expect(wadeEntry).toMatchObject({ role: "active" });
    expect(wadeEntry?.guidance).toBeUndefined();
  });
});

describe("Keep the Change conversations", () => {
  it("offers the job at Wade only once the prerequisite holds", () => {
    const beforeHold = missionEntries(NPC_IDS.wadeRusk, [
      projectionFor(undefined, LOCATION_IDS.crashSite, {}, false),
    ]);
    expect(beforeHold).toHaveLength(0);

    const [offer] = missionEntries(NPC_IDS.wadeRusk, [
      projectionFor(undefined, LOCATION_IDS.crashSite),
    ]);
    expect(offer).toMatchObject({
      role: "offer",
      dialogueId: DIALOGUE_IDS.wadeKeepTheChangeOffer,
      action: { kind: "accept_mission", label: "TAKE THE JOB" },
    });
  });

  it("gives Bix the mandatory scene, with its own authoritative command", () => {
    const [entry] = missionEntries(NPC_IDS.bixWeller, [
      projectionFor(accepted(), LOCATION_IDS.holoHollow),
    ]);
    expect(entry).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.bixKeepTheChangeIntroduction,
      action: {
        kind: "acknowledge_conversation",
        label: "GOOD TO KNOW",
        dialogueId: DIALOGUE_IDS.bixKeepTheChangeIntroduction,
      },
    });
  });

  it("stops offering the Bix/Mara encounter once it has actually happened", () => {
    // The one-time story event must not replay: Mara walking in and meeting the
    // player is a specific occurrence, not idle dialogue. Satisfaction comes
    // from the authoritative requirement, not from any viewed-conversation flag.
    const satisfied = projectionFor(accepted(), LOCATION_IDS.holoHollow, { metBix: true });
    expect(missionEntries(NPC_IDS.bixWeller, [satisfied])).toHaveLength(0);
    // And it is gone for good, including after the mission completes.
    expect(
      missionEntries(NPC_IDS.bixWeller, [
        projectionFor(completed(), LOCATION_IDS.holoHollow, { cells: 0, metBix: true }),
      ]),
    ).toHaveLength(0);
    // His ordinary shop conversation is untouched either way.
    const expectedTopics = getNpcConversationTopics(NPC_IDS.bixWeller).map((topic) => topic.label);
    expect(topicLabels(NPC_IDS.bixWeller, [satisfied])).toEqual(expectedTopics);
  });

  it("keeps the encounter enterable until the command commits", () => {
    // Backing out before the terminal control leaves the requirement
    // unsatisfied, so the player can walk back in and see it again.
    const abandoned = projectionFor(accepted(), LOCATION_IDS.holoHollow, { metBix: false });
    expect(missionEntries(NPC_IDS.bixWeller, [abandoned])).toHaveLength(1);
  });

  it("routes Tansy from reminder to turn-in by semantic stage", () => {
    const beforeBix = missionEntries(NPC_IDS.tansyRusk, [
      projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 3 }),
    ]);
    expect(beforeBix[0]).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.tansyKeepTheChangeConversationReminder,
    });
    expect(beforeBix[0]?.action).toBeUndefined();

    const needsCells = missionEntries(NPC_IDS.tansyRusk, [
      projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 1, metBix: true }),
    ]);
    expect(needsCells[0]).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder,
    });
    expect(needsCells[0]?.action).toBeUndefined();

    const ready = missionEntries(NPC_IDS.tansyRusk, [
      projectionFor(accepted(), LOCATION_IDS.theJag, { cells: 3, metBix: true }),
    ]);
    expect(ready[0]).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
      action: { kind: "complete_mission", label: "HAND OVER CELLS" },
    });
  });

  it("reminds the player at Wade while the job is active", () => {
    const [entry] = missionEntries(NPC_IDS.wadeRusk, [
      projectionFor(accepted(), LOCATION_IDS.crashSite, { cells: 3, metBix: true }),
    ]);
    expect(entry).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.wadeKeepTheChangeActive,
    });
    expect(entry?.action).toBeUndefined();
  });

  it("advances Wade's and Tansy's story state after completion", () => {
    const done = [projectionFor(completed(), LOCATION_IDS.theJag, { cells: 0, metBix: true })];
    expect(missionEntries(NPC_IDS.wadeRusk, done)[0]).toMatchObject({
      role: "completed",
      dialogueId: DIALOGUE_IDS.wadePostKeepTheChange,
    });
    expect(missionEntries(NPC_IDS.tansyRusk, done)[0]).toMatchObject({
      role: "completed",
      dialogueId: DIALOGUE_IDS.tansyPostKeepTheChange,
    });
  });
});

describe("Keep the Change authored content", () => {
  const newSequences = [
    DIALOGUE_IDS.wadeKeepTheChangeOffer,
    DIALOGUE_IDS.wadeKeepTheChangeActive,
    DIALOGUE_IDS.bixKeepTheChangeIntroduction,
    DIALOGUE_IDS.tansyKeepTheChangeConversationReminder,
    DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder,
    DIALOGUE_IDS.tansyKeepTheChangeBusy,
    DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
    DIALOGUE_IDS.tansyKeepTheChangeCompletion,
    DIALOGUE_IDS.wadePostKeepTheChange,
    DIALOGUE_IDS.tansyPostKeepTheChange,
    DIALOGUE_IDS.maraTheBnbTopic,
    DIALOGUE_IDS.maraBixTopic,
  ];

  it("keeps the player character silent in every new sequence", () => {
    for (const dialogueId of newSequences) {
      const sequence = getDialogue(dialogueId);
      expect(sequence, dialogueId).toBeDefined();
      expect(sequence!.beats.length).toBeGreaterThan(0);
      for (const beat of sequence!.beats) {
        // Every spoken beat belongs to a real NPC. There is no player speaker,
        // so no authored line can be put in the player's mouth.
        if (beat.kind === "npc") expect(beat.speakerNpcId).not.toBe(undefined);
        expect(["npc", "item", "skill_xp"]).toContain(beat.kind);
      }
    }
  });

  it("carries Tansy's remote call from The Jag inside Wade's own scene", () => {
    const offer = getDialogue(DIALOGUE_IDS.wadeKeepTheChangeOffer)!;
    expect(offer.npcId).toBe(NPC_IDS.wadeRusk);
    const speakers = new Set(
      offer.beats.filter((beat) => beat.kind === "npc").map((beat) => beat.speakerNpcId),
    );
    expect(speakers).toEqual(new Set([NPC_IDS.wadeRusk, NPC_IDS.tansyRusk]));
    // Wade is in the room at the Crash Site. Tansy calls in from The Jag, shown
    // against her own location with the comms treatment.
    for (const beat of offer.beats) {
      if (beat.kind !== "npc") continue;
      if (beat.speakerNpcId === NPC_IDS.tansyRusk) {
        expect(beat.presentationMode).toBe("comms");
        expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.theJagExterior);
        // She has not been told the player is Wade's apprentice yet.
        expect(beat.text).not.toMatch(/apprentice/i);
      } else {
        expect(beat.presentationMode).toBe("local");
        expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.crashSiteExterior);
      }
    }
    // The apprenticeship beat lives here rather than in a separate forced talk,
    // and Wade names the currency for both the price and the budget.
    const text = offer.beats.map((beat) => beat.text).join(" ");
    expect(text).toContain("Cargo Hold");
    expect(text).toContain("apprentice");
    expect(text).toContain("eight Credits");
    expect(text).toContain("twenty-four Credits");
    expect(text).toContain("Keep what you don't spend");
  });

  it("meets Tansy in person at The Jag for every later Keep the Change scene", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.tansyKeepTheChangeConversationReminder,
      DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder,
      DIALOGUE_IDS.tansyKeepTheChangeBusy,
      DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
      DIALOGUE_IDS.tansyKeepTheChangeCompletion,
      DIALOGUE_IDS.tansyPostKeepTheChange,
    ]) {
      for (const beat of getDialogue(dialogueId)!.beats) {
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId, dialogueId).toBe(NPC_IDS.tansyRusk);
        expect(beat.presentationMode, dialogueId).toBe("local");
        expect(beat.backgroundId, dialogueId).toBe(CONVERSATION_BACKGROUND_IDS.theJagExterior);
      }
    }
  });

  it("shows the three Power Cells exactly once, as the hand-over opens Tansy's completion", () => {
    const [handOver, firstLine] = getDialogue(DIALOGUE_IDS.tansyKeepTheChangeCompletion)!.beats;
    expect(handOver).toMatchObject({ kind: "item", itemId: ITEM_IDS.powerCell, quantity: 3 });
    expect(handOver?.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.theJagExterior);
    expect(firstLine).toMatchObject({ kind: "npc", speakerNpcId: NPC_IDS.tansyRusk });
    // No other Keep the Change scene repeats the reveal — not the turn-in
    // prompt before the Cells change hands, and not the replayable follow-up.
    const itemBeats = newSequences.flatMap((dialogueId) =>
      getDialogue(dialogueId)!.beats.filter((beat) => beat.kind === "item"),
    );
    expect(itemBeats).toEqual([handOver]);
    expect(KEEP_THE_CHANGE.dialogue.completionPresentationDialogueId).toBe(
      DIALOGUE_IDS.tansyKeepTheChangeCompletion,
    );
  });

  it("has Tansy name Bix's price in Credits", () => {
    const text = getDialogue(DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder)!
      .beats.map((beat) => beat.text)
      .join(" ");
    expect(text).toContain("Bix sells them for eight Credits.");
  });

  it("has Tansy say Wade is proud rather than deny the apprenticeship he announced", () => {
    const beats = getDialogue(DIALOGUE_IDS.tansyPostKeepTheChange)!.beats;
    expect(beats.slice(-2)).toMatchObject([
      {
        kind: "npc",
        expressionId: EXPRESSION_IDS.neutral,
        text: "Wade is proud of you, you know.",
      },
      {
        kind: "npc",
        expressionId: EXPRESSION_IDS.smile,
        text: "Though he'd never say it out loud.",
      },
    ]);
    // Wade says "apprentice" to the player's face, so Tansy never claims he won't.
    expect(beats.map((beat) => beat.text).join(" ")).not.toMatch(/apprentice/i);
  });

  it("has Mara appear as an authored guest in Bix's scene, not a shop resident", () => {
    const scene = getDialogue(DIALOGUE_IDS.bixKeepTheChangeIntroduction)!;
    // The sequence belongs to Bix — that is what routes it to his hub — while
    // individual beats carry their own speaker.
    expect(scene.npcId).toBe(NPC_IDS.bixWeller);
    const speakers = scene.beats
      .filter((beat) => beat.kind === "npc")
      .map((beat) => beat.speakerNpcId);
    expect(new Set(speakers)).toEqual(new Set([NPC_IDS.bixWeller, NPC_IDS.maraKells]));
    // Standing in Bix's shop still resolves exactly one resident: Bix.
    expect(
      getResidentNpc({
        locationId: LOCATION_IDS.holoHollow,
        localPlaceId: "holo_hollow_souvenirs",
      })?.id,
    ).toBe(NPC_IDS.bixWeller);
  });

  const introBeats = () =>
    getDialogue(DIALOGUE_IDS.bixKeepTheChangeIntroduction)!.beats.filter(
      (beat): beat is Extract<typeof beat, { kind: "npc" }> => beat.kind === "npc",
    );
  const introText = () =>
    introBeats()
      .map((beat) => beat.text)
      .join(" ");

  it("preserves the approved Annex history, shop logic, and Mara's line", () => {
    const text = introText();
    expect(text).toContain("Ahh, you lucky bastard, you.");
    expect(text).toContain("not a tourist anymore");
    expect(text).toContain("Settled Systems required an emergency power depot");
    expect(text).toContain("DeWhat? got the contract");
    expect(text).toContain("Tourists left. Contract didn't.");
    expect(text).toContain("Five per person, per local day");
    expect(text).toContain("The Annex gives you five. It gives me five.");
    expect(text).toContain("That's called a store.");
    // Bix still points at the free source before taking Wade's money.
    expect(text).toContain("five Cells per local day");
  });

  it("names Credits for every price and budget Bix mentions", () => {
    const text = introText();
    expect(text).toContain("Eight Credits each. Twenty-four Credits.");
    expect(text).toContain("Need another one? Eight Credits.");
    expect(text).toContain("I'll give you three Credits each.");
    expect(text).not.toMatch(/\beight\b(?! Credits)/i);
    expect(text).not.toMatch(/\btwenty-four\b(?! Credits)/i);
  });

  it("establishes Mara's entrance and the apprenticeship before her approved line", () => {
    const beats = introBeats();
    const firstMara = beats.findIndex((beat) => beat.speakerNpcId === NPC_IDS.maraKells);
    const bixNamesMara = beats.findIndex(
      (beat) => beat.speakerNpcId === NPC_IDS.bixWeller && beat.text.startsWith("Hey Mara"),
    );
    const apprenticeSetup = beats.findIndex(
      (beat) => beat.speakerNpcId === NPC_IDS.bixWeller && /apprentice/.test(beat.text),
    );
    const lucky = beats.findIndex((beat) => beat.text === "Ahh, you lucky bastard, you.");
    // She arrives with a greeting of her own, not the punchline.
    expect(beats[firstMara]?.text).toBe("Morning, Bix. How's business?");
    expect(bixNamesMara).toBeGreaterThan(firstMara);
    expect(apprenticeSetup).toBeGreaterThan(firstMara);
    expect(lucky).toBeGreaterThan(apprenticeSetup);
    expect(beats[lucky]?.speakerNpcId).toBe(NPC_IDS.maraKells);
    // No claim that Mara has watched the player around town beforehand.
    expect(introText()).not.toMatch(/door/i);
  });
});
