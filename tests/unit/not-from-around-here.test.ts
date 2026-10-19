import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import {
  MISSIONS,
  NOT_FROM_AROUND_HERE,
  getMission,
  type MissionDefinition,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import { getNpcConversationTopics } from "@/game/content/conversation-topics";
import { resolveNpcConversation } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  itemOfferAvailable,
  missionGuidancePhase,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import { itemOfferForItem } from "@/features/missions/item-offers";
import {
  derivePinnedGuidanceTargets,
  guidancePresentationMissions,
} from "@/features/missions/mission-pins";
import type { PlayGameplayState } from "@/server/play";
import { cargoRepaired } from "./repair-observation";

/**
 * Issue #369 — Not From Around Here.
 *
 * Everything derivable without PostgreSQL or a browser lives here: the item
 * offer's eligibility, who the player is guided to at every stage (including
 * relocated Wade and Tansy), how a hint narrows guidance, the deferred stage
 * with no false turn-in, conversation routing, and registry validation. Server
 * authority (atomic and idempotent acceptance, the lead command, durable
 * progress across a content extension) is proven against real PostgreSQL in
 * tests/integration/not-from-around-here.test.ts.
 */

const NOW = new Date("2026-10-19T00:00:00.000Z");
const accepted = () => ({ acceptedAt: NOW });
const completedAt = () => ({ acceptedAt: NOW, completedAt: NOW });

type Input = {
  fragments?: number;
  runestones?: number;
  hint?: boolean;
  toll?: boolean;
  completed?: readonly string[];
};

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
    completedMissionIds: new Set(input.completed ?? []),
  };
}

function project(
  record: ReturnType<typeof accepted> | ReturnType<typeof completedAt> | undefined,
  locationId: string,
  input: Input = {},
): MissionProjection {
  return projectMission(NOT_FROM_AROUND_HERE, record, locationId, true, observation(input), true);
}

const targets = (projection: MissionProjection) => deriveMissionGuidanceTargets([projection]);

describe("the item offer", () => {
  it("is content, naming the Rune Fragment and carrying all its copy", () => {
    const offer = NOT_FROM_AROUND_HERE.itemOffer!;
    expect(offer.itemIds).toEqual([ITEM_IDS.runeFragment, ITEM_IDS.runestone]);
    expect(offer.inspectLabel).toBe("Inspect");
    expect(offer.description).toContain("resonate beyond ordinary space");
    expect(NOT_FROM_AROUND_HERE.offers).toEqual([]);
  });

  it("is made by a carried Fragment, wherever the player is", () => {
    for (const locationId of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theJag,
      LOCATION_IDS.holoHollow,
    ]) {
      const projection = project(undefined, locationId, { fragments: 1 });
      expect(projection.itemOffer).toEqual({ itemIds: [ITEM_IDS.runeFragment] });
      expect([...targets(projection).availableItemIds]).toEqual([ITEM_IDS.runeFragment]);
    }
  });

  it("is made by an intact Runestone too, and by both together, for the same Mission", () => {
    const stone = project(undefined, LOCATION_IDS.crashSite, { runestones: 1 });
    expect(stone.itemOffer).toEqual({ itemIds: [ITEM_IDS.runestone] });
    expect([...targets(stone).availableItemIds]).toEqual([ITEM_IDS.runestone]);
    const both = project(undefined, LOCATION_IDS.crashSite, { fragments: 2, runestones: 1 });
    expect(both.itemOffer?.itemIds).toEqual([ITEM_IDS.runeFragment, ITEM_IDS.runestone]);
    expect(targets(both).availableItemIds.size).toBe(2);
    for (const itemId of [ITEM_IDS.runeFragment, ITEM_IDS.runestone]) {
      expect(itemOfferForItem({ missions: [both] }, itemId)?.missionId).toBe(
        MISSION_IDS.notFromAroundHere,
      );
    }
  });

  it("is not made without a carried Fragment or Runestone", () => {
    const none = project(undefined, LOCATION_IDS.crashSite, {});
    expect(none.itemOffer).toBeUndefined();
    expect(none.guidance).toBeUndefined();
    expect(targets(none).availableItemIds.size).toBe(0);
  });

  it("is local discovery only: no Mission Log entry, map or objective", () => {
    const projection = project(undefined, LOCATION_IDS.holoHollow, { fragments: 4 });
    expect(projection.state).toBe("not_accepted");
    expect(projection.currentObjective).toBeUndefined();
    expect(projection.requirements).toBeUndefined();
    const sets = targets(projection);
    expect(sets.locationIds.size + sets.turnInLocationIds.size).toBe(0);
    expect(sets.npcIds.size + sets.availableNpcIds.size + sets.localPlaceIds.size).toBe(0);
  });

  it("disappears once accepted and never comes back, with no permanent tint", () => {
    const active = project(accepted(), LOCATION_IDS.crashSite, { fragments: 1, runestones: 1 });
    expect(active.itemOffer).toBeUndefined();
    expect(targets(active).availableItemIds.size).toBe(0);
    const done = project(completedAt(), LOCATION_IDS.crashSite, { fragments: 1 });
    expect(done.itemOffer).toBeUndefined();
    expect(targets(done).availableItemIds.size).toBe(0);
  });

  it("respects an unmet prerequisite exactly as an NPC offer does", () => {
    expect(
      itemOfferAvailable(
        NOT_FROM_AROUND_HERE,
        "not_accepted",
        false,
        observation({ fragments: 1 }),
      ),
    ).toBe(false);
  });

  it("resolves from the projection to the authored copy with no item literal", () => {
    const withOffer = { missions: [project(undefined, LOCATION_IDS.crashSite, { fragments: 1 })] };
    const view = itemOfferForItem(withOffer, ITEM_IDS.runeFragment);
    expect(view?.missionId).toBe(MISSION_IDS.notFromAroundHere);
    expect(view?.missionTitle).toBe("Not From Around Here");
    expect(itemOfferForItem(withOffer, ITEM_IDS.ferriteShale)).toBeUndefined();
    const accepted_ = { missions: [project(accepted(), LOCATION_IDS.crashSite, { fragments: 1 })] };
    expect(itemOfferForItem(accepted_, ITEM_IDS.runeFragment)).toBeUndefined();
  });

  it("is never filtered by pinning, because it is not an accepted Mission", () => {
    const missions = [project(undefined, LOCATION_IDS.crashSite, { fragments: 1 })];
    const state = { missions, unpinnedMissionIds: [MISSION_IDS.notFromAroundHere] };
    expect(guidancePresentationMissions(state as unknown as PlayGameplayState)).toHaveLength(1);
  });
});

