"use client";

import { useEffect, useId, useRef, useState, useTransition, type MutableRefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { usePlay } from "@/features/play/PlayContext";
import { getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { RESEARCH_ARRIVAL_COPY } from "@/game/content/research-jobs";
import { acknowledgeResearchArrivalAction } from "@/server/actions";

/**
 * The Resonance Calibration arrival modal (#406): a durable, dismissible
 * RuneSpace modal over the actual Crash Site once the passage has committed.
 *
 * It is the shared `Drawer` — the same portal, scrim, focus trap, Escape,
 * outside-tap and fade as every other modal — in the ordinary RuneSpace skin,
 * deliberately not Milky Waymo's vendor styling or its cabin assistant. It
 * appears by itself whenever the server's projection holds a confirmed passage
 * the player has not dismissed, which includes a player returning after a
 * refresh, a reconnect or another device.
 *
 * CONTINUE, Escape and tapping outside are one path: each closes the Drawer and
 * the Drawer's close sends the acknowledgment. That is presentation only. The
 * character was moved by the confirmed passage, independently of this modal; the
 * acknowledgment moves nothing, pays nothing and cannot replay the passage, and
 * the stored receipt is what keeps it dismissed. If the acknowledgment cannot be
 * confirmed the modal comes back with the reason instead of vanishing.
 */
export function ResearchArrivalModal() {
  const { acceptState, enqueueForeground, releaseCommand, state } = usePlay();
  const arrival = state.research.arrival;
  const [mounted, setMounted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const closeHandle: MutableRefObject<(() => void) | null> = useRef(null);
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  if (!mounted || !arrival) return null;
  const planetId = getLocationPlanetId(arrival.destinationLocationId);
  const planetName = planetId ? getPlanetPresentation(planetId).displayName : undefined;

  function acknowledge() {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await acknowledgeResearchArrivalAction({ characterId: state.characterId });
          if ("error" in result) {
            setMessage(result.error);
            setAttempt((current) => current + 1);
            return;
          }
          setMessage(undefined);
          acceptState(result.state);
        } catch {
          setMessage("Comms interruption. The notice is still here; try again.");
          setAttempt((current) => current + 1);
        } finally {
          releaseCommand();
        }
      });
    });
  }

  return (
    <Drawer
      closeHandleRef={closeHandle}
      describedById={descriptionId}
      eyebrow="Resonance Calibration"
      key={attempt}
      label="Resonance Calibration arrival"
      onClose={acknowledge}
      title="Arrival"
    >
      <div data-research-arrival={arrival.arrivedAt}>
        {/* The drawer header ellipsizes long titles, so the approved arrival copy
            sits in the body where a phone shows every word of it. */}
        <p className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
          {RESEARCH_ARRIVAL_COPY.heading}
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)]">
          {planetName ? `Welcome to ${planetName}` : "Welcome"}
        </h2>
        <p
          className="mt-1 font-display text-xl font-bold uppercase tracking-wide text-[color:var(--rs-accent-primary)]"
          data-research-arrival-place
        >
          {arrival.destinationName}
        </p>
        <div className="mt-3 space-y-2" id={descriptionId}>
          <p className="text-sm italic text-[color:var(--rs-text-secondary)]">
            {RESEARCH_ARRIVAL_COPY.atmosphere}
          </p>
          <p className="text-sm font-semibold text-[color:var(--rs-text-primary)]">
            {RESEARCH_ARRIVAL_COPY.completed}
          </p>
        </div>
        <div className="mt-4">
          <ActionButton
            data-research-arrival-continue
            intent="primary"
            onClick={() => closeHandle.current?.()}
          >
            {RESEARCH_ARRIVAL_COPY.continueLabel}
          </ActionButton>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-[color:var(--rs-accent-danger)]" role="alert">
            {message}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
