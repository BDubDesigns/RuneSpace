import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TOPIC_IDS,
  DIALOGUE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import {
  CONVERSATION_TOPICS,
  getNpcConversationTopics,
  type ConversationTopicDefinition,
} from "@/game/content/conversation-topics";
import { DIALOGUE_SEQUENCES, getDialogue } from "@/game/content/dialogue";
import {
  CUT_YOUR_TEETH,
  HOLD_IT_TOGETHER,
  WALK_IT_OFF,
  WASTE_NOT,
  type MissionDefinition,
} from "@/game/content/missions";
import {
  getMissionCapacityRefusalDialogue,
  getMissionCompletionPresentation,
  resolveNpcConversation,
  resolveNpcConversationWith,
  validateConversationTopics,
  type NpcConversationEntry,
  type NpcConversationProjection,
} from "@/game/domain/conversation";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");

function p(
  missionId: string,
  state: NpcConversationProjection["state"],
  stage?: NpcConversationProjection["stage"],
  prereq = true,
): NpcConversationProjection {
  return {
    missionId,
    state,
    prerequisiteSatisfied: prereq,
    stage: stage ?? { requirementsSatisfied: false, turnInAvailable: false },
  };
}

const wio = (
  state: NpcConversationProjection["state"],
  stage?: NpcConversationProjection["stage"],
) => p(MISSION_IDS.walkItOff, state, stage);
const cyt = (
  state: NpcConversationProjection["state"],
  stage?: NpcConversationProjection["stage"],
  prereq = true,
) => p(MISSION_IDS.cutYourTeeth, state, stage, prereq);
const waste = (
  state: NpcConversationProjection["state"],
  stage?: NpcConversationProjection["stage"],
) => p(MISSION_IDS.wasteNot, state, stage);
const hold = (
  state: NpcConversationProjection["state"],
  stage?: NpcConversationProjection["stage"],
) => p(MISSION_IDS.holdItTogether, state, stage);

function missionEntries(npcId: string, projections: readonly NpcConversationProjection[]) {
  return resolveNpcConversation(npcId, projections).filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission",
  );
}

function topicEntries(npcId: string, projections: readonly NpcConversationProjection[]) {
  return resolveNpcConversation(npcId, projections).filter((entry) => entry.kind === "topic");
}

function firstMission(npcId: string, projections: readonly NpcConversationProjection[]) {
  return missionEntries(npcId, projections)[0];
}

// Minimal synthetic definitions for injected-content fallback tests. These are
// never added to the production registries — they exist only inside the pure
// resolver's injected arrays, so no player-visible fake Mission is required.
const SYNTH_FUTURE_NO_WADE: MissionDefinition = {
  id: "synthetic_future_no_wade" as unknown as MissionDefinition["id"],
  title: "Synthetic Future (no Wade dialogue)",
  summary: "Test-only future mission that intentionally authors no Wade completed dialogue.",
  offers: [
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth,
    },
  ],
  requirements: [],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true as const,
    objective: "Test turn-in",
    dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth,
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 1 },
  dialogue: {},
  completedNpcDialogue: [
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth },
  ],
};

const SYNTH_FUTURE_WITH_WADE: MissionDefinition = {
  ...SYNTH_FUTURE_NO_WADE,
  id: "synthetic_future_with_wade" as unknown as MissionDefinition["id"],
  title: "Synthetic Future (with Wade dialogue)",
  summary: "Test-only future mission that authors Wade completed dialogue, proving newest wins.",
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadeFollowUp },
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth },
  ],
};

