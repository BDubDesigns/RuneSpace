import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
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
