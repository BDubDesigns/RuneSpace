"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition, type RefObject } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
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
 * Once the server confirms acceptance, the same overlay becomes a compact
 * Mission Started view: the Mission's real title and its current objective read
 * from the authoritative projection the command returned (never authored or
 * hardcoded here), with Show on Map (the existing route-backed Map, where the
 * Mission's ordinary pinned guidance is already lit) and Return to Inventory. It
 * makes no second acceptance call, and a refusal or error never shows it.
 *
 * It is the shared Drawer overlay, so it keeps the focus trap, Escape, scroll
 * lock, mobile sheet layout and focus return every other overlay already has.
 */
export function ItemOfferModal({
  offer,
  stack,
  onAccepted,
  onClose,
  onFinished,
  triggerRef,
}: {
  offer: ItemOfferView;
  stack: { id: string; itemId: string; name: string };
  /** Called once the server has accepted the Mission and its state was applied. */
  onAccepted: (offer: ItemOfferView) => void;
  /** Dismissed before the Mission was started: nothing changed. */
  onClose: () => void;
  /** Left the Mission Started view by any route: back to a normal Inventory. */
  onFinished: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { acceptState, acquireCommand, closeUtilityPanel, releaseCommand, state } = usePlay();
  const router = useRouter();
  const pathname = usePathname();
  const mapButton = useRef<HTMLButtonElement>(null);
  // Set only from a confirmed acceptance, from the returned authoritative state.
  const [started, setStarted] = useState<{ title: string; objective?: string }>();
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
        // the Mission is the character's. Present it from the projection the
        // command returned.
        const projection = result.state.missions.find(
          (mission) => mission.missionId === offer.missionId,
        );
        setStarted({
          title: projection?.title ?? offer.missionTitle,
          ...(projection?.currentObjective ? { objective: projection.currentObjective } : {}),
        });
        onAccepted(offer);
        requestAnimationFrame(() => mapButton.current?.focus());
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: false });
        setMessage("Comms interruption. Mission status could not be confirmed.");
      } finally {
        setPending(false);
        releaseCommand();
      }
    });
  }

  // The route-backed Map is the only Map; its guidance is the Mission's own.
  function showOnMap() {
    onFinished();
    closeUtilityPanel("inventory");
    router.push(`${pathname}?surface=map`);
  }

  if (started) {
    return (
      <Drawer
        eyebrow="Mission started"
        label={`${started.title} mission started`}
        onClose={onFinished}
        title={started.title}
      >
        <div
          className="mt-4 border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-accent-success-subtle)] p-3"
          data-mission-started
        >
          <p className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[color:var(--rs-accent-success)]">
            Mission started
          </p>
          {started.objective ? (
            <>
              <p className="mt-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                Current objective
              </p>
              <p
                className="mt-1 text-sm font-semibold text-[color:var(--rs-text-primary)]"
                data-mission-started-objective
              >
                {started.objective}
              </p>
            </>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton intent="secondary" onClick={onFinished} data-mission-started-return>
            Return to Inventory
          </ActionButton>
          <MissionActionButton
            data-mission-started-map
            guidance="active"
            onClick={showOnMap}
            ref={mapButton}
          >
            Show on Map
          </MissionActionButton>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      eyebrow="New mission"
      label={`${offer.missionTitle} mission offer`}
      onClose={onClose}
      title={offer.missionTitle}
      triggerRef={triggerRef}
    >
      <div
        className="mt-4 grid items-start gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]"
        data-item-offer
      >
        {/* The offer is about the item type, not this stack: no quantity badge or
            fill, so inspecting any stack shows the same offer art. The accept
            still submits the selected stack ID for authoritative validation. */}
        <ItemVisual
          accessibleLabel={stack.name}
          className="h-28 w-28 self-start"
          itemId={stack.itemId}
          name={stack.name}
        />
        <div className="min-w-0">
          <p className="text-sm text-[color:var(--rs-text-secondary)]" data-item-offer-description>
            {offer.offer.description}
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]" data-item-offer-keeps>
            Your {stack.name} stays in your Inventory.
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
