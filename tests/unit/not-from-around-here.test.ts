import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  PLANET_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import {
  MISSIONS,
  FIRST_RUNEWORKING_LESSON,
  FIRST_RESONANCE_ECHO,
  NOT_FROM_AROUND_HERE,
  getMission,
  type MissionDefinition,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import { getNpcConversationTopics } from "@/game/content/conversation-topics";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { getLocationPlanetId } from "@/game/content/locations";
import {
  deriveCompletedMissionIds,
  deriveMissionGuidanceTargets,
  itemOfferAvailable,
  missionGuidancePhase,
  missionLifecycleMoments,
  projectMission,
  requirementWaived,
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
 * Issues #369 and #389 — Not From Around Here.
 *
 * Everything derivable without PostgreSQL or a browser lives here: the item
 * offer's eligibility, who the player is guided to at every stage (including
 * relocated Wade and Tansy), how a hint narrows guidance on Skatboll, the
 * Stillreach route straight to the Wise Old Enby, conversation routing at every
 * contact, and registry validation. Server authority (atomic and idempotent
 * acceptance by item and in person, the lead command, waived-but-never-recorded
 * Toll progress, exactly-once completion) is proven against real PostgreSQL in
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
  stationary = true,
): MissionProjection {
  return projectMission(
    NOT_FROM_AROUND_HERE,
    record,
    locationId,
    stationary,
    observation(input),
    true,
  );
}

const SKATBOLL_LOCATIONS = Object.values(LOCATION_IDS).filter(
  (id) => getLocationPlanetId(id) === PLANET_IDS.skatboll,
);
const STILLREACH_LOCATIONS = Object.values(LOCATION_IDS).filter(
  (id) => getLocationPlanetId(id) === PLANET_IDS.stillreach,
);

const targets = (projection: MissionProjection) => deriveMissionGuidanceTargets([projection]);

