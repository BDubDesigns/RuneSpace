"use client";

import { useState, useTransition } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { FEDHEX_NAME } from "@/game/content/fedhex";
import { claimFedhexParcelAction } from "@/server/actions";

/**
 * The FedHex mailbox (#399): the activity of both FedHex Local Places.
 *
 * Both pickups open the same character-owned mailbox, so this reads the one
 * `state.fedhex` projection and never a place-specific list. Claim is one
 * parcel at a time; every rule (where the character is, whether the Inventory
 * has the slot and the mass) is the server's, and a refusal leaves the parcel
 * exactly where it was. An empty mailbox is a normal, friendly state.
 */
export function FedhexMailbox({ localPlaceId }: { localPlaceId: string }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [claiming, setClaiming] = useState<string>();
  const [refusal, setRefusal] = useState<{ parcelId: string; message: string }>();
  const [claimed, setClaimed] = useState<string>();
  const [, startTransition] = useTransition();
  const { parcels } = state.fedhex;

  function claim(parcelId: string) {
    if (claiming) return;
    enqueueForeground(() => {
      setClaiming(parcelId);
      setRefusal(undefined);
      setClaimed(undefined);
      startTransition(async () => {
        try {
          const result = await claimFedhexParcelAction({
            characterId: state.characterId,
            parcelId,
            localPlaceId,
          });
          if ("error" in result) {
            setRefusal({ parcelId, message: result.error });
            return;
          }
          acceptState(result.state);
          if (result.claim.status === "refused")
            setRefusal({ parcelId, message: result.claim.message });
          else setClaimed(result.claim.parcelId);
        } catch {
          setRefusal({
            parcelId,
            message: "Comms interruption. Your parcel is still waiting; try again.",
          });
        } finally {
          setClaiming(undefined);
          releaseCommand();
        }
      });
    });
  }

  return (
    <ActivityPanel data-fedhex-mailbox eyebrow={FEDHEX_NAME} title="Parcel pickup">
      {claimed ? (
        <div data-fedhex-claimed>
          <Feedback tone="success">Collected. It is in your Inventory now.</Feedback>
        </div>
      ) : null}
      {parcels.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-fedhex-empty>
          Nothing is waiting for you at the moment. Anything FedHex holds for you will show up here,
          at either landing pickup.
        </p>
      ) : (
        <>
          <p className="text-sm text-[color:var(--rs-text-secondary)]" data-fedhex-pending-count>
            {parcels.length === 1
              ? "1 parcel is waiting for you."
              : `${parcels.length} parcels are waiting for you.`}{" "}
            Collect them one at a time.
          </p>
          <ul className="space-y-3">
            {parcels.map((parcel) => (
              <li
                className="grid gap-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] p-3 sm:grid-cols-[7rem_1fr]"
                data-fedhex-parcel={parcel.parcelId}
                key={parcel.parcelId}
              >
                <div className="h-28 w-28" data-fedhex-attachment={parcel.attachment.itemId}>
                  <ItemVisual itemId={parcel.attachment.itemId} name={parcel.attachment.name} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[color:var(--rs-text-muted)]">
                    From <span data-fedhex-sender>{parcel.senderDisplayName}</span>
                  </p>
                  <p
                    className="mt-1 break-words font-display text-base font-bold"
                    data-fedhex-subject
                  >
                    {parcel.subject}
                  </p>
                  <p
                    className="mt-1 text-sm text-[color:var(--rs-text-secondary)]"
                    data-fedhex-body
                  >
                    {parcel.body}
                  </p>
                  <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
                    Attached: {parcel.attachment.name}
                  </p>
                  <div className="mt-3">
                    <ActionButton
                      data-fedhex-claim={parcel.parcelId}
                      intent="success"
                      loading={foregroundBusy && claiming === parcel.parcelId}
                      onClick={() => claim(parcel.parcelId)}
                    >
                      Collect {parcel.attachment.name}
                    </ActionButton>
                  </div>
                  {refusal?.parcelId === parcel.parcelId ? (
                    <div data-fedhex-refusal>
                      <Feedback tone="danger">{refusal.message}</Feedback>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </ActivityPanel>
  );
}
