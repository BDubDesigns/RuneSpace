import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  SKILL_LEVEL_DIALOGUE_IDS,
} from "@/game/config/foundations";
import {
  DIALOGUE_SEQUENCES,
  getDialogue,
  getSkillLevelDialogue,
  SKILL_LEVEL_DIALOGUES,
  type DialogueBeat,
  type SkillLevelDialogue,
} from "@/game/content/dialogue";
import { FIRST_RUNEWORKING_LESSON, MISSIONS, NOT_FROM_AROUND_HERE } from "@/game/content/missions";
import { resolveNpcConversation, type NpcConversationEntry } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  missionLifecycleMoments,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import {
  resolvePresentedDialogue,
  selectSkillLevelDialogues,
  selectSkillLevelDialogueVariant,
  validateSkillLevelDialogues,
} from "@/game/domain/skill-level-dialogue";
import { cargoRepaired } from "./repair-observation";

/**
 * First Runeworking Lesson (#391), without PostgreSQL or a browser: the Mission
 * as authored, both routes to it, its objective and guidance at every count,
 * the Wise Old Enby's verbatim script routed to each moment, the replayable
 * topics, and the skill-level-dependent dialogue seam that both the lesson and
 * "Where to Find Fragments" share. Server authority is proven against real
 * PostgreSQL in tests/integration/first-runeworking-lesson.test.ts.
 */

const NOW = new Date("2026-10-23T00:00:00.000Z");
const enby = NPC_IDS.wiseOldEnby;
const hilltop = LOCATION_IDS.hilltopWorkshop;
const SEEKER_ACTION = ACTION_IDS.beginnerEchoSeekerRuneworking;

type Record = { acceptedAt: Date; completedAt?: Date };

function observation(attuned: number, input: { seekers?: number } = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map([
      [ITEM_IDS.beginnerEchoSeeker, input.seekers ?? 0],
      [ITEM_IDS.runeFragment, 0],
      [ITEM_IDS.runestone, 0],
    ]),
    stackLimits: new Map(),
    itemNames: new Map(),
    trackedProgress: new Map([["seekers-attuned", attuned]]),
    repairTargets: cargoRepaired(),
  };
}

function lessonProjection(
  record: Record | undefined,
  attuned = 0,
  input: { seekers?: number } = {},
  locationId: string = hilltop,
  stationary = true,
): MissionProjection {
  return projectMission(
    FIRST_RUNEWORKING_LESSON,
    record,
    locationId,
    stationary,
    observation(attuned, input),
    true,
  );
}

function mysteryProjection(state: "active" | "completed"): MissionProjection {
  const record: Record =
    state === "completed" ? { acceptedAt: NOW, completedAt: NOW } : { acceptedAt: NOW };
  return projectMission(NOT_FROM_AROUND_HERE, record, hilltop, true, observation(0), true);
}

const hub = (projections: readonly MissionProjection[]) =>
  resolveNpcConversation(enby, projections);
const missionEntries = (entries: readonly NpcConversationEntry[]) =>
  entries.filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission",
  );
const topicLabels = (entries: readonly NpcConversationEntry[]) =>
  entries.filter((entry) => entry.kind === "topic").map((entry) => entry.label);

