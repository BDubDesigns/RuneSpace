"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SelectablePortraitOption } from "@/game/domain/character-portrait";
import { ActionButton } from "@/components/ui/ActionButton";
import { CharacterPortrait } from "./CharacterPortrait";

const WIDE_QUERY = "(min-width: 64rem)"; // matches the Tailwind `lg` breakpoint

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
 * Shared character-portrait chooser (issue #65), used by character creation
 * and by the owned-character Choose/Change portrait flow. One shared boundary
 * owns the grid, the candidate/current selection semantics, the large
 * preview, the mobile grid/review navigation, the desktop master-detail
 * layout, and the Previous/Next review controls. Parent flows supply their
 * own business action (Create character / Save portrait) through the `action`
 * slot, which is placed beside the preview.
 *
 * The options are the server-projected selectable list — all `player-starter`
 * entries plus any owned `player-unlockable` entries, never `npc-only` or
 * `reserved` portraits — so this client component never imports catalog
 * content directly.
 *
 * Responsive behavior:
 * - Wide layouts (`lg` and up): the portrait grid sits on the left and the
 *   selected portrait's large preview (display name, Previous/Next, action)
 *   sits on the right. The grid scrolls inside its own column; the preview
 *   region stays put. Selecting a thumbnail updates the preview immediately.
 * - Narrow layouts: the compact grid is the browsing state. Tapping a
 *   portrait selects it and transitions in-page (never a second modal) to the
 *   review state: a large preview with its full display name, Previous/Next
 *   comparison controls that wrap at the ends, and the action slot. Back to
 *   portraits restores the grid's previous scroll position, preserves the
 *   candidate, and returns focus to the selected tile.
 *
 * Accessibility: each option is a real toggle button with a useful accessible
 * name; candidate selection is exposed through `aria-pressed` and the
 * selected check (never color alone); the server-confirmed current portrait
 * carries a visible "Current" label; review focus moves predictably to the
 * review heading and returns to the selected tile, without a keyboard trap;
 * visible keyboard focus comes from the shared `rs-focus` ring; tile images
 * stay lazy while the actively reviewed preview loads eagerly.
 */
export function PortraitPicker({
  label,
  options,
  onSelect,
  selectedPortraitId,
  currentPortraitId = null,
  action,
}: {
  /** Accessible name for the group of portrait options. */
  label: string;
  options: readonly SelectablePortraitOption[];
  onSelect: (portraitId: string) => void;
  /** The candidate portrait currently being reviewed but not yet saved. */
  selectedPortraitId: string | null;
  /** The server-confirmed persisted portrait (management only; null for creation). */
  currentPortraitId?: string | null;
  /** Context-specific action (Create character / Save portrait) beside the preview. */
  action: ReactNode;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const gridScrollTop = useRef(0);
  const reviewedBefore = useRef(false);

  // Track the wide layout for JS behavior only (focus/review transitions);
  // the responsive presentation itself is CSS-driven.
  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const selectedIndex = selectedPortraitId
    ? options.findIndex((option) => option.portraitId === selectedPortraitId)
    : -1;
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function activate(portraitId: string) {
    onSelect(portraitId);
    if (wide) return;
    // Narrow layout: preserve the grid's scroll position, then transition
    // to the in-page review state.
    reviewedBefore.current = true;
    gridScrollTop.current = gridRef.current?.scrollTop ?? 0;
    setReviewOpen(true);
  }

  function backToGrid() {
    setReviewOpen(false);
  }

  function step(delta: number) {
    if (options.length === 0 || selectedIndex < 0) return;
    const next = (selectedIndex + delta + options.length) % options.length;
    onSelect(options[next]!.portraitId);
  }

  // Narrow-layout review focus: move predictably to the review heading on
  // entry; on return, restore the grid scroll position and focus the
  // selected tile. Never runs on initial mount.
  useEffect(() => {
    if (reviewOpen) {
      if (!wide) reviewHeadingRef.current?.focus();
      return;
    }
    if (!reviewedBefore.current) return;
    reviewedBefore.current = false;
    if (gridRef.current) gridRef.current.scrollTop = gridScrollTop.current;
    gridRef.current?.querySelector<HTMLElement>('[data-portrait-selected="true"]')?.focus();
  }, [reviewOpen, wide]);

  return (
    <div className="lg:flex lg:items-start lg:gap-6" data-portrait-chooser>
      {/* Portrait grid (browsing state). Hidden on narrow layouts while a
          portrait is being reviewed; always visible on wide layouts. */}
      <div className={`${reviewOpen ? "hidden" : ""} lg:block lg:w-80 lg:shrink-0`}>
        <div
          aria-label={label}
          className="grid grid-cols-3 gap-2 lg:max-h-[30rem] lg:overflow-y-auto lg:pr-1"
          ref={gridRef}
          role="group"
        >
          {options.map((option) => {
            const selected = option.portraitId === selectedPortraitId;
            const current = option.portraitId === currentPortraitId;
            return (
              <button
                aria-label={`${option.displayName} portrait${
                  selected ? ", selected" : ""
                }${current ? ", current" : ""}`}
                aria-pressed={selected}
                className={`rs-focus relative flex flex-col items-stretch gap-1.5 border p-1.5 text-left outline-none motion-safe:transition-colors ${
                  selected
                    ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
                    : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] hover:border-[color:var(--rs-border-structural)]"
                }`}
                data-portrait-option
                data-portrait-id={option.portraitId}
                {...(selected ? { "data-portrait-selected": "true" } : {})}
                {...(current ? { "data-portrait-current": "true" } : {})}
                key={option.portraitId}
                onClick={() => activate(option.portraitId)}
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
                  sizes="(min-width: 64rem) 96px, 33vw"
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
                {current ? (
                  <span className="absolute bottom-5 left-1 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.08em] text-[color:var(--rs-text-secondary)]">
                    Current
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview / review region. Always visible on wide layouts; on narrow
          layouts it is the in-page review state reached from the grid. */}
      <div
        className={`${reviewOpen ? "" : "hidden"} lg:block lg:min-w-0 lg:flex-1`}
        data-portrait-review={reviewOpen ? "true" : undefined}
      >
        <div className="lg:sticky lg:top-0">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <h3
              className="rs-focus font-display text-sm font-bold text-[color:var(--rs-text-primary)] outline-none"
              ref={reviewHeadingRef}
              tabIndex={-1}
            >
              Review portrait
            </h3>
            <ActionButton
              className="shrink-0 px-3"
              data-portrait-back
              intent="secondary"
              onClick={backToGrid}
              type="button"
            >
              Back to portraits
            </ActionButton>
          </div>

          {selectedOption ? (
            <>
              <div className="mt-3 lg:mt-0">
                <CharacterPortrait
                  bordered={false}
                  className="mx-auto aspect-square w-full max-w-[28rem]"
                  presentation={{
                    kind: "selected",
                    displayName: selectedOption.displayName,
                    derivativePath: selectedOption.derivativePath,
                    derivativeWidth: selectedOption.derivativeWidth,
                    derivativeHeight: selectedOption.derivativeHeight,
                    accessibleDescription: selectedOption.accessibleDescription,
                  }}
                  sizes="(min-width: 64rem) 26rem, 88vw"
                />
              </div>
              <p
                className="mt-3 text-center font-display text-sm font-bold text-[color:var(--rs-text-primary)] lg:text-left"
                data-portrait-preview-name
              >
                {selectedOption.displayName}
              </p>
              <div className="mt-3 flex justify-center gap-2 lg:justify-start">
                <ActionButton
                  aria-label="Previous portrait"
                  className="px-3"
                  intent="secondary"
                  onClick={() => step(-1)}
                  type="button"
                >
                  Previous
                </ActionButton>
                <ActionButton
                  aria-label="Next portrait"
                  className="px-3"
                  intent="secondary"
                  onClick={() => step(1)}
                  type="button"
                >
                  Next
                </ActionButton>
              </div>
            </>
          ) : (
            <p className="text-sm text-[color:var(--rs-text-muted)]">
              Select a portrait to preview it here.
            </p>
          )}
          {/* The context-specific action (Create character / Save portrait)
              always sits beside the preview so it is reachable wherever the
              preview is visible. */}
          <div className="mt-4">{action}</div>
        </div>
      </div>
    </div>
  );
}
