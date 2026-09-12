import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { CUT_YOUR_TEETH, KEEP_THE_CHANGE, WALK_IT_OFF, WASTE_NOT } from "@/game/content/missions";
import {
  deriveMissionGuidanceTargets,
  localPlaceGuidanceMeaning,
  npcGuidanceMeaning,
  projectMission,
  type MissionObservation,
} from "@/game/domain/missions";
import {
  resolveNpcConversation,
  type NpcConversationEntry,
  type NpcConversationProjection,
} from "@/game/domain/conversation";

// Issue #143 — generic Mission destination/turn-in guidance across the
// World Location -> Local Place -> interaction boundaries. Proven at the
// domain projection layer only: no mission-ID or objective-prose branching
// exists in any consumer under test here.

const ACCEPTED = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };

/** Adapted from the Cut Your Teeth observation helper in mission-framework.test.ts. */
function cutYourTeethObservation(overrides: Partial<MissionObservation> = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map<string, number>(),
    stackLimits: new Map<string, number>([[ITEM_IDS.ferriteShale, 10]]),
    itemNames: new Map<string, string>([
      [ITEM_IDS.salvageCutter, "Salvage Cutter"],
      [ITEM_IDS.ferriteShale, "Ferrite Shale"],
    ]),
    ...overrides,
  };
}

function wasteNotObservation(overrides: Partial<MissionObservation> = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map<string, number>(),
    stackLimits: new Map<string, number>(),
    itemNames: new Map<string, string>(),
    ...overrides,
  };
}

function keepTheChangeObservation(overrides: Partial<MissionObservation> = {}): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map<string, number>(),
    stackLimits: new Map<string, number>(),
    itemNames: new Map<string, string>([[ITEM_IDS.powerCell, "Power Cell"]]),
    ...overrides,
  };
}

/** Narrows a conversation hub entry to its "mission" variant for a given Mission. */
function findMissionEntry(
  entries: readonly NpcConversationEntry[],
  missionId: string,
): Extract<NpcConversationEntry, { kind: "mission" }> | undefined {
  return entries.find(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission" && entry.missionId === missionId,
  );
}

/** Builds the narrow conversation-hub projection shape from a full MissionProjection. */
function toConversationProjection(
  projection: ReturnType<typeof projectMission>,
): NpcConversationProjection {
  return {
    missionId: projection.missionId,
    state: projection.state,
    prerequisiteSatisfied: projection.prerequisiteSatisfied,
    stage: projection.stage,
    requirements: projection.requirements,
    guidance: projection.guidance,
  };
}

describe("unaccepted prerequisite-satisfied Mission: local discovery only", () => {
  it("advertises only the offering NPC at the offer location, and nothing elsewhere", () => {
    const atOfferLocation = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.theJag,
      true,
      undefined,
      true,
    );
    expect(atOfferLocation.guidance?.availableNpcIds).toEqual([NPC_IDS.tansyRusk]);
    expect(atOfferLocation.guidance?.locationId).toBeUndefined();
    expect(atOfferLocation.guidance?.localPlaceId).toBeUndefined();
    expect(atOfferLocation.guidance?.turnIn).toBeUndefined();

    const elsewhere = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.crashSite,
      true,
      undefined,
      true,
    );
    expect(elsewhere.guidance).toBeUndefined();

    const targets = deriveMissionGuidanceTargets([atOfferLocation]);
    expect([...targets.availableNpcIds]).toEqual([NPC_IDS.tansyRusk]);
    expect(targets.locationIds.size).toBe(0);
    expect(targets.localPlaceIds.size).toBe(0);
    expect(targets.turnInLocationIds.size).toBe(0);
    expect(targets.turnInLocalPlaceIds.size).toBe(0);
  });
});

describe("Walk It Off: remote World Location guidance, then turn-in independent of stationary", () => {
  it("targets The Jag while accepted at the Crash Site", () => {
    const atCrashSite = projectMission(WALK_IT_OFF, ACCEPTED, LOCATION_IDS.crashSite, true);
    expect(atCrashSite.guidance).toEqual({ locationId: LOCATION_IDS.theJag });
  });

  it("becomes turn-in at The Jag whether or not the character is stationary", () => {
    const stationary = projectMission(WALK_IT_OFF, ACCEPTED, LOCATION_IDS.theJag, true);
    expect(stationary.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.tansyRusk });
    expect(stationary.stage?.turnInAvailable).toBe(true);

    const busy = projectMission(WALK_IT_OFF, ACCEPTED, LOCATION_IDS.theJag, false);
    expect(busy.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.tansyRusk });
    expect(busy.stage?.turnInAvailable).toBe(false);
  });
});