describe("the Mission as authored", () => {
  it("follows Not From Around Here, by continuation and by prerequisite", () => {
    expect(NOT_FROM_AROUND_HERE.continuationMissionId).toBe(MISSION_IDS.firstRuneworkingLesson);
    expect(FIRST_RUNEWORKING_LESSON.prerequisiteMissionId).toBe(MISSION_IDS.notFromAroundHere);
    // Nothing after it is shipped: no continuation and no placeholder Mission.
    expect(FIRST_RUNEWORKING_LESSON.continuationMissionId).toBeUndefined();
    expect(MISSIONS.map((mission) => mission.title)).not.toContain("First Resonance Echo");
    expect(
      MISSIONS.filter(
        (mission) => mission.prerequisiteMissionId === MISSION_IDS.firstRuneworkingLesson,
      ),
    ).toEqual([]);
  });

  it("offers itself in person at the Enby with Begin Lesson / Not Now, flowing into the lesson", () => {
    expect(FIRST_RUNEWORKING_LESSON.offers).toEqual([
      {
        npcId: enby,
        locationId: hilltop,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonOffer,
        actionLabel: "Begin Lesson",
        declineLabel: "Not Now",
        acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLesson },
      },
    ]);
    expect(FIRST_RUNEWORKING_LESSON.itemOffer).toBeUndefined();
  });

  it("counts three Seeker attunements after acceptance, and offers the Seeker's Sources", () => {
    expect(FIRST_RUNEWORKING_LESSON.requirements).toEqual([
      {
        kind: "tracked_activity",
        progressKey: "seekers-attuned",
        activity: "runeworking",
        metric: "completions",
        actionId: SEEKER_ACTION,
        target: 3,
        objective: "Attune Beginner Echo Seekers at the Resonance Rig — {current} / {target}",
        recommendedActionId: SEEKER_ACTION,
        presentsOutputSources: true,
      },
    ]);
    // Never a carried-stack requirement: holding Seekers satisfies nothing.
    expect(
      FIRST_RUNEWORKING_LESSON.requirements.some((requirement) => "itemId" in requirement),
    ).toBe(false);
  });

  it("turns in explicitly at the Enby for 150 Runeworking XP, once", () => {
    expect(FIRST_RUNEWORKING_LESSON.turnIn).toEqual({
      npcId: enby,
      locationId: hilltop,
      requiresStationary: true,
      objective: "Return to the Wise Old Enby at Hilltop Workshop",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn,
      actionLabel: "Complete First Runeworking Lesson",
    });
    expect(FIRST_RUNEWORKING_LESSON.autoCompletion).toBeUndefined();
    expect(FIRST_RUNEWORKING_LESSON.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.runeworking,
      amount: 150,
    });
    // The mystery stays a lore Mission: no XP, Credits or item.
    expect(NOT_FROM_AROUND_HERE.reward).toBeUndefined();
  });

  it("authors its reminder and completion and declares busy, the one moment the script omits", () => {
    expect([...missionLifecycleMoments(FIRST_RUNEWORKING_LESSON)].sort()).toEqual([
      "busy",
      "completion_presentation",
      "tracked_activity_reminder",
    ]);
    expect(FIRST_RUNEWORKING_LESSON.dialogue).toMatchObject({
      trackedActivityReminderDialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder,
      completionPresentationDialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
    });
    expect(FIRST_RUNEWORKING_LESSON.dialogue.omitted?.map((entry) => entry.moment)).toEqual([
      "busy",
    ]);
    expect(getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion)?.beats).toEqual([
      {
        kind: "skill_xp",
        skillId: SKILL_IDS.runeworking,
        amount: 150,
        backgroundId: CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior,
        text: "",
      },
    ]);
  });

  it("validates with the shipped registry, and refuses output Sources on anything but a recipe's completions", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    const requirement = FIRST_RUNEWORKING_LESSON.requirements[0]!;
    const withRequirement = (changes: object) => () =>
      validateMissionDefinitions([
        NOT_FROM_AROUND_HERE,
        { ...FIRST_RUNEWORKING_LESSON, requirements: [{ ...requirement, ...changes } as never] },
      ]);
    expect(withRequirement({ actionId: undefined, recommendedActionId: undefined })).toThrow(
      /presents output Sources/,
    );
  });
});

describe("both routes to the same lesson", () => {
  it("offers the lesson to a character who finished the mystery before it existed", () => {
    const entries = hub([mysteryProjection("completed"), lessonProjection(undefined)]);
    const [offer] = missionEntries(entries);
    expect(offer).toMatchObject({
      kind: "mission",
      missionId: MISSION_IDS.firstRuneworkingLesson,
      role: "offer",
      label: "First Runeworking Lesson",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonOffer,
      guidance: "available",
      action: { kind: "accept_mission", label: "Begin Lesson", declineLabel: "Not Now" },
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLesson },
    });
    // Blue on the Enby's Talk: local discovery only.
    const targets = deriveMissionGuidanceTargets([lessonProjection(undefined)]);
    expect(targets.availableNpcIds.has(enby)).toBe(true);
    expect(targets.locationIds.size).toBe(0);
  });

  it("offers nothing before the mystery is finished", () => {
    const projection = projectMission(
      FIRST_RUNEWORKING_LESSON,
      undefined,
      hilltop,
      true,
      observation(0),
      false,
    );
    expect(projection.prerequisiteSatisfied).toBe(false);
    expect(missionEntries(hub([mysteryProjection("active"), projection]))).not.toContainEqual(
      expect.objectContaining({ missionId: MISSION_IDS.firstRuneworkingLesson }),
    );
  });

  it("never offers twice: once accepted, by either route, the offer is gone", () => {
    for (const record of [{ acceptedAt: NOW }, { acceptedAt: NOW, completedAt: NOW }]) {
      const entries = missionEntries(
        hub([mysteryProjection("completed"), lessonProjection(record)]),
      );
      expect(entries.some((entry) => entry.role === "offer")).toBe(false);
    }
  });

  it("plays the lesson as the mystery's completion scene, so the auto-accepted route hears it too", () => {
    expect(NOT_FROM_AROUND_HERE.dialogue.completionPresentationDialogueId).toBe(
      DIALOGUE_IDS.wiseOldEnbyFirstLesson,
    );
  });
});

