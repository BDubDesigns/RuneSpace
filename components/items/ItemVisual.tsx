import Image from "next/image";
import { resolveItemPresentation } from "@/game/content/item-presentation";

type ItemVisualProps = {
  itemId: string;
  name: string;
  quantity: number;
};

/** A compact, read-only item treatment for inventory and future equipment views. */
export function ItemVisual({ itemId, name, quantity }: ItemVisualProps) {
  const presentation = resolveItemPresentation(itemId, name);
  const displayName = presentation.displayName;

  return (
    <>
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        {presentation.artworkSrc ? (
          <Image
            alt={presentation.accessibleDescription}
            className="h-20 w-20 max-w-full object-contain"
            data-testid="item-artwork"
            height={512}
            src={presentation.artworkSrc}
            width={512}
          />
        ) : (
          <span className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]">
            {presentation.textFallback}
          </span>
        )}
      </div>
      <p className="absolute bottom-2 left-2 z-20 bg-[rgb(107_114_128_/_0.5)] px-1.5 py-0.5 font-display text-xs uppercase tracking-wide">
        {displayName}
      </p>
      <span className="absolute right-2 top-2 z-20 bg-[rgb(107_114_128_/_0.5)] px-1.5 py-0.5 font-display text-xs">
        x{quantity}
      </span>
    </>
  );
}