describe("the investigation: three contacts, one required", () => {
  it("opens on the authored objective and names all three contacts in the Log", () => {
    const projection = project(accepted(), LOCATION_IDS.crashSite, { fragments: 1 });
    expect(projection.state).toBe("active");
    expect(projection.currentObjective).toBe(
      "Find someone who might recognize the unusual fragment",
    );
    const [contacts, deferred] = projection.requirements!;
    expect(contacts!.detail).toBe("Possible contacts: Wade Rusk, Tansy Rusk, Tolliver “Toll” Kade");
    expect(contacts!.leads).toEqual({
      npcIds: [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk],
      followed: false,
    });
    expect(deferred!.objective).toBe("Find the researcher at Hilltop Workshop on Stillreach");
    expect(deferred!.satisfied).toBe(false);
  });

  it("lights all three contacts' hexes at once and deduplicates a shared hex", () => {
    // Fresh character: Wade at the Crash Site, Tansy at The Jag, Toll at the Landing.
    const fresh = targets(project(accepted(), LOCATION_IDS.holoHollow));
    expect([...fresh.locationIds].sort()).toEqual(
      [LOCATION_IDS.crashSite, LOCATION_IDS.theJag, LOCATION_IDS.holoHollowLanding].sort(),
    );
    expect([...fresh.npcIds].sort()).toEqual(
      [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk, NPC_IDS.tollKade].sort(),
    );

    // Tansy teaching at Wade's yard after Keep the Change and 10,000 Hours: one hex for both.
    const sharedYard = targets(
      project(accepted(), LOCATION_IDS.holoHollow, {
        completed: [MISSION_IDS.keepTheChange, MISSION_IDS.tenThousandHours],
      }),
    );
    expect([...sharedYard.locationIds].sort()).toEqual(
      [LOCATION_IDS.ruskRecovery, LOCATION_IDS.holoHollowLanding].sort(),
    );
    expect(sharedYard.npcIds.has(NPC_IDS.wadeRusk)).toBe(true);
    expect(sharedYard.npcIds.has(NPC_IDS.tansyRusk)).toBe(true);
  });

  it("resolves Wade and Tansy per character through their authored relocations", () => {
    const at = (completed: string[]) =>
      [...targets(project(accepted(), LOCATION_IDS.holoHollow, { completed })).locationIds].sort();
    const landing = LOCATION_IDS.holoHollowLanding;
    // Before any story progress.
    expect(at([])).toEqual([LOCATION_IDS.crashSite, LOCATION_IDS.theJag, landing].sort());
    // Wade moves to his yard when Keep the Change completes; Tansy is still home.
    expect(at([MISSION_IDS.keepTheChange])).toEqual(
      [LOCATION_IDS.ruskRecovery, LOCATION_IDS.theJag, landing].sort(),
    );
    // Tansy goes home again after Break It Down.
    expect(
      at([MISSION_IDS.keepTheChange, MISSION_IDS.tenThousandHours, MISSION_IDS.breakItDown]),
    ).toEqual([LOCATION_IDS.ruskRecovery, LOCATION_IDS.theJag, landing].sort());
  });

  it("hands off from a hex to the NPC and the Local Place entrance on arrival", () => {
    const atLanding = targets(project(accepted(), LOCATION_IDS.holoHollowLanding));
    // Toll lives inside Last Leg Trading, so its entrance carries the guidance.
    expect(atLanding.localPlaceIds.has(LOCAL_PLACE_IDS.lastLegTrading)).toBe(true);
    expect(atLanding.locationIds.has(LOCATION_IDS.holoHollowLanding)).toBe(false);
    // Wade and Tansy are still guided elsewhere.
    expect(atLanding.locationIds.has(LOCATION_IDS.crashSite)).toBe(true);

    const atCrash = targets(project(accepted(), LOCATION_IDS.crashSite));
    expect(atCrash.npcIds.has(NPC_IDS.wadeRusk)).toBe(true);
    expect(atCrash.locationIds.has(LOCATION_IDS.crashSite)).toBe(false);
  });

  it("narrows every surface to Toll alone the moment one hint is recorded", () => {
    const hinted = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    expect(hinted.currentObjective).toBe(
      "Ask Tolliver Kade at Last Leg Trading about the fragment",
    );
    expect(hinted.requirements![0]!.detail).toBeUndefined();
    expect(hinted.requirements![0]!.leads?.followed).toBe(true);
    const sets = targets(hinted);
    expect([...sets.locationIds]).toEqual([LOCATION_IDS.holoHollowLanding]);
    expect([...sets.npcIds]).toEqual([NPC_IDS.tollKade]);
    expect(sets.turnInLocationIds.size).toBe(0);
  });

  it("does not require a hint: Toll alone satisfies the requirement and advances the Mission", () => {
    const direct = project(accepted(), LOCATION_IDS.holoHollowLanding, { toll: true });
    expect(direct.requirements![0]!.satisfied).toBe(true);
    expect(direct.currentObjective).toBe("Find the researcher at Hilltop Workshop on Stillreach");
    // A hint without Toll is not progress toward the requirement itself.
    const onlyHint = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    expect(onlyHint.requirements![0]!.satisfied).toBe(false);
    expect(onlyHint.stage?.requirementsSatisfied).toBe(false);
  });
});