describe("Cut Your Teeth: equipment, action, and location boundaries", () => {
  it("guides to equip the Cutter, with no invented location", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      ACCEPTED,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation(),
    );
    expect(projection.guidance).toEqual({ equipmentItemId: ITEM_IDS.salvageCutter });
  });

  it("guides to Mining with no locationId, since The Jag offers it", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      ACCEPTED,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({ equippedItemIds: new Set([ITEM_IDS.salvageCutter]) }),
    );
    expect(projection.guidance).toEqual({ actionId: ACTION_IDS.ferriteShaleMining });
  });

  it("targets The Jag when away, since at_location is the first unmet requirement", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      ACCEPTED,
      LOCATION_IDS.crashSite,
      true,
      cutYourTeethObservation({ equippedItemIds: new Set([ITEM_IDS.salvageCutter]) }),
    );
    expect(projection.guidance).toEqual({ locationId: LOCATION_IDS.theJag });
  });

  it("turns in to Tansy once every requirement holds", () => {
    const projection = projectMission(
      CUT_YOUR_TEETH,
      ACCEPTED,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
        trackedProgress: new Map([["mining-attempts", 5]]),
      }),
    );
    expect(projection.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.tansyRusk });
  });
});

describe("Waste Not: Mission giver and turn-in NPC differ", () => {
  it("guides to Refining plus the Processing Yard while refining progress is zero", () => {
    const atCrashSite = projectMission(
      WASTE_NOT,
      ACCEPTED,
      LOCATION_IDS.crashSite,
      true,
      wasteNotObservation(),
    );
    expect(atCrashSite.guidance).toEqual({
      actionId: ACTION_IDS.refining,
      locationId: LOCATION_IDS.abandonedProcessingYard,
    });
  });

  it("drops the locationId once at the Processing Yard, since it offers Refining", () => {
    const atYard = projectMission(
      WASTE_NOT,
      ACCEPTED,
      LOCATION_IDS.abandonedProcessingYard,
      true,
      wasteNotObservation(),
    );
    expect(atYard.guidance).toEqual({ actionId: ACTION_IDS.refining });
  });

  it("turns in to Wade at the Crash Site once Refining is complete", () => {
    const complete = wasteNotObservation({
      trackedProgress: new Map([["refining-attempts", 5]]),
    });

    const atYard = projectMission(
      WASTE_NOT,
      ACCEPTED,
      LOCATION_IDS.abandonedProcessingYard,
      true,
      complete,
    );
    expect(atYard.guidance).toEqual({
      turnIn: true,
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.crashSite,
    });

    const atCrashSite = projectMission(WASTE_NOT, ACCEPTED, LOCATION_IDS.crashSite, true, complete);
    expect(atCrashSite.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.wadeRusk });
  });
});

describe("Keep the Change: World Location -> Local Place -> NPC handoff, and no invented acquisition", () => {
  it("targets Holo Hollow and Bix while elsewhere, with Bix unmet", () => {
    const projection = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.crashSite,
      true,
      keepTheChangeObservation(),
    );
    expect(projection.guidance).toEqual({
      npcId: NPC_IDS.bixWeller,
      locationId: LOCATION_IDS.holoHollow,
    });
  });

  it("hands off to Bix's shop entrance once in Holo Hollow", () => {
    const projection = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.holoHollow,
      true,
      keepTheChangeObservation(),
    );
    expect(projection.guidance).toEqual({
      npcId: NPC_IDS.bixWeller,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    });
  });

  it("invents no acquisition guidance once Bix is met but Power Cells are still short", () => {
    const bixMetShortOnCells = keepTheChangeObservation({
      trackedProgress: new Map([["bix-introduction", 1]]),
      carriedQuantities: new Map([[ITEM_IDS.powerCell, 1]]),
    });

    const inHoloHollow = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.holoHollow,
      true,
      bixMetShortOnCells,
    );
    expect(inHoloHollow.guidance).toBeUndefined();

    const atCrashSite = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.crashSite,
      true,
      bixMetShortOnCells,
    );
    expect(atCrashSite.guidance).toBeUndefined();

    const atAnnex = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.emergencyPowerAnnex,
      true,
      bixMetShortOnCells,
    );
    expect(atAnnex.guidance).toBeUndefined();
  });

  it("turns in to Tansy at The Jag once every requirement holds — remote, then local", () => {
    const complete = keepTheChangeObservation({
      trackedProgress: new Map([["bix-introduction", 1]]),
      carriedQuantities: new Map([[ITEM_IDS.powerCell, 3]]),
    });

    const inHoloHollow = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.holoHollow,
      true,
      complete,
    );
    expect(inHoloHollow.guidance).toEqual({
      turnIn: true,
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
    });

    const targets = deriveMissionGuidanceTargets([inHoloHollow]);
    expect(targets.turnInLocationIds.has(LOCATION_IDS.theJag)).toBe(true);
    expect(targets.locationIds.has(LOCATION_IDS.theJag)).toBe(false);

    const atTheJag = projectMission(KEEP_THE_CHANGE, ACCEPTED, LOCATION_IDS.theJag, true, complete);
    expect(atTheJag.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.tansyRusk });
  });
});

