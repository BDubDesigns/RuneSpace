import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  getConversationBackground,
  getConversationBackgroundPlaceName,
} from "@/game/content/conversation-backgrounds";
import { getNpcConversationTopics } from "@/game/content/conversation-topics";
import { getDialogue, type DialogueSequence } from "@/game/content/dialogue";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { MISSIONS, NOT_FROM_AROUND_HERE } from "@/game/content/missions";
import { getNpc, getResidentNpcs } from "@/game/content/npcs";
import { resolveNpcConversation, type NpcConversationEntry } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  npcGuidanceMeaning,
  projectMission,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import { cargoRepaired } from "./repair-observation";

/**
 * Issue #389 — the Wise Old Enby at Hilltop Workshop.
 *
 * The person, their art, their ordinary topics, the in-person "Show strange
 * mineral" offer and which revelation they speak, all derived without
 * PostgreSQL or a browser. Not From Around Here's own projection and validation
 * live in not-from-around-here.test.ts; server authority is proven against real
 * PostgreSQL in tests/integration/not-from-around-here.test.ts.
 */

const NOW = new Date("2026-10-22T00:00:00.000Z");
const enby = NPC_IDS.wiseOldEnby;
const hilltop = LOCATION_IDS.hilltopWorkshop;

type Input = { fragments?: number; runestones?: number; hint?: boolean; toll?: boolean };

function observation(input: Input = {}): MissionObservation {
  const progress = new Map<string, number>();
  if (input.hint) progress.set("toll-hint", 1);
  if (input.toll) progress.set("toll-lead", 1);
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map([
      [ITEM_IDS.runeFragment, input.fragments ?? 0],
      [ITEM_IDS.runestone, input.runestones ?? 0],
    ]),
    stackLimits: new Map(),
    itemNames: new Map(),
    trackedProgress: progress,
    repairTargets: cargoRepaired(),
  };
}

function project(
  record: { acceptedAt: Date; completedAt?: Date } | undefined,
  input: Input = {},
  locationId: string = hilltop,
): MissionProjection {
  return projectMission(NOT_FROM_AROUND_HERE, record, locationId, true, observation(input), true);
}

const hub = (projection: MissionProjection) => resolveNpcConversation(enby, [projection]);
const missionEntries = (entries: readonly NpcConversationEntry[]) =>
  entries.filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission",
  );
const topicLabels = (entries: readonly NpcConversationEntry[]) =>
  entries.filter((entry) => entry.kind === "topic").map((entry) => entry.label);

function pngSize(path: string) {
  const buffer = readFileSync(join(process.cwd(), path));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpLossySize(path: string) {
  const buffer = readFileSync(join(process.cwd(), path));
  expect(buffer.toString("ascii", 8, 16)).toBe("WEBPVP8 ");
  return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
}

const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(process.cwd(), path)))
    .digest("hex");

describe("the person at Hilltop Workshop", () => {
  it("is one stable NPC standing at the World Location, not in an invented place", () => {
    const npc = getNpc(enby)!;
    expect(npc.displayName).toBe("The Wise Old Enby");
    expect(npc.homeLocationId).toBe(hilltop);
    expect(npc.localPlaceId).toBeUndefined();
    expect(npc.relocations).toBeUndefined();
    expect(getLocalPlacesForLocation(hilltop)).toEqual([]);
  });

  it("is there for everyone, whatever they have or have not done", () => {
    for (const completed of [
      new Set<string>(),
      new Set([MISSION_IDS.notFromAroundHere]),
      new Set(MISSIONS.map((mission) => mission.id)),
    ]) {
      expect(
        getResidentNpcs({ locationId: hilltop, completedMissionIds: completed }).map(
          (npc) => npc.id,
        ),
      ).toEqual([enby]);
    }
  });

  it("describes the workshop as lived in, with its researcher, and keeps the panorama", () => {
    const location = getLocation(hilltop)!;
    expect(location.description).toContain("Wise Old Enby");
    expect(location.description).not.toMatch(/portrait|render|art direction|aspect/i);
    expect(location.presentation.scene.asset).toBe("/location-scenes/hilltop-workshop.webp");
    expect(location.presentation.mapIconKey).toBe("hilltop_workshop");
    expect(location.presentation.localMap).toEqual({
      axial: { q: 2, r: -1 },
      label: "Hilltop Workshop",
    });
    expect([...location.adjacentLocationIds].sort()).toEqual(
      [LOCATION_IDS.windwardTrack, LOCATION_IDS.theLowHum].sort(),
    );
  });
});

