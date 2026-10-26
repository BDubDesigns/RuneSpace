"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { usePlay } from "@/features/play/PlayContext";
import { getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { acknowledgeShipArrivalAction } from "@/server/actions";

/**
 * The durable landing notice (#358): "Flight complete — Arrived at <place>" and,
 * when the landing earned it, "Mission Complete: <title>". Since #402 the
 * title also names the planet ("Arrived at <place> · <planet>"), so a return
 * from Stillreach reads as an arrival on Skatboll at Holo Hollow Landing —
 * the same "destination · planet" convention as the star chart's readout.
 * The planet comes from the destination location's registry membership, so
 * the notice needs no new server field.
 *
 * It is a stored receipt, not a toast: it is part of the authoritative Play
 * state, so it is still here after closing the browser, a dropped connection or
 * a switch of device, and it is gone everywhere once dismissed. Dismissing is
 * presentation only: the arrival and the Mission were committed independently of
 * this card and nothing about either changes. There is no Wade portrait, no
 * turn-in and no reward tile, because there is no reward.
 */
export function ShipArrivalNotice() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const notice = state.ship.arrivalNotice;
  const [dismissing, setDismissing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  if (!notice) return null;
  const noticeId = notice.noticeId;
  const noticePlanetId = getLocationPlanetId(notice.destinationLocationId);
  const noticePlanetName = noticePlanetId
    ? getPlanetPresentation(noticePlanetId).displayName
    : undefined;

  function dismiss() {
    if (dismissing) return;
    enqueueForeground(() => {
      setDismissing(true);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await acknowledgeShipArrivalAction({
            characterId: state.characterId,
            noticeId,
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
    <Panel
      className="rs-result-feedback-success !border-[color:var(--rs-accent-success)] !p-4"
      data-ship-arrival-notice={notice.noticeId}
      role="status"
      tone="raised"
    >
      <p className="font-display text-lg font-bold tracking-wide" data-ship-arrival-title>
        Flight complete — Arrived at {notice.destinationName}
        {noticePlanetName ? ` · ${noticePlanetName}` : null}
      </p>
      {notice.completedMissionTitle ? (
        <p
          className="mt-1 font-display text-sm font-bold uppercase tracking-wide text-[color:var(--rs-accent-success)]"
          data-ship-arrival-mission
        >
          Mission Complete: {notice.completedMissionTitle}
        </p>
      ) : null}
      <div className="mt-3">
        <ActionButton
          data-ship-arrival-dismiss
          intent="success"
          loading={foregroundBusy && dismissing}
          onClick={dismiss}
        >
          DISMISS
        </ActionButton>
      </div>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </Panel>
  );
}
