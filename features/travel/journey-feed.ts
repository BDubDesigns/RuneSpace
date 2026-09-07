import type { PlayGameplayState } from "@/server/play";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { scavengeWindowAt } from "@/game/domain/scavenge";

export type JourneyFeedEvent = {
  id: string;
  kind: "status" | "flavor" | "scavenge";
  title: string;
  detail: string;
  interactive?: boolean;
};

type TravelState = NonNullable<PlayGameplayState["travelState"]>;

const ROUTE_FLAVOR: Record<string, string> = {
  [`${LOCATION_IDS.crashSite}:${LOCATION_IDS.abandonedProcessingYard}`]:
    "The old service route cuts through wet scrap and collapsed fencing.",
  [`${LOCATION_IDS.crashSite}:${LOCATION_IDS.emergencyPowerAnnex}`]:
    "The emergency route follows a line of half-buried marker lights.",
  [`${LOCATION_IDS.crashSite}:${LOCATION_IDS.theLongScramble}`]:
    "The ground rises into loose stone and a long, exposed climb.",
  [`${LOCATION_IDS.abandonedProcessingYard}:${LOCATION_IDS.emergencyPowerAnnex}`]:
    "Rust flakes from the yard as the route bends toward the intact depot.",
  [`${LOCATION_IDS.theLongScramble}:${LOCATION_IDS.theJag}`]:
    "The ridge narrows before the ferrite seam comes into view.",
};

function routeFlavor(travel: TravelState): string {
  return (
    ROUTE_FLAVOR[`${travel.originLocationId}:${travel.destinationLocationId}`] ??
    ROUTE_FLAVOR[`${travel.destinationLocationId}:${travel.originLocationId}`] ??
    "The route is quiet except for the sound of your own equipment."
  );
}

export function deriveJourneyFeed(travel: TravelState, now: Date): readonly JourneyFeedEvent[] {
  const origin = getLocation(travel.originLocationId)?.displayName ?? "origin";
  const destination = getLocation(travel.destinationLocationId)?.displayName ?? "destination";
  const timing = scavengeWindowAt({
    claimed: Boolean(travel.scavenge.outcome),
    now,
    opportunityStartTick: travel.scavenge.opportunityStartTick,
    travelStartedAt: new Date(travel.startedAt),
  });
  const events: JourneyFeedEvent[] = [
    {
      detail: `Walking from ${origin} to ${destination}.`,
      id: "departure",
      kind: "status",
      title: "Journey underway",
    },
    {
      detail: routeFlavor(travel),
      id: "route-flavor",
      kind: "flavor",
      title: "Along the route",
    },
  ];

  if (travel.scavenge.outcome) {
    const quantity = travel.scavenge.outcome.quantity;
    events.push({
      detail: `The server confirmed ${quantity} ${travel.scavenge.outcome.label}. The reward reveal is ready.`,
      id: "scavenge-claimed",
      kind: "scavenge",
      title: "Scavenge claimed",
    });
  } else if (timing.lifecycle === "available") {
    events.push({
      detail: "An optional find is available. Claiming it does not change your walking time.",
      id: "scavenge-available",
      interactive: true,
      kind: "scavenge",
      title: "Something turned up",
    });
  } else if (timing.lifecycle === "missed") {
    events.push({
      detail: "The optional find passed by. Travel continues normally.",
      id: "scavenge-missed",
      kind: "scavenge",
      title: "Scavenge missed",
    });
  } else {
    events.push({
      detail: "An optional find may appear during this Travel leg.",
      id: "scavenge-waiting",
      kind: "scavenge",
      title: "Optional find ahead",
    });
  }

  return events;
}