describe("approved art", () => {
  const expressions = ["neutral", "friendly", "thoughtful", "amused"] as const;
  const masters: Record<(typeof expressions)[number], string> = {
    neutral: "eca3c7f8595ea9f65a712bb0114fa8045dfabcdf38debeeab7180dd42a9aa827",
    friendly: "668a7776f3f894dfc082001b58d38f954c1aa4a168885960becf1472719d98ea",
    thoughtful: "c4755d09b6be76cef331f09a022fd728c38b01c4db66f29338a011b22113e323",
    amused: "21503b65f0cc72337d9ba6d99f825ab5fbb0a41f78bc1415c5627eb87beb7559",
  };

  it("maps the four approved portraits onto the shared expression vocabulary", () => {
    const assets = getNpc(enby)!.expressionAssets!;
    expect(Object.keys(assets).sort()).toEqual(
      expressions.map((expression) => EXPRESSION_IDS[expression]).sort(),
    );
    for (const expression of expressions) {
      const asset = assets[EXPRESSION_IDS[expression]]!;
      expect(asset).toBe(`/npc-art/wise-old-enby-${expression}.png`);
      expect(pngSize(`public${asset}`)).toEqual({ width: 400, height: 500 });
      const master = `assets/npc-art/wise-old-enby/wise-old-enby-${expression}-master.png`;
      expect(sha256(master)).toBe(masters[expression]);
      expect(pngSize(master)).toEqual({ width: 1122, height: 1402 });
    }
  });

  it("talks against the dedicated people-free 15:8 interior, labelled by the hill", () => {
    const background = getConversationBackground(
      CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior,
    )!;
    expect(getNpc(enby)!.conversationBackgroundId).toBe(background.id);
    expect(background.locationId).toBe(hilltop);
    expect(background.localPlaceId).toBeUndefined();
    expect(getConversationBackgroundPlaceName(background.id)).toBe("Hilltop Workshop");
    expect(background.asset).toBe("/location-scenes/hilltop-workshop-interior.webp");
    const { width, height } = webpLossySize(`public${background.asset}`);
    expect({ width, height }).toEqual({ width: 1710, height: 912 });
    expect(width * 8).toBe(height * 15);
    const master = "assets/location-scenes/hilltop-workshop-dialogue-interior-master.png";
    expect(sha256(master)).toBe("e98599a6c092df0185119760ef31b888639a501fe3d51dd6694ab04e31782b88");
    expect(pngSize(master)).toEqual({ width: 1717, height: 916 });
  });
});

describe("ordinary conversation", () => {
  it("offers the introduction and two topics to anyone, with or without the mystery", () => {
    for (const projection of [
      project(undefined),
      project(undefined, { fragments: 1 }),
      project({ acceptedAt: NOW }),
    ]) {
      expect(topicLabels(hub(projection))).toEqual(["Introductions", "The workshop", "Stillreach"]);
    }
  });

  it("adds About RuneSpace only once the mystery is solved, as an ordinary topic", () => {
    const done = hub(project({ acceptedAt: NOW, completedAt: NOW }, { fragments: 2 }));
    expect(topicLabels(done)).toEqual([
      "Introductions",
      "The workshop",
      "Stillreach",
      "About RuneSpace",
      // #391: the Mining-level Fragment advice, gated on the same completion.
      "Where to Find Fragments",
    ]);
    // Nothing of this Mission is left: no command, no offer, no follow-up entry.
    // (The lesson it hands on to is covered by first-runeworking-lesson.test.ts.)
    expect(missionEntries(done)).toEqual([]);
    expect(done.every((entry) => !("action" in entry) || entry.action === undefined)).toBe(true);
  });

  it("authors every line for the Enby, in the workshop, with an approved expression", () => {
    const ids = [
      ...getNpcConversationTopics(enby).map((topic) => topic.dialogueId),
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer,
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere,
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent,
    ];
    for (const id of ids) {
      const sequence = getDialogue(id)!;
      expect(sequence.npcId).toBe(enby);
      for (const beat of sequence.beats) {
        expect(beat).toMatchObject({
          kind: "npc",
          speakerNpcId: enby,
          backgroundId: CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior,
          presentationMode: "local",
        });
        if (beat.kind === "npc") {
          expect(getNpc(enby)!.expressionAssets).toHaveProperty(beat.expressionId);
        }
      }
    }
  });

  it("keeps the ordinary topics free of rune instruction and the reveal", () => {
    const text = [
      DIALOGUE_IDS.wiseOldEnbyGreetingTopic,
      DIALOGUE_IDS.wiseOldEnbyWorkshopTopic,
      DIALOGUE_IDS.wiseOldEnbyStillreachTopic,
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer,
    ]
      .flatMap((id) => getDialogue(id)!.beats)
      .map((beat) => (beat.kind === "npc" ? beat.text : ""))
      // The owner-approved personal Stillreach beat (#393) names "the resonance"
      // as half of why the Enby came; it teaches nothing about runes.
      .filter((line) => line !== STILLREACH_RESONANCE_LINE)
      .join(" ");
    expect(text).not.toMatch(/runespace|rune\b|runework|fragment|resonan|echo|seeker/i);
  });

  it("never uses the wrong name, and leaves identity, past and crash cause unspoken", () => {
    const text = [
      ...getNpcConversationTopics(enby).map((topic) => topic.dialogueId),
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer,
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere,
      DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent,
    ]
      .flatMap((id) => getDialogue(id)!.beats)
      .map((beat) => (beat.kind === "npc" ? beat.text : ""))
      .join(" ");
    expect(text).not.toMatch(/wise old man|gielinor|nonbinary|gender|pronoun|crash/i);
  });
});