describe("the objective, its guidance and the turn-in", () => {
  it("advances 0/3 → 3/3 from tracked completions alone, with the Seeker's Sources while unmet", () => {
    for (const count of [0, 1, 2]) {
      const projection = lessonProjection({ acceptedAt: NOW }, count);
      expect(projection.state).toBe("active");
      expect(projection.currentObjective).toBe(
        `Attune Beginner Echo Seekers at the Resonance Rig — ${count} / 3`,
      );
      expect(projection.requirements).toEqual([
        expect.objectContaining({
          kind: "tracked_activity",
          satisfied: false,
          progress: { current: count, target: 3 },
          activity: "runeworking",
          sourcesItemId: ITEM_IDS.beginnerEchoSeeker,
        }),
      ]);
      // The requirement observes no item: Sources is a reference, not a target.
      expect(projection.requirements![0]!.itemId).toBeUndefined();
    }
  });

  it("caps at 3/3 and drops the Sources reference once met", () => {
    const projection = lessonProjection({ acceptedAt: NOW }, 5);
    expect(projection.requirements![0]).toMatchObject({
      satisfied: true,
      progress: { current: 3, target: 3 },
    });
    expect(projection.requirements![0]!.sourcesItemId).toBeUndefined();
    expect(projection.currentObjective).toBe("Return to the Wise Old Enby at Hilltop Workshop");
  });

  it("is never completed by holding Seekers: carried Seekers leave the objective at 0", () => {
    const projection = lessonProjection({ acceptedAt: NOW }, 0, { seekers: 5 });
    expect(projection.state).toBe("active");
    expect(projection.requirements![0]!.satisfied).toBe(false);
  });

  it("guides the Rig's Start where it is, and Hilltop Workshop from elsewhere", () => {
    const here = deriveMissionGuidanceTargets([lessonProjection({ acceptedAt: NOW }, 1)]);
    expect(here.actionIds.has(SEEKER_ACTION)).toBe(true);
    expect(here.locationIds.has(hilltop)).toBe(false);
    const away = deriveMissionGuidanceTargets([
      lessonProjection({ acceptedAt: NOW }, 1, {}, LOCATION_IDS.stillreachLandingStation),
    ]);
    expect(away.locationIds.has(hilltop)).toBe(true);
  });

  it("hands off to a blue turn-in at the Enby at 3/3, but only completes when stationary", () => {
    const ready = lessonProjection({ acceptedAt: NOW }, 3);
    expect(ready.state).toBe("ready_for_completion");
    const targets = deriveMissionGuidanceTargets([ready]);
    expect(targets.turnInNpcIds.has(enby)).toBe(true);
    const busy = lessonProjection({ acceptedAt: NOW }, 3, {}, hilltop, false);
    expect(busy.state).toBe("active");
    expect(busy.stage?.requirementsSatisfied).toBe(true);
    expect(busy.stage?.turnInAvailable).toBe(false);
  });
});

