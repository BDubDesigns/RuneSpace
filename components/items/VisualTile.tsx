import Image from "next/image";
import { useId, type ReactNode } from "react";

type VisualTileProps = {
  accessibleLabel: string;
  accessibleDescription?: string;
  artworkSrc?: string;
  /** Omit to render no corner plate (unique items carry no fake stack quantity). */
  badge?: string;
  background?: ReactNode;
  className?: string;
  fallbackText: string;
  /**
   * Render the tile as a native button so occupied inventory tiles are
   * operable by mouse, touch, and keyboard. The internal layers are phrasing
   * content so the button stays valid HTML.
   */
  interactive?: boolean;
  mutedArtwork?: boolean;
  name: string;
  onSelect?: () => void;
  /**
   * True when this tile is currently a semantic mission-guidance target. The
   * caller derives that from the projected guidance contract — the tile never
   * inspects missions itself. Marks the tile accessibly for E2E/AT.
   */
  missionGuidance?: boolean;
  /** Exposed accessibly through `aria-pressed` and visually through a ring. */
  selected?: boolean;
};

/** Shared compact frame for inventory content and non-inventory reward presentation. */
export function VisualTile({
  accessibleLabel,
  accessibleDescription,
  artworkSrc,
  badge,
  background,
  className = "",
  fallbackText,
  interactive = false,
  mutedArtwork = false,
  name,
  onSelect,
  missionGuidance = false,
  selected = false,
}: VisualTileProps) {
  const descriptionId = useId();
  const rootClassName = `relative min-h-28 overflow-hidden border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3 ${interactive ? "rs-focus w-full cursor-pointer text-left" : ""} ${selected ? "ring-2 ring-[color:var(--rs-accent-mining)]" : ""} ${className}`;
  const rootProps = {
    "aria-describedby": accessibleDescription ? descriptionId : undefined,
    "aria-label": accessibleLabel,
    "data-mission-guidance": missionGuidance ? "active" : undefined,
    className: rootClassName,
  };
  const content = (
    <>
      {accessibleDescription ? (
        <span className="sr-only" id={descriptionId}>
          {accessibleDescription}
        </span>
      ) : null}
      {background}
      <span className="absolute inset-0 z-10 flex items-center justify-center">
        {artworkSrc ? (
          <Image
            alt=""
            className={`h-20 w-20 max-w-full object-contain ${mutedArtwork ? "opacity-50 grayscale" : ""}`}
            data-testid="item-artwork"
            height={160}
            sizes="80px"
            src={artworkSrc}
            width={160}
          />
        ) : (
          <span
            data-item-fallback
            className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]"
          >
            {fallbackText}
          </span>
        )}
      </span>
      <span
        data-nameplate
        className="absolute bottom-0 left-3 right-0 z-20 block truncate border-t border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-nameplate-surface)] px-2 py-0.5 font-display text-xs uppercase tracking-wide"
      >
        {name}
      </span>
      {badge !== undefined ? (
        <span className="absolute right-2 top-2 z-20 border border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-plate-surface)] px-1.5 py-0.5 font-display text-xs">
          {badge}
        </span>
      ) : null}
    </>
  );
  if (interactive) {
    return (
      <button {...rootProps} aria-pressed={selected} onClick={onSelect} type="button">
        {content}
      </button>
    );
  }
  return <article {...rootProps}>{content}</article>;
}
