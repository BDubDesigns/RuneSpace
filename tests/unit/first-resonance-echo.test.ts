import { describe, expect, it } from "vitest";
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
  FIRST_RESONANCE_ECHO,
  FIRST_RUNEWORKING_LESSON,
  MISSIONS,
  NOT_FROM_AROUND_HERE,
} from "@/game/content/missions";
import {
  resolveMissionSuccessView,
  resolveNpcConversation,
  type NpcConversationEntry,
} from "@/game/domain/conversation";
import {
  continuationGiftOffer,
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import { composePresentedDialogue } from "@/game/domain/skill-level-dialogue";
import { cargoRepaired } from "./repair-observation";

/**
 * First Resonance Echo (#393), without PostgreSQL or a browser: the Mission as
 * authored, the capacity-safe continuation seam, every approved Enby line
 * verbatim (and the personal Stillreach beats), what the conversation plays
 * after each command outcome, and the objective at 0/1 and 1/1. Server authority
 * is proven against PostgreSQL in tests/integration/first-resonance-echo.test.ts.
 */

const NOW = new Date("2026-10-23T00:00:00.000Z");
const enby = NPC_IDS.wiseOldEnby;
const hilltop = LOCATION_IDS.hilltopWorkshop;

const lines = (dialogueId: string) =>
  getDialogue(dialogueId)!.beats.map((beat: DialogueBeat) =>
    beat.kind === "npc" ? [beat.expressionId, beat.text] : [beat.kind],
  );

const SCENE_A = [
  [
    EXPRESSION_IDS.friendly,
    "Well! You've learned to make Seekers. Now comes the interesting part. Finding out whether they have anything worthwhile to say.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "I've set two more aside for you. Consider them a little encouragement. Or insurance against an uncooperative universe.",
  ],
  [
    EXPRESSION_IDS.amused,
    "I recommend carrying a few. It can be terribly embarrassing to discover something remarkable just as you've run out of ways to look for it.",
  ],
];

const SCENE_B = [
  [
    EXPRESSION_IDS.thoughtful,
    "An Echo is a disturbance where RuneSpace brushes against our own. Usually quite faint. The sort of thing you'd walk past a thousand times without knowing it was there.",
  ],
  [
    EXPRESSION_IDS.friendly,
    "But your Seekers have been attuned to recognize one. Take a Seeker from your Inventory, find yourself a place to stand, and use it.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "Give it a few moments. If there's an Echo at your location, the Seeker will resonate with it. And you may find that RuneSpace has left you something rather interesting.",
  ],
  [
    EXPRESSION_IDS.amused,
    "Do keep your expectations reasonable. The universe is under no obligation to give you anything useful. I've reminded it of this several times.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "If the Echo is elsewhere, the Seeker will tell you which way to look. East or west. North or south. Sometimes you'll already be lined up in one direction.",
  ],
  [
    EXPRESSION_IDS.friendly,
    "Remember that the directions are measured from where you took the reading. You can check your last reading in the Seeker's details whenever you need a reminder.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "One important detail: a Seeker listens for Echoes on the planet you're standing on. Stillreach has its own disturbances. Skatboll has others.",
  ],
  [
    EXPRESSION_IDS.friendly,
    "And if you leave one world before you've finished searching, don't worry. Come back and your last reading will still be there. Those Echoes can be patient things.",
  ],
  [
    EXPRESSION_IDS.amused,
    "Each reading uses up a Seeker, I'm afraid. Rather like a match. An extraordinarily expensive match that points toward mysteries instead of setting your curtains on fire.",
  ],
  [
    EXPRESSION_IDS.friendly,
    "And if you run out? Make some more. The Echo won't wander off simply because you've exhausted your supplies.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "Oh, and do leave some room in your Inventory before you go looking. Sometimes an Echo gives up an item, and you'll need somewhere to put it.",
  ],
  [
    EXPRESSION_IDS.amused,
    "Otherwise, it slips straight back into RuneSpace, perhaps to be found by a better-prepared traveler. Rather judgmental, coming from a place that hasn't invented pockets.",
  ],
  [
    EXPRESSION_IDS.thoughtful,
    "Find one. Just one, for now. Then come back and tell me how it went.",
  ],
  [
    EXPRESSION_IDS.amused,
    "And don't assume you need to travel halfway across Stillreach. For all we know, there's one under your feet. The universe does enjoy making fools of people with elaborate travel plans.",
  ],
];

function observation(found: number): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map([[ITEM_IDS.beginnerEchoSeeker, 5]]),
    stackLimits: new Map(),
    itemNames: new Map(),
    trackedProgress: new Map([["echoes-found", found]]),
    repairTargets: cargoRepaired(),
  };
}

