"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { TransientStatus } from "@/components/ui/TransientStatus";
import { CharacterPortrait } from "@/components/portraits/CharacterPortrait";
import { PortraitPicker } from "@/components/portraits/PortraitPicker";
import { changeCharacterPortraitAction } from "@/server/actions";
import type {
  CharacterPortraitPresentation,
  SelectablePortraitOption,
} from "@/game/domain/character-portrait";

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/**
 * Choose/Change portrait flow for one owned character on the character
 * management screen (issue #65).
 *
 * The portrait itself is the edit control: one accessible button wrapping the
 * character's portrait (or the neutral placeholder) with an always-visible
 * pencil badge at its top-right corner that gains emphasis on hover and
 * keyboard focus. Activating it opens the shared catalog-derived chooser in
 * the wide Drawer; the deliberate Save portrait action is the chooser's
 * action slot and submits only the stable portrait ID to the
 * server-authoritative command, which re-validates selectability and
 * ownership.
 *
 * Save completion: the action enters a disabled Saving… state, waits for the
 * confirmed server response, refreshes the authoritative character data,
 * closes the chooser automatically (focus returns to the edit control through
 * the shared Drawer), briefly emphasizes the updated portrait frame, and
 * shows a transient "Portrait updated" status on the management screen.
 * Refusals, validation failures, and transport failures keep the chooser open
 * in review state with the candidate preserved and a styled alert near the
 * action.
 */
export function ManageCharacterPortrait({
  characterId,
  characterName,
  currentPortraitId,
  presentation,
  options,
}: {
  characterId: string;
  characterName: string;
  /** The character's stored portrait ID, or null for legacy characters. */
  currentPortraitId: string | null;
  /** Resolved presentation of the stored value (portrait or placeholder). */
  presentation: CharacterPortraitPresentation;
  /** Server-projected selectable portrait options (the ten player-starter entries). */
  options: readonly SelectablePortraitOption[];
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(currentPortraitId);
  const [error, setError] = useState<string | undefined>();
  const [savedNonce, setSavedNonce] = useState(0);
  const [toastNonce, setToastNonce] = useState(0);
  const [pending, startTransition] = useTransition();
  const previousCurrent = useRef(currentPortraitId);
  const focusPending = useRef(false);

  // The shared Drawer returns focus to the edit control when it finishes
  // closing, but the post-save router.refresh() may replace the button DOM
  // node afterwards (or around the same time), which drops that focus. When
  // the refreshed server data lands, re-focus the (new) edit control once.
  useEffect(() => {
    if (currentPortraitId === previousCurrent.current) return;
    previousCurrent.current = currentPortraitId;
    if (focusPending.current) {
      focusPending.current = false;
      triggerRef.current?.focus();
    }
  }, [currentPortraitId]);

  const hasPortrait = currentPortraitId !== null;
  const title = hasPortrait ? "Change portrait" : "Choose portrait";

  function openPicker() {
    // Re-open with the server-confirmed selection; never trust a stale choice.
    setSelected(currentPortraitId);
    setError(undefined);
    setOpen(true);
  }

  function save() {
    if (!selected || pending) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await changeCharacterPortraitAction({
          characterId,
          portraitId: selected,
        });
        if (result.error) {
          // Refusal or validation failure: keep the chooser open, preserve
          // the candidate, and show the styled alert near the action.
          setError(result.error);
          return;
        }
        // Confirmed success: emphasize the updated frame, announce the
        // transient status on the management screen, refresh the
        // server-rendered card, and close the chooser (the shared Drawer
        // returns focus to this edit control).
        focusPending.current = true;
        setSavedNonce((nonce) => nonce + 1);
        setToastNonce((nonce) => nonce + 1);
        router.refresh();
        setOpen(false);
      } catch {
        setError("Comms interruption. Portrait could not be saved.");
      }
    });
  }

  const actionSlot = (
    <div>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <ActionButton
        className="w-full"
        disabled={!selected || selected === currentPortraitId}
        loading={pending}
        onClick={save}
        type="button"
      >
        {pending ? "Saving…" : "Save portrait"}
      </ActionButton>
    </div>
  );

  return (
    <>
      <button
        aria-label={`${hasPortrait ? "Change" : "Choose"} portrait for ${characterName}`}
        className={`group relative block shrink-0 outline-none ${
          savedNonce > 0 ? "rs-portrait-saved" : ""
        }`}
        data-portrait-edit
        onClick={openPicker}
        onAnimationEnd={() => setSavedNonce(0)}
        ref={triggerRef}
        type="button"
      >
        <CharacterPortrait
          className="h-24 w-24 sm:h-28 sm:w-28"
          presentation={presentation}
          sizes="112px"
        />
        {/* Always-visible edit affordance at the TOP-RIGHT corner of the
            portrait; stronger emphasis on hover and keyboard focus, so touch
            users never depend on hover. */}
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 grid h-7 w-7 place-items-center border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] text-[color:var(--rs-text-secondary)] transition-[color,background-color,border-color] duration-[var(--rs-duration-fast)] group-hover:border-[color:var(--rs-accent-primary)] group-hover:bg-[color:var(--rs-accent-primary-subtle)] group-hover:text-[color:var(--rs-accent-primary)] group-focus-visible:border-[color:var(--rs-accent-primary)] group-focus-visible:bg-[color:var(--rs-accent-primary-subtle)] group-focus-visible:text-[color:var(--rs-accent-primary)]"
          data-portrait-edit-icon
        >
          <PencilIcon />
        </span>
      </button>

      {toastNonce > 0 ? <TransientStatus key={toastNonce} message="Portrait updated" /> : null}

      {open ? (
        <Drawer
          eyebrow="Character portrait"
          label="Portrait"
          onClose={() => setOpen(false)}
          size="wide"
          title={title}
          triggerRef={triggerRef}
        >
          <div className="mt-4">
            <p className="text-sm text-[color:var(--rs-text-secondary)]">
              {characterName} — choose one of the available portraits.
            </p>
            <div className="mt-3">
              <PortraitPicker
                action={actionSlot}
                currentPortraitId={currentPortraitId}
                label="Character portrait"
                onSelect={setSelected}
                options={options}
                selectedPortraitId={selected}
              />
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
