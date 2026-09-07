import type { PlayGameplayState } from "@/server/play";
import {
  DIRECTED_ROUTE_TRAVEL_FLAVOR,
  GENERAL_TRAVEL_FLAVOR,
  HOLO_HOLLOW_TRAVEL_FLAVOR,
  type TravelFlavorLine,
} from "@/game/content/travel-flavor";
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

const JOURNEY_FLAVOR_FRACTIONS = [0.24, 0.62] as const;

export type JourneyFlavorBeat = {
  detail: string;
  id: string;
  presentationAt: number;
};

export function getEligibleTravelFlavorPool(
  originLocationId: string,
  destinationLocationId: string,
): readonly TravelFlavorLine[] {
  const origin = getLocation(originLocationId);
  const destination = getLocation(destinationLocationId);
  const lines: TravelFlavorLine[] = [...GENERAL_TRAVEL_FLAVOR];

  if (origin?.region === "holo_hollow" && destination?.region === "holo_hollow") {
    lines.push(...HOLO_HOLLOW_TRAVEL_FLAVOR);
  }

  const directed = DIRECTED_ROUTE_TRAVEL_FLAVOR[`${originLocationId}:${destinationLocationId}`];
  if (directed) lines.push(directed);
  return lines;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function selectDistinctFlavorLines(
  lines: readonly TravelFlavorLine[],
  seed: number,
): readonly TravelFlavorLine[] {
  if (lines.length < 2) return lines;
  const firstIndex = seed % lines.length;
  const secondOffset = 1 + ((seed >>> 8) % (lines.length - 1));
  return [lines[firstIndex]!, lines[(firstIndex + secondOffset) % lines.length]!];
}

export function deriveJourneyFlavorBeats(travel: TravelState): readonly JourneyFlavorBeat[] {
  const startedAt = new Date(travel.startedAt).getTime();
  const arrivesAt = new Date(travel.arrivesAt).getTime();
  const duration = Math.max(0, arrivesAt - startedAt);
  const seed = stableHash(
    [
      travel.originLocationId,
      travel.destinationLocationId,
      travel.startedAt,
      travel.arrivesAt,
    ].join("|"),
  );
  const lines = selectDistinctFlavorLines(
    getEligibleTravelFlavorPool(travel.originLocationId, travel.destinationLocationId),
    seed,
  );

  return lines.map((line, index) => {
    const fraction = JOURNEY_FLAVOR_FRACTIONS[index] ?? JOURNEY_FLAVOR_FRACTIONS.at(-1)!;
    return {
      detail: line.text,
      id: line.id,
      presentationAt: startedAt + duration * fraction,
    };
  });
}

function scavengeResultDetail(outcome: NonNullable<TravelState["scavenge"]["outcome"]>): string {
  const label = outcome.label.replace(/\s+x\d+$/i, "");
  return outcome.quantity > 0
    ? `Found ${outcome.quantity} ${label}.`
    : `${label}. Nothing useful this time.`;
}

export function deriveJourneyFeed(travel: TravelState, now: Date): readonly JourneyFeedEvent[] {
  const origin = getLocation(travel.originLocationId)?.displayName ?? "origin";
  const nowAt = now.getTime();
  const startedAt = new Date(travel.startedAt).getTime();
  const timing = scavengeWindowAt({
    claimed: Boolean(travel.scavenge.outcome),
    now,
    opportunityStartTick: travel.scavenge.opportunityStartTick,
    travelStartedAt: new Date(travel.startedAt),
  });
  const candidates: Array<JourneyFeedEvent & { presentationAt: number; sequence: number }> = [];
  let sequence = 0;
  const addIfReached = (event: JourneyFeedEvent, presentationAt: number) => {
    if (presentationAt <= nowAt)
      candidates.push({ ...event, presentationAt, sequence: sequence++ });
  };

  addIfReached(
    {
      detail: `Leaving ${origin}.`,
      id: "departure",
      kind: "status",
      title: "Journey underway",
    },
    startedAt,
  );

  for (const beat of deriveJourneyFlavorBeats(travel)) {
    addIfReached(
      {
        detail: beat.detail,
        id: beat.id,
        kind: "flavor",
        title: "Along the route",
      },
      beat.presentationAt,
    );
  }

  if (travel.scavenge.outcome) {
    addIfReached(
      {
        detail: scavengeResultDetail(travel.scavenge.outcome),
        id: "scavenge-claimed",
        kind: "scavenge",
        title: "Scavenge result",
      },
      timing.opensAt.getTime(),
    );
  } else if (timing.lifecycle === "available") {
    addIfReached(
      {
        detail: "You notice something off the route worth checking out.",
        id: "scavenge-available",
        interactive: true,
        kind: "scavenge",
        title: "Something catches your eye",
      },
      timing.opensAt.getTime(),
    );
  } else if (timing.lifecycle === "missed") {
    addIfReached(
      {
        detail: "The optional find passed by. Travel continues normally.",
        id: "scavenge-missed",
        kind: "scavenge",
        title: "Scavenge missed",
      },
      timing.expiresAt.getTime(),
    );
  }

  return candidates
    .sort(
      (left, right) => left.presentationAt - right.presentationAt || left.sequence - right.sequence,
    )
    .map(({ presentationAt: _presentationAt, sequence: _sequence, ...event }) => event);
}
