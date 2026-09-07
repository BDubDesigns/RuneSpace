import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getScavengeOutcome } from "@/game/content/scavenge";
import type { PlayGameplayState } from "@/server/play";
import {
  deriveJourneyFeed,
  deriveJourneyFlavorBeats,
  getEligibleTravelFlavorPool,
} from "@/features/travel/journey-feed";

type TravelState = NonNullable<PlayGameplayState["travelState"]>;

const startedAt = new Date("2026-01-01T00:00:00.000Z");

function makeTravel(overrides: Partial<TravelState> = {}): TravelState {
  return {
    originLocationId: LOCATION_IDS.crashSite,
    destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
    startedAt: startedAt.toISOString(),
    arrivesAt: new Date(startedAt.getTime() + 30_000).toISOString(),
    scavenge: {
      opportunityStartTick: 3,
      opensAt: new Date(startedAt.getTime() + 1_800).toISOString(),
      expiresAt: new Date(startedAt.getTime() + 4_800).toISOString(),
    },
    ...overrides,
  };
}

function claimedTravel(outcomeId: string): TravelState {
  const outcome = getScavengeOutcome(outcomeId);
  if (!outcome) throw new Error(`Missing test outcome ${outcomeId}`);
  return makeTravel({
    scavenge: {
      opportunityStartTick: 3,
      opensAt: new Date(startedAt.getTime() + 1_800).toISOString(),
      expiresAt: new Date(startedAt.getTime() + 4_800).toISOString(),
      outcome: {
        outcomeId: outcome.id,
        itemId: outcome.itemId,
        label: outcome.label,
        quantity: outcome.quantity,
      },
    },
  });
}

describe("Journey feed presentation", () => {
  it("starts sparse and reveals passive beats only after their temporal thresholds", () => {
    const travel = makeTravel();
    const beats = deriveJourneyFlavorBeats(travel);
    const immediate = deriveJourneyFeed(travel, startedAt);

    expect(immediate.map((event) => event.id)).toEqual(["departure"]);
    expect(immediate.some((event) => event.kind === "flavor")).toBe(false);
    expect(immediate.some((event) => event.kind === "scavenge")).toBe(false);

    const beforeFirst = deriveJourneyFeed(travel, new Date(beats[0]!.presentationAt - 1));
    expect(beforeFirst.some((event) => event.id === beats[0]!.id)).toBe(false);

    const first = deriveJourneyFeed(travel, new Date(beats[0]!.presentationAt));
    expect(first.map((event) => event.id)).toContain(beats[0]!.id);
    expect(first.map((event) => event.id)).not.toContain(beats[1]!.id);

    const second = deriveJourneyFeed(travel, new Date(beats[1]!.presentationAt));
    expect(second.map((event) => event.id)).toEqual([
      "departure",
      "scavenge-missed",
      beats[0]!.id,
      beats[1]!.id,
    ]);
  });

  it("reconstructs the same elapsed Journey beats without reshuffling", () => {
    const travel = makeTravel();
    const beats = deriveJourneyFlavorBeats(travel);
    const now = new Date(beats[1]!.presentationAt + 1);

    expect(deriveJourneyFeed({ ...travel }, now)).toEqual(deriveJourneyFeed(travel, now));
    expect(deriveJourneyFeed(travel, now).filter((event) => event.kind === "flavor")).toHaveLength(
      2,
    );
  });

  it("places passive beats by journey-relative fractions on a 24-second walk", () => {
    const travel = makeTravel({
      arrivesAt: new Date(startedAt.getTime() + 24_000).toISOString(),
    });
    const beats = deriveJourneyFlavorBeats(travel);
    const duration = new Date(travel.arrivesAt).getTime() - startedAt.getTime();

    expect((beats[0]!.presentationAt - startedAt.getTime()) / duration).toBeCloseTo(0.24);
    expect((beats[1]!.presentationAt - startedAt.getTime()) / duration).toBeCloseTo(0.62);
  });

  it("combines general and Holo Hollow pools and varies stable selections between journeys", () => {
    const pool = getEligibleTravelFlavorPool(
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
    );
    expect(pool.some((line) => line.id === "general-gear-creak")).toBe(true);
    expect(pool.some((line) => line.id === "holo-shale-ticks")).toBe(true);
    expect(pool.find((line) => line.id === "general-distant-motion")?.text).toBe(
      "A faint sound comes from somewhere beyond the route.",
    );
    expect(pool.find((line) => line.id === "holo-shale-ticks")?.text).toBe(
      "A few loose stones tick against the ground as you pass.",
    );

    const selections = [0, 1, 2, 3].map((offset) => {
      const journeyStart = new Date(startedAt.getTime() + offset * 60_000);
      return deriveJourneyFlavorBeats(
        makeTravel({
          startedAt: journeyStart.toISOString(),
          arrivesAt: new Date(journeyStart.getTime() + 24_000).toISOString(),
        }),
      )
        .map((beat) => beat.id)
        .join("|");
    });

    expect(new Set(selections).size).toBeGreaterThan(1);
  });

  it("does not silently reuse a directed line for reverse travel", () => {
    const outbound = getEligibleTravelFlavorPool(
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theLongScramble,
    );
    const returnPool = getEligibleTravelFlavorPool(
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.crashSite,
    );
    const outboundLine = outbound.find((line) => line.id === "route-crash-scramble-outbound");

    expect(outboundLine).toBeDefined();
    expect(returnPool.some((line) => line.id === outboundLine?.id)).toBe(false);
    expect(returnPool.some((line) => line.text === outboundLine?.text)).toBe(false);
  });

  it("shows Scavenge only at its existing available or missed lifecycle", () => {
    const beforeWindow = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 1_799));
    expect(beforeWindow.some((event) => event.kind === "scavenge")).toBe(false);

    const available = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 1_800)).find(
      (event) => event.id === "scavenge-available",
    );
    expect(available).toMatchObject({
      detail: "Something turned up along the route.",
      interactive: true,
      kind: "scavenge",
      title: "Something turned up",
    });

    const missed = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 4_800)).find(
      (event) => event.id === "scavenge-missed",
    );
    expect(missed).toMatchObject({
      detail: "The optional find passed by. Travel continues normally.",
      kind: "scavenge",
    });
  });

  it("presents a claimed item outcome without duplicate quantity or a nested control", () => {
    const feed = deriveJourneyFeed(
      claimedTravel("ferrite_shale_2"),
      new Date(startedAt.getTime() + 2_000),
    );
    const event = feed.find((candidate) => candidate.id === "scavenge-claimed");

    expect(event).toMatchObject({
      detail: "Found 2 Ferrite Shale.",
      kind: "scavenge",
      title: "Scavenge result",
    });
    expect(event?.interactive).toBeUndefined();
    expect(event?.detail).not.toContain("Ferrite Shale x2");
    expect(event?.detail).not.toContain("server confirmed");
    expect(event?.detail).not.toContain("reward reveal");
  });

  it("presents zero outcomes without a leading zero quantity", () => {
    const event = deriveJourneyFeed(
      claimedTravel("nothing_burger"),
      new Date(startedAt.getTime() + 2_000),
    ).find((candidate) => candidate.id === "scavenge-claimed");

    expect(event?.detail).toBe("Nothing Burger. Nothing useful this time.");
    expect(event?.detail).not.toMatch(/^0\b/);
  });

  it("does not mutate Travel state while deriving presentation", () => {
    const travel = makeTravel();
    const before = structuredClone(travel);

    deriveJourneyFeed(travel, new Date(startedAt.getTime() + 10_000));

    expect(travel).toEqual(before);
  });
});