function echoProjection(
  record: { acceptedAt: Date; completedAt?: Date } | undefined,
  found = 0,
  locationId: string = hilltop,
): MissionProjection {
  return projectMission(FIRST_RESONANCE_ECHO, record, locationId, true, observation(found), true);
}

const lessonDone = projectMission(
  FIRST_RUNEWORKING_LESSON,
  { acceptedAt: NOW, completedAt: NOW },
  hilltop,
  true,
  { ...observation(0), trackedProgress: new Map([["seekers-attuned", 3]]) },
  true,
);

const missionEntries = (entries: readonly NpcConversationEntry[]) =>
  entries.filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission" && entry.missionId === MISSION_IDS.firstResonanceEcho,
  );
const topicLabels = (entries: readonly NpcConversationEntry[]) =>
  entries.filter((entry) => entry.kind === "topic").map((entry) => entry.label);

describe("the Mission as authored", () => {
  it("follows the lesson by continuation and by prerequisite, with one gift authored once", () => {
    expect(FIRST_RUNEWORKING_LESSON.continuationMissionId).toBe(MISSION_IDS.firstResonanceEcho);
    expect(FIRST_RESONANCE_ECHO.prerequisiteMissionId).toBe(MISSION_IDS.firstRuneworkingLesson);
    expect(FIRST_RESONANCE_ECHO.offers).toEqual([
      {
        npcId: enby,
        locationId: hilltop,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
        actionLabel: "Take the Seekers",
        declineLabel: "Not Now",
        acceptEffect: { kind: "stack_item", itemId: ITEM_IDS.beginnerEchoSeeker, quantity: 2 },
        acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions },
      },
    ]);
    expect(continuationGiftOffer(FIRST_RUNEWORKING_LESSON, FIRST_RESONANCE_ECHO)).toBe(
      FIRST_RESONANCE_ECHO.offers[0],
    );
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("counts one discovery, turns in at the Enby, and pays 300 Runeworking XP", () => {
    expect(FIRST_RESONANCE_ECHO.requirements).toEqual([
      {
        kind: "tracked_activity",
        progressKey: "echoes-found",
        activity: "echo_hunt",
        metric: "completions",
        target: 1,
        objective:
          "Find one Resonance Echo using a Beginner Echo Seeker ({current}/{target}). Seekers search your current planet; each planet's search is separate. Leave room in Inventory for anything you find.",
        recommendedActionId: ACTION_IDS.beginnerEchoReading,
        recommendedItemId: ITEM_IDS.beginnerEchoSeeker,
      },
    ]);
    expect(FIRST_RESONANCE_ECHO.turnIn).toMatchObject({
      npcId: enby,
      locationId: hilltop,
      requiresStationary: true,
      objective: "Return to the Wise Old Enby at Hilltop Workshop",
    });
    expect(FIRST_RESONANCE_ECHO.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.runeworking,
      amount: 300,
    });
    // 3 × 25 + 150 + 50 + 300: Level 2 on the 500 XP threshold.
    expect(3 * 25 + 150 + 50 + 300).toBe(575);
  });

  it("refuses a continuation whose gift route would hand over Credits", () => {
    expect(() =>
      validateMissionDefinitions([
        NOT_FROM_AROUND_HERE,
        FIRST_RUNEWORKING_LESSON,
        {
          ...FIRST_RESONANCE_ECHO,
          offers: [
            { ...FIRST_RESONANCE_ECHO.offers[0]!, acceptEffect: { kind: "credits", amount: 5 } },
          ],
        },
      ]),
    ).toThrow(/grants something a continuation cannot hand over/);
  });
});

