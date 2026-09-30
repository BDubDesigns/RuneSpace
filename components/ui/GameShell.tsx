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

export function BottomNav({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
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
}: {
  children: ReactNode;
  position: FloatingActionPosition;
  aboveBottomNav: boolean;
}) {
  const y = Math.min(1, Math.max(0, position.y));
  return (
    <div
      className={`pointer-events-none fixed top-[env(safe-area-inset-top)] z-20 py-[calc(var(--rs-touch-target)/2)] ${
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
 */
export function GameShell({
  topBar,
  children,
  bottomNav,
  floatingAction,
  floatingActionPosition = DEFAULT_FLOATING_ACTION_POSITION,
  aside,
}: {
  topBar: ReactNode;
  children: ReactNode;
  bottomNav?: ReactNode;
  floatingAction?: ReactNode;
  floatingActionPosition?: FloatingActionPosition;
  aside?: ReactNode;
}) {
  return (
    <div
      className={`rs-viewport-shell mx-auto max-w-7xl px-3 py-3 ${bottomNav ? "pb-[var(--rs-bottom-nav-clearance)]" : "pb-6"} sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5`}
    >
      <div className="min-w-0 space-y-4">
        {topBar}
        <main>{children}</main>
      </div>
      {aside ? <aside className="mt-4 lg:mt-0">{aside}</aside> : null}
      {floatingAction ? (
        <FloatingEdgeAnchor aboveBottomNav={Boolean(bottomNav)} position={floatingActionPosition}>
          {floatingAction}
        </FloatingEdgeAnchor>
      ) : null}
      {bottomNav ? <BottomNav>{bottomNav}</BottomNav> : null}
    </div>
  );
}
