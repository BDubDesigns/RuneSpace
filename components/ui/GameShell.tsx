import type { ReactNode } from "react";

export function TopBar({
  title,
  detail,
  trailing,
}: {
  title: ReactNode;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="rs-bevel border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-4 py-3 shadow-[var(--rs-glow-primary)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 font-display text-lg font-bold text-[color:var(--rs-text-primary)]">
          {title}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {detail ? <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">{detail}</p> : null}
    </header>
  );
}

export function BottomNav({
  children,
  hiddenAtDesktop = false,
}: {
  children: ReactNode;
  /** The shell's desktop rail replaces the bar at `xl` and wider (#286). */
  hiddenAtDesktop?: boolean;
}) {
  return (
    <nav
      aria-label="Primary"
      className={`${hiddenAtDesktop ? "xl:hidden" : ""} fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm`}
    >
      {children}
    </nav>
  );
}

/**
 * Where a floating action rests, normalized so a rotation or viewport change
 * can never strand it offscreen: which edge, and how far down the usable
 * viewport its centre sits (0 = top, 1 = bottom, clamped). Nothing persists
 * or changes it yet; it exists so a later drag-and-snap can store one value.
 */
export type FloatingActionPosition = { side: "left" | "right"; y: number };

export const DEFAULT_FLOATING_ACTION_POSITION: FloatingActionPosition = { side: "right", y: 0.5 };

/**
 * Pins one compact control flush to a screen edge. The track spans the usable
 * viewport — below the top safe area, above the fixed BottomNav when there is
 * one — inset by half a touch target, so the control stays wholly on screen at
 * any `y`. The track ignores pointer events; only the control receives them.
 * It reserves no page space: it overlays content at the edge like any other
 * fixed control.
 */
function FloatingEdgeAnchor({
  children,
  position,
  aboveBottomNav,
  hiddenAtDesktop,
}: {
  children: ReactNode;
  position: FloatingActionPosition;
  aboveBottomNav: boolean;
  hiddenAtDesktop: boolean;
}) {
  const y = Math.min(1, Math.max(0, position.y));
  return (
    <div
      className={`${hiddenAtDesktop ? "xl:hidden" : ""} pointer-events-none fixed top-[env(safe-area-inset-top)] z-20 py-[calc(var(--rs-touch-target)/2)] ${
        aboveBottomNav
          ? "bottom-[var(--rs-bottom-nav-box-height)]"
          : "bottom-[env(safe-area-inset-bottom)]"
      } ${
        position.side === "right"
          ? "right-[env(safe-area-inset-right)]"
          : "left-[env(safe-area-inset-left)]"
      }`}
      data-floating-action-side={position.side}
    >
      <div className="relative h-full">
        <div
          className={`pointer-events-auto absolute flex -translate-y-1/2 ${
            position.side === "right" ? "right-0" : "left-0"
          }`}
          style={{ top: `${y * 100}%` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Page chrome. `floatingAction` is one compact control the shell pins to a
 * screen edge (by default the right edge, centred in the usable viewport) —
 * the shell only positions it; the feature owns the control.
 *
 * `desktopRail` (#286) turns the shell into the desktop Play composition at
 * `xl` (1280px) and wider: a 24rem right-hand rail beside the main column,
 * independently scrolling, full viewport height and sticky; `mainHeader` is one
 * compact row at the top of `<main>`, above the page content; and the bottom
 * navigation and floating action — the phone's way of reaching the same
 * destinations — are hidden. Below `xl` the rail and header render nothing and
 * the shell is the phone/tablet composition it always was. The shell only
 * places these slots with CSS; the feature decides what mounts in them, so no
 * interactive feature is ever mounted twice.
 */
export function GameShell({
  topBar,
  children,
  bottomNav,
  floatingAction,
  floatingActionPosition = DEFAULT_FLOATING_ACTION_POSITION,
  aside,
  desktopRail,
  mainHeader,
}: {
  topBar: ReactNode;
  children: ReactNode;
  bottomNav?: ReactNode;
  floatingAction?: ReactNode;
  floatingActionPosition?: FloatingActionPosition;
  aside?: ReactNode;
  desktopRail?: ReactNode;
  mainHeader?: ReactNode;
}) {
  const hasRail = desktopRail !== undefined;
  // Joined from parts, not concatenated: a trailing space inside a string is
  // trimmed by the class sorter and would fuse two utilities into one.
  const shellClassName = [
    "rs-viewport-shell mx-auto max-w-7xl px-3 py-3 sm:px-6",
    bottomNav ? "pb-[var(--rs-bottom-nav-clearance)]" : "pb-6",
    bottomNav && hasRail ? "xl:pb-3" : "",
    "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5",
    hasRail ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={shellClassName}>
      <div className="min-w-0 space-y-4">
        {topBar}
        <main>
          {mainHeader ? <div className="mb-4 hidden justify-end xl:flex">{mainHeader}</div> : null}
          {children}
        </main>
      </div>
      {aside ? <aside className="mt-4 lg:mt-0">{aside}</aside> : null}
      {hasRail ? (
        <aside
          aria-label="Play workspace"
          className="hidden min-h-0 flex-col gap-3 xl:sticky xl:top-3 xl:flex xl:h-[calc(100dvh-1.5rem)] xl:self-start"
          data-play-rail=""
        >
          {desktopRail}
        </aside>
      ) : null}
      {floatingAction ? (
        <FloatingEdgeAnchor
          aboveBottomNav={Boolean(bottomNav)}
          hiddenAtDesktop={hasRail}
          position={floatingActionPosition}
        >
          {floatingAction}
        </FloatingEdgeAnchor>
      ) : null}
      {bottomNav ? <BottomNav hiddenAtDesktop={hasRail}>{bottomNav}</BottomNav> : null}
    </div>
  );
}
