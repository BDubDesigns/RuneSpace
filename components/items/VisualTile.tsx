import Image from "next/image";
import type { ReactNode } from "react";

type VisualTileProps = {
  accessibleLabel: string;
  artworkSrc?: string;
  badge: string;
  background?: ReactNode;
  className?: string;
  fallbackText: string;
  name: string;
};

/** Shared compact frame for inventory content and non-inventory reward presentation. */
export function VisualTile({
  accessibleLabel,
  artworkSrc,
  badge,
  background,
  className = "",
  fallbackText,
  name,
}: VisualTileProps) {
  return (
    <article
      aria-label={accessibleLabel}
      className={`relative min-h-28 overflow-hidden border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3 ${className}`}
    >
      {background}
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        {artworkSrc ? (
          <Image
            alt=""
            className="h-20 w-20 max-w-full object-contain"
            data-testid="item-artwork"
            height={160}
            sizes="80px"
            src={artworkSrc}
            width={160}
          />
        ) : (
          <span className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]">
            {fallbackText}
          </span>
        )}
      </div>
      <p className="absolute bottom-0 left-3 right-0 z-20 truncate border-t border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-nameplate-surface)] px-2 py-0.5 font-display text-xs uppercase tracking-wide">
        {name}
      </p>
      <span className="absolute right-2 top-2 z-20 border border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-plate-surface)] px-1.5 py-0.5 font-display text-xs">
        {badge}
      </span>
    </article>
  );
}