describe("the Enby's conversation at each moment", () => {
  const lessonEntry = (entries: readonly NpcConversationEntry[]) =>
    missionEntries(entries).find((entry) => entry.missionId === MISSION_IDS.firstRuneworkingLesson);

  it("reminds, with no command, while fewer than three are attuned", () => {
    for (const count of [0, 2]) {
      const entry = lessonEntry(
        hub([mysteryProjection("completed"), lessonProjection({ acceptedAt: NOW }, count)]),
      );
      expect(entry).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder,
      });
      expect(entry?.action).toBeUndefined();
    }
  });

  it("turns in with the explicit control at three", () => {
    const entry = lessonEntry(
      hub([mysteryProjection("completed"), lessonProjection({ acceptedAt: NOW }, 3)]),
    );
    expect(entry).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn,
      action: { kind: "complete_mission", label: "Complete First Runeworking Lesson" },
      guidance: "turn_in",
    });
  });

  it("falls back to the turn-in opening while busy, as declared", () => {
    const entry = lessonEntry(
      hub([
        mysteryProjection("completed"),
        lessonProjection({ acceptedAt: NOW }, 3, {}, hilltop, false),
      ]),
    );
    expect(entry?.dialogueId).toBe(DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn);
  });

  it("offers the topics in order: Where to Find Fragments after the mystery, First lesson once accepted, About the Seekers after", () => {
    expect(topicLabels(hub([mysteryProjection("completed"), lessonProjection(undefined)]))).toEqual(
      ["Introductions", "The workshop", "Stillreach", "About RuneSpace", "Where to Find Fragments"],
    );
    expect(
      topicLabels(hub([mysteryProjection("completed"), lessonProjection({ acceptedAt: NOW }, 1)])),
    ).toEqual([
      "Introductions",
      "The workshop",
      "Stillreach",
      "About RuneSpace",
      "First lesson",
      "Where to Find Fragments",
    ]);
    const done = hub([
      mysteryProjection("completed"),
      lessonProjection({ acceptedAt: NOW, completedAt: NOW }, 3),
    ]);
    expect(topicLabels(done)).toEqual([
      "Introductions",
      "The workshop",
      "Stillreach",
      "About RuneSpace",
      "First lesson",
      "Where to Find Fragments",
      "About the Seekers",
    ]);
    // Completed: no Mission command remains anywhere in the hub.
    expect(missionEntries(done)).toEqual([]);
  });

  it("never offers a lesson topic before the mystery is solved", () => {
    expect(topicLabels(hub([mysteryProjection("active")]))).toEqual([
      "Introductions",
      "The workshop",
      "Stillreach",
    ]);
  });
});

/** The approved script, verbatim: expression and line for every beat. */
const SCRIPT = {
  offer: [
    [
      EXPRESSION_IDS.friendly,
      "Ah, there you are! I was hoping you'd come back. There's only so much conversation one can have with a machine, and this one is a terrible listener.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "Well, that's not entirely fair. Listening is precisely what I built it for.",
    ],
    [
      EXPRESSION_IDS.amused,
      "You know what RuneSpace is now. Would you like to learn how to do something useful with it? I promise the equipment is considerably more reliable than it looks.",
    ],
  ],
  lesson: [
    [
      EXPRESSION_IDS.friendly,
      "One step at a time, as promised. Now, you may have noticed that rather impressive collection of questionable engineering over there.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "That's my Resonance Rig. I built it after following the disturbances in RuneSpace to this very hill. The signal was stronger here than anywhere else I'd been.",
    ],
    [
      EXPRESSION_IDS.amused,
      "I wasn't trying to build a doorway into RuneSpace. I was trying to build an ear. The distinction has saved me a considerable amount of property damage.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "Rune Fragments already resonate with that space between worlds. With a little careful attunement, we can persuade one to listen for something specific.",
    ],
    [
      EXPRESSION_IDS.friendly,
      "A Resonance Echo. A disturbance hidden somewhere out there, waiting to be discovered.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "One Rune Fragment, properly attuned in the Rig, becomes what I call a Beginner Echo Seeker. Rather a grand name for a little piece of stone, but accuracy is important.",
    ],
    [
      EXPRESSION_IDS.friendly,
      "I'd like you to make three. Not because three is a particularly magical number, mind you. It's just enough practice to make sure you've got the hang of it.",
    ],
    [
      EXPRESSION_IDS.amused,
      "And please, use the Rig as often as you like. I built it to be used. Not admired from a safe distance, as the instruction manual recommends.",
    ],
  ],
  novice: [
    [
      EXPRESSION_IDS.friendly,
      "If you're short on Fragments, try the Prospecting Quarry. They turn up among the ordinary stone from time to time.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "There's a place called Harmonic Workings where the fragments are much more plentiful. Tougher digging, though. I'd get a little more Mining experience before trying your luck there.",
    ],
  ],
  experienced: [
    [
      EXPRESSION_IDS.thoughtful,
      "You look like you've done your share of Mining. I'd recommend Harmonic Workings. The rune material runs right through the rock there. Far better than hoping to turn up the odd Fragment at the Quarry.",
    ],
    [
      EXPRESSION_IDS.amused,
      "Do be careful. The stones have a peculiar habit of humming back when you disturb them. Quite rude, really.",
    ],
  ],
  reminder: [
    [
      EXPRESSION_IDS.friendly,
      "How's the attunement coming along? Don't rush it. RuneSpace has been there a very long time. I doubt it's going anywhere before supper.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "Three successful Seekers, remember. The Rig will take care of the delicate work, so long as you give it a Fragment to work with.",
    ],
    [
      EXPRESSION_IDS.amused,
      "And don't worry about wearing the machine out. I've been trying for years. It appears to be winning.",
    ],
  ],
  turnIn: [
    [
      EXPRESSION_IDS.friendly,
      "Ah! Look at you! Three successful attunements, and the workshop is still standing!",
    ],
    [
      EXPRESSION_IDS.amused,
      "You're already ahead of my first attempt. We don't discuss that one. Particularly not with the neighbors.",
    ],
    [
      EXPRESSION_IDS.thoughtful,
      "Let me tell you what you've made. Each Seeker is attuned to detect Resonance Echoes — little disturbances where RuneSpace brushes against the world we know.",
    ],
    [
      EXPRESSION_IDS.neutral,
      "They won't tell you exactly where an Echo is hiding. But they can point you in the right direction. Sometimes that's all you need.",
    ],
    [
      EXPRESSION_IDS.friendly,
      "You've learned how to make them. Next, we'll learn how to listen. Keep those Seekers handy.",
    ],
    [
      EXPRESSION_IDS.amused,
      "And well done, genuinely. It's rather nice having someone else around who can operate the equipment without setting anything on fire.",
    ],
  ],
  seekers: [
    [
      EXPRESSION_IDS.thoughtful,
      "You've learned how to make Seekers. The next challenge is learning what they're telling you.",
    ],
    [
      EXPRESSION_IDS.friendly,
      "Keep a few handy. There are things worth finding out there, and I suspect you've only scratched the surface.",
    ],
    [
      EXPRESSION_IDS.amused,
      "The Rig is yours to use whenever you need it. Just leave the roof attached, would you? It's already doing the bare minimum.",
    ],
  ],
} as const;

