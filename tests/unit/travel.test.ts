import { describe, expect, it } from "vitest";
import { miningActionIds, refiningActionIds } from "@/game/config/balance";
import { LOCATION_IDS } from "@/game/config/foundations";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";
import {
  adjacentWalkDurationTicks,
  planTravel,
  resolveTravel,
  type TravelState,
} from "@/game/domain/travel";

const TICK_MS = 600;
const DURATION_TICKS = 40;

function travel(startedAt: Date): TravelState {
  return {
    originLocationId: LOCATION_IDS.crashSite,
    destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
    mode: "walk",
    startedAt,
    arrivesAt: new Date(startedAt.getTime() + DURATION_TICKS * TICK_MS),
  };
}

describe("issue #40 travel domain", () => {
  it("sources the adjacent walk duration from the authoritative balance (40 ticks / 24s)", () => {
    expect(adjacentWalkDurationTicks()).toBe(40);
    expect(adjacentWalkDurationTicks() * TICK_MS).toBe(24_000);
  });

  it("approves only an adjacent, different, known destination", () => {
    expect(
      planTravel({
        currentLocationId: LOCATION_IDS.crashSite,
        destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
        alreadyTraveling: false,
      }),
    ).toEqual({ ok: true, durationTicks: 40 });

    const same = planTravel({
      currentLocationId: LOCATION_IDS.crashSite,
      destinationLocationId: LOCATION_IDS.crashSite,
      alreadyTraveling: false,
    });
    expect(same.ok).toBe(false);
    expect((same as { reason: string }).reason).toBe("same_location");

    const traveling = planTravel({
      currentLocationId: LOCATION_IDS.crashSite,
      destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
      alreadyTraveling: true,
    });
    expect(traveling.ok).toBe(false);
    expect((traveling as { reason: string }).reason).toBe("already_traveling");

    const unknown = planTravel({
      currentLocationId: LOCATION_IDS.crashSite,
      destinationLocationId: "unknown_place",
      alreadyTraveling: false,
    });
    expect(unknown.ok).toBe(false);
    expect((unknown as { reason: string }).reason).toBe("unknown_destination");
  });

  it("does not update location before the 40-tick duration elapses", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const result = resolveTravel({
      travel: travel(startedAt),
      windowStartsAt: startedAt,
      elapsedTicks: 39,
      alreadyConsumedTicks: 0,
    });
    expect(result.arrived).toBe(false);
    expect(result.consumedTicks).toBe(39);
  });

  it("produces exactly one arrival once the 40-tick duration has elapsed", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const full = resolveTravel({
      travel: travel(startedAt),
      windowStartsAt: startedAt,
      elapsedTicks: 40,
      alreadyConsumedTicks: 0,
    });
    expect(full).toEqual({ arrived: true, consumedTicks: 40 });

    // A long absence (offline cap) still resolves exactly one arrival.
    const overdue = resolveTravel({
      travel: travel(startedAt),
      windowStartsAt: new Date("2026-01-02T00:00:00.000Z"),
      elapsedTicks: 100_000,
      alreadyConsumedTicks: 0,
    });
    expect(overdue).toEqual({ arrived: true, consumedTicks: 40 });
  });
});

describe("every authored work action can be walked away from", () => {
  /**
   * Issue #211 review — the travel-replacement set named `ferriteShaleMining`
   * and the original `refining` action by hand, so generalizing Mining to
   * sources and Refining to recipes (#209) left Galvanite and both tier-2
   * recipes out of it. Walking away from them refused instead of stopping
   * them, reported as the bogus "Another activity is active."
   *
   * The fix is that the set is derived from the same registries every other
   * surface reads. This states the property rather than the three names, so a
   * fourth source or recipe is covered the moment it is authored.
   */
  it("covers every authored Mining source and Refining recipe", () => {
    for (const actionId of [...miningActionIds(), ...refiningActionIds()]) {
      expect(isTravelReplaceableAction(actionId)).toBe(true);
    }
    // A guard on the loop itself: this must be more than the two originals.
    expect([...miningActionIds(), ...refiningActionIds()].length).toBeGreaterThan(2);
  });

  it("still refuses an action that never declared itself replaceable", () => {
    expect(isTravelReplaceableAction("not_a_work_action")).toBe(false);
  });
});