describe("the item offer", () => {
  it("is content, naming the Rune Fragment and carrying all its copy", () => {
    const offer = NOT_FROM_AROUND_HERE.itemOffer!;
    expect(offer.itemIds).toEqual([ITEM_IDS.runeFragment, ITEM_IDS.runestone]);
    expect(offer.inspectLabel).toBe("Inspect");
    expect(offer.description).toContain("resonate beyond ordinary space");
    // The one NPC route is the same offer made in person by the Enby (#389).
    expect(NOT_FROM_AROUND_HERE.offers).toEqual([
      expect.objectContaining({
        npcId: NPC_IDS.wiseOldEnby,
        locationId: LOCATION_IDS.hilltopWorkshop,
        requiresCarriedOfferItem: true,
        subject: "Show strange mineral",
        declineLabel: "Not now",
      }),
    ]);
    expect(NOT_FROM_AROUND_HERE.offers[0]!.acceptEffect).toBeUndefined();
  });

  it("is made by a carried Fragment, wherever the player is", () => {
    for (const locationId of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theJag,
      LOCATION_IDS.holoHollow,
      // Inventory Inspect works on Stillreach too (#389).
      LOCATION_IDS.stillreachLandingStation,
      LOCATION_IDS.hilltopWorkshop,
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
    const [contacts, ...rest] = projection.requirements!;
    expect(rest).toEqual([]);
    expect(contacts!.detail).toBe("Possible contacts: Wade Rusk, Tansy Rusk, Tolliver “Toll” Kade");
    expect(contacts!.leads).toEqual({
      npcIds: [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk],
      followed: false,
    });
    expect(missionGuidancePhase(projection)).toBe("work");
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
    expect(direct.stage?.requirementsSatisfied).toBe(true);
    // A hint without Toll is not progress toward the requirement itself.
    const onlyHint = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    expect(onlyHint.requirements![0]!.satisfied).toBe(false);
    expect(onlyHint.stage?.requirementsSatisfied).toBe(false);
  });
});

describe("after Toll, back on Skatboll", () => {
  const afterToll = (location: string, extra: Input = {}) =>
    project(accepted(), location, { toll: true, ...extra });

  it("points at the researcher on Stillreach and pins no Skatboll contact", () => {
    for (const locationId of SKATBOLL_LOCATIONS) {
      for (const extra of [{}, { hint: true }]) {
        const projection = afterToll(locationId, extra);
        expect(projection.state).toBe("active");
        expect(projection.currentObjective).toBe(
          "Find the researcher at Hilltop Workshop on Stillreach",
        );
        // The Toll row is still listed, as done.
        expect(projection.requirements).toEqual([
          expect.objectContaining({ kind: "npc_conversation", satisfied: true }),
        ]);
        const sets = targets(projection);
        // Nothing on Skatboll's own map: no hex, entrance or person to walk to.
        for (const id of [...sets.locationIds, ...sets.turnInLocationIds]) {
          expect(getLocationPlanetId(id)).toBe(PLANET_IDS.stillreach);
        }
        expect(sets.localPlaceIds.size + sets.turnInLocalPlaceIds.size).toBe(0);
        for (const npcId of [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk, NPC_IDS.tollKade]) {
          expect(sets.npcIds.has(npcId)).toBe(false);
          expect(sets.turnInNpcIds.has(npcId)).toBe(false);
        }
        expect(projection.stage?.turnInAvailable).toBe(false);
      }
    }
  });

  it("survives a refresh: the projection is a pure function of persisted progress", () => {
    const first = afterToll(LOCATION_IDS.holoHollowLanding, { hint: true });
    const reloaded = afterToll(LOCATION_IDS.holoHollowLanding, { hint: true });
    expect(reloaded).toEqual(first);
  });
});

describe("on Stillreach: the Wise Old Enby is the one objective (#389)", () => {
  const states: readonly [string, Input][] = [
    ["accepted with no contact", {}],
    ["after a Wade or Tansy hint", { hint: true }],
    ["after Toll", { toll: true }],
    ["after both", { hint: true, toll: true }],
    ["with no rune material left", { fragments: 0, runestones: 0 }],
  ];

  it("waives Toll's Skatboll conversation there and only there", () => {
    const [toll] = NOT_FROM_AROUND_HERE.requirements;
    for (const id of STILLREACH_LOCATIONS) expect(requirementWaived(toll!, id)).toBe(true);
    for (const id of SKATBOLL_LOCATIONS) expect(requirementWaived(toll!, id)).toBe(false);
  });

  it.each(states)("%s: one Hilltop pin, then the Enby, whether or not Toll was met", (_, input) => {
    for (const locationId of STILLREACH_LOCATIONS) {
      const projection = project(accepted(), locationId, input);
      expect(projection.currentObjective).toBe(
        "Find the researcher at Hilltop Workshop on Stillreach",
      );
      // The waived conversation is not listed: not done, not outstanding.
      expect(projection.requirements).toEqual([]);
      expect(projection.stage?.requirementsSatisfied).toBe(true);
      expect(missionGuidancePhase(projection)).toBe("turn_in");
      const sets = targets(projection);
      expect(sets.locationIds.size + sets.npcIds.size + sets.localPlaceIds.size).toBe(0);
      if (locationId === LOCATION_IDS.hilltopWorkshop) {
        expect(sets.turnInLocationIds.size).toBe(0);
        expect([...sets.turnInNpcIds]).toEqual([NPC_IDS.wiseOldEnby]);
        expect(projection.state).toBe("ready_for_completion");
        expect(projection.stage?.turnInAvailable).toBe(true);
      } else {
        expect([...sets.turnInLocationIds]).toEqual([LOCATION_IDS.hilltopWorkshop]);
        expect(projection.state).toBe("active");
      }
    }
  });

  it("is not ready while the character is busy at the hill", () => {
    const busy = project(accepted(), LOCATION_IDS.hilltopWorkshop, {}, false);
    expect(busy.state).toBe("active");
    expect(busy.stage?.turnInAvailable).toBe(false);
    expect(busy.stage?.requirementsSatisfied).toBe(true);
  });

  it("restores the unfinished Skatboll investigation exactly on the way back", () => {
    // Flying back changes only where the character is; nothing was recorded.
    const away = project(accepted(), LOCATION_IDS.hilltopWorkshop, { hint: true });
    const back = project(accepted(), LOCATION_IDS.holoHollow, { hint: true });
    expect(away.requirements).toEqual([]);
    expect(back.currentObjective).toBe("Ask Tolliver Kade at Last Leg Trading about the fragment");
    expect(back.requirements![0]).toMatchObject({ satisfied: false, leads: { followed: true } });
    expect([...targets(back).npcIds]).toEqual([NPC_IDS.tollKade]);
    const fresh = project(accepted(), LOCATION_IDS.holoHollow);
    expect(targets(fresh).npcIds.size).toBe(3);
  });

  it("reports the Toll fact only when Toll's own marker holds", () => {
    expect(project(accepted(), LOCATION_IDS.hilltopWorkshop, {}).facts).toEqual([]);
    expect(project(accepted(), LOCATION_IDS.hilltopWorkshop, { hint: true }).facts).toEqual([]);
    expect(project(accepted(), LOCATION_IDS.hilltopWorkshop, { toll: true }).facts).toEqual([
      "toll-sent",
    ]);
  });
});

describe("completion and after (#389)", () => {
  it("completes at the Enby with no reward or consumption, and continues into the lesson", () => {
    expect(NOT_FROM_AROUND_HERE.turnIn).toEqual({
      npcId: NPC_IDS.wiseOldEnby,
      locationId: LOCATION_IDS.hilltopWorkshop,
      requiresStationary: true,
      objective: "Find the researcher at Hilltop Workshop on Stillreach",
      dialogueId: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere,
      actionLabel: "I UNDERSTAND",
    });
    expect(NOT_FROM_AROUND_HERE.autoCompletion).toBeUndefined();
    expect(NOT_FROM_AROUND_HERE.reward).toBeUndefined();
    // #391: the next chapter is accepted in the same completion transaction.
    expect(NOT_FROM_AROUND_HERE.continuationMissionId).toBe(MISSION_IDS.firstRuneworkingLesson);
    expect(NOT_FROM_AROUND_HERE.completedNpcDialogue).toBeUndefined();
    expect(
      NOT_FROM_AROUND_HERE.requirements.some(
        (requirement) =>
          requirement.kind === "carried_stack" || requirement.kind === "deferred_stage",
      ),
    ).toBe(false);
  });

  it("reaches only the busy and completion moments: busy declared, completion the lesson", () => {
    expect([...missionLifecycleMoments(NOT_FROM_AROUND_HERE)].sort()).toEqual([
      "busy",
      "completion_presentation",
    ]);
    expect(NOT_FROM_AROUND_HERE.dialogue.omitted?.map((entry) => entry.moment)).toEqual(["busy"]);
    // Its completion flows straight into the lesson it has just accepted (#391).
    expect(NOT_FROM_AROUND_HERE.dialogue.completionPresentationDialogueId).toBe(
      DIALOGUE_IDS.wiseOldEnbyFirstLesson,
    );
  });

  it("is truly Completed afterwards: no objective, guidance, offer or pin, anywhere", () => {
    for (const locationId of [...SKATBOLL_LOCATIONS, ...STILLREACH_LOCATIONS]) {
      const done = project(completedAt(), locationId, { fragments: 3, runestones: 1, hint: true });
      expect(done.state).toBe("completed");
      expect(done.completedAt).toEqual(NOW);
      expect(done.earnedReward).toBeUndefined();
      expect(done.currentObjective).toBeUndefined();
      expect(done.requirements).toBeUndefined();
      expect(done.itemOffer).toBeUndefined();
      expect(done.guidance).toBeUndefined();
    }
  });

  it("hands on to exactly one next chapter, by continuation and by prerequisite, and no phantom", () => {
    // #391 used the seam this Mission left: future completions accept the lesson
    // (continuation), and the completion stamp every earlier finisher already has
    // is what the lesson's own offer reads (prerequisite).
    const done = project(completedAt(), LOCATION_IDS.hilltopWorkshop);
    expect(deriveCompletedMissionIds([done]).has(MISSION_IDS.notFromAroundHere)).toBe(true);
    expect(
      MISSIONS.filter(
        (mission) => mission.prerequisiteMissionId === MISSION_IDS.notFromAroundHere,
      ).map((mission) => mission.id),
    ).toEqual([MISSION_IDS.firstRuneworkingLesson]);
    // The lesson hands on to the next chapter in turn (#393), never back here.
    expect(
      MISSIONS.find((mission) => mission.id === MISSION_IDS.firstRuneworkingLesson)
        ?.continuationMissionId,
    ).toBe(MISSION_IDS.firstResonanceEcho);
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

  it("offers nothing to Toll, Wade or Tansy on the direct Stillreach route", () => {
    // They are on Skatboll; a projection made on Stillreach routes nothing to them.
    const onStillreach = project(accepted(), LOCATION_IDS.hilltopWorkshop);
    for (const npcId of [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk, NPC_IDS.tollKade]) {
      expect(entries(npcId, onStillreach).every((entry) => entry.guidance === undefined)).toBe(
        true,
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
  // Validated beside the lesson it continues into (#391), which is the one other
  // Mission the shipped definition names.
  const validate = (definition: MissionDefinition) => () =>
    validateMissionDefinitions([definition, FIRST_RUNEWORKING_LESSON, FIRST_RESONANCE_ECHO]);
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
  // The deferred stage stays framework vocabulary (#369) after this Mission
  // stopped using it (#389), so it is still proven here on a synthetic shape.
  const deferred = {
    kind: "deferred_stage",
    objective: "Find the researcher at Hilltop Workshop on Stillreach",
  } as const;
  const skatbollOnly = { ...conversation, appliesOnPlanetId: undefined };
  const deferredShape: MissionDefinition = {
    ...NOT_FROM_AROUND_HERE,
    offers: [],
    requirements: [skatbollOnly, deferred],
    turnIn: undefined,
    continuationMissionId: undefined,
    reactiveFacts: undefined,
    dialogue: {},
  };

  it("accepts the shipped Mission beside the lesson it continues into", () => {
    expect(validate(NOT_FROM_AROUND_HERE)).not.toThrow();
  });

  it("requires an item offer, an NPC offer, or a continuation", () => {
    expect(validate({ ...deferredShape, itemOffer: undefined })).toThrow(
      /at least one offer interaction/,
    );
  });

  it("requires an item offer for an in-person item offer, and real labels", () => {
    const [offer] = NOT_FROM_AROUND_HERE.offers;
    expect(validate({ ...NOT_FROM_AROUND_HERE, itemOffer: undefined })).toThrow(
      /requires a carried offer item but authors no item offer/,
    );
    expect(validate({ ...NOT_FROM_AROUND_HERE, offers: [{ ...offer!, subject: " " }] })).toThrow(
      /subject/,
    );
    expect(
      validate({ ...NOT_FROM_AROUND_HERE, offers: [{ ...offer!, declineLabel: "" }] }),
    ).toThrow(/decline label/);
  });

  it("holds a planet-local conversation to its own planet and a turn-in elsewhere", () => {
    expect(
      validate(withRequirements([{ ...conversation, appliesOnPlanetId: PLANET_IDS.stillreach }])),
    ).toThrow(/applies on planet "stillreach" but is met on another/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        turnIn: { ...NOT_FROM_AROUND_HERE.turnIn!, locationId: LOCATION_IDS.holoHollowLanding },
      }),
    ).toThrow(/needs a turn-in on another planet/);
  });

  it("holds a conversation fact to one of the Mission's own conversations", () => {
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        reactiveFacts: [
          {
            key: "toll-sent",
            observes: { kind: "conversation_acknowledged", requirementProgressKey: "toll-hint" },
          },
        ],
      }),
    ).toThrow(/must name one of its own conversation requirements/);
    expect(
      validate({
        ...NOT_FROM_AROUND_HERE,
        reactiveFacts: [
          {
            key: "toll-lead",
            observes: { kind: "conversation_acknowledged", requirementProgressKey: "toll-lead" },
          },
        ],
      }),
    ).toThrow(/is not unique/);
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
    const shape = (requirements: MissionDefinition["requirements"]) =>
      validate({ ...deferredShape, requirements });
    expect(validate(deferredShape)).not.toThrow();
    expect(shape([deferred, skatbollOnly])).toThrow(/must be its last/);
    expect(shape([skatbollOnly, deferred, deferred])).toThrow(/at most one/);
    expect(validate({ ...deferredShape, reward: { kind: "credits", amount: 5 } })).toThrow(
      /cannot author a turn-in, an auto-completion or a reward/,
    );
    expect(
      validate({
        ...deferredShape,
        turnIn: MISSIONS.find((m) => m.turnIn?.npcId === NPC_IDS.rennCalder)!.turnIn,
      }),
    ).toThrow(/cannot author a turn-in/);
    expect(
      validate({ ...deferredShape, dialogue: { busyDialogueId: DIALOGUE_IDS.tollFuelTopic } }),
    ).toThrow(/no turn-in/);
    expect(shape([skatbollOnly, { kind: "deferred_stage", objective: " " }])).toThrow(
      /objective copy/,
    );
  });

  it("rejects malformed leads", () => {
    const leads = conversation.leads!;
    const lead = leads.conversations[0]!;
    const withLeads = (next: typeof leads) => withRequirements([{ ...conversation, leads: next }]);
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
