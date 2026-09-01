"use client";

import { useState, useTransition } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { POWER_ANNEX_RESET_TIME_ZONE, POWER_CELL_DAILY_ALLOTMENT } from "@/game/domain/power-annex";
import { claimPowerCellsAction } from "@/server/actions";
import { usePlay } from "@/features/play/PlayContext";

export function PowerAnnexClaimPanel() {
  const {
    acquireCommand,
    acceptState,
    enqueueForeground,
    foregroundBusy: busy,
    releaseCommand,
    requestAutoRefresh,
    state,
  } = usePlay();
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [messageTone, setMessageTone] = useState<"danger" | "muted">("muted");

  if (state.location.currentLocationId !== LOCATION_IDS.emergencyPowerAnnex) return null;

  const claimed = state.powerAnnex?.claimed ?? false;
  const resetDate = state.powerAnnex?.resetDate ?? "today";
  const availableQuantity = claimed ? 0 : POWER_CELL_DAILY_ALLOTMENT;
  const itemAccessibleLabel = claimed
    ? `0 Power Cells currently available; today's ${POWER_CELL_DAILY_ALLOTMENT}-cell allotment has been claimed`
    : `${POWER_CELL_DAILY_ALLOTMENT} Power Cells available to claim`;

  function claim() {
    const execute = () => {
      startTransition(async () => {
        try {
          const result = await claimPowerCellsAction({ characterId: state.characterId });
          if ("error" in result) {
            setMessage(result.error);
            setMessageTone("danger");
          } else {
            acceptState(result.state);
            if (result.claim.status === "error") {
              setMessage(result.claim.message);
              setMessageTone("danger");
            } else if (result.claim.status === "claimed") {
              setMessage(
                `Today's emergency allotment claimed: ${POWER_CELL_DAILY_ALLOTMENT} Power Cells awarded.`,
              );
              setMessageTone("muted");
            } else {
              setMessage("Today's emergency allotment has already been claimed.");
              setMessageTone("muted");
            }
          }
        } catch {
          setMessage("Comms interruption. The Power Annex could not confirm your claim.");
          setMessageTone("danger");
          requestAutoRefresh();
        } finally {
          releaseCommand();
        }
      });
    };
    enqueueForeground(execute);
  }

  return (
    <Panel tone="raised">
      <SectionHeader eyebrow="Daily emergency allotment">
        DeWhat? Emergency Power Annex
      </SectionHeader>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The damaged depot dispenses one registered worker allotment per RuneSpace reset day.
        Eligibility belongs to this character and requires being stationary at the Annex.
      </p>
      <div
        className="mt-4 grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] items-center gap-3"
        data-power-annex-reward-grid
      >
        <div className="flex min-w-0 flex-col items-center" data-power-annex-reward-left>
          <ItemVisual
            accessibleLabel={itemAccessibleLabel}
            badge={`x${availableQuantity}`}
            className="w-full"
            itemId={ITEM_IDS.powerCell}
            mutedArtwork={claimed}
            name="Power Cell"
            quantity={availableQuantity}
          />
          {!claimed ? (
            <ActionButton
              className="mt-3 w-full max-w-full px-2 text-xs leading-tight"
              disabled={busy}
              intent="primary"
              loading={busy}
              onClick={claim}
            >
              Claim Power Cells
            </ActionButton>
          ) : null}
        </div>
        <div
          className="min-w-0 self-center text-sm text-[color:var(--rs-text-secondary)]"
          data-power-annex-reward-info
        >
          <p className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
            {availableQuantity} Power Cells currently available
          </p>
          <p className="mt-1">500 g each · stack limit 5 · 2,500 g total</p>
          {claimed ? (
            <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
              Today&apos;s {POWER_CELL_DAILY_ALLOTMENT}-cell allotment has already been claimed.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            Reset date: {resetDate}. Next eligibility begins at midnight Pacific (
            {POWER_ANNEX_RESET_TIME_ZONE}).
          </p>
          {claimed ? (
            <p className="mt-1 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-primary)]">
              Today&apos;s allotment claimed · next reset at midnight Pacific
            </p>
          ) : null}
        </div>
      </div>
      {message ? (
        <div className="mt-4">
          <Feedback tone={messageTone}>{message}</Feedback>
        </div>
      ) : null}
    </Panel>
  );
}
