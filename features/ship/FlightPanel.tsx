"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { usePlay } from "@/features/play/PlayContext";
import { FlightCinematic } from "@/features/ship/FlightCinematic";
import { flightCountdown, flightProgressPercent } from "@/features/ship/flight";
import { getLocation } from "@/game/content/locations";

/**
 * The Rivet in flight (#358): an authoritative countdown, led by the flight
 * cinematic (#359) — takeoff, a local nav chart, touchdown — which is a
 * presentation layer over the same recorded flight and adds no time to it.
 *
 * Every figure comes from the server's recorded flight, so a reload resumes the
 * remaining time rather than restarting it. When the local clock passes the
 * scheduled arrival the panel says touchdown is pending and unlocks nothing: only
 * the server's next read confirms the landing (`PlayContext` keeps asking), so a
 * fast or slow client clock can neither land the ship early nor strand it.
 *
 * The flight cannot be cancelled, aborted or refunded, so there is no such
 * control. It can be minimized to a single line and reopened; Inventory,
 * Equipment and Missions stay browseable in their own utilities throughout.
 */
export function FlightPanel() {
  const { state } = usePlay();
  const flight = state.ship.flight;
  const [now, setNow] = useState(() => Date.now());
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (!flight) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [flight]);

  if (!flight) return null;

  const origin = getLocation(flight.originLocationId)?.displayName ?? "origin";
  const { remainingSeconds, arrivalPending } = flightCountdown(flight, now);
  const remaining = arrivalPending
    ? "Touchdown pending. Waiting for confirmation."
    : `${remainingSeconds} ${remainingSeconds === 1 ? "second" : "seconds"} remaining`;

  if (minimized) {
    return (
      <Panel
        className="flex flex-wrap items-center justify-between gap-3 !p-3"
        data-flight-minimized
        data-flight-surface
        tone="raised"
      >
        <p className="text-sm text-[color:var(--rs-text-primary)]" data-flight-remaining>
          In flight to <strong>{flight.destinationName}</strong> — {remaining}
        </p>
        <ActionButton data-flight-reopen intent="secondary" onClick={() => setMinimized(false)}>
          OPEN FLIGHT
        </ActionButton>
      </Panel>
    );
  }

  return (
    <Panel data-flight-surface tone="raised">
      <SectionHeader eyebrow="In flight">Rivet flight</SectionHeader>
      <div className="mt-4">
        <FlightCinematic
          destinationName={flight.destinationName}
          flight={flight}
          now={now}
          originName={origin}
        />
      </div>
      <p className="mt-4 text-sm text-[color:var(--rs-text-primary)]" data-flight-route>
        Flying the Rivet Utility Shuttle from <strong>{origin}</strong> to{" "}
        <strong>{flight.destinationName}</strong>.
      </p>
      <div className="mt-4" data-flight-progress>
        <StatusMeter
          detail={remaining}
          label="Flight progress"
          value={arrivalPending ? 100 : flightProgressPercent(flight, now)}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The flight cannot be cancelled. Nothing else can begin until the ship lands, but your
        Inventory, Equipment and Missions can still be browsed.
      </p>
      <div className="mt-4">
        <ActionButton data-flight-minimize intent="secondary" onClick={() => setMinimized(true)}>
          MINIMIZE
        </ActionButton>
      </div>
    </Panel>
  );
}