describe("the deferred Stillreach stage", () => {
  const afterToll = (location: string, extra: Input = {}) =>
    project(accepted(), location, { toll: true, ...extra });

  it("stays Active with the authored objective and no false Turn In or Completed", () => {
    for (const locationId of Object.values(LOCATION_IDS)) {
      const projection = afterToll(locationId);
      expect(projection.state).toBe("active");
      expect(projection.currentObjective).toBe(
        "Find the researcher at Hilltop Workshop on Stillreach",
      );
      expect(projection.stage?.turnInAvailable).toBe(false);
      expect(projection.stage?.requirementsSatisfied).toBe(false);
      expect(missionGuidancePhase(projection)).toBe("work");
      expect(projection.completedAt).toBeUndefined();
      expect(projection.earnedReward).toBeUndefined();
    }
  });

  it("projects no guidance target of any kind, anywhere", () => {
    for (const locationId of Object.values(LOCATION_IDS)) {
      const projection = afterToll(locationId, { hint: true });
      expect(projection.guidance).toBeUndefined();
      const sets = targets(projection);
      for (const set of Object.values(sets)) expect(set.size).toBe(0);
    }
  });

  it("survives a refresh: the projection is a pure function of persisted progress", () => {
    const first = afterToll(LOCATION_IDS.holoHollowLanding, { hint: true });
    const reloaded = afterToll(LOCATION_IDS.holoHollowLanding, { hint: true });
    expect(reloaded).toEqual(first);
  });

  it("pays nothing and authors no turn-in, automatic completion, reward or finish", () => {
    expect(NOT_FROM_AROUND_HERE.turnIn).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.autoCompletion).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.reward).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.continuationMissionId).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.completedNpcDialogue).toBeUndefined();
    for (const offer of NOT_FROM_AROUND_HERE.offers) expect(offer.acceptEffect).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.dialogue).toEqual({});
  });

  it("can be extended later without resetting what a character already earned", () => {
    // The seam the Enby slice uses: swap the deferred stage for real requirements.
    const extended: MissionDefinition = {
      ...NOT_FROM_AROUND_HERE,
      requirements: [
        NOT_FROM_AROUND_HERE.requirements[0]!,
        {
          kind: "at_location",
          locationId: LOCATION_IDS.theJag,
          objective: "A later slice's real stage",
        },
      ],
      turnIn: {
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.theJag,
        requiresStationary: true,
        objective: "Later hand-in",
        dialogueId: DIALOGUE_IDS.tansyMiningTopic,
      },
    };
    const reprojected = projectMission(
      extended,
      accepted(),
      LOCATION_IDS.holoHollow,
      true,
      observation({ toll: true, hint: true }),
      true,
    );
    // The earlier requirement is still satisfied from the SAME persisted keys,
    // and the Mission was never reset.
    expect(reprojected.state).toBe("active");
    expect(reprojected.requirements![0]!.satisfied).toBe(true);
    expect(reprojected.currentObjective).toBe("A later slice's real stage");
  });
});