describe("available and turn-in remain distinct meanings, with deterministic precedence", () => {
  it("keeps a turn-in NPC and an available offer distinct while turn-in wins the presented meaning", () => {
    const targets = deriveMissionGuidanceTargets([
      { guidance: { turnIn: true, npcId: NPC_IDS.tansyRusk } } as any,
      { guidance: { availableNpcIds: [NPC_IDS.tansyRusk] } } as any,
    ]);
    expect(targets.turnInNpcIds.has(NPC_IDS.tansyRusk)).toBe(true);
    expect(targets.availableNpcIds.has(NPC_IDS.tansyRusk)).toBe(true);
    expect(npcGuidanceMeaning(targets, NPC_IDS.tansyRusk)).toBe("turn_in");
  });

  it("resolves an active/turn-in collision on the same NPC to active", () => {
    const targets = deriveMissionGuidanceTargets([
      { guidance: { npcId: NPC_IDS.tansyRusk } } as any,
      { guidance: { turnIn: true, npcId: NPC_IDS.tansyRusk } } as any,
    ]);
    expect(targets.npcIds.has(NPC_IDS.tansyRusk)).toBe(true);
    expect(targets.turnInNpcIds.has(NPC_IDS.tansyRusk)).toBe(true);
    expect(npcGuidanceMeaning(targets, NPC_IDS.tansyRusk)).toBe("active");
  });

  it("gives Local Place meaning the same active-over-turn-in precedence", () => {
    const targets = deriveMissionGuidanceTargets([
      {
        guidance: {
          npcId: NPC_IDS.bixWeller,
          localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        },
      } as any,
      {
        guidance: {
          turnIn: true,
          npcId: NPC_IDS.bixWeller,
          localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        },
      } as any,
    ]);
    expect(targets.localPlaceIds.has(LOCAL_PLACE_IDS.holoHollowSouvenirs)).toBe(true);
    expect(targets.turnInLocalPlaceIds.has(LOCAL_PLACE_IDS.holoHollowSouvenirs)).toBe(true);
    expect(localPlaceGuidanceMeaning(targets, LOCAL_PLACE_IDS.holoHollowSouvenirs)).toBe("active");
  });
});

describe("multi-Mission union is deterministic", () => {
  it("collapses two Missions' active guidance at the same location into one entry", () => {
    const targets = deriveMissionGuidanceTargets([
      { guidance: { locationId: LOCATION_IDS.theJag } } as any,
      { guidance: { locationId: LOCATION_IDS.theJag } } as any,
    ]);
    expect([...targets.locationIds]).toEqual([LOCATION_IDS.theJag]);
  });

  it("keeps both facts when one Mission's active target and another's turn-in collide at one location", () => {
    const targets = deriveMissionGuidanceTargets([
      { guidance: { locationId: LOCATION_IDS.theJag } } as any,
      {
        guidance: { turnIn: true, npcId: NPC_IDS.tansyRusk, locationId: LOCATION_IDS.theJag },
      } as any,
    ]);
    expect(targets.locationIds.has(LOCATION_IDS.theJag)).toBe(true);
    expect(targets.turnInLocationIds.has(LOCATION_IDS.theJag)).toBe(true);
  });
});

describe("conversation hub entries reuse the same guidance meaning", () => {
  it("marks Tansy's Walk It Off entry turn-in at The Jag once requirements hold", () => {
    const projection = projectMission(WALK_IT_OFF, ACCEPTED, LOCATION_IDS.theJag, true);
    const entries = resolveNpcConversation(NPC_IDS.tansyRusk, [
      toConversationProjection(projection),
    ]);
    const entry = findMissionEntry(entries, WALK_IT_OFF.id);
    expect(entry?.role).toBe("turn_in");
    expect(entry?.guidance).toBe("turn_in");
  });

  it("marks Bix's Keep the Change entry active while his mandatory conversation is unmet", () => {
    const projection = projectMission(
      KEEP_THE_CHANGE,
      ACCEPTED,
      LOCATION_IDS.holoHollow,
      true,
      keepTheChangeObservation(),
    );
    const entries = resolveNpcConversation(NPC_IDS.bixWeller, [
      toConversationProjection(projection),
    ]);
    const entry = findMissionEntry(entries, KEEP_THE_CHANGE.id);
    expect(entry?.role).toBe("active");
    expect(entry?.guidance).toBe("active");
  });
});
