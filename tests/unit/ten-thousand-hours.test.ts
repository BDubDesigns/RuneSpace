import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { DIALOGUE_SEQUENCES, getDialogue } from "@/game/content/dialogue";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import { getLocationMerchant, getMerchant, isMerchantOpen } from "@/game/content/merchants";
import {
  getResidentNpcs,
  resolveNpcPlacement,
  resolveNpcVenueBackgroundId,
  getNpc,
} from "@/game/content/npcs";
import { KEEP_THE_CHANGE, MISSIONS, TEN_THOUSAND_HOURS } from "@/game/content/missions";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { resolveNpcConversation } from "@/game/domain/conversation";
import {
  deriveAcceptedMissionIds,
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";

/**
 * Issue #190 — 10,000 Hours, Rusk Recovery, and who owns the offer.
 *
 * The correction this Mission was rebuilt around is the thing most worth
 * pinning down here: Tansy hands off, Wade offers, and acceptance itself is the
 * unlock boundary. Everything that needs a database — the six-Scrap grant, the
 * counter, the 50 Credits — is proven in
 * tests/integration/ten-thousand-hours.test.ts.
 */

const balance = getEffectiveGameBalance();

function observation(practiceWelds = 0): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(),
    stackLimits: new Map(),
    itemNames: new Map([[ITEM_IDS.scrapMetal, "Scrap Metal"]]),
    trackedProgress: new Map([["practice-welds", practiceWelds]]),
  };
}

const accepted = () => ({ acceptedAt: new Date("2026-09-15T00:00:00.000Z") });
const completed = () => ({
  acceptedAt: new Date("2026-09-15T00:00:00.000Z"),
  completedAt: new Date("2026-09-15T01:00:00.000Z"),
});

function project(
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  options: { at?: string; welds?: number; prerequisiteCompleted?: boolean } = {},
): MissionProjection {
  return projectMission(
    TEN_THOUSAND_HOURS,
    mission,
    options.at ?? LOCATION_IDS.ruskRecovery,
    true,
    observation(options.welds ?? 0),
    options.prerequisiteCompleted ?? true,
  );
}

describe("Rusk Recovery is an ordinary World Location", () => {
  it("sits one walking edge northwest of Holo Hollow and nowhere else", () => {
    const rusk = getLocation(LOCATION_IDS.ruskRecovery);
    expect(rusk?.presentation.localMap.axial).toEqual({ q: -2, r: 1 });
    expect(rusk?.adjacentLocationIds).toEqual([LOCATION_IDS.holoHollow]);
    expect(areLocationsAdjacent(LOCATION_IDS.ruskRecovery, LOCATION_IDS.holoHollow)).toBe(true);
    expect(areLocationsAdjacent(LOCATION_IDS.holoHollow, LOCATION_IDS.ruskRecovery)).toBe(true);
    // Reachable on the ordinary adjacent walk; no special duration exists.
    expect(balance.travel.adjacentWalkDurationTicks).toBe(40);
  });

  it("hosts the Workbench and one static scene", () => {
    const rusk = getLocation(LOCATION_IDS.ruskRecovery);
    expect(rusk?.availableActionIds).toContain(ACTION_IDS.practiceWelding);
    expect(rusk?.presentation.scene.asset).toBe("/location-scenes/rusk-recovery.webp");
    const scene = rusk!.presentation.scene;
    expect(scene.width / scene.height).toBe(4);
  });
});

