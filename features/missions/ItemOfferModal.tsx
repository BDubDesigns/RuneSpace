"use client";

import { useState, useTransition, type RefObject } from "react";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { usePlay } from "@/features/play/PlayContext";
import { acceptItemOfferAction } from "@/server/actions";
import type { ItemOfferView } from "./item-offers";

/**
 * The compact, item-focused Mission offer opened from Item Details (#369).
 *
 * It shows the item's own approved art and the authored offer copy with two
 * explicit controls. Closing it, by Decline, Close, Escape or the backdrop,
 * changes nothing. Accepting submits only the Mission and the carried stack; the
 * server revalidates the offer and the stack, never consumes the item, and
 * answers idempotently, so a double-click or a retry cannot accept twice.
 *
 * It is the shared Drawer overlay, so it keeps the focus trap, Escape, scroll
 * lock, mobile sheet layout and focus return every other overlay already has.
 */
export function ItemOfferModal({
  offer,
  stack,
  onAccepted,
  onClose,
  triggerRef,
}: {
  offer: ItemOfferView;
  stack: { id: string; itemId: string; name: string; quantity: number; stackLimit: number };
  /** Called once the server has accepted the Mission and its state was applied. */
  onAccepted: (offer: ItemOfferView) => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { acceptState, acquireCommand, releaseCommand, state } = usePlay();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  // Declining leaves nothing changed; focus goes back to the Inspect control that
  // opened the offer, as the shared overlay does for Close and Escape.
  function decline() {
    onClose();
    // After the overlay is gone: refocusing while it is still mounted would be
    // pulled straight back into its focus trap.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function accept() {
    if (pending) return;
    if (!acquireCommand()) {
      setMessage("Another command is being confirmed. Try again in a moment.");
      return;
    }
    setPending(true);
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await acceptItemOfferAction({
          characterId: state.characterId,
          missionId: offer.missionId,
          stackId: stack.id,
        });
        if ("error" in result) {
          setMessage(result.error);
          return;
        }
        acceptState(result.state);
        if (result.mission.status === "refused") {
          setMessage(result.mission.message);
          return;
        }
        // Accepted now, or already accepted by an earlier request: either way
        // the Mission is the character's and the offer is done.
        onAccepted(offer);
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: false });
        setMessage("Comms interruption. Mission status could not be confirmed.");
      } finally {
        setPending(false);
        releaseCommand();
      }
    });
  }

  return (
    <Drawer
      eyebrow="Mission available"
      label={`${offer.offer.title} mission offer`}
      onClose={onClose}
      title={offer.offer.title}
      triggerRef={triggerRef}
    >
      <div
        className="mt-4 grid items-start gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]"
        data-item-offer
      >
        <StackItemVisual
          className="h-28 w-28 self-start"
          itemId={stack.itemId}
          name={stack.name}
          quantity={stack.quantity}
          stackLimit={stack.stackLimit}
        />
        <div className="min-w-0">
          <p className="text-sm text-[color:var(--rs-text-secondary)]" data-item-offer-description>
            {offer.offer.description}
          </p>
          <p className="mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Mission: {offer.missionTitle}. Your {stack.name} stays in your Inventory.
          </p>
        </div>
      </div>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton disabled={pending} intent="secondary" onClick={decline}>
          {offer.offer.declineLabel}
        </ActionButton>
        <MissionActionButton
          data-item-offer-accept
          guidance="available"
          loading={pending}
          onClick={accept}
        >
          {offer.offer.acceptLabel}
        </MissionActionButton>
      </div>
    </Drawer>
  );
}
