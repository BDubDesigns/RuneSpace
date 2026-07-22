import { resolveItemPresentation } from "@/game/content/item-presentation";
import { VisualTile } from "./VisualTile";

type ItemVisualProps = {
  itemId: string;
  name: string;
  quantity?: number;
  badge?: string;
  accessibleLabel?: string;
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
  background,
  className,
}: ItemVisualProps) {
  const presentation = resolveItemPresentation(itemId, name);
  return (
    <VisualTile
      accessibleDescription={presentation.accessibleDescription}
      accessibleLabel={accessibleLabel ?? `${quantity ?? 1} ${presentation.displayName}`}
      artworkSrc={presentation.artworkSrc}
      background={background}
      badge={badge ?? `x${quantity ?? 1}`}
      className={className}
      fallbackText={presentation.textFallback}
      name={presentation.displayName}
    />
  );
}