describe("Wade moves to his own yard, derived from the Mission record", () => {
  it("is at the Crash Site until Keep the Change is done, and at the yard after", () => {
    const wade = getNpc(NPC_IDS.wadeRusk)!;
    expect(resolveNpcPlacement(wade, new Set()).locationId).toBe(LOCATION_IDS.crashSite);
    expect(resolveNpcPlacement(wade, new Set([MISSION_IDS.keepTheChange])).locationId).toBe(
      LOCATION_IDS.ruskRecovery,
    );
  });

  it("is only in one place at a time", () => {
    const before = new Set<string>();
    const after = new Set([MISSION_IDS.keepTheChange]);
    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.crashSite, completedMissionIds: before }).map(
        (npc) => npc.id,
      ),
    ).toEqual([NPC_IDS.wadeRusk]);
    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.ruskRecovery, completedMissionIds: before }),
    ).toEqual([]);

    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.crashSite, completedMissionIds: after }),
    ).toEqual([]);
    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.ruskRecovery, completedMissionIds: after }).map(
        (npc) => npc.id,
      ),
    ).toEqual([NPC_IDS.wadeRusk]);
  });

  it("keeps one Wade, with no second shop identity", () => {
    expect(
      MISSIONS.flatMap((mission) => mission.offers).filter(
        (offer) => offer.npcId === NPC_IDS.wadeRusk,
      ).length,
    ).toBeGreaterThan(0);
    expect(getNpc(NPC_IDS.wadeRusk)?.displayName).toBe("Wade Rusk");
  });
});

describe("Tansy hands off; Wade owns the Mission", () => {
  it("ends Keep the Change with Wade naming the yard over comms", () => {
    const beats = getDialogue(DIALOGUE_IDS.tansyKeepTheChangeCompletion)!.beats;
    const wadeBeats = beats.filter(
      (beat) => beat.kind === "npc" && beat.speakerNpcId === NPC_IDS.wadeRusk,
    );
    expect(wadeBeats.length).toBeGreaterThan(0);
    for (const beat of wadeBeats) {
      expect(beat.kind === "npc" && beat.presentationMode).toBe("comms");
      expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard);
    }
    expect(wadeBeats.map((beat) => beat.text).join(" ")).toMatch(/Rusk Recovery/);
  });

  it("offers 10,000 Hours only through Wade, only at his yard", () => {
    expect(TEN_THOUSAND_HOURS.offers).toHaveLength(1);
    expect(TEN_THOUSAND_HOURS.offers[0]).toMatchObject({
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
    });
    // Tansy neither offers it nor turns it in.
    expect(TEN_THOUSAND_HOURS.offers.some((offer) => offer.npcId === NPC_IDS.tansyRusk)).toBe(
      false,
    );
    expect(TEN_THOUSAND_HOURS.turnIn.npcId).toBe(NPC_IDS.wadeRusk);
    expect(TEN_THOUSAND_HOURS.turnIn.locationId).toBe(LOCATION_IDS.ruskRecovery);
  });

  it("is never auto-accepted", () => {
    expect(TEN_THOUSAND_HOURS.continuationMissionId).toBeUndefined();
    expect(KEEP_THE_CHANGE.continuationMissionId).toBeUndefined();
    expect(TEN_THOUSAND_HOURS.prerequisiteMissionId).toBe(MISSION_IDS.keepTheChange);
  });

  it("reveals nothing before the player walks into the yard", () => {
    // Availability is local discovery only: standing anywhere else, a satisfied
    // prerequisite produces no destination, no route, and no Mission Log entry.
    const elsewhere = deriveMissionGuidanceTargets([
      project(undefined, { at: LOCATION_IDS.theJag }),
    ]);
    expect(elsewhere.availableNpcIds.size).toBe(0);
    expect(elsewhere.locationIds.size).toBe(0);

    const atTheYard = deriveMissionGuidanceTargets([project(undefined)]);
    expect(atTheYard.availableNpcIds.has(NPC_IDS.wadeRusk)).toBe(true);
    expect(atTheYard.locationIds.size).toBe(0);
  });
});