describe("the objective", () => {
  it("moves from 0/1 to 1/1 only by the tracked discovery, then hands off to the Enby", () => {
    const zero = echoProjection({ acceptedAt: NOW }, 0, LOCATION_IDS.theJag);
    expect(zero.currentObjective).toBe(
      "Find one Resonance Echo using a Beginner Echo Seeker (0/1). Seekers search your current planet; each planet's search is separate. Leave room in Inventory for anything you find.",
    );
    // Carrying five Seekers satisfies nothing.
    expect(zero.state).toBe("active");
    const targets = deriveMissionGuidanceTargets([zero]);
    expect(targets.actionIds.has(ACTION_IDS.beginnerEchoReading)).toBe(true);
    expect(targets.actionItemIds.has(ITEM_IDS.beginnerEchoSeeker)).toBe(true);
    // An unpinned Mission contributes no active item guidance, without changing progress.
    expect(deriveMissionGuidanceTargets([]).actionItemIds.size).toBe(0);
    const one = echoProjection({ acceptedAt: NOW }, 1, LOCATION_IDS.theJag);
    expect(deriveMissionGuidanceTargets([one]).actionItemIds.size).toBe(0);
    expect(one.currentObjective).toBe("Return to the Wise Old Enby at Hilltop Workshop");
    expect(one.state).toBe("active");
    expect(echoProjection({ acceptedAt: NOW }, 1).state).toBe("ready_for_completion");
  });
});

describe("the Enby's conversation", () => {
  it("offers it in person once the lesson is complete, and never again once accepted", () => {
    const [offer] = missionEntries(
      resolveNpcConversation(enby, [lessonDone, echoProjection(undefined)]),
    );
    expect(offer).toMatchObject({
      role: "offer",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
      action: { kind: "accept_mission", label: "Take the Seekers", declineLabel: "Not Now" },
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions },
    });
    const accepted = missionEntries(
      resolveNpcConversation(enby, [lessonDone, echoProjection({ acceptedAt: NOW })]),
    );
    expect(accepted.map((entry) => entry.role)).toEqual(["active"]);
    expect(accepted[0]!.dialogueId).toBe(DIALOGUE_IDS.wiseOldEnbyFirstEchoReminder);
    expect(accepted[0]!.action).toBeUndefined();
  });

  it("turns in with the explicit control once an Echo is found", () => {
    const [turnIn] = missionEntries(
      resolveNpcConversation(enby, [lessonDone, echoProjection({ acceptedAt: NOW }, 1)]),
    );
    expect(turnIn).toMatchObject({
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoTurnIn,
      action: { kind: "complete_mission", label: "Complete First Resonance Echo" },
    });
  });

  it("replays How to Listen while accepted and after, and About Resonance Echoes after", () => {
    const before = topicLabels(resolveNpcConversation(enby, [lessonDone]));
    expect(before).not.toContain("How to Listen");
    const active = topicLabels(
      resolveNpcConversation(enby, [lessonDone, echoProjection({ acceptedAt: NOW })]),
    );
    expect(active).toContain("How to Listen");
    expect(active).not.toContain("About Resonance Echoes");
    const done = topicLabels(
      resolveNpcConversation(enby, [
        lessonDone,
        echoProjection({ acceptedAt: NOW, completedAt: NOW }, 1),
      ]),
    );
    expect(done).toEqual(expect.arrayContaining(["How to Listen", "About Resonance Echoes"]));
    expect(done).toContain("Stillreach");
  });
});

