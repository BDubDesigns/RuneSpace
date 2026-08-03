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

export function GameShell({
  topBar,
  children,
  bottomNav,
  aside,
}: {
  topBar: ReactNode;
  children: ReactNode;
  bottomNav?: ReactNode;
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
      {bottomNav ? <BottomNav>{bottomNav}</BottomNav> : null}
    </div>
  );
}
