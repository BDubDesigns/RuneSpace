"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toggleSelection } from "./selectable-details";

/**
 * The one shared selectable-item interaction contract behind the Inventory
 * drawer and the Cargo Hold storage grids: a grid of selectable tiles plus a
 * single contextual details/action area for whatever is currently selected.
 *
 * It owns exactly the behavior both surfaces must keep identical:
 *
 * - toggle semantics, so re-selecting the open tile closes its details;
 * - reconciliation against authoritative state, so a selection whose entry no
 *   longer exists never lingers as a stale tile or action area;
 * - the explicit-player-selection reveal — scroll the details panel into view
 *   and move focus to its heading, yielding to `prefers-reduced-motion` — so a
 *   keyboard user never has to tab through the rest of a dense grid to reach
 *   the actions they just opened;
 * - safe focus restoration when an authoritative mutation removes the selected
 *   tile, preferring a surviving tile and falling back to the grid container.
 *
 * It owns none of the domain. Deposit/Withdraw, Drop, Equip, Power Cell
 * loading, capacity and mass validation, and every server mutation stay with
 * the feature that owns those rules. Selection identity stays there too —
 * callers supply `resolve` and `isSameSelection` — because an Inventory
 * selection and a Cargo selection are deliberately different shapes.
 */
export type SelectableDetails<TSelection, TResolved> = {
  /** The current advisory selection identity, or `undefined` when nothing is open. */
  selection: TSelection | undefined;
  /** The selection resolved against authoritative state on this render. */
  resolved: TResolved | undefined;
  /** An explicit player selection: toggles the open tile closed, else opens `next` and reveals it. */
  select: (next: TSelection) => void;
  /** Passive dismissal (Close details, empty-slot click). Never reveals or moves focus. */
  clear: () => void;
  /**
   * Arm focus restoration for the next authoritative state that removes the
   * selection, naming the container to restore into. Call it only once a
   * command is confirmed — arming before submission would let a refusal or an
   * uncertain transport move focus on some later, unrelated reconciliation.
   */
  armFocusReturn: (container: () => HTMLElement | null) => void;
  /** Attach to the details/action panel that renders for the current selection. */
  detailsRef: RefObject<HTMLElement | null>;
  /** Attach to that panel's heading; it needs `tabIndex={-1}` to receive focus. */
  detailsHeadingRef: RefObject<HTMLHeadingElement | null>;
};

export function useSelectableDetails<TSelection, TResolved>({
  resolve,
  isSameSelection,
}: {
  /** Resolve a selection against authoritative state; `undefined` when its entry is gone. */
  resolve: (selection: TSelection) => TResolved | undefined;
  isSameSelection: (current: TSelection, next: TSelection) => boolean;
}): SelectableDetails<TSelection, TResolved> {
  const [selection, setSelection] = useState<TSelection | undefined>();
  const detailsRef = useRef<HTMLElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  // Set only by an explicit player selection, so authoritative reconciliation
  // never scrolls the page or steals focus on its own.
  const revealRequestedRef = useRef(false);
  const focusReturnRef = useRef<(() => HTMLElement | null) | undefined>(undefined);
  const resolved = selection === undefined ? undefined : resolve(selection);

  // Reconcile with authoritative state: when the selected entry no longer
  // exists (consumed, dropped, equipped, transferred away), clear the
  // selection so no stale tile or action area survives.
  useEffect(() => {
    if (selection !== undefined && resolved === undefined) setSelection(undefined);
  }, [selection, resolved]);

  // Reveal the details panel for an explicit player selection only: scroll it
  // into view, then move focus to its heading so the actions the player just
  // opened are the next thing in the tab order.
  useEffect(() => {
    if (!revealRequestedRef.current) return;
    revealRequestedRef.current = false;
    if (!resolved) return;
    const panel = detailsRef.current;
    const heading = detailsHeadingRef.current;
    if (!panel || !heading) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  }, [resolved]);

  // A confirmed command removed the selected tile: return focus into the armed
  // container — the former selected tile if it somehow survives, else the first
  // occupied tile, else the container itself (which carries `tabIndex={-1}`) —
  // rather than letting the browser drop focus to the document body. The arm is
  // consumed on the first render after it is set, so a command that left the
  // selection intact never moves focus later.
  useEffect(() => {
    const container = focusReturnRef.current;
    if (!container) return;
    focusReturnRef.current = undefined;
    if (resolved) return;
    const root = container();
    if (!root) return;
    const selectedTile = root.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const target = selectedTile ?? root.querySelector<HTMLButtonElement>("button[aria-pressed]");
    (target ?? root).focus();
  }, [resolved]);

  const select = useCallback(
    (next: TSelection) => {
      const nextSelection = toggleSelection(selection, next, isSameSelection);
      revealRequestedRef.current = nextSelection !== undefined;
      setSelection(nextSelection);
    },
    [isSameSelection, selection],
  );

  const clear = useCallback(() => {
    revealRequestedRef.current = false;
    setSelection(undefined);
  }, []);

  const armFocusReturn = useCallback((container: () => HTMLElement | null) => {
    focusReturnRef.current = container;
  }, []);

  return {
    selection,
    resolved,
    select,
    clear,
    armFocusReturn,
    detailsRef,
    detailsHeadingRef,
  };
}
