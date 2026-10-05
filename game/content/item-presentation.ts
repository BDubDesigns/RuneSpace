import { ITEM_IDS, type ItemId } from "@/game/config/foundations";
import { getItemDefinition } from "@/game/config/balance";

/**
 * Player-facing item presentation is content, not a UI concern. UI consumers
 * can use the returned artwork when it exists and their supplied name when it
 * does not.
 */
/**
 * An item's authored rarity, a presentation property of the ITEM (#308). A rare
 * item reads as rare on every shared item visual; it is independent of how the
 * item is obtained and of whether finding it is announced anywhere.
 */
export type ItemRarity = "rare";

export type ItemPresentation = {
  displayName: string;
  accessibleDescription: string;
  textFallback: string;
  artworkSrc?: string;
  /**
   * Player-facing flavour for the item's details (#308). Optional: items
   * authored before descriptions existed present without one.
   */
  description?: string;
  /** Omitted for an ordinary item. */
  rarity?: ItemRarity;
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
    artworkSrc: "/item-art/power-cell.webp",
  },
  [ITEM_IDS.refinedFerrite]: {
    displayName: "Refined Ferrite",
    accessibleDescription: "Stacked refined ingots of purified Ferrite metal",
    textFallback: "RF",
    artworkSrc: "/item-art/refined-ferrite.webp",
  },
  [ITEM_IDS.scrapMetal]: {
    displayName: "Scrap Metal",
    accessibleDescription: "Cut-down piece of salvaged scrap metal kept for welding practice",
    textFallback: "SM",
    artworkSrc: "/item-art/scrap-metal.webp",
  },
  [ITEM_IDS.galvanite]: {
    displayName: "Galvanite",
    accessibleDescription:
      "Chunks of dark Tier-2 ore shot through with bright conductive metallic veining",
    textFallback: "GV",
    artworkSrc: "/item-art/galvanite.webp",
  },
  [ITEM_IDS.galvanicStock]: {
    displayName: "Galvanic Stock",
    accessibleDescription: "Dense rough-cast conductive billets of refined Galvanite",
    textFallback: "GS",
    artworkSrc: "/item-art/galvanic-stock.webp",
  },
  [ITEM_IDS.galvaferrite]: {
    displayName: "Galvaferrite",
    accessibleDescription:
      "Stacked ingots of advanced structural conductor, each struck with a bolt mark",
    textFallback: "GF",
    artworkSrc: "/item-art/galvaferrite.webp",
  },
  [ITEM_IDS.slag]: {
    displayName: "Slag",
    accessibleDescription: "Vesicular slag byproduct from the refining process",
    textFallback: "SL",
    artworkSrc: "/item-art/slag.webp",
  },
  // Tier-1 Fabrication outputs (#232).
  [ITEM_IDS.mountingBracket]: {
    displayName: "Mounting Bracket",
    accessibleDescription: "Fabricated mounting bracket for permanent installations",
    textFallback: "MB",
    artworkSrc: "/item-art/mounting-bracket.webp",
  },
  [ITEM_IDS.scrapBox]: {
    displayName: "Scrap Box",
    accessibleDescription: "Crude, overbuilt fabricated container attachment",
    textFallback: "SB",
    artworkSrc: "/item-art/scrap-box.webp",
  },
  // Fabrication 5 and 8 outputs (#233).
  [ITEM_IDS.galvanicWireSpool]: {
    displayName: "Galvanic Wire Spool",
    accessibleDescription:
      "Spool of dark conductive Galvanic wire wound between bolted yellow-and-steel flanges, with a crimped lug on the free end",
    textFallback: "GW",
    artworkSrc: "/item-art/galvanic-wire-spool.webp",
  },
  [ITEM_IDS.loadsteelCutter]: {
    displayName: "Loadsteel Cutter",
    accessibleDescription:
      "Heavy yellow-and-steel Loadsteel Cutter mining tool with a guarded cutting disc, top carry handle and pistol grip",
    textFallback: "LC",
    artworkSrc: "/item-art/loadsteel-cutter.webp",
  },
  [ITEM_IDS.freightHarness]: {
    displayName: "Freight Harness",
    accessibleDescription:
      "Strapped freight harness frame with shoulder straps and hip belt carrying a rugged rear cargo box",
    textFallback: "FH",
    artworkSrc: "/item-art/freight-harness.webp",
  },
  // Mining Secondary Finds (#308).
  [ITEM_IDS.uncutQuartz]: {
    displayName: "Uncut Quartz",
    accessibleDescription:
      "Rough translucent smoky quartz crystals chipped free of a little dark host rock",
    textFallback: "UQ",
    artworkSrc: "/item-art/uncut-quartz.webp",
    rarity: "rare",
    description:
      "A rough translucent crystal chipped free from the rock. Common enough to recognize, valuable enough to keep.",
  },
  [ITEM_IDS.uncutTopaz]: {
    displayName: "Uncut Topaz",
    accessibleDescription:
      "Rough warm amber topaz crystals pulled from the rock with a little host matrix still clinging",
    textFallback: "UT",
    artworkSrc: "/item-art/uncut-topaz.webp",
    rarity: "rare",
    description:
      "A warm amber crystal pulled from the rock intact. Valuable even in its rough state.",
  },
  [ITEM_IDS.uncutSapphire]: {
    displayName: "Uncut Sapphire",
    accessibleDescription:
      "Rough deep blue sapphire crystals with fractured faces rising from a little dark host rock",
    textFallback: "US",
    artworkSrc: "/item-art/uncut-sapphire.webp",
    rarity: "rare",
    description:
      "A dense blue crystal with a rough, fractured surface. Rare, heavy-looking, and unmistakably valuable.",
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
