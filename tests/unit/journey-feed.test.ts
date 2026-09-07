import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getScavengeOutcome } from "@/game/content/scavenge";
import type { PlayGameplayState } from "@/server/play";
import { deriveJourneyFeed } from "@/features/travel/journey-feed";

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

describe("Journey feed presentation", () => {
  it("keeps route context and presents a waiting Scavenge event", () => {
    const feed = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 1_000));

    expect(feed.map((event) => event.title)).toEqual([
      "Journey underway",
      "Along the route",
      "Optional find ahead",
    ]);
    expect(feed.some((event) => event.interactive)).toBe(false);
  });

  it("marks the existing authoritative Scavenge opportunity interactive", () => {
    const feed = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 2_000));
    const event = feed.find((candidate) => candidate.id === "scavenge-available");

    expect(event).toMatchObject({
      kind: "scavenge",
      interactive: true,
      title: "Something turned up",
    });
  });

  it("shows a missed opportunity without changing Travel semantics", () => {
    const feed = deriveJourneyFeed(makeTravel(), new Date(startedAt.getTime() + 5_000));
    expect(feed.at(-1)).toMatchObject({
      detail: "The optional find passed by. Travel continues normally.",
      id: "scavenge-missed",
    });
  });

  it("distinguishes a committed outcome from a pending reveal", () => {
    const outcome = getScavengeOutcome("ferrite_shale_2");
    expect(outcome).toBeDefined();
    const claimedTravel = makeTravel({
      scavenge: {
        opportunityStartTick: 3,
        opensAt: new Date(startedAt.getTime() + 1_800).toISOString(),
        expiresAt: new Date(startedAt.getTime() + 4_800).toISOString(),
        outcome: {
          outcomeId: outcome!.id,
          itemId: outcome!.itemId!,
          label: outcome!.label,
          quantity: outcome!.quantity,
        },
      },
    });
    const now = new Date(startedAt.getTime() + 2_000);
    const pendingFeed = deriveJourneyFeed(claimedTravel, now, [
      {
        claimedAt: now.toISOString(),
        itemId: outcome!.itemId,
        label: outcome!.label,
        outcomeId: outcome!.id,
        quantity: outcome!.quantity,
        revealId: "reveal-1",
      },
    ]);
    const pendingEvent = pendingFeed.find((candidate) => candidate.id === "scavenge-claimed");

    expect(pendingEvent).toMatchObject({
      interactive: true,
      kind: "scavenge",
      title: "Scavenge claimed",
    });
    expect(pendingEvent?.detail).toContain("server confirmed Ferrite Shale x2");
    expect(pendingEvent?.detail).toContain("The reward reveal is ready.");
    expect(pendingEvent?.detail).not.toContain("2 Ferrite Shale x2");

    const acknowledgedFeed = deriveJourneyFeed(claimedTravel, now, []);
    const acknowledgedEvent = acknowledgedFeed.find(
      (candidate) => candidate.id === "scavenge-claimed",
    );
    expect(acknowledgedEvent).toMatchObject({ interactive: false });
    expect(acknowledgedEvent?.detail).toContain("No reward reveal is pending.");
    expect(acknowledgedEvent?.detail).not.toContain("The reward reveal is ready.");
  });
});
