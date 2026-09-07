"use client";

import { useEffect, useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getLocation } from "@/game/content/locations";
import { ScavengeControl } from "./ScavengeControl";
import { deriveJourneyFeed } from "./journey-feed";
import { usePlay } from "@/features/play/PlayContext";

function progressBetween(startedAt: string, arrivesAt: string, now: number): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(arrivesAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

export function JourneyPanel() {
  const { state } = usePlay();
  const travel = state.travelState;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!travel) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [travel]);

  if (!travel) return null;

  const origin = getLocation(travel.originLocationId)?.displayName ?? "origin";
  const destination = getLocation(travel.destinationLocationId)?.displayName ?? "destination";
  const remainingSeconds = Math.max(0, (new Date(travel.arrivesAt).getTime() - now) / 1_000);
  const feed = deriveJourneyFeed(travel, new Date(now));

  return (
    <Panel tone="raised" data-journey-surface>
      <SectionHeader eyebrow="In transit">Journey</SectionHeader>
      <p className="mt-4 text-sm text-[color:var(--rs-text-primary)]">
        Walking from <strong>{origin}</strong> to <strong>{destination}</strong>.
      </p>
      <div className="mt-4" data-travel-progress>
        <StatusMeter
          detail={`${remainingSeconds.toFixed(1)} seconds remaining`}
          label="Journey progress"
          value={progressBetween(travel.startedAt, travel.arrivesAt, now)}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The active work stopped before departure. No new activity can begin until you arrive.
      </p>

      <ol aria-label="Journey events" className="mt-5 space-y-3" data-journey-feed>
        {feed.map((event) => (
          <li
            className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
            data-journey-event={event.kind}
            key={event.id}
          >
            <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
              {event.title}
            </p>
            <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">{event.detail}</p>
            {event.interactive || event.id === "scavenge-claimed" ? <ScavengeControl /> : null}
          </li>
        ))}
      </ol>
      <Feedback tone="muted">Travel timing and outcomes remain server-confirmed.</Feedback>
    </Panel>
  );
}
