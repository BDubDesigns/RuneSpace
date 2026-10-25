"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { cabinArrivalAnnouncement } from "@/game/content/cabin-announcements";
import { acknowledgePassengerArrivalAction } from "@/server/actions";

/**
 * The durable passenger arrival notice (#404): the cabin assistant's fixed
 * sign-off and a DISEMBARK control.
 *
 * Like the Rivet's landing receipt it is stored, not a toast: it is part of the
 * authoritative Play state, so it is still here after closing the browser or
 * switching device, and gone everywhere once dismissed. The character was moved
 * when the server landed the journey; DISEMBARK acknowledges the notice and
 * changes nothing else. The sign-off is shown whole because a viewer who reaches
 * it here is arriving, not watching a line begin.
 */
export function PassengerArrivalNotice() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const notice = state.passenger.arrivalNotice;
  const [dismissing, setDismissing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  if (!notice) return null;

  function disembark() {
    if (dismissing) return;
    enqueueForeground(() => {
      setDismissing(true);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await acknowledgePassengerArrivalAction({
            characterId: state.characterId,
          });
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          acceptState(result.state);
        } catch {
          setMessage("Comms interruption. The notice is still here; try again.");
        } finally {
          setDismissing(false);
          releaseCommand();
        }
      });
    });
  }

  return (
    <section
      aria-label="Milky Waymo arrival"
      className="mw-cabin !mt-0"
      data-cabin-assistant
      data-cabin-phase="arrival"
      data-passenger-arrival-notice={notice.arrivedAt}
      role="status"
    >
      <header className="mw-cabin__header">
        <Image
          alt=""
          className="mw-cabin__mark"
          height={179}
          src="/branding/milky-waymo-mark.webp"
          width={640}
        />
        <h3 className="mw-cabin__title">Milky Waymo — Cabin Assistant</h3>
      </header>
      <p className="mw-cabin__line !min-h-0" data-cabin-line>
        {cabinArrivalAnnouncement(notice.destinationName)}
      </p>
      <div className="mw-cabin__action">
        <button
          className="mw-kiosk__button mw-kiosk__button--primary w-full sm:w-auto"
          data-passenger-disembark
          disabled={dismissing || foregroundBusy}
          onClick={disembark}
          type="button"
        >
          DISEMBARK
        </button>
      </div>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </section>
  );
}
