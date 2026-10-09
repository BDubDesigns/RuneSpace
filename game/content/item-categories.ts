import { ITEM_IDS, type ItemId } from "@/game/config/foundations";

/**
 * The Wiki's editorial item classification (#338).
 *
 * Four closed categories that say what an item IS — never how it is obtained.
 * This is classification only: no stat, recipe or source is stated here.
 * `validateItemCategories` ties it to the shipped inventory registry, so a
 * newly authored item without a category, a category on an item that is not
 * shipped, or a category that lists nothing fails when the Wiki is built.
 */
export const ITEM_CATEGORY_IDS = [
  "ores-and-gemstones",
  "processed-materials",
  "components-and-supplies",
  "tools-and-containers",
] as const;

export type ItemCategoryId = (typeof ITEM_CATEGORY_IDS)[number];

/** Player-facing heading and one-line description, in the order the directory renders them. */
export const ITEM_CATEGORIES: readonly {
  id: ItemCategoryId;
  label: string;
  description: string;
}[] = [
  {
    id: "ores-and-gemstones",
    label: "Ores & Gemstones",
    description: "Raw ore and rough gems, as they come out of the rock.",
  },
  {
    id: "processed-materials",
    label: "Processed Materials",
    description: "Refined metals, stock, and the leftovers of working them.",
  },
  {
    id: "components-and-supplies",
    label: "Components & Supplies",
    description: "Parts and consumables that other work uses up.",
  },
  {
    id: "tools-and-containers",
    label: "Tools & Containers",
    description: "Gear you equip: Mining tools and container attachments.",
  },
];

const itemCategoryByItemId = {
  [ITEM_IDS.ferriteShale]: "ores-and-gemstones",
  [ITEM_IDS.galvanite]: "ores-and-gemstones",
  [ITEM_IDS.uncutQuartz]: "ores-and-gemstones",
  [ITEM_IDS.uncutTopaz]: "ores-and-gemstones",
  [ITEM_IDS.uncutSapphire]: "ores-and-gemstones",
  [ITEM_IDS.refinedFerrite]: "processed-materials",
  [ITEM_IDS.galvanicStock]: "processed-materials",
  [ITEM_IDS.galvaferrite]: "processed-materials",
  [ITEM_IDS.slag]: "processed-materials",
  [ITEM_IDS.scrapMetal]: "processed-materials",
  [ITEM_IDS.mountingBracket]: "components-and-supplies",
  [ITEM_IDS.galvanicWireSpool]: "components-and-supplies",
  [ITEM_IDS.wheelAssembly]: "components-and-supplies",
  [ITEM_IDS.driveMount]: "components-and-supplies",
  [ITEM_IDS.powerCell]: "components-and-supplies",
  [ITEM_IDS.salvageCutter]: "tools-and-containers",
  [ITEM_IDS.loadsteelCutter]: "tools-and-containers",
  [ITEM_IDS.scrapBox]: "tools-and-containers",
  [ITEM_IDS.freightHarness]: "tools-and-containers",
  [ITEM_IDS.mykeaSchleppraum8]: "tools-and-containers",
} as const satisfies Partial<Record<ItemId, ItemCategoryId>>;

/** The editorial category map, keyed by stable item ID. */
export const ITEM_CATEGORY_BY_ITEM_ID: Readonly<Record<string, ItemCategoryId>> =
  itemCategoryByItemId;

/**
 * Fail when the classification and the shipped inventory registry disagree:
 * an item with no category, a category naming something that is not a shipped
 * item, an unknown category, or a category with no items.
 */
export function validateItemCategories(
  shippedItemIds: readonly string[],
  categoryByItemId: Readonly<Record<string, string>> = ITEM_CATEGORY_BY_ITEM_ID,
): void {
  const shipped = new Set(shippedItemIds);
  if (shipped.size !== shippedItemIds.length) {
    throw new Error("The shipped item registry lists an item more than once.");
  }
  const known = new Set<string>(ITEM_CATEGORY_IDS);
  for (const itemId of shippedItemIds) {
    const category = categoryByItemId[itemId];
    if (category === undefined) throw new Error(`Shipped item "${itemId}" has no Wiki category.`);
    if (!known.has(category)) {
      throw new Error(`Item "${itemId}" names unknown Wiki category "${category}".`);
    }
  }
  for (const itemId of Object.keys(categoryByItemId)) {
    if (!shipped.has(itemId)) {
      throw new Error(`Wiki category names "${itemId}", which is not a shipped item.`);
    }
  }
  for (const category of ITEM_CATEGORY_IDS) {
    if (!shippedItemIds.some((itemId) => categoryByItemId[itemId] === category)) {
      throw new Error(`Wiki item category has no items: ${category}`);
    }
  }
}