describe("acceptance is the whole onboarding", () => {
  it("grants exactly six Scrap Metal through the offer's own acceptance effect", () => {
    expect(TEN_THOUSAND_HOURS.offers[0]?.acceptEffect).toEqual({
      kind: "stack_item",
      itemId: ITEM_IDS.scrapMetal,
      quantity: 6,
    });
    // Three welds' worth, exactly.
    expect(6).toBe(3 * balance.practiceWelding.scrapPerWeld);
  });

  it("authors no mandatory conversation requirement at all", () => {
    expect(TEN_THOUSAND_HOURS.requirements.every((r) => r.kind !== "npc_conversation")).toBe(true);
    expect(TEN_THOUSAND_HOURS.requirements).toHaveLength(1);
  });

  it("presents one shared refusal for both capacity causes", () => {
    const { capacitySlotsDialogueId, capacityMassDialogueId } = TEN_THOUSAND_HOURS.dialogue;
    expect(capacitySlotsDialogueId).toBe(DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal);
    expect(capacityMassDialogueId).toBe(capacitySlotsDialogueId);
    const refusal = getDialogue(DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal)!;
    expect(refusal.npcId).toBe(NPC_IDS.wadeRusk);
    expect(refusal.beats.map((beat) => beat.text).join(" ")).toMatch(/Make room/i);
  });

  it("opens the bench and the Trade counter from the one accepted record", () => {
    expect(RUSK_RECOVERY_CONTENT.practiceAuthorizingMissionId).toBe(MISSION_IDS.tenThousandHours);
    const wadeShop = getMerchant(MERCHANT_IDS.wadeRusk)!;
    expect(wadeShop.authorizingMissionId).toBe(MISSION_IDS.tenThousandHours);

    const beforeAcceptance = deriveAcceptedMissionIds([project(undefined)]);
    expect(isMerchantOpen(wadeShop, beforeAcceptance)).toBe(false);
    expect(isMerchantOpen(wadeShop, deriveAcceptedMissionIds([project(accepted())]))).toBe(true);
    // And it stays open once the Mission is finished.
    expect(isMerchantOpen(wadeShop, deriveAcceptedMissionIds([project(completed())]))).toBe(true);
  });
});

describe("the objective is real Practice welds", () => {
  it("runs offer → 3 welds → return to Wade", () => {
    expect(project(undefined).state).toBe("not_accepted");

    const zero = project(accepted());
    expect(zero.state).toBe("active");
    expect(zero.currentObjective).toBe("Complete 3 Practice Welds — 0 / 3");

    const partway = project(accepted(), { welds: 2 });
    expect(partway.currentObjective).toBe("Complete 3 Practice Welds — 2 / 3");
    expect(partway.stage?.requirementsSatisfied).toBe(false);

    const done = project(accepted(), { welds: 3 });
    expect(done.state).toBe("ready_for_completion");
    expect(done.currentObjective).toBe(TEN_THOUSAND_HOURS.turnIn.objective);
    expect(done.stage?.turnInAvailable).toBe(true);
  });

  it("guides the player to the bench, not to a person", () => {
    const guidance = deriveMissionGuidanceTargets([project(accepted())]);
    expect(guidance.actionIds.has(ACTION_IDS.practiceWelding)).toBe(true);
    expect(guidance.npcIds.has(NPC_IDS.wadeRusk)).toBe(false);

    // Once the welds are done, Wade is the handoff.
    const turnIn = deriveMissionGuidanceTargets([project(accepted(), { welds: 3 })]);
    expect(turnIn.turnInNpcIds.has(NPC_IDS.wadeRusk)).toBe(true);
  });

  it("points a player who is elsewhere back to the yard", () => {
    const guidance = deriveMissionGuidanceTargets([
      project(accepted(), { at: LOCATION_IDS.holoHollow }),
    ]);
    expect(guidance.locationIds.has(LOCATION_IDS.ruskRecovery)).toBe(true);
  });

  it("counts any genuine weld, with no provenance on the Scrap", () => {
    const requirement = TEN_THOUSAND_HOURS.requirements[0];
    expect(requirement).toMatchObject({
      kind: "tracked_activity",
      activity: "practice_welding",
      metric: "attempts",
      target: 3,
      recommendedActionId: ACTION_IDS.practiceWelding,
    });
  });

  it("pays 50 Credits and no second helping of Welding XP", () => {
    expect(TEN_THOUSAND_HOURS.reward).toEqual({ kind: "credits", amount: 50 });
    expect(project(completed()).earnedReward).toEqual({ kind: "credits", amount: 50 });
  });
});