describe("conversation routing", () => {
  const entries = (npcId: string, projection: MissionProjection) =>
    resolveNpcConversation(npcId, [projection]).filter((entry) => entry.kind === "mission");

  it("offers Wade's and Tansy's hint scenes as one-time Mission conversations", () => {
    const projection = project(accepted(), LOCATION_IDS.crashSite);
    const [wade] = entries(NPC_IDS.wadeRusk, projection);
    expect(wade).toMatchObject({
      kind: "mission",
      missionId: MISSION_IDS.notFromAroundHere,
      dialogueId: DIALOGUE_IDS.wadeNotFromAroundHereHint,
      guidance: "active",
      action: {
        kind: "acknowledge_conversation",
        dialogueId: DIALOGUE_IDS.wadeNotFromAroundHereHint,
        label: "WORTH ASKING",
      },
    });
    const [tansy] = entries(NPC_IDS.tansyRusk, projection);
    expect(tansy).toMatchObject({
      dialogueId: DIALOGUE_IDS.tansyNotFromAroundHereHint,
      action: { kind: "acknowledge_conversation", label: "WORTH ASKING" },
    });
  });

  it("offers Toll's required scene from the start, with no hint prerequisite", () => {
    const [toll] = entries(NPC_IDS.tollKade, project(accepted(), LOCATION_IDS.holoHollowLanding));
    expect(toll).toMatchObject({
      dialogueId: DIALOGUE_IDS.tollNotFromAroundHere,
      guidance: "active",
      action: {
        kind: "acknowledge_conversation",
        dialogueId: DIALOGUE_IDS.tollNotFromAroundHere,
      },
    });
  });

  it("stops offering both hint scenes once either hint has been followed", () => {
    const hinted = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    expect(entries(NPC_IDS.wadeRusk, hinted)).toEqual([]);
    expect(entries(NPC_IDS.tansyRusk, hinted)).toEqual([]);
    // Toll is still required, and is the only contact still guided.
    const [toll] = entries(NPC_IDS.tollKade, hinted);
    expect(toll).toMatchObject({ guidance: "active" });
  });

  it("stops offering any scene once Toll has been met, and leaves ordinary topics alone", () => {
    const done = project(accepted(), LOCATION_IDS.holoHollowLanding, { toll: true });
    expect(entries(NPC_IDS.tollKade, done)).toEqual([]);
    expect(entries(NPC_IDS.wadeRusk, done)).toEqual([]);
    // Toll's three ordinary topics are untouched at every stage.
    for (const projection of [
      project(undefined, LOCATION_IDS.holoHollowLanding),
      project(accepted(), LOCATION_IDS.holoHollowLanding),
      done,
    ]) {
      const topics = resolveNpcConversation(NPC_IDS.tollKade, [projection]).filter(
        (entry) => entry.kind === "topic",
      );
      expect(topics.map((topic) => topic.id)).toEqual(
        getNpcConversationTopics(NPC_IDS.tollKade).map((topic) => topic.id),
      );
    }
  });

  it("offers nothing at the three NPCs before the Mission is accepted", () => {
    const unaccepted = project(undefined, LOCATION_IDS.holoHollow, { fragments: 1 });
    for (const npcId of [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk, NPC_IDS.tollKade]) {
      expect(entries(npcId, unaccepted)).toEqual([]);
    }
  });
});

