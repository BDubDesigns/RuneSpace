"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getLocation } from "@/game/content/locations";
import { TRANSPORT_ROUTES } from "@/game/content/transport-routes";
import { Feedback } from "@/components/ui/Feedback";
import { ScavengeControl } from "./ScavengeControl";
import { TurnBackControl } from "./TurnBackControl";
import { deriveJourneyFeed, newestJourneyEventsFirst } from "./journey-feed";
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
  // A ride is described as a ride. The mode is authoritative travel state, so
  // the Journey surface can never claim the player is walking when they paid
  // not to be.
  const rideName =
    travel.mode === "walk"
      ? undefined
      : (TRANSPORT_ROUTES.find((route) => route.mode === travel.mode)?.displayName ?? "transport");
  const remainingSeconds = Math.max(0, (new Date(travel.arrivesAt).getTime() - now) / 1_000);
  const feed = newestJourneyEventsFirst(deriveJourneyFeed(travel, new Date(now)));

  return (
    <Panel tone="raised" data-journey-surface>
      <SectionHeader eyebrow="In transit">Journey</SectionHeader>
      <p
        className="mt-4 text-sm text-[color:var(--rs-text-primary)]"
        data-journey-mode={travel.mode}
      >
        {rideName ? (
          <>
            Riding the <strong>{rideName}</strong> from <strong>{origin}</strong> to{" "}
            <strong>{destination}</strong>.
          </>
        ) : (
          <>
            Walking from <strong>{origin}</strong> to <strong>{destination}</strong>.
          </>
        )}
      </p>
      <div className="mt-4" data-travel-progress>
        <StatusMeter
          detail={`${remainingSeconds.toFixed(1)} seconds remaining`}
          label="Journey progress"
          value={progressBetween(travel.startedAt, travel.arrivesAt, now)}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {rideName
          ? "Nothing to do but sit with the crew. No new activity can begin until you arrive."
          : "The active work stopped before departure. No new activity can begin until you arrive."}
      </p>

      {/* Suppression is stated, never merely implied by a missing find (#312). */}
      {travel.scavengeSuppressed ? (
        <div data-journey-scavenge-suppressed>
          <Feedback>
            Scavenge is unavailable on this Journey. Complete a walk to find things along the road
            again.
          </Feedback>
        </div>
      ) : null}

      {/* Reachable here, with the Journey itself, rather than through the Map. */}
      <TurnBackControl rideFare={Boolean(rideName)} />

      {/* Newest first (#240): the latest beat leads, so a live Scavenge control
          is reachable without scrolling past older history, which stays below
          in reverse order. "Latest" is a position, not read/unread state. */}
      <ol aria-label="Journey events" className="mt-5 space-y-3" data-journey-feed>
        {feed.map((event, index) => {
          const latest = index === 0;
          return (
            <li
              className={`border bg-[color:var(--rs-surface-panel)] p-3 ${
                latest
                  ? "border-[color:var(--rs-accent-secondary)]"
                  : "border-[color:var(--rs-border-structural)]"
              }`}
              data-journey-event={event.kind}
              data-journey-latest={latest ? "true" : undefined}
              key={event.id}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
                  {event.title}
                </p>
                {latest ? (
                  <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-secondary)]">
                    Latest
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">{event.detail}</p>
              {event.interactive ? <ScavengeControl /> : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