describe("Wade's conversations at the yard", () => {
  it("offers the Mission when the prerequisite is done and it is not yet accepted", () => {
    const entries = resolveNpcConversation(NPC_IDS.wadeRusk, [project(undefined)]);
    const offer = entries.find((entry) => entry.kind === "mission" && entry.role === "offer");
    expect(offer).toBeDefined();
    expect(offer?.kind === "mission" && offer.action?.kind).toBe("accept_mission");
    expect(offer?.kind === "mission" && offer.action?.label).toBe("PICK UP THE TORCH");
  });

  it("presents the turn-in only once the three welds are genuinely done", () => {
    const active = resolveNpcConversation(NPC_IDS.wadeRusk, [project(accepted(), { welds: 1 })]);
    expect(
      active.some((entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission"),
    ).toBe(false);

    const ready = resolveNpcConversation(NPC_IDS.wadeRusk, [project(accepted(), { welds: 3 })]);
    expect(
      ready.some((entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission"),
    ).toBe(true);
  });

  it("speaks every yard beat against the yard's own background", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.wadeTenThousandHoursOffer,
      DIALOGUE_IDS.wadeTenThousandHoursAccepted,
      DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal,
      DIALOGUE_IDS.wadeTenThousandHoursPracticeReminder,
      DIALOGUE_IDS.wadeTenThousandHoursBusy,
      DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
      DIALOGUE_IDS.wadeTenThousandHoursCompletion,
      DIALOGUE_IDS.wadePostTenThousandHours,
    ]) {
      const sequence = getDialogue(dialogueId)!;
      expect(sequence.npcId, dialogueId).toBe(NPC_IDS.wadeRusk);
      for (const beat of sequence.beats) {
        expect(beat.backgroundId, dialogueId).toBe(CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard);
      }
    }
  });

  it("leaves the authored background of his older beats alone", () => {
    // Authoring is never rewritten: a person moving must not retroactively
    // relocate the beats they already spoke. Where a present-tense topic is
    // *presented* is a separate question, proven below.
    const sequence = getDialogue(DIALOGUE_IDS.wadePostKeepTheChange)!;
    for (const beat of sequence.beats) {
      expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.crashSiteExterior);
    }
  });

  it("never speaks game-system language in the onboarding scene", () => {
    const text = getDialogue(DIALOGUE_IDS.wadeTenThousandHoursOffer)!
      .beats.map((beat) => beat.text)
      .join(" ");
    expect(text).not.toMatch(/level|XP|experience|tick/i);
  });
});

describe("a present-tense local conversation follows the speaker", () => {
  const wade = getNpc(NPC_IDS.wadeRusk)!;

  it("resolves Wade's venue from the same Mission record that moves him", () => {
    expect(resolveNpcVenueBackgroundId(wade, new Set())).toBe(
      CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    );
    expect(resolveNpcVenueBackgroundId(wade, new Set([MISSION_IDS.keepTheChange]))).toBe(
      CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
    );
  });

  it("leaves an NPC who has never moved on their authored background", () => {
    const tansy = getNpc(NPC_IDS.tansyRusk)!;
    expect(tansy.relocations).toBeUndefined();
    expect(resolveNpcVenueBackgroundId(tansy, new Set([MISSION_IDS.keepTheChange]))).toBe(
      tansy.conversationBackgroundId,
    );
  });

  it("marks his replayable topic and post-Mission follow-ups as present tense", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.wadeRecoveryWorkTopic,
      DIALOGUE_IDS.wadePostCutYourTeeth,
      DIALOGUE_IDS.wadePostWasteNot,
      DIALOGUE_IDS.wadePostHoldItTogether,
      DIALOGUE_IDS.wadePostKeepTheChange,
    ]) {
      expect(getDialogue(dialogueId)?.presentsAtCurrentVenue, dialogueId).toBe(true);
    }
  });

  it("leaves authored scenes and comms calls fixed where they happened", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.wadeOffer,
      DIALOGUE_IDS.wadeKeepTheChangeOffer,
      DIALOGUE_IDS.wadeTenThousandHoursOffer,
      DIALOGUE_IDS.tansyKeepTheChangeCompletion,
    ]) {
      expect(getDialogue(dialogueId)?.presentsAtCurrentVenue, dialogueId).toBeUndefined();
    }
  });

  it("never lets a present-tense sequence carry a comms beat", () => {
    // The override applies to local beats only, so a sequence that mixes the
    // two would silently keep half its authored framing.
    for (const sequence of DIALOGUE_SEQUENCES) {
      if (!sequence.presentsAtCurrentVenue) continue;
      for (const beat of sequence.beats) {
        expect(beat.kind === "npc" && beat.presentationMode, sequence.id).toBe("local");
      }
    }
  });
});