describe("issue #164 canonical NPC conversation model", () => {
  it("opens a hub instead of one globally winning sequence, with Mission entries above topics", () => {
    const entries = resolveNpcConversation(NPC_IDS.wadeRusk, [wio("not_accepted")]);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries[0]).toMatchObject({
      kind: "mission",
      label: WALK_IT_OFF.title,
      role: "offer",
      roleLabel: "Available",
      dialogueId: DIALOGUE_IDS.wadeOffer,
    });
    // Every ordinary topic sorts after the Mission-derived conversations.
    const firstTopicIndex = entries.findIndex((entry) => entry.kind === "topic");
    const lastMissionIndex = entries.map((entry) => entry.kind).lastIndexOf("mission");
    expect(firstTopicIndex).toBeGreaterThan(lastMissionIndex);
  });

  it("lists several genuinely relevant Mission conversations rather than collapsing to one winner", () => {
    // Tansy is Cut Your Teeth's turn-in NPC while it is active AND authors an
    // offer for a later (synthetic) mission that is not yet accepted: both are
    // currently relevant conversations, so the hub shows both.
    const definitions = [WALK_IT_OFF, CUT_YOUR_TEETH, SYNTH_FUTURE_NO_WADE];
    const projections = [
      wio("completed"),
      cyt("active", {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "equipped_item",
      }),
      p(SYNTH_FUTURE_NO_WADE.id, "not_accepted"),
    ];
    const entries = resolveNpcConversationWith(
      NPC_IDS.tansyRusk,
      projections,
      definitions,
      CONVERSATION_TOPICS,
    ).filter((entry) => entry.kind === "mission");
    expect(entries.map((entry) => entry.dialogueId)).toEqual([
      DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
      DIALOGUE_IDS.tansyPostCutYourTeeth,
    ]);
    // Accepted work sorts before an available offer.
    expect(entries[0]?.role).toBe("active");
    expect(entries[1]?.role).toBe("offer");
  });

  it("reuses the derived semantic guidance projection for entry treatment", () => {
    const available = firstMission(NPC_IDS.wadeRusk, [
      { ...wio("not_accepted"), guidance: { availableNpcIds: [NPC_IDS.wadeRusk] } },
    ]);
    expect(available?.guidance).toBe("available");
    const active = firstMission(NPC_IDS.tansyRusk, [
      {
        ...wio("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
        guidance: { npcId: NPC_IDS.tansyRusk },
      },
    ]);
    expect(active?.guidance).toBe("active");
    // Active green wins when a projection somehow reports both.
    const both = firstMission(NPC_IDS.tansyRusk, [
      {
        ...wio("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
        guidance: { npcId: NPC_IDS.tansyRusk, availableNpcIds: [NPC_IDS.tansyRusk] },
      },
    ]);
    expect(both?.guidance).toBe("active");
    expect(firstMission(NPC_IDS.wadeRusk, [wio("not_accepted")])?.guidance).toBeUndefined();
  });
});

describe("issue #164 preserved Wade/Tansy Mission conversations", () => {
  it("Wade: Walk It Off offer, then the active follow-up, then Cut Your Teeth contextual dialogue", () => {
    expect(firstMission(NPC_IDS.wadeRusk, [wio("not_accepted")])).toMatchObject({
      dialogueId: DIALOGUE_IDS.wadeOffer,
      action: { kind: "accept_mission", label: "Accept mission" },
    });
    expect(firstMission(NPC_IDS.wadeRusk, [wio("active")])?.dialogueId).toBe(
      DIALOGUE_IDS.wadeWalkItOffActiveFollowUp,
    );
    expect(firstMission(NPC_IDS.wadeRusk, [wio("completed"), cyt("active")])?.dialogueId).toBe(
      DIALOGUE_IDS.wadeCutYourTeethActive,
    );
  });

  it("Tansy: explorer-first offer carries the authored acceptance continuation and Cutter claim", () => {
    const offer = firstMission(NPC_IDS.tansyRusk, [wio("not_accepted")]);
    expect(offer?.dialogueId).toBe(DIALOGUE_IDS.tansyBeforeMission);
    expect(offer?.action).toEqual({ kind: "accept_mission", label: "Accept mission" });
    expect(offer?.acceptedContinuation).toEqual({
      dialogueId: DIALOGUE_IDS.tansyAfterRemoteAcceptance,
      action: { kind: "complete_mission", label: "Claim Cutter" },
    });
    // The Wade comms beats still render inside that authored sequence, in order.
    const explorer = getDialogue(DIALOGUE_IDS.tansyBeforeMission);
    expect(explorer?.beats[4]).toMatchObject({
      speakerNpcId: NPC_IDS.wadeRusk,
      presentationMode: "comms",
      text: "What now? You know I'm busy, Tansy.",
    });
    expect(
      explorer?.beats.filter((beat) => beat.kind === "npc" && beat.presentationMode === "comms")
        .length,
    ).toBe(7);
  });

  it("Tansy: the Walk It Off turn-in keeps its authored Claim Cutter completion action", () => {
    const turnIn = firstMission(NPC_IDS.tansyRusk, [
      wio("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
    ]);
    expect(turnIn).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyCompletion,
      role: "turn_in",
      roleLabel: "Turn in",
      action: { kind: "complete_mission", label: "Claim Cutter" },
    });
  });

  it("resolves every Cut Your Teeth stage branch and attaches the action only to the turn-in", () => {
    const stage = (
      overrides: Partial<NonNullable<NpcConversationProjection["stage"]>>,
    ): NpcConversationProjection["stage"] => ({
      requirementsSatisfied: false,
      turnInAvailable: false,
      ...overrides,
    });
    const route = (overrides: Partial<NonNullable<NpcConversationProjection["stage"]>>) =>
      firstMission(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt(overrides.turnInAvailable ? "ready_for_completion" : "active", stage(overrides)),
      ]);

    expect(route({ nextObjectiveKind: "equipped_item" })).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
      role: "active",
    });
    expect(route({ nextObjectiveKind: "equipped_item" })?.action).toBeUndefined();
    expect(route({ nextObjectiveKind: "tracked_activity" })?.dialogueId).toBe(
      DIALOGUE_IDS.tansyCutYourTeethMiningReminder,
    );
    expect(route({ nextObjectiveKind: "carried_stack" })?.dialogueId).toBe(
      DIALOGUE_IDS.tansyCutYourTeethStackReminder,
    );
    expect(route({ requirementsSatisfied: true })?.dialogueId).toBe(
      DIALOGUE_IDS.tansyCutYourTeethBusy,
    );
    expect(route({ requirementsSatisfied: true })?.action).toBeUndefined();
    expect(route({ requirementsSatisfied: true, turnInAvailable: true })).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyCutYourTeethTurnIn,
      action: { kind: "complete_mission", label: "SHOW SHALE" },
    });
  });

  it("keeps Waste Not and Hold It Together reminders, busy states, and turn-ins intact", () => {
    const wasteReminder = firstMission(NPC_IDS.wadeRusk, [
      wio("completed"),
      cyt("completed"),
      waste("active", {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "tracked_activity",
      }),
    ]);
    expect(wasteReminder?.dialogueId).toBe(DIALOGUE_IDS.wadeWasteNotTrackedActivityReminder);
    expect(wasteReminder?.action).toBeUndefined();

    expect(
      firstMission(NPC_IDS.wadeRusk, [
        waste("active", { requirementsSatisfied: true, turnInAvailable: false }),
      ])?.dialogueId,
    ).toBe(DIALOGUE_IDS.wadeWasteNotBusy);
    expect(
      firstMission(NPC_IDS.wadeRusk, [
        waste("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
      ])?.action,
    ).toEqual({ kind: "complete_mission", label: "REPORT TO WADE" });

    expect(
      firstMission(NPC_IDS.wadeRusk, [
        hold("active", {
          requirementsSatisfied: false,
          turnInAvailable: false,
          nextObjectiveKind: "repair_target_complete",
        }),
      ])?.dialogueId,
    ).toBe(DIALOGUE_IDS.wadeHoldItTogetherRepairReminder);
    expect(
      firstMission(NPC_IDS.wadeRusk, [
        hold("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
      ])?.action,
    ).toEqual({ kind: "complete_mission", label: "REPORT REPAIR" });
  });

  it("keeps contextual off-path dialogue for NPCs who are not the turn-in NPC", () => {
    expect(
      firstMission(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed"), waste("active")])
        ?.dialogueId,
    ).toBe(DIALOGUE_IDS.tansyWasteNotActive);
    const tansyDuringHold = firstMission(NPC_IDS.tansyRusk, [
      wio("completed"),
      cyt("completed"),
      waste("completed"),
      hold("active", {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "repair_target_complete",
      }),
    ]);
    expect(tansyDuringHold?.dialogueId).toBe(DIALOGUE_IDS.tansyHoldItTogetherActive);
    expect(tansyDuringHold?.missionId).toBe(MISSION_IDS.holdItTogether);
  });

  it("keeps the completion presentation one-shot and the capacity refusals authored", () => {
    expect(getMissionCompletionPresentation(MISSION_IDS.walkItOff)?.id).toBe(
      DIALOGUE_IDS.tansyAfterClaim,
    );
    expect(getMissionCompletionPresentation(MISSION_IDS.cutYourTeeth)?.id).toBe(
      DIALOGUE_IDS.tansyCutYourTeethCompletion,
    );
    // The one-shot presentation is never resolved as an ordinary conversation.
    const afterCompletion = missionEntries(NPC_IDS.tansyRusk, [
      wio("completed"),
      cyt("completed"),
    ]).map((entry) => entry.dialogueId);
    expect(afterCompletion).not.toContain(DIALOGUE_IDS.tansyCutYourTeethCompletion);
    expect(afterCompletion).toEqual([DIALOGUE_IDS.tansyPostCutYourTeeth]);
    expect(getMissionCapacityRefusalDialogue(MISSION_IDS.walkItOff, "slots")?.id).toBe(
      DIALOGUE_IDS.tansyCapacitySlots,
    );
    expect(getMissionCapacityRefusalDialogue(MISSION_IDS.walkItOff, "mass")?.id).toBe(
      DIALOGUE_IDS.tansyCapacityMass,
    );
  });

  it("keeps completed-story follow-up narrow: one latest relevant entry, never a growing list", () => {
    const wadeCompleted = missionEntries(NPC_IDS.wadeRusk, [
      wio("completed"),
      cyt("completed"),
      waste("completed"),
      hold("completed"),
    ]);
    expect(wadeCompleted).toHaveLength(1);
    expect(wadeCompleted[0]).toMatchObject({
      dialogueId: DIALOGUE_IDS.wadePostHoldItTogether,
      role: "completed",
      roleLabel: "Completed",
    });
    expect(wadeCompleted[0]?.action).toBeUndefined();
    // Tansy falls back to the newest completed mission that authors dialogue
    // for her — Hold It Together authors none.
    expect(
      missionEntries(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("completed"),
        waste("completed"),
        hold("completed"),
      ])[0]?.dialogueId,
    ).toBe(DIALOGUE_IDS.tansyPostWasteNot);
    // A current conversation always supersedes the completed follow-up.
    expect(
      missionEntries(NPC_IDS.wadeRusk, [wio("completed"), cyt("active")]).map(
        (entry) => entry.dialogueId,
      ),
    ).toEqual([DIALOGUE_IDS.wadeCutYourTeethActive]);
  });

  it("falls back generically across injected definitions without mission-ID chains", () => {
    const noWade = [WALK_IT_OFF, CUT_YOUR_TEETH, SYNTH_FUTURE_NO_WADE];
    const projections = [
      wio("completed"),
      cyt("completed"),
      p(SYNTH_FUTURE_NO_WADE.id, "completed"),
    ];
    const fallback = resolveNpcConversationWith(
      NPC_IDS.wadeRusk,
      projections,
      noWade,
      CONVERSATION_TOPICS,
    ).find((entry) => entry.kind === "mission");
    expect(fallback).toMatchObject({
      dialogueId: DIALOGUE_IDS.wadePostCutYourTeeth,
      missionId: MISSION_IDS.cutYourTeeth,
    });

    const withWade = [WALK_IT_OFF, CUT_YOUR_TEETH, SYNTH_FUTURE_WITH_WADE];
    const newest = resolveNpcConversationWith(
      NPC_IDS.wadeRusk,
      [wio("completed"), cyt("completed"), p(SYNTH_FUTURE_WITH_WADE.id, "completed")],
      withWade,
      CONVERSATION_TOPICS,
    ).find((entry) => entry.kind === "mission");
    expect(newest).toMatchObject({
      dialogueId: DIALOGUE_IDS.wadeFollowUp,
      missionId: SYNTH_FUTURE_WITH_WADE.id,
    });
  });

  it("never offers a mission whose projected prerequisite is unsatisfied", () => {
    const gated = missionEntries(NPC_IDS.tansyRusk, [
      wio("completed"),
      cyt("not_accepted", undefined, false),
    ]);
    expect(gated).toHaveLength(0);
  });
});

