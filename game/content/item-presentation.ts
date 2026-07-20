import { ITEM_IDS, type ItemId } from "@/game/config/foundations";

/**
 * Player-facing item presentation is content, not a UI concern. UI consumers
 * can use the returned artwork when it exists and their supplied name when it
 * does not.
 */
export type ItemPresentation = {
  displayName: string;
  accessibleDescription: string;
  textFallback: string;
  artworkSrc?: string;
};

const itemPresentations = {
  [ITEM_IDS.ferriteShale]: {
    displayName: "Ferrite Shale",
    accessibleDescription: "Ferrite Shale mineral fragment",
    textFallback: "FS",
    artworkSrc: "/item-art/ferrite-shale.webp",
  },
} as const satisfies Partial<Record<ItemId, ItemPresentation>>;

export function getItemPresentation(itemId: string): ItemPresentation | undefined {
  return itemPresentations[itemId as ItemId];
}

export function resolveItemPresentation(itemId: string, fallbackName: string): ItemPresentation {
  return (
    getItemPresentation(itemId) ?? {
      displayName: fallbackName,
      accessibleDescription: fallbackName,
      textFallback: fallbackName,
    }
  );
}
