import type { ReactNode } from "react";

/**
 * A titled section heading with an optional eyebrow.
 *
 * `level` is the heading rank this instance contributes to its page's document
 * outline. It defaults to `1` because that is what every existing consumer
 * already rendered; a surface that sits beneath another heading passes its own
 * rank rather than relying on the default.
 *
 * On a stationary Play screen the place itself owns the one `h1` — the scene
 * plate in `features/location-scene/LocationSceneHeader` (#193) — so every
 * panel composed beneath it passes `level={2}`, and a block inside one of those
 * panels passes `level={3}`. Rank is the only thing `level` changes: the
 * rendered size stays the section-heading size wherever it is used, because it
 * signals "this is a panel's title", not "this text is large".
 */
export function SectionHeader({
  eyebrow,
  children,
  level = 1,
}: {
  eyebrow?: string;
  children: ReactNode;
  level?: 1 | 2 | 3;
}) {
  const Heading = `h${level}` as const;
  return (
    <header>
      {eyebrow ? (
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
          {eyebrow}
        </p>
      ) : null}
      <Heading className="mt-1 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl">
        {children}
      </Heading>
    </header>
  );
}