const lines = (beats: readonly DialogueBeat[]) =>
  beats.map((beat) => {
    if (beat.kind !== "npc") throw new Error("the protagonist is silent; every beat is the Enby's");
    expect(beat.speakerNpcId).toBe(enby);
    expect(beat.presentationMode).toBe("local");
    expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior);
    return [beat.expressionId, beat.text];
  });

describe("the approved script, verbatim", () => {
  it.each([
    ["offer", DIALOGUE_IDS.wiseOldEnbyFirstLessonOffer, SCRIPT.offer],
    ["lesson", DIALOGUE_IDS.wiseOldEnbyFirstLesson, SCRIPT.lesson],
    ["lesson topic", DIALOGUE_IDS.wiseOldEnbyFirstLessonTopic, SCRIPT.lesson],
    ["Mining 1–7 advice", DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice, SCRIPT.novice],
    ["Mining 8+ advice", DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced, SCRIPT.experienced],
    ["reminder", DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder, SCRIPT.reminder],
    ["turn-in", DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn, SCRIPT.turnIn],
    ["About the Seekers", DIALOGUE_IDS.wiseOldEnbyAboutTheSeekersTopic, SCRIPT.seekers],
  ] as const)(
    "authors the %s exactly, one beat per passage, for the Enby alone",
    (_, id, script) => {
      const sequence = getDialogue(id)!;
      expect(sequence.npcId).toBe(enby);
      expect(lines(sequence.beats)).toEqual(script);
    },
  );

  it("keeps the lesson and its replayable topic identical, both closing with the Fragment advice", () => {
    const lesson = getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLesson)!;
    const topic = getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLessonTopic)!;
    expect(topic.beats).toEqual(lesson.beats);
    expect(lesson.skillLevelDialogueId).toBe(SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice);
    expect(topic.skillLevelDialogueId).toBe(SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice);
    const where = getDialogue(DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic)!;
    expect(where.beats).toEqual([]);
    expect(where.skillLevelDialogueId).toBe(SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice);
  });
});

