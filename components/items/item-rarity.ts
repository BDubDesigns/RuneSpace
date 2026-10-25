import type { ItemRarity } from "@/game/content/item-presentation";

/**
 * How an item's authored rarity reads on a shared item visual (#308). Rarity is
 * a property of the item's own presentation, so the tile border and the stack
 * indicator follow the item everywhere it is drawn (Inventory, storage, recipes,
 * rewards) without any surface inspecting where the item came from. The values
 * are tokens in `app/globals.css`; an item with no rarity uses none of this and
 * keeps the default look.
 */
export const ITEM_RARITY_STYLE = {
  rare: {
    accent: "var(--rs-item-rare-accent)",
    stackTrack: "var(--rs-item-rare-stack-track)",
  },
  // Ultra Rare (#342) takes its own accent; the continuous shimmer that goes with
  // it is applied by the shared visual through `data-item-rarity`, never baked
  // into an item's artwork.
  ultra_rare: {
    accent: "var(--rs-item-ultra-rare-accent)",
    stackTrack: "var(--rs-item-ultra-rare-stack-track)",
  },
  // Legendary (#399) takes its own gold accent, clearly apart from Ultra Rare's
  // orange. Its tile also carries a visible text label (VisualTile), so the
  // distinction never rests on colour alone.
  legendary: {
    accent: "var(--rs-item-legendary-accent)",
    stackTrack: "var(--rs-item-legendary-stack-track)",
  },
} as const satisfies Record<ItemRarity, { accent: string; stackTrack: string }>;
