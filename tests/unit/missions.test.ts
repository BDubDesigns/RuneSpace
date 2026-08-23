import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { getConversationBackground } from "@/game/content/conversation-backgrounds";
import { getDialogue, getWalkItOffDialogue, resolveDialogueSpeaker } from "@/game/content/dialogue";
import { WALK_IT_OFF } from "@/game/content/missions";
import { getNpcAtLocation } from "@/game/content/npcs";
import { deriveMissionState, projectMission } from "@/game/domain/missions";
import { planUniqueItemAddition } from "@/game/domain/inventory";
import { getLocation } from "@/game/content/locations";

describe("issue #102 authored NPC and mission boundaries", () => {
  it("keeps Wade and Tansy static at existing locations", () => {
    expect(getNpcAtLocation(LOCATION_IDS.crashSite)?.id).toBe(NPC_IDS.wadeRusk);
    expect(getNpcAtLocation(LOCATION_IDS.theJag)?.id).toBe(NPC_IDS.tansyRusk);
    expect(getLocation("holo_hollow")).toBeUndefined();
  });

  it("keeps conversation backgrounds independently replaceable", () => {
    expect(getConversationBackground(CONVERSATION_BACKGROUND_IDS.crashSiteExterior)?.asset).toBe(
      "/npc-bg.png",
    );
    expect(getConversationBackground(CONVERSATION_BACKGROUND_IDS.theJagExterior)?.asset).toBe(
      "/npc-bg.png",
    );
    expect(WALK_IT_OFF.id).toBe(MISSION_IDS.walkItOff);
  });

  it("uses typed beats and state-specific dialogue without player choices", () => {
    const offer = getWalkItOffDialogue(NPC_IDS.wadeRusk, "not_accepted");
    const completion = getWalkItOffDialogue(NPC_IDS.tansyRusk, "active");
    expect(offer?.action).toBe("accept_mission");
    expect(completion?.action).toBe("complete_mission");
    expect(offer?.beats[0]).toMatchObject({
      speakerNpcId: NPC_IDS.wadeRusk,
      expressionId: expect.any(String),
      text: expect.stringContaining("TEMPORARY COPY"),
    });
    expect(resolveDialogueSpeaker(offer!.beats[0]!)).toMatchObject({
      npc: { id: NPC_IDS.wadeRusk },
      expressionAsset: "/npc.png",
    });
    expect(getDialogue("unknown_dialogue")).toBeUndefined();
  });

  it("derives the four mission states from timestamps, location, and stationary state", () => {
    const acceptedAt = new Date("2026-01-01T00:00:00.000Z");
    const completedAt = new Date("2026-01-01T00:01:00.000Z");
    expect(deriveMissionState({ mission: undefined, ...locationInput() })).toBe("not_accepted");
    expect(deriveMissionState({ mission: { acceptedAt }, ...locationInput() })).toBe("active");
    expect(
      deriveMissionState({
        mission: { acceptedAt },
        relevantLocationId: LOCATION_IDS.theJag,
        currentLocationId: LOCATION_IDS.theJag,
        stationary: true,
      }),
    ).toBe("ready_for_completion");
    expect(deriveMissionState({ mission: { acceptedAt, completedAt }, ...locationInput() })).toBe(
      "completed",
    );
    expect(
      projectMission(WALK_IT_OFF, { acceptedAt }, LOCATION_IDS.crashSite, true).currentObjective,
    ).toBe("Travel to The Jag");
  });
});

describe("unique reward capacity planning", () => {
  it("requires one free slot and the full item mass before insertion", () => {
    expect(
      planUniqueItemAddition({
        inventorySlotsUsed: 8,
        slotCapacity: 8,
        carriedMassGrams: 0,
        maximumCarryCapacityGrams: 50_000,
        itemMassGrams: 5_000,
      }),
    ).toEqual({ ok: false, reason: "slots" });
    expect(
      planUniqueItemAddition({
        inventorySlotsUsed: 7,
        slotCapacity: 8,
        carriedMassGrams: 46_000,
        maximumCarryCapacityGrams: 50_000,
        itemMassGrams: 5_000,
      }),
    ).toEqual({ ok: false, reason: "mass" });
    expect(
      planUniqueItemAddition({
        inventorySlotsUsed: 7,
        slotCapacity: 8,
        carriedMassGrams: 45_000,
        maximumCarryCapacityGrams: 50_000,
        itemMassGrams: 5_000,
      }),
    ).toEqual({ ok: true });
  });
});

function locationInput() {
  return {
    relevantLocationId: LOCATION_IDS.theJag,
    currentLocationId: LOCATION_IDS.crashSite,
    stationary: true,
  };
}