describe("pinning", () => {
  it("hides all guidance when unpinned, without blocking anything", () => {
    const projection = project(accepted(), LOCATION_IDS.holoHollow);
    const pinned = { missions: [projection], unpinnedMissionIds: [] };
    const unpinned = {
      missions: [projection],
      unpinnedMissionIds: [MISSION_IDS.notFromAroundHere],
    };
    expect(
      derivePinnedGuidanceTargets(pinned as unknown as PlayGameplayState).locationIds.size,
    ).toBe(3);
    const hidden = derivePinnedGuidanceTargets(unpinned as unknown as PlayGameplayState);
    for (const set of Object.values(hidden)) expect(set.size).toBe(0);
    // The conversation is still offered; unpinning is presentation only.
    expect(resolveNpcConversation(NPC_IDS.tollKade, [projection])[0]).toMatchObject({
      kind: "mission",
      action: { kind: "acknowledge_conversation" },
    });
  });

  it("keeps a shared highlight when a second pinned Mission also targets the place", () => {
    const toll = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    const other = {
      ...toll,
      missionId: "other",
      guidance: { locationId: LOCATION_IDS.holoHollowLanding },
    } as MissionProjection;
    const state = {
      missions: [toll, other],
      unpinnedMissionIds: [MISSION_IDS.notFromAroundHere],
    } as unknown as PlayGameplayState;
    expect([...derivePinnedGuidanceTargets(state).locationIds]).toEqual([
      LOCATION_IDS.holoHollowLanding,
    ]);
  });
});

