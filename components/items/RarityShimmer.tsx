import type { ItemRarity } from "@/game/content/item-presentation";

/**
 * The reusable continuous rarity effect for Ultra Rare items and above (#342,
 * #399).
 *
 * A UI treatment applied by the shared item visuals from the item's authored
 * rarity, never baked into artwork, so the same art stays honest wherever it is
 * shown without the effect. Plain Rare items (the gems) keep only their outline
 * and render nothing here. Exactly two animated tiers exist:
 *
 * - Ultra Rare: the small animated plus sparkles only.
 * - Legendary: the same sparkles AND the light sweep travelling across the tile.
 *
 * Decorative: aria-hidden, no pointer events, and clipped to the tile it sits in.
 * Reduced-motion users get soft static sparkles, and a Legendary tile a static
 * soft highlight in place of the sweep (see the `.rs-item-shimmer` rules in
 * `app/globals.css`).
 */
const SHIMMER: Partial<Record<ItemRarity, { sweep: boolean }>> = {
  ultra_rare: { sweep: false },
  legendary: { sweep: true },
};

export function RarityShimmer({ rarity }: { rarity: ItemRarity | undefined }) {
  const shimmer = rarity ? SHIMMER[rarity] : undefined;
  if (!shimmer) return null;
  return (
    <span
      aria-hidden="true"
      className="rs-item-shimmer"
      data-item-shimmer={rarity}
      data-item-shimmer-sweep={shimmer.sweep ? "" : undefined}
    >
      <span className="rs-item-shimmer__spark" />
      <span className="rs-item-shimmer__spark" />
      <span className="rs-item-shimmer__spark" />
    </span>
  );
}