const STILLREACH_RESONANCE_LINE =
  "The resonance brought me to Stillreach. That's true, but it's only half an answer.";

describe("Not From Around Here at the Enby", () => {
  it("offers the same Mission in person to a visitor carrying either stone", () => {
    for (const input of [{ fragments: 1 }, { runestones: 1 }, { fragments: 3, runestones: 2 }]) {
      const projection = project(undefined, input);
      expect(npcGuidanceMeaning(deriveMissionGuidanceTargets([projection]), enby)).toBe(
        "available",
      );
      const [offer, ...rest] = missionEntries(hub(projection));
      expect(rest).toEqual([]);
      expect(offer).toMatchObject({
        id: `${MISSION_IDS.notFromAroundHere}:offer`,
        missionId: MISSION_IDS.notFromAroundHere,
        label: "Show strange mineral",
        role: "offer",
        guidance: "available",
        dialogueId: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer,
        action: { kind: "accept_mission", label: "Start mission", declineLabel: "Not now" },
      });
      expect(offer!.acceptedContinuation).toBeUndefined();
    }
  });

  it("makes no in-person offer without a carried stone, or once started or solved", () => {
    for (const projection of [
      project(undefined),
      project({ acceptedAt: NOW }, { fragments: 1 }),
      project({ acceptedAt: NOW, completedAt: NOW }, { fragments: 1 }),
    ]) {
      expect(missionEntries(hub(projection)).filter((entry) => entry.role === "offer")).toEqual([]);
    }
    expect(
      npcGuidanceMeaning(deriveMissionGuidanceTargets([project(undefined)]), enby),
    ).toBeUndefined();
  });

  it("never offers it in person anywhere but the hill", () => {
    const elsewhere = project(undefined, { fragments: 1 }, LOCATION_IDS.windwardTrack);
    expect(deriveMissionGuidanceTargets([elsewhere]).availableNpcIds.size).toBe(0);
  });

  it.each([
    ["accepted on Skatboll with no contact", {}],
    ["after a Wade or Tansy hint", { hint: true }],
    ["accepted at the Enby with a carried Fragment", { fragments: 1 }],
    ["accepted at the Enby with an intact Runestone", { runestones: 1 }],
    ["after the stone was sold, stashed or used", {}],
  ] as const)("%s: the direct revelation, finished by I UNDERSTAND", (_, input) => {
    const [entry, ...rest] = missionEntries(hub(project({ acceptedAt: NOW }, input)));
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      role: "turn_in",
      label: "Not From Around Here",
      guidance: "turn_in",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere,
      action: { kind: "complete_mission", label: "I UNDERSTAND" },
    });
  });

  it("opens with Toll only when Toll genuinely sent the player", () => {
    for (const input of [{ toll: true }, { toll: true, hint: true }]) {
      const [entry] = missionEntries(hub(project({ acceptedAt: NOW }, input)));
      expect(entry).toMatchObject({
        role: "turn_in",
        dialogueId: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent,
        action: { kind: "complete_mission", label: "I UNDERSTAND" },
      });
    }
  });

  it("converges both openings on one identical explanation", () => {
    const direct = getDialogue(DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere)!;
    const tollSent = getDialogue(DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent)!;
    const tail = (sequence: DialogueSequence) => sequence.beats.slice(2);
    expect(direct.beats).toHaveLength(10);
    expect(tail(tollSent)).toEqual(tail(direct));
    expect(tail(direct).map((beat) => beat.kind === "npc" && beat.expressionId)).toEqual([
      "thoughtful",
      "neutral",
      "thoughtful",
      "neutral",
      "friendly",
      "amused",
      "thoughtful",
      "friendly",
    ]);
    const last = direct.beats.at(-1)!;
    expect(last.kind === "npc" && last.text).toBe(
      "When you're ready, I'll show you. One step at a time.",
    );
  });
});
