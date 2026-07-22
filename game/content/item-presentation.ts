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
  [ITEM_IDS.salvageCutter]: {
    displayName: "Salvage Cutter",
    accessibleDescription: "Vice-jaw improvised Salvage Cutter mining tool",
    textFallback: "SC",
    artworkSrc: "/item-art/salvage-cutter.png",
  },
  [ITEM_IDS.mykeaSchleppraum8]: {
    displayName: "MYKEA SCHLEPPRAUM-8",
    accessibleDescription: "White-and-blue MYKEA industrial flat-pack container with eight drawers",
    textFallback: "MY-8",
    artworkSrc: "/item-art/mykea-schleppraum-8.png",
  },
  [ITEM_IDS.powerCell]: {
    displayName: "Power Cell",
    accessibleDescription: "Salvaged DeWhat? power cell with QC FAILED marking and visible repairs",
    textFallback: "PC",
    artworkSrc: "/item-art/power-cell.png",
  },
  [ITEM_IDS.refinedFerrite]: {
    displayName: "Refined Ferrite",
    accessibleDescription: "Purified Ferrite material refined from raw mineral shale",
    textFallback: "RF",
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
