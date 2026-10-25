import Image from "next/image";
import { useId, type ReactNode } from "react";
import type { ItemRarity } from "@/game/content/item-presentation";
import { ITEM_RARITY_STYLE } from "./item-rarity";
import { RarityShimmer } from "./RarityShimmer";

type VisualTileProps = {
  accessibleLabel: string;
  accessibleDescription?: string;
  /**
   * Overrides the tile's default Mining-orange outline, for a tile that
   * belongs to one skill (skill XP, #304). Inventory tiles never pass it.
   */
  accentColor?: string;
  artworkSrc?: string;
  /** Omit to render no corner plate (unique items carry no fake stack quantity). */
  badge?: string;
  /**
   * The item's authored rarity (#308). A rare tile takes the rarity outline
   * unless the caller names its own accent (skill XP does); Ultra Rare and above
   * also carry the shared shimmer (#342): Ultra Rare sparkles only, Legendary
   * sparkles plus the travelling sweep and a visible label (#399). Ultra Rare shows sparkles only; Legendary
   * adds the travelling sweep and a visible label (#399).
   */
  rarity?: ItemRarity;
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
   * True (or `"active"`) when this tile is currently a semantic mission-guidance
   * target, `"available"` when a carried item offers a new Mission (#369). The
   * caller derives that from the projected guidance contract — the tile never
   * inspects missions itself — and applies the shared `.rs-mission-*` class.
   * Marks the tile accessibly for E2E/AT with the real semantic value.
   */
  missionGuidance?: boolean | "active" | "available";
  /** Exposed accessibly through `aria-pressed` and visually through a ring. */
  selected?: boolean;
  /** Overrides the selection ring's Mining-orange (Equipment's slot grid selects in cyan, #364). */
  selectionAccent?: string;
};

/** Shared compact frame for inventory content and non-inventory reward presentation. */
export function VisualTile({
  accessibleLabel,
  accessibleDescription,
  accentColor,
  artworkSrc,
  badge,
  rarity,
  background,
  className = "",
  fallbackText,
  interactive = false,
  mutedArtwork = false,
  name,
  onSelect,
  missionGuidance = false,
  selected = false,
  selectionAccent,
}: VisualTileProps) {
  const descriptionId = useId();
  const rootClassName = `relative min-h-28 overflow-hidden border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3 ${interactive ? "rs-focus w-full cursor-pointer text-left" : ""} ${selected ? "ring-2 ring-[color:var(--rs-accent-mining)]" : ""} ${className}`;
  const rootProps = {
    "aria-describedby": accessibleDescription ? descriptionId : undefined,
    "aria-label": accessibleLabel,
    "data-mission-guidance":
      missionGuidance === "available" ? "available" : missionGuidance ? "active" : undefined,
    className: rootClassName,
    "data-item-rarity": rarity,
    style: {
      ...(accentColor
        ? { borderColor: accentColor }
        : rarity
          ? { borderColor: ITEM_RARITY_STYLE[rarity].accent }
          : {}),
      ...(selectionAccent ? ({ "--tw-ring-color": selectionAccent } as object) : {}),
    },
  };
  const content = (
    <>
      {accessibleDescription ? (
        <span className="sr-only" id={descriptionId}>
          {accessibleDescription}
        </span>
      ) : null}
      {background}
      {/* The artwork zone stops where the reserved label band starts (#199), so
          a name that wraps to its second line never covers art that a
          single-line name leaves visible. The band is sized to leave the
          `min-h-28` tile more room than the `h-20` artwork needs; `max-h-full`
          keeps a shorter tile shrinking its art rather than overflowing. */}
      <span className="absolute inset-x-0 bottom-[var(--rs-item-label-block)] top-0 z-10 flex items-center justify-center">
        {artworkSrc ? (
          <Image
            alt=""
            className={`h-20 max-h-full w-20 max-w-full object-contain ${mutedArtwork ? "opacity-50 grayscale" : ""}`}
            data-offer-hop={missionGuidance === "available" ? "" : undefined}
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
      {/* Ultra Rare and above shimmer over the artwork zone (#342), under the
          nameplate and plates so labels stay fully legible. */}
      <RarityShimmer rarity={rarity} />
      {/* Legendary also reads as a word, never colour alone (#399). */}
      {rarity === "legendary" ? (
        <span className="rs-item-rarity-label" data-item-rarity-label="legendary">
          Legendary
        </span>
      ) : null}
      {/* One reserved two-line label band for every tile (#199). Skill XP uses
          accentColor and has no left stack-fill track, so its nameplate spans
          the full width; item tiles keep their stack-track clearance. */}
      <span
        data-nameplate
        className={`absolute bottom-0 right-0 z-20 flex min-h-[var(--rs-item-label-block)] items-center border-t border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-nameplate-surface)] px-2 font-display text-xs uppercase leading-[var(--rs-item-label-line-height)] tracking-wide ${accentColor ? "left-0" : "left-3"}`}
      >
        <span className="line-clamp-2 break-words">{name}</span>
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
