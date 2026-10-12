"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type RefObject } from "react";
import {
  getVerticalScrollAffordances,
  NO_VERTICAL_SCROLL_AFFORDANCES,
  sameVerticalScrollAffordances,
  type VerticalScrollAffordances,
} from "./scroll-affordances";

/**
 * Directional scroll hints for bounded panels (#345): the local map's amber
 * triangular edge arrow, reused for any independently scrolling region that can
 * hide content above or below. The arrows are decoration only — `aria-hidden`,
 * never focusable, `pointer-events: none` — so native touch, wheel, trackpad and
 * keyboard scrolling are untouched; nothing here scrolls, snaps or intercepts.
 *
 * Presentation lives in `app/globals.css` (`.rs-scroll-affordance*`), shared with
 * the map. This module owns the measurement and the placement: the layer is a
 * sibling of the scroller inside a `relative` frame the same size as the
 * scroller's visible box, so the arrows stay on the visible viewport while the
 * content moves under them and never scroll away. `ScrollAffordanceFrame` builds
 * that frame for a scroller that is a child of a larger layout; a panel that is
 * itself the scroller (the modal Drawer, a docked utility) is wrapped by its own
 * component and uses the hook and `ScrollAffordanceOverlay` directly.
 */

function readAffordances(element: HTMLElement): VerticalScrollAffordances {
  return getVerticalScrollAffordances({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  });
}

/**
 * Measures one scroller's real overflow from its native metrics and keeps it
 * current. The element must be the same node for the life of the component
 * (give a swapped scroller a `key`); the hook re-measures on mount, on native
 * scroll, on window and visual-viewport resize, whenever the scroller or one of
 * its children changes size (tab switches, async content, collapses, a hidden
 * ancestor becoming visible), and when children are added or removed.
 */
export function useScrollAffordances(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): VerticalScrollAffordances {
  const [affordances, setAffordances] = useState<VerticalScrollAffordances>(
    NO_VERTICAL_SCROLL_AFFORDANCES,
  );

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setAffordances(NO_VERTICAL_SCROLL_AFFORDANCES);
      return;
    }

    const update = () => {
      const next = readAffordances(element);
      setAffordances((previous) =>
        sameVerticalScrollAffordances(previous, next) ? previous : next,
      );
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    const observed = new Set<Element>();
    const syncObservedChildren = () => {
      if (!resizeObserver) return;
      const children = new Set<Element>(Array.from(element.children));
      for (const child of observed) {
        if (!children.has(child)) {
          resizeObserver.unobserve(child);
          observed.delete(child);
        }
      }
      for (const child of children) {
        if (!observed.has(child)) {
          resizeObserver.observe(child);
          observed.add(child);
        }
      }
    };

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(() => {
            syncObservedChildren();
            update();
          });

    resizeObserver?.observe(element);
    syncObservedChildren();
    mutationObserver?.observe(element, { childList: true });
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();

    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [enabled, ref]);

  return enabled ? affordances : NO_VERTICAL_SCROLL_AFFORDANCES;
}

const AFFORDANCE_DIRECTIONS = ["top", "bottom"] as const;

/**
 * The shared arrows: the same wrapper-and-inner-arrow markup and classes as the
 * map's, so the shape, halo and breathing are one definition. `top` points up
 * (more above) and `bottom` points down (more below).
 */
export function ScrollAffordanceMarkers({
  affordances,
}: {
  affordances: VerticalScrollAffordances;
}) {
  return (
    <>
      {AFFORDANCE_DIRECTIONS.map((direction) =>
        affordances[direction] ? (
          <span
            className={`rs-scroll-affordance rs-scroll-affordance--${direction}`}
            data-scroll-affordance={direction}
            key={direction}
          >
            <span className="rs-scroll-affordance__arrow" data-scroll-affordance-arrow />
          </span>
        ) : null,
      )}
    </>
  );
}

/**
 * The hint layer for a scroller that sits inside a `relative` frame the size of
 * its visible box. Render it as a sibling after the scroller; it fills the
 * frame and ignores pointer input. `className` lets a caller whose frame fades
 * (the Drawer's enter and exit) fade the arrows with it.
 */
export function ScrollAffordanceOverlay({
  affordances,
  className = "",
}: {
  affordances: VerticalScrollAffordances;
  className?: string;
}) {
  if (!affordances.top && !affordances.bottom) return null;
  return (
    <div
      aria-hidden="true"
      className={`rs-scroll-affordance-layer ${className}`.trim()}
      data-scroll-affordance-layer
    >
      <ScrollAffordanceMarkers affordances={affordances} />
    </div>
  );
}

/**
 * A scroller inside its own `relative` frame, for a bounded region that is a
 * child of a larger layout (a trade body above a fixed footer, a capped list, a
 * thumbnail grid). `className` shapes the frame as a layout child; the scroller
 * carries `scrollerClassName`, any other props (`id`, `role`, `aria-label`) and
 * optionally the caller's `scrollerRef`. The arrows sit on the frame, so they
 * stay on the scroller's visible viewport and never reach a sibling footer.
 */
export function ScrollAffordanceFrame({
  children,
  className = "",
  scrollerClassName,
  scrollerRef,
  ...scrollerProps
}: ComponentPropsWithoutRef<"div"> & {
  scrollerClassName?: string;
  scrollerRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollerRef ?? ownRef;
  const affordances = useScrollAffordances(ref);
  return (
    <div className={`relative ${className}`.trim()}>
      <div {...scrollerProps} className={scrollerClassName} ref={ref}>
        {children}
      </div>
      <ScrollAffordanceOverlay affordances={affordances} />
    </div>
  );
}
