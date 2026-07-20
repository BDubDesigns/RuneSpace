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
      <div
        aria-label={presentation.accessibleDescription}
        className="relative z-10 mb-2 flex h-12 items-center justify-center"
      >
        {presentation.artworkSrc ? (
          <Image
            alt=""
            className="h-full w-full object-contain"
            data-testid="item-artwork"
            height={512}
            priority
            src={presentation.artworkSrc}
            width={512}
          />
        ) : (
          <span className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]">
            {presentation.textFallback}
          </span>
        )}
      </div>
      <p className="relative z-10 font-display text-xs uppercase tracking-wide">{displayName}</p>
      <span className="absolute right-2 top-2 z-20 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-raised)] px-1.5 py-0.5 font-display text-xs">
        x{quantity}
      </span>
    </>
  );
}