describe("authored content", () => {
  it("is registered and passes the production validation", () => {
    expect(getMission(MISSION_IDS.notFromAroundHere)).toBe(NOT_FROM_AROUND_HERE);
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("authors all three scenes for the right speakers, and nothing for the player", () => {
    const wade = getDialogue(DIALOGUE_IDS.wadeNotFromAroundHereHint)!;
    const tansy = getDialogue(DIALOGUE_IDS.tansyNotFromAroundHereHint)!;
    const toll = getDialogue(DIALOGUE_IDS.tollNotFromAroundHere)!;
    expect(wade.npcId).toBe(NPC_IDS.wadeRusk);
    expect(tansy.npcId).toBe(NPC_IDS.tansyRusk);
    expect(toll.npcId).toBe(NPC_IDS.tollKade);
    // Wade and Tansy speak wherever each is standing for this character.
    expect(wade.presentsAtCurrentVenue).toBe(true);
    expect(tansy.presentsAtCurrentVenue).toBe(true);
    for (const sequence of [wade, tansy, toll]) {
      for (const beat of sequence.beats) {
        expect(beat.kind).toBe("npc");
        if (beat.kind === "npc") {
          expect(beat.speakerNpcId).toBe(sequence.npcId);
          expect(getNpc(beat.speakerNpcId)?.expressionAssets).toHaveProperty(beat.expressionId);
        }
      }
    }
  });

  it("never explains the mineral, Runeworking or RuneSpace, and never names the researcher", () => {
    const text = [
      DIALOGUE_IDS.wadeNotFromAroundHereHint,
      DIALOGUE_IDS.tansyNotFromAroundHereHint,
      DIALOGUE_IDS.tollNotFromAroundHere,
    ]
      .flatMap((id) => getDialogue(id)!.beats)
      .map((beat) => (beat.kind === "npc" ? beat.text : ""))
      .join(" ");
    expect(text).not.toMatch(/runeworking|runespace|resonan|enby|crash caus|rune\b/i);
    // The researcher carries no pronoun: none is established for them.
    expect(text).not.toMatch(
      /\b(he|she|they|them|their)\b[^.]*researcher|researcher[^.]*\b(he|she|they)\b/i,
    );
  });

  it("keeps the player silent: every line belongs to an NPC", () => {
    const toll = getDialogue(DIALOGUE_IDS.tollNotFromAroundHere)!;
    expect(toll.beats.every((beat) => beat.kind === "npc")).toBe(true);
  });
});

describe("registry validation", () => {
  const validate = (definition: MissionDefinition) => () =>
    validateMissionDefinitions([definition]);
  const conversation = NOT_FROM_AROUND_HERE.requirements[0]! as Extract<
    MissionDefinition["requirements"][number],
    { kind: "npc_conversation" }
  >;
  const withRequirements = (
    requirements: MissionDefinition["requirements"],
  ): MissionDefinition => ({
    ...NOT_FROM_AROUND_HERE,
    requirements,
  });
  const deferred = NOT_FROM_AROUND_HERE.requirements[1]!;

  it("accepts the shipped Mission standing alone", () => {
    expect(validate(NOT_FROM_AROUND_HERE)).not.toThrow();
  });

  it("requires an item offer, an NPC offer, or a continuation", () => {
    expect(validate({ ...NOT_FROM_AROUND_HERE, itemOffer: undefined })).toThrow(
      /at least one offer interaction/,
    );
  });

  it("rejects an item offer on a non-stackable or unknown item, or with missing copy", () => {
    const offer = NOT_FROM_AROUND_HERE.itemOffer!;
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        itemOffer: { ...offer, itemIds: [ITEM_IDS.salvageCutter] },
      }),
    ).toThrow(/stackable item/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        itemOffer: { ...offer, itemIds: ["no_such_item" as never] },
      }),
    ).toThrow(/unknown item/);
    expect(
      validate({ ...NOT_FROM_AROUND_HERE, itemOffer: { ...offer, acceptLabel: " " } }),
    ).toThrow(/acceptLabel/);
    expect(validate({ ...NOT_FROM_AROUND_HERE, itemOffer: { ...offer, itemIds: [] } })).toThrow(
      /at least one item/,
    );
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        itemOffer: { ...offer, itemIds: [ITEM_IDS.runeFragment, ITEM_IDS.runeFragment] },
      }),
    ).toThrow(/more than once/);
  });

  it("rejects two Missions offered by one item", () => {
    const twin = { ...NOT_FROM_AROUND_HERE, id: "twin_offer" as never };
    expect(() => validateMissionDefinitions([NOT_FROM_AROUND_HERE, twin])).toThrow(
      /one item offers one Mission/,
    );
  });

  it("requires the deferred stage to be last, unique, and alone in having no finish", () => {
    expect(validate(withRequirements([deferred, conversation]))).toThrow(/must be its last/);
    expect(validate(withRequirements([conversation, deferred, deferred]))).toThrow(/at most one/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        reward: { kind: "credits", amount: 5 },
      }),
    ).toThrow(/cannot author a turn-in, an auto-completion or a reward/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        turnIn: MISSIONS.find((m) => m.turnIn?.npcId === NPC_IDS.rennCalder)!.turnIn,
      }),
    ).toThrow(/cannot author a turn-in/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        dialogue: { busyDialogueId: DIALOGUE_IDS.tollFuelTopic },
      }),
    ).toThrow(/no turn-in/);
    expect(
      validate(withRequirements([conversation, { kind: "deferred_stage", objective: " " }])),
    ).toThrow(/objective copy/);
  });

  it("rejects malformed leads", () => {
    const leads = conversation.leads!;
    const lead = leads.conversations[0]!;
    const withLeads = (next: typeof leads) =>
      withRequirements([{ ...conversation, leads: next }, deferred]);
    expect(validate(withLeads({ ...leads, conversations: [] }))).toThrow(/at least one lead/);
    expect(validate(withLeads({ ...leads, progressKey: "Not Valid" }))).toThrow(
      /lowercase hyphenated/,
    );
    expect(validate(withLeads({ ...leads, progressKey: "toll-lead" }))).toThrow(
      /duplicates progress key/,
    );
    expect(validate(withLeads({ ...leads, followedObjective: " " }))).toThrow(/followed objective/);
    expect(
      validate(withLeads({ ...leads, conversations: [{ ...lead, npcId: NPC_IDS.tollKade }] })),
    ).toThrow(/belongs to NPC|required contact/);
    expect(validate(withLeads({ ...leads, conversations: [lead, lead] }))).toThrow(
      /more than once/,
    );
    expect(
      validate(
        withLeads({
          ...leads,
          conversations: [{ ...lead, dialogueId: DIALOGUE_IDS.tansyNotFromAroundHereHint }],
        }),
      ),
    ).toThrow(/belongs to NPC/);
  });
});