describe("what plays after each command", () => {
  const completed = (continuation?: object) =>
    resolveMissionSuccessView({
      actionKind: "complete_mission",
      missionId: MISSION_IDS.firstRuneworkingLesson,
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn,
      mission: { status: "completed", ...(continuation ? { continuation } : {}) } as never,
    });

  it("plays the lesson's 150 XP, then the gift scene, when the continuation was accepted", () => {
    expect(completed({ missionId: MISSION_IDS.firstResonanceEcho, status: "accepted" })).toEqual({
      kind: "dialogue",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
      then: [DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer, DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions],
    });
  });

  it("plays the lesson's 150 XP, then the refusal, when the Seekers would not fit", () => {
    for (const capacityReason of ["slots", "mass"] as const) {
      expect(
        completed({
          missionId: MISSION_IDS.firstResonanceEcho,
          status: "capacity_refused",
          capacityReason,
        }),
      ).toEqual({
        kind: "dialogue",
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
        then: [DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity],
      });
    }
  });

  it("plays no gift without a receipt for it", () => {
    expect(completed()).toEqual({
      kind: "dialogue",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
    });
    expect(
      resolveMissionSuccessView({
        actionKind: "complete_mission",
        missionId: MISSION_IDS.firstRuneworkingLesson,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn,
        mission: { status: "already_completed" },
      }),
    ).toEqual({ kind: "hub" });
  });

  it("plays the gift scene after the in-person offer is accepted", () => {
    expect(
      resolveMissionSuccessView({
        actionKind: "accept_mission",
        missionId: MISSION_IDS.firstResonanceEcho,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
        acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions },
        mission: { status: "accepted" },
      }),
    ).toEqual({ kind: "dialogue", dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions });
  });

  it("joins the scenes into one, beat for beat", () => {
    const joined = composePresentedDialogue(
      [
        DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
        DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
        DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions,
      ],
      {},
    )!;
    expect(joined.beats).toEqual([
      ...getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion)!.beats,
      ...getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer)!.beats,
      ...getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions)!.beats,
    ]);
    expect(composePresentedDialogue([DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer], {})).toBe(
      getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer),
    );
  });
});

