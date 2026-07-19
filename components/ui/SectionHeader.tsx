import type { ReactNode } from "react";

export function SectionHeader({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <header>
      {eyebrow ? (
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl">
        {children}
      </h1>
    </header>
  );
}
