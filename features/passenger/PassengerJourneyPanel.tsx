"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { usePlay } from "@/features/play/PlayContext";
import { CabinAssistant } from "@/features/passenger/CabinAssistant";
import { FlightCinematic } from "@/features/ship/FlightCinematic";
import { flightCountdown, flightProgressPercent } from "@/features/ship/flight";
import { getLocation } from "@/game/content/locations";

/**
 * A Milky Waymo passenger journey in the air (#404): the existing interplanetary
 * flight cinematic, flown by the shuttle in place of the Rivet, with the cabin
 * assistant under the chart.
 *
 * It is a presentation of the server's recorded journey and nothing else, built
 * the way the Rivet's `FlightPanel` is: every figure, the cinematic's phase and
 * the cabin announcement are derived from the journey's own start and arrival
 * instants, so a reload resumes where the journey is. Passing the scheduled
 * arrival on the local clock lands nothing; it says arrival is pending and the
 * server's next read confirms it (`PlayContext` keeps asking). There is no cancel
 * and no pilot control: the shuttle flies itself.
 */
export function PassengerJourneyPanel() {
  const { state } = usePlay();
  const journey = state.passenger.journey;
  const [now, setNow] = useState(() => Date.now());
  // The clock reads the browser, so the cabin line renders only after mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!journey) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [journey]);

  if (!journey) return null;

  const origin = getLocation(journey.originLocationId)?.displayName ?? "origin";
  const { remainingSeconds, arrivalPending } = flightCountdown(journey, now);
  const remaining = arrivalPending
    ? "Arrival pending. Waiting for confirmation."
    : `${remainingSeconds} ${remainingSeconds === 1 ? "second" : "seconds"} remaining`;

  return (
    <Panel data-passenger-journey data-flight-surface tone="raised">
      <SectionHeader eyebrow="In transit">Milky Waymo shuttle</SectionHeader>
      <div className="mt-4">
        <FlightCinematic
          destinationName={journey.destinationName}
          flight={journey}
          now={now}
          originName={origin}
        />
      </div>
      {mounted ? (
        <CabinAssistant destinationName={journey.destinationName} journey={journey} now={now} />
      ) : (
        <div aria-hidden="true" className="mw-cabin" style={{ minHeight: "9rem" }} />
      )}
      <p className="mt-4 text-sm text-[color:var(--rs-text-primary)]" data-passenger-route>
        Riding the Milky Waymo shuttle from <strong>{origin}</strong> to{" "}
        <strong>{journey.destinationName}</strong>.
      </p>
      <div className="mt-4" data-passenger-progress>
        <StatusMeter
          detail={remaining}
          label="Journey progress"
          value={arrivalPending ? 100 : flightProgressPercent(journey, now)}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The journey cannot be cancelled. Your personal ship and its cargo stay where you left them.
        Nothing else can begin until the shuttle lands, but your Inventory, Equipment and Missions
        can still be browsed.
      </p>
    </Panel>
  );
}
