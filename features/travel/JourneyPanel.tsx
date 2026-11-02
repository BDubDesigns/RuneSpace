"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getLocation } from "@/game/content/locations";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { TRANSPORT_ROUTES } from "@/game/content/transport-routes";
import { Feedback } from "@/components/ui/Feedback";
import { ScavengeControl } from "./ScavengeControl";
import { StopAfterLegControl } from "./StopAfterLegControl";
import { TurnBackControl } from "./TurnBackControl";
import { deriveJourneyFeed, newestJourneyEventsFirst } from "./journey-feed";
import { usePlay } from "@/features/play/PlayContext";

const WALK_MS = getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS;

/** Where each stop of a Route To (#450) stands relative to the leg under way. */
type RouteStopStatus = "passed" | "here" | "next" | "ahead";

function progressBetween(startedAt: string, arrivesAt: string, now: number): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(arrivesAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

export function JourneyPanel() {
  const { serverNowMs, state } = usePlay();
  const travel = state.travelState;
  // Every Journey time is the server's, so it is read on the server's clock (#424).
  const [now, setNow] = useState(serverNowMs);
  const [refusal, setRefusal] = useState<{ startedAt: string; message: string }>();

  useEffect(() => {
    if (!travel) return;
    const timer = window.setInterval(() => setNow(serverNowMs()), 250);
    return () => window.clearInterval(timer);
  }, [serverNowMs, travel]);

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
  // This character's own name for a place (#441), as everywhere else.
  const placeName = (locationId: string) =>
    state.locationStates[locationId]?.displayName ??
    getLocation(locationId)?.displayName ??
    locationId;
  const route = travel.route;
  const routeLegIndex = route ? route.locationIds.indexOf(travel.originLocationId) : -1;
  const routeLegCount = route ? route.locationIds.length - 1 : 0;
  const routeRemainingSeconds = route
    ? remainingSeconds + (route.remainingLocationIds.length * WALK_MS) / 1_000
    : 0;
  const routeStopStatus = (index: number): RouteStopStatus =>
    index < routeLegIndex
      ? "passed"
      : index === routeLegIndex
        ? "here"
        : index === routeLegIndex + 1
          ? "next"
          : "ahead";
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

      {/* Route To (#450): the route as a whole, beside the ordinary leg above.
          The committed location is the leg's origin until the leg arrives, so
          that is where the player stands, and where Turn Back leaves them. */}
      {route ? (
        <section
          aria-label="Route"
          className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
          data-journey-route={route.finalDestinationLocationId}
        >
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
            Route to {placeName(route.finalDestinationLocationId)}
          </p>
          <p
            className="mt-1 text-sm text-[color:var(--rs-text-primary)]"
            data-journey-route-leg={`${routeLegIndex + 1}/${routeLegCount}`}
          >
            Leg {routeLegIndex + 1} of {routeLegCount} · about {Math.ceil(routeRemainingSeconds)}{" "}
            sec of walking left
          </p>
          <ol
            aria-label="Route stops"
            className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
            data-journey-route-path
          >
            {route.locationIds.map((locationId, index) => {
              const stop = routeStopStatus(index);
              return (
                <li
                  className={`flex items-center gap-1.5 ${
                    stop === "here"
                      ? "font-bold text-[color:var(--rs-text-primary)]"
                      : stop === "next"
                        ? "text-[color:var(--rs-accent-secondary)]"
                        : stop === "passed"
                          ? "text-[color:var(--rs-text-muted)] line-through"
                          : "text-[color:var(--rs-text-secondary)]"
                  }`}
                  data-journey-route-stop={stop}
                  key={locationId}
                >
                  <span>
                    {placeName(locationId)}
                    <span className="sr-only">
                      {stop === "here"
                        ? " (you are here)"
                        : stop === "next"
                          ? " (walking there now)"
                          : stop === "passed"
                            ? " (passed)"
                            : ""}
                    </span>
                  </span>
                  {index < route.locationIds.length - 1 ? (
                    <span aria-hidden="true" className="text-[color:var(--rs-text-muted)]">
                      →
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p
            className="mt-2 text-xs text-[color:var(--rs-text-secondary)]"
            data-journey-route-location={travel.originLocationId}
          >
            You are at {origin}. Each leg is an ordinary walk with its own chance to Scavenge.
          </p>
          {route.remainingLocationIds.length > 0 ? (
            <StopAfterLegControl legDestinationName={destination} />
          ) : (
            <p
              className="mt-3 font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]"
              data-journey-route-final-leg
            >
              Final leg — you&apos;ll stop at {destination}.
            </p>
          )}
        </section>
      ) : null}

      {/* Suppression is stated, never merely implied by a missing find (#312). */}
      {travel.scavengeSuppressed ? (
        <div data-journey-scavenge-suppressed>
          <Feedback>
            Scavenge is unavailable on this Journey. Complete a walk to find things along the road
            again.
          </Feedback>
        </div>
      ) : null}

      {/* The server's answer to a refused claim outlives the control that sent it:
          that control leaves the feed the moment its window closes (#424). It is
          this Journey's, so it never carries over to the next one. */}
      {refusal && refusal.startedAt === travel.startedAt ? (
        <div className="mt-4" data-journey-scavenge-refusal>
          <Feedback tone="danger">{refusal.message}</Feedback>
        </div>
      ) : null}

      {/* Reachable here, with the Journey itself, rather than through the Map. */}
      <TurnBackControl
        rideFare={Boolean(rideName)}
        routeNote={route ? `Turn Back ends the route and leaves you at ${origin}.` : undefined}
      />

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
              {event.interactive ? (
                <ScavengeControl
                  onRefusal={(message) =>
                    setRefusal(message ? { startedAt: travel.startedAt, message } : undefined)
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