describe("the approved script, verbatim", () => {
  it("is the gift scene: line one offers, the rest gives two Seekers then teaches", () => {
    expect(lines(DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer)).toEqual([SCENE_A[0]]);
    expect(lines(DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions)).toEqual([
      SCENE_A[1],
      ["item"],
      SCENE_A[2],
      ...SCENE_B,
    ]);
    const gift = getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions)!.beats[1]!;
    expect(gift).toMatchObject({ kind: "item", itemId: ITEM_IDS.beginnerEchoSeeker, quantity: 2 });
  });

  it("replays the instructions, without the gift, as How to Listen", () => {
    expect(lines(DIALOGUE_IDS.wiseOldEnbyHowToListenTopic)).toEqual(SCENE_B);
  });

  it("reminds, refuses, debriefs, pays and reflects", () => {
    expect(lines(DIALOGUE_IDS.wiseOldEnbyFirstEchoReminder)).toEqual([
      [EXPRESSION_IDS.friendly, "Back already? Any promising readings?"],
      [
        EXPRESSION_IDS.thoughtful,
        "Try to narrow things down. Every reading tells you something, even when it doesn't find what you're looking for.",
      ],
      [
        EXPRESSION_IDS.amused,
        "I once spent an entire afternoon following a particularly interesting resonance, only to discover I'd been listening to my own equipment.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "Well, mostly my equipment. I'm still not entirely certain about the last reading.",
      ],
    ]);
    expect(lines(DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity)).toEqual([
      [
        EXPRESSION_IDS.amused,
        "Ah. A small logistical complication. I've got two more Seekers for you, but your pockets appear to have lodged a formal complaint.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "Make a little room and come back. I'll keep them here for you. The universe has waited this long to be explored. Another few minutes won't hurt.",
      ],
    ]);
    expect(FIRST_RESONANCE_ECHO.dialogue.capacitySlotsDialogueId).toBe(
      DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity,
    );
    expect(FIRST_RESONANCE_ECHO.dialogue.capacityMassDialogueId).toBe(
      DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity,
    );
    expect(lines(DIALOGUE_IDS.wiseOldEnbyFirstEchoTurnIn)).toEqual([
      [
        EXPRESSION_IDS.friendly,
        "You're back! And judging by that look on your face, I'd say you've found something.",
      ],
      [
        EXPRESSION_IDS.thoughtful,
        "Remarkable, isn't it? One moment, you're standing in an ordinary place on an ordinary planet. The next, you've reached into something we barely understand.",
      ],
      [
        EXPRESSION_IDS.amused,
        "I remember my first successful Echo. Nearly fell out of my chair. Which was particularly impressive, considering I was standing.",
      ],
      [
        EXPRESSION_IDS.thoughtful,
        "You see, that's what makes RuneSpace so fascinating. We can measure its disturbances. We can learn to follow them. And sometimes, we can even retrieve something from the other side.",
      ],
      [
        EXPRESSION_IDS.neutral,
        "But we still don't know why those things are there. Or what decides where they turn up.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "You've done something wonderful today. You've learned that a mystery doesn't have to remain a mystery forever.",
      ],
      [
        EXPRESSION_IDS.amused,
        "Of course, solving one question tends to produce three more. Terrible habit. I've been putting up with it for years.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "Keep exploring. Keep listening. And do come back now and then. It's nice having someone to share the strange bits of the universe with.",
      ],
    ]);
    expect(getDialogue(DIALOGUE_IDS.wiseOldEnbyFirstEchoCompletion)!.beats).toEqual([
      expect.objectContaining({ kind: "skill_xp", skillId: SKILL_IDS.runeworking, amount: 300 }),
    ]);
    expect(lines(DIALOGUE_IDS.wiseOldEnbyAboutResonanceEchoesTopic)).toEqual([
      [
        EXPRESSION_IDS.thoughtful,
        "There are Echoes all over the place, if you know how to listen. And every world has its own peculiar relationship with RuneSpace.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "Your Seekers will keep working long after your first discovery. There's no reason to stop looking.",
      ],
      [
        EXPRESSION_IDS.amused,
        "I certainly haven't. At my age, a good mystery is one of the few things guaranteed to get me out of bed before noon.",
      ],
    ]);
  });

  it("gives the always-available Stillreach topic the Enby's three personal beats, before its unchanged last line", () => {
    expect(lines(DIALOGUE_IDS.wiseOldEnbyStillreachTopic)).toEqual([
      [
        EXPRESSION_IDS.neutral,
        "Stillreach is quiet, as worlds go. I like that. Gives you room to notice the small things.",
      ],
      [
        EXPRESSION_IDS.friendly,
        "The people at the landing station keep the supplies moving. I keep the instruments running. A decent arrangement.",
      ],
      [
        EXPRESSION_IDS.thoughtful,
        "The resonance brought me to Stillreach. That's true, but it's only half an answer.",
      ],
      [
        EXPRESSION_IDS.neutral,
        "Where I lived before, people took an exhausting interest in telling me who I ought to be. Here, I've found room to be myself.",
      ],
      [
        EXPRESSION_IDS.amused,
        "The neighbors still complain, mind you. These days it's about the noise coming from my workshop. A much more reasonable grievance.",
      ],
      [
        EXPRESSION_IDS.thoughtful,
        "Whatever brought you here, don't rush past the hills. There's more to this place than the sky.",
      ],
    ]);
    // Always there, before any Mission and after both, and never a Mission command.
    for (const projections of [
      [],
      [lessonDone, echoProjection({ acceptedAt: NOW })],
      [lessonDone, echoProjection({ acceptedAt: NOW, completedAt: NOW }, 1)],
    ]) {
      const stillreach = resolveNpcConversation(enby, projections).find(
        (entry) => entry.kind === "topic" && entry.label === "Stillreach",
      );
      expect(stillreach).toMatchObject({
        kind: "topic",
        dialogueId: DIALOGUE_IDS.wiseOldEnbyStillreachTopic,
      });
      expect(stillreach).not.toHaveProperty("action");
    }
  });

  it("is spoken by the Enby alone, at the workshop, in their existing expressions", () => {
    for (const id of [
      DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
      DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions,
      DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity,
      DIALOGUE_IDS.wiseOldEnbyFirstEchoReminder,
      DIALOGUE_IDS.wiseOldEnbyFirstEchoTurnIn,
      DIALOGUE_IDS.wiseOldEnbyHowToListenTopic,
      DIALOGUE_IDS.wiseOldEnbyAboutResonanceEchoesTopic,
    ]) {
      const sequence = getDialogue(id)!;
      expect(sequence.npcId).toBe(enby);
      for (const beat of sequence.beats) {
        if (beat.kind === "npc") expect(beat.speakerNpcId).toBe(enby);
      }
    }
  });
});
