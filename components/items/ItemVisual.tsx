import { resolveItemPresentation } from "@/game/content/item-presentation";
import { VisualTile } from "./VisualTile";

type ItemVisualProps = {
  itemId: string;
  name: string;
  quantity?: number;
  badge?: string;
  accessibleLabel?: string;
  /**
   * Item-specific player-facing state (e.g., "3 of 10 charges remaining"),
   * appended to the item's approved presentation description so screen-reader
   * users receive the same state the tile shows visually.
   */
  additionalDescription?: string;
  mutedArtwork?: boolean;
  background?: React.ReactNode;
  className?: string;
};

/** A compact, read-only item treatment for inventory and future equipment views. */
export function ItemVisual({
  itemId,
  name,
  quantity,
  badge,
  accessibleLabel,
  additionalDescription,
  mutedArtwork,
  background,
  className,
}: ItemVisualProps) {
  const presentation = resolveItemPresentation(itemId, name);
  return (
    <VisualTile
      accessibleDescription={
        additionalDescription
          ? `${presentation.accessibleDescription}. ${additionalDescription}`
          : presentation.accessibleDescription
      }
      accessibleLabel={
        accessibleLabel ??
        (quantity !== undefined
          ? `${quantity} ${presentation.displayName}`
          : presentation.displayName)
      }
      artworkSrc={presentation.artworkSrc}
      background={background}
      badge={badge ?? (quantity !== undefined ? `x${quantity}` : undefined)}
      className={className}
      fallbackText={presentation.textFallback}
      mutedArtwork={mutedArtwork}
      name={presentation.displayName}
    />
  );
}
