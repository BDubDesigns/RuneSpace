"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition, type MutableRefObject } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { TypewriterText } from "@/features/dialogue/TypewriterText";
import { usePlay } from "@/features/play/PlayContext";
import { cabinArrivalAnnouncement } from "@/game/content/cabin-announcements";
import { getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { acknowledgePassengerArrivalAction } from "@/server/actions";

/**
 * The passenger arrival modal (#404): the cabin assistant's fixed sign-off, in
 * Milky Waymo's blue and white, over the dimmed game.
 *
 * It is the existing `Drawer` — the same portal, scrim, focus trap, Escape,
 * outside-tap and fade — in its vendor skin, so it behaves like every other modal
 * in RuneSpace. It appears by itself whenever the server's projection holds a
 * landed journey the player has not disembarked, which includes a player who
 * returns from offline to find the shuttle long since landed. The sign-off types
 * itself, with the blinking cursor, because the modal opening is a line beginning
 * on screen; reduced motion shows it whole, and a screen reader is given the full
 * line as the dialog's description rather than character by character.
 *
 * DISEMBARK, tapping outside and Escape are one path: each closes the Drawer, and
 * the Drawer's close is what sends the existing acknowledgment. That is
 * presentation only. The character was moved when the server landed the journey,
 * independently of this modal, and the acknowledgment lands nothing and changes no
 * Credits, ship or cargo; the stored receipt is what keeps it dismissed across
 * refreshes and devices. If the acknowledgment cannot be confirmed the modal comes
 * back with the reason instead of vanishing.
 */
export function PassengerArrivalModal() {
  const { acceptState, enqueueForeground, releaseCommand, state } = usePlay();
  const notice = state.passenger.arrivalNotice;
  // A portal needs a document, so it first renders after the browser has hydrated.
  const [mounted, setMounted] = useState(false);
  // A new instance after a failed acknowledgment, so the modal is presented afresh.
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const closeHandle: MutableRefObject<(() => void) | null> = useRef(null);
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  if (!mounted || !notice) return null;
  const destinationPlanetId = getLocationPlanetId(notice.destinationLocationId);
  const destinationPlanetName = destinationPlanetId
    ? getPlanetPresentation(destinationPlanetId).displayName
    : undefined;

  function acknowledge() {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await acknowledgePassengerArrivalAction({
            characterId: state.characterId,
          });
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
      eyebrow="Milky Waymo"
      key={attempt}
      label="Milky Waymo arrival"
      onClose={acknowledge}
      title="Arrived"
      variant="vendor"
    >
      <div className="mw-modal" data-passenger-arrival-notice={notice.arrivedAt}>
        <header className="mw-modal__top">
          <Image
            alt="Milky Waymo"
            className="mw-modal__logo"
            height={332}
            src="/branding/milky-waymo-logo.webp"
            width={720}
          />
          <p className="mw-kiosk__tagline">Interplanetary Passenger Services</p>
        </header>
        <div className="mw-modal__screen">
          {destinationPlanetName ? (
            <p className="mw-kiosk__eyebrow" data-passenger-arrival-planet>
              {notice.destinationName} · {destinationPlanetName}
            </p>
          ) : null}
          <h2 className="mw-kiosk__eyebrow" data-cabin-title>
            Milky Waymo — Cabin Assistant
          </h2>
          <TypewriterText
            className="mw-kiosk__quote"
            fullTextId={descriptionId}
            text={cabinArrivalAnnouncement(notice.destinationName)}
          />
          <div className="mw-kiosk__actions">
            <button
              className="mw-kiosk__button mw-kiosk__button--primary"
              data-passenger-disembark
              onClick={() => closeHandle.current?.()}
              type="button"
            >
              DISEMBARK
            </button>
          </div>
          {message ? (
            <p className="mw-kiosk__feedback" data-passenger-arrival-error role="alert">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
