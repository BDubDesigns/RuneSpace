import type { ReactNode } from "react";

export function TopBar({ title, detail }: { title: string; detail?: string }) {
  return (
    <header className="rs-bevel border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-4 py-3 shadow-[var(--rs-glow-primary)]">
      <p className="font-display text-lg font-bold text-[color:var(--rs-text-primary)]">{title}</p>
      {detail ? <p className="text-xs text-[color:var(--rs-text-muted)]">{detail}</p> : null}
    </header>
  );
}

export function BottomNav({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Primary"
      className="bg-[color:var(--rs-surface-raised)]/95 fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--rs-border-structural)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
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
    <div className="mx-auto min-h-screen max-w-7xl px-3 py-3 pb-24 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5 lg:pb-6">
      <div className="min-w-0 space-y-4">
        {topBar}
        <main>{children}</main>
      </div>
      {aside ? <aside className="mt-4 lg:mt-0">{aside}</aside> : null}
      {bottomNav ? <BottomNav>{bottomNav}</BottomNav> : null}
    </div>
  );
}
