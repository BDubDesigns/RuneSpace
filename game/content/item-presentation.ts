import { ITEM_IDS, type ItemId } from "@/game/config/foundations";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";

/** The Fuel Units a Full Small Fuel Canister carries: authored on the item, never restated. */
const FULL_CANISTER_FUEL_UNITS = getEffectiveGameBalance().items.fullSmallFuelCanister.fuelUnits;

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
export type ItemRarity = "rare" | "ultra_rare" | "legendary";

/** The player-facing label of each rarity, one place for the Wiki and any tag that names it. */
export const ITEM_RARITY_LABELS = {
  rare: "Rare",
  ultra_rare: "Ultra Rare",
  legendary: "Legendary",
} as const satisfies Record<ItemRarity, string>;

/**
 * The rarities whose trade offers carry the scarcity/value warning (#399). A
 * property of rarity, so a future Ultra Rare or Legendary item is covered the
 * moment it is authored, and no item ID is named.
 */
export const TRADE_SCARCITY_RARITIES: readonly ItemRarity[] = ["ultra_rare", "legendary"];

export type ItemPresentation = {
  displayName: string;
  /**
   * The name when the item is counted and the count is not one ("2 Wheel
   * Assemblies"). Authored only where adding an "s" would be wrong or the item
   * is a countable thing; omitted names (Refined Ferrite, Slag) read the same at
   * any quantity.
   */
  pluralName?: string;
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
    pluralName: "Power Cells",
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
    pluralName: "Mounting Brackets",
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
    pluralName: "Galvanic Wire Spools",
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
  // The Landing Gear's wheel (#322).
  [ITEM_IDS.wheelAssembly]: {
    displayName: "Wheel Assembly",
    pluralName: "Wheel Assemblies",
    accessibleDescription:
      "Rebuilt heavy-duty wheel with a deep-treaded rubber tire, riveted steel hub plates and a pinned swivel mounting plate, rust-streaked and work-worn",
    textFallback: "WA",
    artworkSrc: "/item-art/wheel-assembly.webp",
  },
  // The Propulsion System's mounting interface (#330).
  [ITEM_IDS.driveMount]: {
    displayName: "Drive Mount",
    pluralName: "Drive Mounts",
    accessibleDescription:
      "Heavy steel drive mount, a welded cylindrical housing between two square bolted flanges, with a splined socket at one end and a copper-collared power connector on a short armoured lead",
    textFallback: "DM",
    artworkSrc: "/item-art/drive-mount.webp",
    description: "A reinforced powered mount that secures the ship's drive to its frame.",
  },
  // Skatboll Oil Shale Mining (#342). The art carries no baked sparkle: the Ultra
  // Rare shimmer belongs to the shared item visuals, keyed off `rarity`.
  [ITEM_IDS.oilShale]: {
    displayName: "Oil Shale",
    accessibleDescription:
      "A cluster of glossy, dark, thinly layered shale pieces with rusty orange edges and oily, reflective faces",
    textFallback: "OS",
    artworkSrc: "/item-art/oil-shale.webp",
    description: "Dark, thinly layered shale that still weeps a little oil. Heavy for its size.",
  },
  [ITEM_IDS.motherlodeSlab]: {
    displayName: "Motherlode Slab",
    pluralName: "Motherlode Slabs",
    accessibleDescription:
      "One large, unbroken slab of richly layered dark shale with a bright amber seam running through its cut face",
    textFallback: "MS",
    artworkSrc: "/item-art/motherlode-slab.webp",
    rarity: "ultra_rare",
    description:
      "A single unbroken specimen of layered Oil Shale with an amber, oil-rich seam through it. Twelve kilograms of the real thing.",
  },
  // Rune materials (#367). Ordinary physical materials: no rarity or special treatment.
  [ITEM_IDS.runeFragment]: {
    displayName: "Rune Fragment",
    pluralName: "Rune Fragments",
    accessibleDescription:
      "A small, pointed, triangular shard of dark grey stone with glowing violet and cyan crystalline seams",
    textFallback: "FR",
    artworkSrc: "/item-art/rune-fragment.webp",
    description:
      "A broken piece of an unusual mineral that seems to resonate with something just beyond ordinary space. Useful for basic Runeworking.",
  },
  [ITEM_IDS.runestone]: {
    displayName: "Runestone",
    pluralName: "Runestones",
    accessibleDescription:
      "A large, irregular, intact grey stone with prismatic violet, blue and teal seams and a circular, angled rune engraved into its face",
    textFallback: "RS",
    artworkSrc: "/item-art/runestone.webp",
    description:
      "An intact stone with an unusually strong resonance. Valuable for advanced Runeworking, but can be broken into five Rune Fragments.",
  },
  // The first Runeworking output (#391). An ordinary stack with no Use yet.
  [ITEM_IDS.beginnerEchoSeeker]: {
    displayName: "Beginner Echo Seeker",
    pluralName: "Beginner Echo Seekers",
    accessibleDescription:
      "A dark, chipped triangular shard of rune stone with glowing violet and cyan grooves and a concentric resonant glyph around a small bright central point",
    textFallback: "ES",
    artworkSrc: "/item-art/beginner-echo-seeker.webp",
    description:
      "A fragment attuned to detect hidden disturbances in RuneSpace. Consume one to sense the direction of a hidden Resonance Echo on your current planet.",
  },
  // Stillreach Prospecting Quarry Mining (#379). Stone is the ordinary primary
  // resource; the Boulder is its single Ultra Rare find. Neither's art bakes in
  // a sparkle: the Ultra Rare shimmer belongs to the shared item visuals, keyed
  // off `rarity`.
  [ITEM_IDS.stone]: {
    displayName: "Stone",
    accessibleDescription:
      "A small pile of four chipped, angular pieces of grey-tan quarry rock with rough faces and sharp edges",
    textFallback: "ST",
    artworkSrc: "/item-art/stone.webp",
    description:
      "Plain quarried rock, chipped off the face in pieces. Heavy for how little it is worth.",
  },
  [ITEM_IDS.boulder]: {
    displayName: "Boulder",
    pluralName: "Boulders",
    accessibleDescription:
      "One large, angular, tan and grey boulder with rough chiselled faces, ordinary in every way",
    textFallback: "BO",
    artworkSrc: "/item-art/boulder.webp",
    rarity: "ultra_rare",
    description:
      "A rock. Just a rock, five kilograms of it, and somehow the one everyone wants to be seen holding.",
  },
  // Fuel manufacturing (#343). The two canisters are one silver cylinder family;
  // the fill state is the physical red cap and red side locking bar, so the art
  // has no baked label and the Full one's contents are said in words.
  [ITEM_IDS.emptySmallFuelCanister]: {
    displayName: "Empty Small Fuel Canister",
    pluralName: "Empty Small Fuel Canisters",
    accessibleDescription:
      "Upright weathered silver steel fuel canister inside a protective collar, with an exposed brass valve and no red hardware",
    textFallback: "EC",
    artworkSrc: "/item-art/empty-small-fuel-canister.webp",
    description:
      "A bare steel canister with its valve shut and nothing inside. It is worth little until something fills it.",
  },
  [ITEM_IDS.fullSmallFuelCanister]: {
    displayName: "Full Small Fuel Canister",
    pluralName: "Full Small Fuel Canisters",
    accessibleDescription:
      "Upright weathered silver steel fuel canister inside a protective collar, with a bright red valve cap and a bright red vertical locking bar on its side",
    textFallback: "FC",
    artworkSrc: "/item-art/full-small-fuel-canister.webp",
    description: `A red-capped canister, locked shut and filled with ${FULL_CANISTER_FUEL_UNITS} Fuel Units. Heavy for its size.`,
  },
  // The Legendary miner's set (#399): the rarest Beginner Echo prizes. The art
  // carries no baked sparkle or sweep: the Legendary treatment belongs to the
  // shared item visuals, keyed off `rarity`.
  [ITEM_IDS.minersBoots]: {
    displayName: "Miner's Boots",
    pluralName: "Miner's Boots",
    accessibleDescription:
      "A pair of rugged charcoal and gunmetal industrial work boots with steel toe and heel reinforcements, warm amber trim and a small triple-hex insignia",
    textFallback: "MBo",
    artworkSrc: "/item-art/miners-boots.webp",
    rarity: "legendary",
    description:
      "Steel-reinforced work boots that grip loose rock like they were made for it. Worn on the feet, they add one effective Mining level to your success chance, and nothing else.",
  },
  [ITEM_IDS.minersGloves]: {
    displayName: "Miner's Gloves",
    pluralName: "Miner's Gloves",
    accessibleDescription:
      "A pair of rugged charcoal and gunmetal industrial work gloves with steel knuckle reinforcements, warm amber trim and a small triple-hex insignia",
    textFallback: "MGl",
    artworkSrc: "/item-art/miners-gloves.webp",
    rarity: "legendary",
    description:
      "Steel-reinforced work gloves that find the grip in any seam. Worn on the hands, they add one effective Mining level to your success chance, and nothing else.",
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

/**
 * "1 Wheel Assembly" / "2 Wheel Assemblies" / "5 Refined Ferrite": a counted
 * item name in its authored singular or plural, falling back to the supplied
 * name for an item with no presentation.
 */
export function itemQuantityLabel(itemId: string, quantity: number, fallbackName: string): string {
  const presentation = resolveItemPresentation(itemId, fallbackName);
  const name =
    quantity === 1
      ? presentation.displayName
      : (presentation.pluralName ?? presentation.displayName);
  return `${quantity} ${name}`;
}