describe("skill-level-dependent dialogue (the reusable seam)", () => {
  const advice = getSkillLevelDialogue(SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice)!;

  it("declares one Mining choice whose threshold is Harmonic Workings' own level, 8", () => {
    expect(advice).toEqual({
      id: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
      npcId: enby,
      skillId: SKILL_IDS.mining,
      variants: [
        { minimumLevel: 1, dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice },
        { minimumLevel: 8, dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced },
      ],
    });
    expect(advice.variants[1]!.minimumLevel).toBe(
      getEffectiveGameBalance().mining.sources.harmonicMining.requiredMiningLevel,
    );
  });

  it("selects by the current Mining level: 7 and a missing row are novice, 8 and above experienced", () => {
    expect(selectSkillLevelDialogueVariant(advice, { [SKILL_IDS.mining]: 7 })).toBe(
      DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice,
    );
    expect(selectSkillLevelDialogueVariant(advice, {})).toBe(
      DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice,
    );
    expect(selectSkillLevelDialogueVariant(advice, { [SKILL_IDS.mining]: 8 })).toBe(
      DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced,
    );
    expect(selectSkillLevelDialogueVariant(advice, { [SKILL_IDS.mining]: 99 })).toBe(
      DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced,
    );
    // Another skill's level is irrelevant.
    expect(selectSkillLevelDialogueVariant(advice, { [SKILL_IDS.refining]: 50 })).toBe(
      DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice,
    );
  });

  it("plays only the applicable lines, at the end of the lesson and as the whole topic", () => {
    for (const [level, applicable, other] of [
      [7, SCRIPT.novice, SCRIPT.experienced],
      [8, SCRIPT.experienced, SCRIPT.novice],
    ] as const) {
      const selections = selectSkillLevelDialogues({ [SKILL_IDS.mining]: level });
      const lesson = resolvePresentedDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLesson, selections)!;
      expect(lines(lesson.beats)).toEqual([...SCRIPT.lesson, ...applicable]);
      const topic = resolvePresentedDialogue(
        DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
        selections,
      )!;
      expect(lines(topic.beats)).toEqual(applicable);
      const texts = topic.beats.map((beat) => (beat.kind === "npc" ? beat.text : ""));
      for (const [, text] of other) expect(texts).not.toContain(text);
    }
  });

  it("reflects a changed level on the next visit, from the same authored choice", () => {
    const before = resolvePresentedDialogue(
      DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
      selectSkillLevelDialogues({ [SKILL_IDS.mining]: 7 }),
    )!;
    const after = resolvePresentedDialogue(
      DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
      selectSkillLevelDialogues({ [SKILL_IDS.mining]: 8 }),
    )!;
    expect(lines(before.beats)).toEqual(SCRIPT.novice);
    expect(lines(after.beats)).toEqual(SCRIPT.experienced);
  });

  it("plays the Level 1 fallback when the server named no selection, and leaves other sequences untouched", () => {
    const fallback = resolvePresentedDialogue(
      DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
      {},
    )!;
    expect(lines(fallback.beats)).toEqual(SCRIPT.novice);
    const ordinary = getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder)!;
    expect(resolvePresentedDialogue(ordinary.id, {})).toBe(ordinary);
    expect(resolvePresentedDialogue("not_a_dialogue", {})).toBeUndefined();
  });

  it("validates the shipped registry and refuses malformed choices", () => {
    expect(() => validateSkillLevelDialogues(DIALOGUE_SEQUENCES)).not.toThrow();
    const broken = (changes: Partial<SkillLevelDialogue>) => () =>
      validateSkillLevelDialogues(DIALOGUE_SEQUENCES, [{ ...advice, ...changes }]);
    expect(broken({ variants: [advice.variants[0]!] })).toThrow(/at least two/);
    expect(
      broken({ variants: [{ ...advice.variants[0]!, minimumLevel: 2 }, advice.variants[1]!] }),
    ).toThrow(/Level 1 fallback/);
    expect(
      broken({ variants: [advice.variants[0]!, { ...advice.variants[1]!, minimumLevel: 1 }] }),
    ).toThrow(/ascending/);
    expect(
      broken({ variants: [advice.variants[0]!, { ...advice.variants[1]!, minimumLevel: 100 }] }),
    ).toThrow(/maximum/);
    expect(broken({ npcId: NPC_IDS.tollKade })).toThrow(/another NPC/);
    expect(broken({ skillId: SKILL_IDS.strength })).toThrow(/no level curve/);
    expect(() =>
      validateSkillLevelDialogues(DIALOGUE_SEQUENCES, [...SKILL_LEVEL_DIALOGUES, advice]),
    ).toThrow(/more than once/);
  });
});
