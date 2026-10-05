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
} as const satisfies Record<ItemRarity, { accent: string; stackTrack: string }>;
