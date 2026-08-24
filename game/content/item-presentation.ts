import { ITEM_IDS, type ItemId } from "@/game/config/foundations";
import { getItemDefinition } from "@/game/config/balance";

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
    accessibleDescription: "Stacked refined ingots of purified Ferrite metal",
    textFallback: "RF",
    artworkSrc: "/item-art/refined-ferrite.webp",
  },
  [ITEM_IDS.slag]: {
    displayName: "Slag",
    accessibleDescription: "Vesicular slag byproduct from the refining process",
    textFallback: "SL",
    artworkSrc: "/item-art/slag.webp",
  },
} as const satisfies Partial<Record<ItemId, ItemPresentation>>;

export function getItemPresentation(itemId: string): ItemPresentation | undefined {
  return itemPresentations[itemId as ItemId];
}

/**
 * The authoritative quantity range for an item presentation beat, derived from
 * the item's inventory definition (the single source of truth for stack
 * limits). Stackable items allow 1..stackLimit; unique items are fixed at 1.
 * Unknown items have no valid beat quantity.
 */
export function getItemBeatQuantityRange(itemId: string): { min: number; max: number } | undefined {
  const definition = getItemDefinition(itemId);
  if (!definition) return undefined;
  if (definition.kind === "stack") {
    return { min: 1, max: definition.stackLimit };
  }
  return { min: 1, max: 1 };
}

export type DialogueItemCatalogEntry =
  | { id: ItemId; displayName: string; kind: "stack"; stackLimit: number }
  | { id: ItemId; displayName: string; kind: "unique" };

/**
 * Canonical selectable items for authoring/preview surfaces. The intersection
 * of authored item presentation and a current authoritative inventory
 * definition — never a hand-maintained UI list.
 */
export const DIALOGUE_ITEM_CATALOG: readonly DialogueItemCatalogEntry[] = Object.entries(
  itemPresentations,
).flatMap(([rawId, presentation]): DialogueItemCatalogEntry[] => {
  const itemId = rawId as ItemId;
  const definition = getItemDefinition(itemId);
  if (!definition) return [];
  if (definition.kind === "stack") {
    return [
      {
        id: itemId,
        displayName: presentation.displayName,
        kind: "stack",
        stackLimit: definition.stackLimit,
      },
    ];
  }
  return [{ id: itemId, displayName: presentation.displayName, kind: "unique" }];
});

export function resolveItemPresentation(itemId: string, fallbackName: string): ItemPresentation {
  return (
    getItemPresentation(itemId) ?? {
      displayName: fallbackName,
      accessibleDescription: fallbackName,
      textFallback: fallbackName,
    }
  );
}
