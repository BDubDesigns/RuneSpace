"use client";

import type { SelectablePortraitOption } from "@/game/domain/character-portrait";
import { CharacterPortrait } from "./CharacterPortrait";

function SelectedCheck() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-panel)] text-[color:var(--rs-accent-primary)]"
    >
      <svg
        aria-hidden="true"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

/**
 * Shared character-portrait picker (issue #65), used by character creation and
 * by the owned-character Choose/Change portrait flow.
 *
 * The options are the server-projected selectable list — exactly the ten
 * `player-starter` catalog entries, never `npc-only` or `reserved` portraits —
 * so this client component never imports catalog content directly.
 *
 * Accessibility: each option is a real toggle button with a useful accessible
 * name; the selected state is exposed programmatically through `aria-pressed`
 * and visually through a check badge plus border treatment (never color
 * alone); visible keyboard focus comes from the shared `rs-focus` ring; and
 * the compact responsive grid scales from the canonical mobile viewport
 * without horizontal overflow. Images are plain lazy `next/image` derivatives.
 */
export function PortraitPicker({
  label,
  optionSizes,
  options,
  onSelect,
  selectedPortraitId,
}: {
  /** Accessible name for the group of portrait options. */
  label: string;
  /** Responsive `sizes` hint for the option images. */
  optionSizes: string;
  options: readonly SelectablePortraitOption[];
  onSelect: (portraitId: string) => void;
  selectedPortraitId: string | null;
}) {
  return (
    <div aria-label={label} className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="group">
      {options.map((option) => {
        const selected = option.portraitId === selectedPortraitId;
        return (
          <button
            aria-label={
              selected
                ? `${option.displayName} portrait, selected`
                : `${option.displayName} portrait`
            }
            aria-pressed={selected}
            className={`rs-focus relative flex flex-col items-stretch gap-1.5 border p-1.5 text-left outline-none motion-safe:transition-colors ${
              selected
                ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
                : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] hover:border-[color:var(--rs-border-structural)]"
            }`}
            data-portrait-option
            data-portrait-id={option.portraitId}
            {...(selected ? { "data-portrait-selected": "true" } : {})}
            key={option.portraitId}
            onClick={() => onSelect(option.portraitId)}
            type="button"
          >
            <CharacterPortrait
              bordered={false}
              className="aspect-square w-full"
              presentation={{
                kind: "selected",
                displayName: option.displayName,
                derivativePath: option.derivativePath,
                derivativeWidth: option.derivativeWidth,
                derivativeHeight: option.derivativeHeight,
                accessibleDescription: option.accessibleDescription,
              }}
              sizes={optionSizes}
            />
            <span className="truncate text-center text-xs font-medium text-[color:var(--rs-text-primary)]">
              {option.displayName}
            </span>
            {selected ? (
              <>
                <SelectedCheck />
                <span className="sr-only">Selected</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
