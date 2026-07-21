import { resolveItemPresentation } from "@/game/content/item-presentation";
import { VisualTile } from "./VisualTile";

type ItemVisualProps = {
  itemId: string;
  name: string;
  quantity: number;
  accessibleLabel?: string;
  background?: React.ReactNode;
  className?: string;
};

/** A compact, read-only item treatment for inventory and future equipment views. */
export function ItemVisual({
  itemId,
  name,
  quantity,
  accessibleLabel,
  background,
  className,
}: ItemVisualProps) {
  const presentation = resolveItemPresentation(itemId, name);
  return (
    <VisualTile
      accessibleLabel={accessibleLabel ?? `${quantity} ${presentation.displayName}`}
      artworkSrc={presentation.artworkSrc}
      background={background}
      badge={`x${quantity}`}
      className={className}
      fallbackText={presentation.textFallback}
      name={presentation.displayName}
    />
  );
}
