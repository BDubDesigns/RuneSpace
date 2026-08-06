"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { PortraitPicker } from "@/components/portraits/PortraitPicker";
import { changeCharacterPortraitAction } from "@/server/actions";
import type { SelectablePortraitOption } from "@/game/domain/character-portrait";

/**
 * Choose/Change portrait flow for one owned character on the character
 * management screen (issue #65).
 *
 * The shared catalog-derived picker is reused; the deliberate Save/Confirm
 * action submits only the stable portrait ID to the server-authoritative
 * command, which re-validates selectability and ownership. Success, refusal,
 * validation, and transport states are visible in the drawer; on success the
 * server-rendered character row refreshes so the new portrait (and its label)
 * is the durable visual confirmation. The shared Drawer owns focus return to
 * the trigger, Escape, and the scroll lock, and only one drawer can ever be
 * open because the modal backdrop blocks the other rows' triggers.
 */
export function ManageCharacterPortrait({
  characterId,
  characterName,
  currentPortraitId,
  options,
}: {
  characterId: string;
  characterName: string;
  /** The character's stored portrait ID, or null for legacy characters. */
  currentPortraitId: string | null;
  /** Server-projected selectable portrait options (the ten player-starter entries). */
  options: readonly SelectablePortraitOption[];
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(currentPortraitId);
  const [message, setMessage] = useState<{ tone: "muted" | "danger" | "success"; text: string }>();
  const [pending, startTransition] = useTransition();

  const hasPortrait = currentPortraitId !== null;
  const triggerLabel = hasPortrait ? "Change portrait" : "Choose portrait";
  const title = hasPortrait ? "Change portrait" : "Choose portrait";

  function openPicker() {
    // Re-open with the server-confirmed selection; never trust a stale choice.
    setSelected(currentPortraitId);
    setMessage(undefined);
    setOpen(true);
  }

  function save() {
    if (!selected) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await changeCharacterPortraitAction({ characterId, portraitId: selected });
        if (result.error) {
          setMessage({ tone: "danger", text: result.error });
          return;
        }
        setMessage({ tone: "success", text: "Portrait saved" });
        // Refresh the server-rendered row so the durable confirmation is the
        // character's updated portrait itself.
        router.refresh();
      } catch {
        setMessage({ tone: "danger", text: "Comms interruption. Portrait could not be saved." });
      }
    });
  }

  return (
    <>
      <ActionButton ref={triggerRef} className="shrink-0" intent="secondary" onClick={openPicker}>
        {triggerLabel}
      </ActionButton>
      {open ? (
        <Drawer
          eyebrow="Character portrait"
          label="Portrait"
          onClose={() => setOpen(false)}
          title={title}
          triggerRef={triggerRef}
        >
          <div className="mt-4">
            <p className="text-sm text-[color:var(--rs-text-secondary)]">
              {characterName} — choose one of the available portraits.
            </p>
            <div className="mt-3">
              <PortraitPicker
                label="Character portrait"
                onSelect={setSelected}
                optionSizes="(min-width: 640px) 96px, 33vw"
                options={options}
                selectedPortraitId={selected}
              />
            </div>
            {message ? <Feedback tone={message.tone}>{message.text}</Feedback> : null}
            <ActionButton
              className="mt-4 w-full"
              disabled={!selected || selected === currentPortraitId}
              loading={pending}
              onClick={save}
            >
              {pending ? "Saving…" : "Save portrait"}
            </ActionButton>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