describe("issue #164 replayable social topics", () => {
  it("coexists with a current Mission conversation and stays replayable", () => {
    const entries = resolveNpcConversation(NPC_IDS.tansyRusk, [
      wio("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
    ]);
    expect(entries.some((entry) => entry.kind === "mission")).toBe(true);
    expect(entries.some((entry) => entry.kind === "topic")).toBe(true);
    // Replayable: resolving again with identical state yields identical entries.
    // Nothing records that a topic was opened.
    const again = resolveNpcConversation(NPC_IDS.tansyRusk, [
      wio("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
    ]);
    expect(again).toEqual(entries);
  });

  it("authors the approved Wade and Tansy topics as short subjects, never player lines", () => {
    expect(getNpcConversationTopics(NPC_IDS.wadeRusk).map((topic) => topic.label)).toEqual([
      "Recovery work",
    ]);
    expect(getNpcConversationTopics(NPC_IDS.tansyRusk).map((topic) => topic.label)).toEqual([
      "Mining",
      "Beyond Holo Hollow",
    ]);
    for (const topic of CONVERSATION_TOPICS) {
      // A subject, not a sentence the silent player character speaks.
      expect(topic.label.length).toBeLessThanOrEqual(28);
      expect(topic.label).not.toMatch(/[.?!]$/);
      // Every beat is spoken/presented by the topic's own NPC.
      const sequence = getDialogue(topic.dialogueId);
      expect(sequence?.npcId).toBe(topic.npcId);
      for (const beat of sequence?.beats ?? []) {
        expect(beat.kind).toBe("npc");
        if (beat.kind === "npc") expect(beat.speakerNpcId).toBe(topic.npcId);
      }
    }
  });

  it("hides Beyond Holo Hollow until Hold It Together is completed", () => {
    const beforeCompletion = topicEntries(NPC_IDS.tansyRusk, [
      wio("completed"),
      cyt("completed"),
      waste("completed"),
      hold("active", {
        requirementsSatisfied: false,
        turnInAvailable: false,
        nextObjectiveKind: "repair_target_complete",
      }),
    ]);
    expect(beforeCompletion.map((entry) => entry.id)).toEqual([CONVERSATION_TOPIC_IDS.tansyMining]);

    const afterCompletion = topicEntries(NPC_IDS.tansyRusk, [
      wio("completed"),
      cyt("completed"),
      waste("completed"),
      hold("completed"),
    ]);
    expect(afterCompletion.map((entry) => entry.id)).toEqual([
      CONVERSATION_TOPIC_IDS.tansyMining,
      CONVERSATION_TOPIC_IDS.tansyBeyondHoloHollow,
    ]);
    expect(afterCompletion[1]?.label).toBe("Beyond Holo Hollow");
  });

  it("seeds Tansy's arc with the approved Beyond Holo Hollow beats", () => {
    const sequence = getDialogue(DIALOGUE_IDS.tansyBeyondHoloHollowTopic);
    expect(sequence?.beats).toHaveLength(27);
    expect(sequence?.beats[0]?.text).toBe("What's it like out there?");
    const text = sequence?.beats.map((beat) => beat.text).join(" ") ?? "";
    expect(text).toContain("You used to run deliveries, right?");
    expect(text).toContain("you don't remember any of it");
    expect(text).toContain("Wade never asked me to stay.");
    expect(text).toContain("I could go.");
    expect(text).toContain("taking it away from somebody else");
    expect(text).toContain("we've both got some sightseeing to do");
    expect(sequence?.beats.at(-1)?.text).toContain("coolant manifold with a serving spoon");
  });

  it("validates authored topics and rejects mis-authored ones", () => {
    expect(() => validateConversationTopics(CONVERSATION_TOPICS)).not.toThrow();
    const base = CONVERSATION_TOPICS[0]!;
    const withTopic = (overrides: Partial<ConversationTopicDefinition>) =>
      [{ ...base, ...overrides }] as readonly ConversationTopicDefinition[];
    expect(() =>
      validateConversationTopics(withTopic({ npcId: "nobody" as typeof base.npcId })),
    ).toThrow(/unknown NPC/i);
    expect(() =>
      validateConversationTopics(withTopic({ dialogueId: "nope" as typeof base.dialogueId })),
    ).toThrow(/unknown dialogue/i);
    expect(() =>
      validateConversationTopics(withTopic({ dialogueId: DIALOGUE_IDS.tansyMiningTopic })),
    ).toThrow(/belonging to NPC/i);
    expect(() =>
      validateConversationTopics(withTopic({ dialogueId: DIALOGUE_IDS.wadeOffer })),
    ).toThrow(/reuses Mission dialogue/i);
    expect(() => validateConversationTopics(withTopic({ label: "  " }))).toThrow(/subject label/i);
    expect(() =>
      validateConversationTopics(
        withTopic({
          availability: {
            kind: "mission_completed",
            missionId: "not_a_mission" as typeof MISSION_IDS.walkItOff,
          },
        }),
      ),
    ).toThrow(/unknown mission/i);
    expect(() => validateConversationTopics([base, base])).toThrow(/declared more than once/i);
  });

  it("keeps topic dialogue out of every Mission's authored mapping", () => {
    const topicDialogueIds = new Set(CONVERSATION_TOPICS.map((topic) => topic.dialogueId));
    for (const definition of [WALK_IT_OFF, CUT_YOUR_TEETH, WASTE_NOT, HOLD_IT_TOGETHER]) {
      const missionOwned = [
        definition.turnIn.dialogueId,
        ...definition.offers.flatMap((offer) => [
          offer.dialogueId,
          offer.acceptedContinuation?.dialogueId,
          offer.activeDialogueId,
        ]),
        ...(definition.activeNpcDialogue ?? []).map((entry) => entry.dialogueId),
        ...(definition.completedNpcDialogue ?? []).map((entry) => entry.dialogueId),
        ...Object.values(definition.dialogue),
      ].filter((dialogueId): dialogueId is string => typeof dialogueId === "string");
      for (const dialogueId of missionOwned) {
        expect(topicDialogueIds.has(dialogueId as never)).toBe(false);
      }
    }
  });
});

describe("issue #164 conversation-history persistence guard", () => {
  it("adds no seen/met/viewed conversation state to schema, server, domain, content, or UI", () => {
    const scanned = [
      "db/rune-space.ts",
      "server/missions.ts",
      "server/mission-state.ts",
      "server/play.ts",
      "game/domain/conversation.ts",
      "game/content/conversation-topics.ts",
      "game/content/dialogue.ts",
      "features/npc/NpcConversation.tsx",
      "features/npc/NpcInteractionPanel.tsx",
      "features/dialogue/DialoguePlayer.tsx",
    ];
    const forbidden =
      /seenTopicIds|seen_topic|viewedTopic|viewed_topic|topicHistory|topic_history|conversationHistory|conversation_history|hasMet|has_met|firstMeeting|first_meeting|metNpc|met_npc/;
    const offenders = scanned.filter((relative) =>
      forbidden.test(readFileSync(resolve(REPOSITORY_ROOT, relative), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps authored dialogue sequences free of Mission action semantics", () => {
    for (const sequence of DIALOGUE_SEQUENCES) {
      expect(sequence).not.toHaveProperty("action");
      expect(sequence).not.toHaveProperty("actionLabel");
    }
  });
});
