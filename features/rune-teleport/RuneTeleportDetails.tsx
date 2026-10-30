"use client";

import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { RUNE_TELEPORT_COPY } from "@/game/content/rune-teleports";
import type { InventoryStackEntry } from "@/features/inventory/inventory-selection";
import { RUNE_TELEPORT_ADVISORY_COPY, runeTeleportAdvisory } from "./availability";
import { useOptionalTeleportCinematic, useTeleportCinematic } from "./TeleportCinematic";

type Confirmation = { stackId: string; expectedQuantity: number };

/**
 * A teleport rune's part of its ordinary Item Details (#438): USE RUNE, and the
 * RuneSpace confirmation that must be accepted before anything happens.
 *
 * Opening the dialog, cancelling it, pressing Escape and tapping outside it send
 * no command and cost nothing. TELEPORT closes the dialog and hands the intent to
 * the cinematic, which holds the one foreground command gate and lets the server
 * decide. Everything offered here is advisory (a stale tab can still press it);
 * the server revalidates the carried stack, the position, activity, travel,
 * flight and trade state.
 */
export function RuneTeleportDetails({ entry }: { entry: InventoryStackEntry }) {
  const { foregroundBusy, state } = usePlay();
  const cinematic = useTeleportCinematic();
  const destination = state.runeTeleport.runes[entry.itemId];
  const [confirming, setConfirming] = useState<Confirmation>();
  const [staleMessage, setStaleMessage] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const useButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeHandle: MutableRefObject<(() => void) | null> = useRef(null);
  const choice = useRef<"cancel" | "teleport">("cancel");
  const descriptionId = useId();

  // The selected stack changed or vanished under an open confirmation (a trade, a
  // second tab, another command): drop the confirmation and say why, rather than
  // spend a rune the player did not confirm.
  useEffect(() => {
    if (!confirming) return;
    const stack = state.inventory.stacks.find((candidate) => candidate.id === confirming.stackId);
    if (!stack || stack.quantity !== confirming.expectedQuantity) {
      choice.current = "cancel";
      setConfirming(undefined);
      setStaleMessage("Inventory changed. Review the stack and try again.");
    }
  }, [confirming, state.inventory.stacks]);

  if (!destination) return null;
  const advisory = runeTeleportAdvisory(state, destination.locationId);
  const disabled = foregroundBusy || cinematic.active || advisory !== undefined;
  const place = destination.planetName
    ? `${destination.name}, ${destination.planetName}`
    : destination.name;

  function onDialogClose() {
    const chosen = choice.current;
    choice.current = "cancel";
    const pending = confirming;
    setConfirming(undefined);
    if (chosen === "teleport" && pending) {
      cinematic.begin({
        ...pending,
        // The control itself when it is usable again, else these details, so a
        // keyboard player never lands on the page body.
        returnFocus: () =>
          useButton.current?.disabled === false ? useButton.current : root.current,
      });
    }
  }

  return (
    <div
      className="mt-3 space-y-2 border-t border-[color:var(--rs-border-subtle)] pt-3 text-sm text-[color:var(--rs-text-secondary)] outline-none"
      data-rune-teleport-details
      ref={root}
      tabIndex={-1}
    >
      <p data-rune-teleport-destination>
        <span className="font-semibold text-[color:var(--rs-text-primary)]">Destination:</span>{" "}
        {place}
      </p>
      <ActionButton
        data-rune-use
        disabled={disabled}
        intent="arcane"
        onClick={() => {
          setStaleMessage(undefined);
          cinematic.clearNotice();
          setConfirming({ stackId: entry.id, expectedQuantity: entry.quantity });
        }}
        ref={useButton}
      >
        {RUNE_TELEPORT_COPY.useLabel}
      </ActionButton>
      {advisory ? (
        <Feedback data-rune-advisory={advisory}>{RUNE_TELEPORT_ADVISORY_COPY[advisory]}</Feedback>
      ) : null}
      {staleMessage ? <Feedback tone="danger">{staleMessage}</Feedback> : null}
      {confirming ? (
        <Drawer
          closeHandleRef={closeHandle}
          describedById={descriptionId}
          eyebrow={entry.name}
          initialFocusRef={cancelButton}
          label="Teleport confirmation"
          onClose={onDialogClose}
          title={`Teleport to ${destination.planetName ?? destination.name}?`}
          triggerRef={useButton}
        >
          <div data-rune-teleport-dialog>
            <div
              className="mt-3 space-y-2 text-sm text-[color:var(--rs-text-secondary)]"
              id={descriptionId}
            >
              <p className="font-display text-lg font-bold uppercase tracking-wide text-[color:var(--rs-accent-primary)]">
                {place}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li data-rune-cost>
                  <span className="font-semibold text-[color:var(--rs-text-primary)]">
                    One {entry.name} is used up.
                  </span>
                </li>
                <li>Only you travel, with everything you carry and wear.</li>
                <li>Your ship, its fuel and its Cargo Hold stay where they are parked.</li>
              </ul>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton
                data-rune-teleport-cancel
                intent="secondary"
                onClick={() => {
                  choice.current = "cancel";
                  closeHandle.current?.();
                }}
                ref={cancelButton}
              >
                {RUNE_TELEPORT_COPY.cancelLabel}
              </ActionButton>
              <ActionButton
                data-rune-teleport-confirm
                intent="arcane"
                onClick={() => {
                  choice.current = "teleport";
                  closeHandle.current?.();
                }}
              >
                {RUNE_TELEPORT_COPY.teleportLabel}
              </ActionButton>
            </div>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

/** The cinematic's last refusal or uncertainty, shown at the top of Inventory like every other command's feedback. */
export function RuneTeleportNotice() {
  const notice = useOptionalTeleportCinematic()?.notice;
  return notice ? (
    <div className="mt-4" data-rune-teleport-notice>
      <Feedback tone={notice.tone}>{notice.message}</Feedback>
    </div>
  ) : null;
}
