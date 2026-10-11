import type { ItemRarity } from "@/game/content/item-presentation";

/**
 * The reusable continuous shimmer for Ultra Rare items and above (#342).
 *
 * A UI treatment applied by the shared item visuals from the item's authored
 * rarity — never baked into artwork, so the same art stays honest wherever it is
 * shown without the effect. Plain Rare items (the gems) keep only their outline
 * and render nothing here. A higher rarity later adds its own entry; the
 * `--rs-shimmer-strength` dial lets it read brighter without a second component.
 *
 * Decorative: aria-hidden, no pointer events, and clipped to the tile it sits in.
 * Reduced-motion users get soft static sparkles instead of movement (see the
 * `.rs-item-shimmer` rules in `app/globals.css`).
 */
const SHIMMER_STRENGTH: Partial<Record<ItemRarity, number>> = {
  ultra_rare: 1,
};

export function RarityShimmer({ rarity }: { rarity: ItemRarity | undefined }) {
  const strength = rarity ? SHIMMER_STRENGTH[rarity] : undefined;
  if (strength === undefined) return null;
  return (
    <span
      aria-hidden="true"
      className="rs-item-shimmer"
      data-item-shimmer={rarity}
      style={{ "--rs-shimmer-strength": strength } as React.CSSProperties}
    >
      <span className="rs-item-shimmer__spark" />
      <span className="rs-item-shimmer__spark" />
      <span className="rs-item-shimmer__spark" />
    </span>
  );
}
