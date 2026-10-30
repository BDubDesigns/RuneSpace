"use client";

import { useEffect, useId, useRef, useState, useTransition, type MutableRefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { usePlay } from "@/features/play/PlayContext";
import { RUNE_TELEPORT_COPY } from "@/game/content/rune-teleports";
import { acknowledgeRuneTeleportArrivalAction } from "@/server/actions";
import { useTeleportCinematic } from "./TeleportCinematic";

/**
 * The teleport rune's arrival modal (#438): a durable, dismissible RuneSpace
 * modal over the real destination, with the Resonance Calibration arrival's
 * receipt semantics. It appears whenever the server's projection holds a
 * confirmed teleport the player has not dismissed, so a refresh, a reconnect or
 * another device shows it too, and it waits until the cinematic has finished so
 * the destination is never covered by it mid-reveal.
 *
 * CONTINUE, Escape and tapping outside are one path, and the acknowledgment is
 * presentation only: it moves nothing, consumes nothing and cannot replay the
 * teleport. If it cannot be confirmed the modal returns with the reason.
 */
export function RuneTeleportArrivalModal() {
  const { acceptState, enqueueForeground, releaseCommand, state } = usePlay();
  const cinematic = useTeleportCinematic();
  const arrival = state.runeTeleport.arrival;
  const [mounted, setMounted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const closeHandle: MutableRefObject<(() => void) | null> = useRef(null);
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  // One arrival at a time: a pending Resonance Calibration arrival goes first.
  if (!mounted || !arrival || cinematic.active || state.research.arrival) return null;
  // Snapshot the visible receipt before the async callback; a different tab may
  // have already produced a newer arrival by the time this request is handled.
  const displayedIntentId = arrival.intentId;

  function acknowledge() {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await acknowledgeRuneTeleportArrivalAction({
            characterId: state.characterId,
            intentId: displayedIntentId,
          });
          if (result.error || !result.state) {
            setMessage(result.error ?? "Comms interruption. The notice is still here; try again.");
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
      eyebrow="Skatboll TP Rune"
      key={`${arrival.intentId}:${attempt}`}
      label="Teleport arrival"
      onClose={acknowledge}
      title="Arrival"
    >
      <div data-rune-arrival={arrival.arrivedAt}>
        <p className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
          {RUNE_TELEPORT_COPY.arrivalHeading}
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)]">
          {arrival.planetName ? `Welcome to ${arrival.planetName}` : "Welcome"}
        </h2>
        <p
          className="mt-1 font-display text-xl font-bold uppercase tracking-wide text-[color:var(--rs-accent-primary)]"
          data-rune-arrival-place
        >
          {arrival.name}
        </p>
        <div className="mt-3 space-y-2" id={descriptionId}>
          <p className="text-sm italic text-[color:var(--rs-text-secondary)]">
            {RUNE_TELEPORT_COPY.arrivalAtmosphere}
          </p>
        </div>
        <div className="mt-4">
          <ActionButton
            data-rune-arrival-continue
            intent="primary"
            onClick={() => closeHandle.current?.()}
          >
            {RUNE_TELEPORT_COPY.arrivalContinue}
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
