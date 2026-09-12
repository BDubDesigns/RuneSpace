import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { KEEP_THE_CHANGE, WALK_IT_OFF, type MissionDefinition } from "@/game/content/missions";
import type { ContentId } from "@/game/schemas/ids";
import { deriveMissionGuidanceTargets, projectMission } from "@/game/domain/missions";

/**
 * Accepted-Mission guidance toward an NPC who lives inside a Local Place is
 * bridged to that place's entrance at the player's current World Location.
 * Everything here is generic: it is derived from authored NPC placement, never
 * from a mission ID, objective prose, or a particular NPC's name.
 */

const accepted = { acceptedAt: new Date("2026-09-12T00:00:00.000Z") };

/** A synthetic mission whose turn-in NPC is `npcId` at Holo Hollow, with nothing left to do. */
function turnInAtHoloHollow(npcId: ContentId, dialogueId: ContentId): MissionDefinition {
  return {
    id: "synthetic_resident_turn_in" as ContentId,
    title: "Synthetic",
    summary: "Test",
    offers: [{ npcId, locationId: LOCATION_IDS.holoHollow, dialogueId }],
    requirements: [],
    turnIn: {
      npcId,
      locationId: LOCATION_IDS.holoHollow,
      requiresStationary: true,
      objective: "Talk",
      dialogueId,
    },
    reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 10 },
    dialogue: {},
  } as MissionDefinition;
}

describe("Local Place handoff for accepted Mission NPC guidance", () => {
  it("leaves guidance toward an NPC outside any Local Place on that NPC", () => {
    // Walk It Off at The Jag: the turn-in NPC stands at the World Location.
    const projection = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.theJag, true);
    expect(projection.guidance).toEqual({ npcId: NPC_IDS.tansyRusk, turnIn: true });
    const targets = deriveMissionGuidanceTargets([projection]);
    expect(targets.localPlaceIds.size).toBe(0);
    expect(targets.turnInLocalPlaceIds.size).toBe(0);
  });

  it("guides the entrance of the one Local Place holding the target NPC", () => {
    // Keep the Change's current target is Bix, who lives inside his shop.
    const projection = projectMission(KEEP_THE_CHANGE, accepted, LOCATION_IDS.holoHollow, true);
    expect(projection.guidance).toEqual({
      npcId: NPC_IDS.bixWeller,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    });
    const targets = deriveMissionGuidanceTargets([projection]);
    // Exactly that place — unrelated Local Places in town stay unguided.
    expect(targets.localPlaceIds).toEqual(new Set([LOCAL_PLACE_IDS.holoHollowSouvenirs]));
    // Inside the place, the NPC's own interaction carries the guidance.
    expect(targets.npcIds).toEqual(new Set([NPC_IDS.bixWeller]));
  });

  it("guides the World Location, never a Local Place, from another World Location", () => {
    const projection = projectMission(KEEP_THE_CHANGE, accepted, LOCATION_IDS.crashSite, true);
    expect(projection.guidance).toEqual({
      npcId: NPC_IDS.bixWeller,
      locationId: LOCATION_IDS.holoHollow,
    });
    const targets = deriveMissionGuidanceTargets([projection]);
    expect(targets.localPlaceIds.size).toBe(0);
    expect(targets.locationIds).toEqual(new Set([LOCATION_IDS.holoHollow]));
  });

  it("works for any Local Place resident without naming one, including a turn-in", () => {
    const projection = projectMission(
      turnInAtHoloHollow(NPC_IDS.rennCalder, DIALOGUE_IDS.rennLifeHereTopic),
      accepted,
      LOCATION_IDS.holoHollow,
      true,
    );
    expect(projection.guidance).toEqual({
      npcId: NPC_IDS.rennCalder,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
      turnIn: true,
    });
    // A turn-in entrance is its own semantic target, not active work.
    const targets = deriveMissionGuidanceTargets([projection]);
    expect(targets.turnInLocalPlaceIds).toEqual(
      new Set([LOCAL_PLACE_IDS.holoHollowAssistanceCenter]),
    );
    expect(targets.localPlaceIds.size).toBe(0);
  });

  it("never bridges an unaccepted available offer to a Local Place", () => {
    const available = projectMission(
      turnInAtHoloHollow(NPC_IDS.bixWeller, DIALOGUE_IDS.bixTheShopTopic),
      undefined,
      LOCATION_IDS.holoHollow,
      true,
    );
    expect(available.guidance).toEqual({ availableNpcIds: [NPC_IDS.bixWeller] });
    expect(deriveMissionGuidanceTargets([available]).localPlaceIds.size).toBe(0);
  });

  it("hands the World Location target off to the Local Place on arrival", () => {
    const away = deriveMissionGuidanceTargets([
      projectMission(KEEP_THE_CHANGE, accepted, LOCATION_IDS.crashSite, true),
    ]);
    expect(away.locationIds).toEqual(new Set([LOCATION_IDS.holoHollow]));
    expect(away.localPlaceIds.size).toBe(0);
    const arrived = deriveMissionGuidanceTargets([
      projectMission(KEEP_THE_CHANGE, accepted, LOCATION_IDS.holoHollow, true),
    ]);
    // Arriving ends the map destination; the doorway takes over.
    expect(arrived.locationIds.size).toBe(0);
    expect(arrived.localPlaceIds).toEqual(new Set([LOCAL_PLACE_IDS.holoHollowSouvenirs]));
  });
});
