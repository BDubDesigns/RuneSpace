"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useModalDrawerOpen } from "@/components/ui/Drawer";
import { ScrollAffordanceMarkers } from "@/components/ui/ScrollAffordances";
import {
  getVerticalScrollAffordances,
  NO_VERTICAL_SCROLL_AFFORDANCES,
  sameVerticalScrollAffordances,
  type VerticalScrollAffordances,
} from "@/components/ui/scroll-affordances";
import { usePlay } from "./PlayContext";
import { useDesktopWorkspace } from "./workspace-presentation";

/**
 * PREVIEW EXPERIMENT (#345, owner-approved, pending the owner's playtest).
 *
 * Amber up / down arrows on the phone's main Location screen, where the page
 * itself scrolls (the Activity sits below the location scene and is not always
 * obviously reachable). Every other scroll hint in RuneSpace belongs to a bounded
 * panel; this is the one deliberate exception, and it is built to be removed on
 * its own: delete this file and its single `<PlayPageScrollHints />` line in
 * `PlayScreen.tsx`. The reusable panel hints do not depend on it.
 *
 * - Truth comes from the actual document scroller (`scrollY`, the root's
 *   `clientHeight` and `scrollHeight`), never from `LocationSurface` or Activity
 *   dimensions, using the same near-edge rule and the same arrow as the panels.
 * - The layer is `position: fixed` and ignores pointer input: it reserves no
 *   layout height, scrolls no page, and swallows no tap. It is anchored to the
 *   visible viewport — below the top safe area, above the fixed bottom
 *   navigation with clearance — and horizontally to the primary gameplay column
 *   (`<main>`), so a tablet's off-centre column keeps its arrows.
 * - Phone/tablet composition only (the desktop dock has a different page and no
 *   bottom navigation), the primary Location view only (not Map or Journey), and
 *   not while a modal Drawer owns the screen, which locks the document behind it.
 * - Plain amber/yellow. Mission-coloured edge cues stay a map-only behaviour.
 */

type PageHints = {
  affordances: VerticalScrollAffordances;
  left: number;
  width: number;
};

const NO_PAGE_HINTS: PageHints = {
  affordances: NO_VERTICAL_SCROLL_AFFORDANCES,
  left: 0,
  width: 0,
};

function readPageHints(): PageHints {
  const root = document.documentElement;
  const affordances = getVerticalScrollAffordances({
    scrollTop: window.scrollY,
    clientHeight: root.clientHeight,
    scrollHeight: root.scrollHeight,
  });
  if (!affordances.top && !affordances.bottom) return NO_PAGE_HINTS;
  const column = document.querySelector("main")?.getBoundingClientRect();
  return {
    affordances,
    left: Math.round(column?.left ?? 0),
    width: Math.round(column?.width ?? root.clientWidth),
  };
}

function usePageScrollAffordances(enabled: boolean): PageHints {
  const [hints, setHints] = useState<PageHints>(NO_PAGE_HINTS);

  useEffect(() => {
    if (!enabled) {
      setHints(NO_PAGE_HINTS);
      return;
    }

    const update = () => {
      const next = readPageHints();
      setHints((previous) =>
        sameVerticalScrollAffordances(previous.affordances, next.affordances) &&
        previous.left === next.left &&
        previous.width === next.width
          ? previous
          : next,
      );
    };

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(document.documentElement);
    observer?.observe(document.body);
    const main = document.querySelector("main");
    if (main) observer?.observe(main);

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [enabled]);

  return enabled ? hints : NO_PAGE_HINTS;
}

export function PlayPageScrollHints() {
  const desktop = useDesktopWorkspace();
  const mapActive = useSearchParams().get("surface") === "map";
  const { state } = usePlay();
  const modalOpen = useModalDrawerOpen();
  const inTransit = Boolean(state.travelState);
  const enabled = desktop === false && !mapActive && !inTransit && !modalOpen;
  const { affordances, left, width } = usePageScrollAffordances(enabled);

  if (!affordances.top && !affordances.bottom) return null;
  return (
    <div
      aria-hidden="true"
      className="rs-scroll-affordance-layer rs-scroll-affordance-layer--viewport"
      data-play-page-scroll-affordances
      style={{ left, width }}
    >
      <ScrollAffordanceMarkers affordances={affordances} />
    </div>
  );
}
