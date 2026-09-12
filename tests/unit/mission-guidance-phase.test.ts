import { describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { KEEP_THE_CHANGE, WALK_IT_OFF } from "@/game/content/missions";
import {
  missionGuidancePhase,
  projectMission,
  type MissionObservation,
} from "@/game/domain/missions";

/**
 * The compact Mission strips (#174) read one semantic phase from the Mission
 * projection instead of re-deriving turn-in readiness in the UI: green work
 * while an authored requirement remains, blue turn-in once every requirement
 * holds — wherever the player is, and whether or not they are busy.
 */

const accepted = { acceptedAt: new Date("2026-09-12T00:00:00.000Z") };

function keepTheChangeObservation(input: { cells: number; metBix: boolean }): MissionObservation {
  return {
    equippedItemIds: new Set(),
    carriedQuantities: new Map([[ITEM_IDS.powerCell, input.cells]]),
    stackLimits: new Map([[ITEM_IDS.powerCell, 10]]),
    itemNames: new Map([[ITEM_IDS.powerCell, "Power Cell"]]),
    trackedProgress: new Map([["bix-introduction", input.metBix ? 1 : 0]]),
  };
}

describe("missionGuidancePhase", () => {
  it("is work while an authored requirement remains", () => {
    const projection = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.crashSite, true);
    expect(missionGuidancePhase(projection)).toBe("work");
  });

  it("is turn-in as soon as every requirement holds, even far from the turn-in", () => {
    const remote = projectMission(
      KEEP_THE_CHANGE,
      accepted,
      LOCATION_IDS.holoHollow,
      true,
      keepTheChangeObservation({ cells: 3, metBix: true }),
    );
    expect(remote.stage?.turnInAvailable).toBe(false);
    expect(missionGuidancePhase(remote)).toBe("turn_in");
  });

  it("stays turn-in on arrival and while busy — never flips back to work", () => {
    for (const stationary of [true, false]) {
      const atTheJag = projectMission(
        KEEP_THE_CHANGE,
        accepted,
        LOCATION_IDS.theJag,
        stationary,
        keepTheChangeObservation({ cells: 3, metBix: true }),
      );
      expect(missionGuidancePhase(atTheJag)).toBe("turn_in");
    }
  });

  it("agrees with the guidance projection's turn-in flag in every stage", () => {
    const stages = [
      { cells: 0, metBix: false },
      { cells: 0, metBix: true },
      { cells: 3, metBix: false },
      { cells: 3, metBix: true },
    ];
    for (const stage of stages) {
      for (const locationId of [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.holoHollow,
        LOCATION_IDS.theJag,
      ]) {
        const projection = projectMission(
          KEEP_THE_CHANGE,
          accepted,
          locationId,
          true,
          keepTheChangeObservation(stage),
        );
        expect(missionGuidancePhase(projection) === "turn_in").toBe(
          projection.guidance?.turnIn === true,
        );
      }
    }
  });
});