describe("Wade's Scrap counter", () => {
  it("is a World Location merchant at his own yard", () => {
    expect(getLocationMerchant(LOCATION_IDS.ruskRecovery)?.id).toBe(MERCHANT_IDS.wadeRusk);
    expect(getLocation(LOCATION_IDS.ruskRecovery)?.merchantId).toBe(MERCHANT_IDS.wadeRusk);
    // He has no counter at the pre-progression Crash Site.
    expect(getLocationMerchant(LOCATION_IDS.crashSite)).toBeUndefined();
  });

  it("sells Scrap at four Credits, and buys it back, structural material, but never Slag", () => {
    const wadeShop = getMerchant(MERCHANT_IDS.wadeRusk)!;
    // #230 repriced his Scrap line and gave it a buyback and a daily limit.
    const scrapLine = {
      itemId: ITEM_IDS.scrapMetal,
      buyPrice: 1,
      sellPrice: 4,
      dailySellLimit: 12,
    };
    expect(wadeShop.prices.filter((price) => price.sellPrice !== undefined)).toEqual([scrapLine]);
    expect(wadeShop.prices.filter((price) => price.buyPrice !== undefined)).toEqual([
      scrapLine,
      { itemId: ITEM_IDS.refinedFerrite, buyPrice: 10 },
      { itemId: ITEM_IDS.galvanicStock, buyPrice: 18 },
      { itemId: ITEM_IDS.galvaferrite, buyPrice: 45 },
    ]);
    // Bix remains the one buyer of Slag.
    expect(wadeShop.prices.some((price) => price.itemId === ITEM_IDS.slag)).toBe(false);
  });

  it("leaves Bix's Slag price as the one place Slag is sold", () => {
    const bix = getMerchant(MERCHANT_IDS.bixWeller)!;
    expect(bix.prices.find((price) => price.itemId === ITEM_IDS.slag)?.buyPrice).toBe(1);
    expect(bix.authorizingMissionId).toBeUndefined();
  });
});

describe("registry validation", () => {
  it("accepts the authored registry with 10,000 Hours in it", () => {
    expect(MISSIONS).toContain(TEN_THOUSAND_HOURS);
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("rejects an item grant the acceptance boundary cannot execute", () => {
    expect(() =>
      validateMissionDefinitions([
        {
          ...TEN_THOUSAND_HOURS,
          offers: [
            {
              ...TEN_THOUSAND_HOURS.offers[0]!,
              acceptEffect: { kind: "stack_item", itemId: ITEM_IDS.salvageCutter, quantity: 1 },
            },
          ],
        },
        KEEP_THE_CHANGE,
      ]),
    ).toThrow(/stackable item/);
  });

  it("rejects a non-positive grant quantity", () => {
    expect(() =>
      validateMissionDefinitions([
        {
          ...TEN_THOUSAND_HOURS,
          offers: [
            {
              ...TEN_THOUSAND_HOURS.offers[0]!,
              acceptEffect: { kind: "stack_item", itemId: ITEM_IDS.scrapMetal, quantity: 0 },
            },
          ],
        },
        KEEP_THE_CHANGE,
      ]),
    ).toThrow(/positive integer/);
  });
});
