import { getItemDefinition, inventoryItemDefinitions } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import {
  ITEM_CATEGORIES,
  ITEM_CATEGORY_BY_ITEM_ID,
  validateItemCategories,
  type ItemCategoryId,
} from "@/game/content/item-categories";
import {
  getItemPresentation,
  itemQuantityLabel,
  resolveItemPresentation,
} from "@/game/content/item-presentation";
import { getLocalPlace } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { getMission } from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import {
  buildItemReference,
  defaultItemReferenceRegistries,
  type ItemReference,
  type ItemReferenceLocation,
  type ItemReferenceRecipe,
  type ItemReferenceRegistries,
  type ItemReferenceSource,
  type ItemReferenceUse,
} from "@/game/domain/item-reference";
import { formatMassGrams } from "@/game/domain/mass";
import { getWikiArticles, WIKI_ITEMS_PATH } from "./public-wiki";

/**
 * The Wiki's derived Items & Recipes reference (#338).
 *
 * `/wiki/items` and `/wiki/items/<slug>` are not authored articles: every fact
 * on them is read from the registries that own it (`game/domain/item-reference`)
 * and only worded here. There is no hand-copied stat, recipe, price or chance
 * in this file, so a changed authored value reads correctly with no Wiki edit.
 *
 * Pages are statically generated from the shipped inventory registry — the
 * eligible set is `inventoryItemDefinitions()`, not `ITEM_IDS`, which also
 * names IDs that are not shipped items.
 */

/** A run of prose, with a link only where a phrase names another page. */
export type WikiItemLine = readonly (string | { text: string; href: string })[];

export type WikiItemEntry = {
  itemId: string;
  slug: string;
  name: string;
  category: ItemCategoryId;
};

export type WikiItemGroup = {
  id: ItemCategoryId;
  label: string;
  description: string;
  items: readonly WikiItemEntry[];
};

export type WikiItemRecipeView = {
  key: string;
  heading: string;
  facts: readonly WikiItemLine[];
  inputs: readonly WikiItemLine[];
  yields: string;
};

export type WikiItemPage = {
  itemId: string;
  slug: string;
  name: string;
  path: string;
  categoryLabel: string;
  /** Meta description, derived from the item's kind and name only. */
  summary: string;
  /** Present only when the item authors one. */
  description?: string;
  rare: boolean;
  properties: readonly { label: string; value: string }[];
  obtain: readonly WikiItemLine[];
  oneTime: readonly WikiItemLine[];
  byproducts: readonly WikiItemLine[];
  recipes: readonly WikiItemRecipeView[];
  usedIn: readonly { heading: string; lines: readonly WikiItemLine[] }[];
};

/** The route segment for an item: its stable ID, never its mutable label. */
export function wikiItemSlug(itemId: string): string {
  return itemId.replace(/_/g, "-");
}

export function wikiItemPath(itemId: string): string {
  return `${WIKI_ITEMS_PATH}/${wikiItemSlug(itemId)}`;
}

function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

/** The shipped items, each exactly once, validated against the category map. */
function loadWikiItems(): readonly WikiItemEntry[] {
  const itemIds = inventoryItemDefinitions().map((definition) => definition.itemId);
  validateItemCategories(itemIds);
  const entries = itemIds.map((itemId) => ({
    itemId,
    slug: wikiItemSlug(itemId),
    name: itemName(itemId),
    category: ITEM_CATEGORY_BY_ITEM_ID[itemId]!,
  }));
  const slugs = new Set(entries.map((entry) => entry.slug));
  if (slugs.size !== entries.length) throw new Error("Two shipped items share a Wiki slug.");
  return entries;
}

const wikiItems = loadWikiItems();

export function getWikiItems(): readonly WikiItemEntry[] {
  return wikiItems;
}

/** The directory's groups in category order, items ordered by displayed name. */
export function getWikiItemGroups(): readonly WikiItemGroup[] {
  return ITEM_CATEGORIES.map((category) => ({
    ...category,
    items: wikiItems
      .filter((item) => item.category === category.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function getWikiItemBySlug(slug: string): WikiItemEntry | undefined {
  return wikiItems.find((item) => item.slug === slug);
}

function itemLink(itemId: string, quantity?: number): { text: string; href: string } {
  return {
    text:
      quantity === undefined
        ? itemName(itemId)
        : itemQuantityLabel(itemId, quantity, itemName(itemId)),
    href: wikiItemPath(itemId),
  };
}

function skillRequirement(skillId: string, level: number): string {
  return `${getSkillPresentation(skillId)?.displayName ?? skillId} ${level}`;
}

/** A Mission's title, linked to its guide when it has one. */
function missionLink(missionId: string): string | { text: string; href: string } {
  const title = getMission(missionId)?.title ?? missionId;
  const guide = getWikiArticles().find(
    (article) => article.slug.startsWith("mission-") && article.title === title,
  );
  return guide ? { text: title, href: `/wiki/${guide.slug}` } : title;
}

function repairTargetLabel(repairTargetId: string): string {
  const target = getRepairTarget(repairTargetId);
  if (!target) return repairTargetId;
  const where = getLocation(target.locationId)?.displayName;
  return where ? `${target.displayName} (${where})` : target.displayName;
}

function locationPhrase(locations: readonly ItemReferenceLocation[]): WikiItemLine {
  const parts: (string | { text: string; href: string })[] = [];
  locations.forEach((entry, index) => {
    if (index > 0) parts.push(" or ");
    parts.push(getLocation(entry.locationId)?.displayName ?? entry.locationId);
    if (entry.gate?.kind === "repair_target") {
      parts.push(
        ` (once the ${getRepairTarget(entry.gate.repairTargetId)?.displayName ?? "repair"} is repaired)`,
      );
    } else if (entry.gate?.kind === "mission") {
      parts.push(" (once ", missionLink(entry.gate.missionId), " is accepted)");
    }
  });
  return parts;
}

function recipeFacts(recipe: ItemReferenceRecipe): WikiItemLine[] {
  const facts: WikiItemLine[] = [
    [`Requires ${skillRequirement(recipe.skillId, recipe.minimumLevel)}`],
    ["Where: ", ...locationPhrase(recipe.locations)],
  ];
  if (recipe.kind === "refine") {
    if (recipe.deterministic) {
      facts.push(["Always succeeds"]);
    } else if (recipe.failure?.kind === "fixed_outputs") {
      facts.push([
        "Can fail. A failed attempt produces ",
        ...joinLinks(recipe.failure.outputs.map((out) => itemLink(out.itemId, out.quantity))),
        " instead.",
      ]);
    } else if (recipe.failure?.kind === "one_input_returned") {
      facts.push(["Can fail. A failed attempt hands one of the ingredients back."]);
    } else {
      facts.push(["Can fail."]);
    }
  }
  return facts;
}

function joinLinks(links: readonly { text: string; href: string }[]) {
  const parts: (string | { text: string; href: string })[] = [];
  links.forEach((link, index) => {
    if (index > 0) parts.push(index === links.length - 1 ? " and " : ", ");
    parts.push(link);
  });
  return parts;
}

function recipeView(recipe: ItemReferenceRecipe): WikiItemRecipeView {
  return {
    key: recipe.actionId,
    heading: recipe.kind === "fabricate" ? "Fabrication" : "Refining",
    facts: recipeFacts(recipe),
    inputs: recipe.inputs.map((input) => [itemLink(input.itemId, input.quantity)]),
    yields: `Makes ${itemQuantityLabel(recipe.outputItemId, recipe.outputQuantity, itemName(recipe.outputItemId))}`,
  };
}

function sourceLine(itemId: string, source: ItemReferenceSource): WikiItemLine {
  switch (source.kind) {
    case "fabricate":
    case "refine": {
      const { recipe } = source;
      return [
        source.kind === "fabricate" ? "Fabricate it from " : "Refine it from ",
        ...joinLinks(recipe.inputs.map((input) => itemLink(input.itemId, input.quantity))),
        ` (${skillRequirement(recipe.skillId, recipe.minimumLevel)}) — `,
        ...locationPhrase(recipe.locations),
        ".",
      ];
    }
    case "mine":
      return source.role === "primary"
        ? ["Mine it — ", ...locationPhrase(source.locations), "."]
        : [
            `Secondary Find while mining `,
            itemLink(source.oreItemId),
            " — ",
            ...locationPhrase(source.locations),
            `. Each successful extraction has a 1 in ${source.oneInPerSuccess} chance of turning it up; a successful extraction turns up at most one Secondary Find.`,
          ];
    case "merchant": {
      const place = source.localPlaceId ? getLocalPlace(source.localPlaceId) : undefined;
      const where = [place?.displayName, getLocation(source.locationId)?.displayName]
        .filter(Boolean)
        .join(", ");
      const line: (string | { text: string; href: string })[] = [
        `Buy from ${getNpc(source.npcId)?.displayName ?? "a merchant"} — ${where} — for ${source.unitPrice} Credits each`,
      ];
      if (source.dailyLimit !== undefined) {
        line.push(`, up to ${source.dailyLimit} a day per character`);
      }
      line.push(".");
      if (source.opensWithMissionId) {
        line.push(
          " The shop opens once you have accepted ",
          missionLink(source.opensWithMissionId),
          ".",
        );
      }
      if (source.placeOpensWithMissionId) {
        line.push(
          " The place opens once you have completed ",
          missionLink(source.placeOpensWithMissionId),
          ".",
        );
      }
      return line;
    }
    case "fixed_claim":
      return [
        `Claim ${itemQuantityLabel(itemId, source.quantity, itemName(itemId))} once a day at ${getLocation(source.locationId)?.displayName ?? source.locationId}.`,
      ];
    case "scavenge":
      return ["Scavenge — occasionally found while walking between locations."];
    case "player_trade":
      return ["Player trade — this item can be traded between players, who set their own terms."];
  }
}

function useLine(use: ItemReferenceUse): { group: string; line: WikiItemLine } {
  switch (use.kind) {
    case "recipe_input":
      return {
        group: "Recipes",
        line: [
          `${use.recipeKind === "fabricate" ? "Fabricating" : "Refining"} `,
          itemLink(use.outputItemId),
          ` — uses ${use.quantity}.`,
        ],
      };
    case "repair": {
      const target = getRepairTarget(use.repairTargetId);
      const auth = target?.authorization;
      const line: (string | { text: string; href: string })[] = [
        `${repairTargetLabel(use.repairTargetId)} repair — needs ${use.quantity}`,
      ];
      if (auth?.kind === "mission") line.push(" (", missionLink(auth.missionId), ")");
      line.push(".");
      return { group: "Repairs", line };
    }
    case "mission_requirement": {
      const verb =
        use.disposition === "equip"
          ? "must be equipped"
          : use.disposition === "show"
            ? "must be carried and shown, and is kept"
            : "must be carried and is handed in";
      return {
        group: "Missions",
        line: [missionLink(use.missionId), ` — ${verb}.`],
      };
    }
  }
}

function propertyRows(itemId: string, reference: ItemReference, powerCellSpeedMultiplier: number) {
  const { definition, equipment } = reference.properties;
  const rows: { label: string; value: string }[] = [];
  if (equipment?.kind === "mining_tool") rows.push({ label: "Kind", value: "Mining tool" });
  else if (equipment?.kind === "container")
    rows.push({ label: "Kind", value: "Container attachment" });
  else
    rows.push({
      label: "Kind",
      value: definition.kind === "stack" ? "Stackable item" : "Unique item",
    });
  rows.push({ label: "Mass", value: formatMassGrams(definition.massGrams) });
  if (definition.kind === "stack") {
    rows.push({ label: "Stack capacity", value: `Up to ${definition.stackLimit} per stack` });
  }
  if (equipment?.kind === "mining_tool") {
    rows.push({
      label: "Requirement",
      value: `${skillRequirement(SKILL_IDS.mining, equipment.requiredMiningLevel)} to equip and use`,
    });
    rows.push({
      label: "Charges",
      value: `Holds up to ${equipment.maximumCharge}; each attempt spends one`,
    });
    if (equipment.baseDurationMultiplierBps !== 10_000) {
      rows.push({
        label: "Speed",
        value: `Attempts take ${equipment.baseDurationMultiplierBps / 100}% of the usual time, charged or not`,
      });
    }
    rows.push({
      label: "Charged effect",
      value:
        equipment.chargedEffect.kind === "speed"
          ? `A charged attempt is ${powerCellSpeedMultiplier}× as fast`
          : `A charged, successful attempt yields ${equipment.chargedEffect.units} extra ore`,
    });
  }
  if (equipment?.kind === "container") {
    rows.push({
      label: "Capacity",
      value: `Adds ${equipment.slotCapacity} inventory slots while equipped`,
    });
  }
  if (getItemPresentation(itemId)?.rarity === "rare") rows.push({ label: "Rarity", value: "Rare" });
  return rows;
}

/** The view model for one item's page, or `undefined` when the item is not shipped. */
export function buildWikiItemPage(
  itemId: string,
  registries: ItemReferenceRegistries = defaultItemReferenceRegistries(),
): WikiItemPage | undefined {
  const reference = buildItemReference(itemId, registries);
  const entry = wikiItems.find((item) => item.itemId === itemId);
  if (!reference || !entry) return undefined;
  const definition = getItemDefinition(itemId, registries.balance);
  const category = ITEM_CATEGORIES.find((candidate) => candidate.id === entry.category)!;
  const mass = formatMassGrams(reference.properties.definition.massGrams);
  const summary =
    definition?.kind === "stack"
      ? `${entry.name} is a stackable item in ${category.label}. A stack holds up to ${definition.stackLimit}, and each weighs ${mass}.`
      : `${entry.name} is a unique item in ${category.label}, weighing ${mass}.`;

  const usedIn = new Map<string, WikiItemLine[]>();
  for (const use of reference.uses) {
    const { group, line } = useLine(use);
    usedIn.set(group, [...(usedIn.get(group) ?? []), line]);
  }

  const oneTime = reference.oneTime.map((entryLine): WikiItemLine => {
    const label = itemQuantityLabel(itemId, entryLine.quantity, entry.name);
    return entryLine.kind === "mission_reward"
      ? [
          "Mission reward: ",
          missionLink(entryLine.missionId),
          ` pays ${label} when you turn it in.`,
        ]
      : [
          "Handed over: ",
          missionLink(entryLine.missionId),
          ` gives you ${label} when you accept it.`,
        ];
  });

  const byproducts = reference.byproducts.map(
    (byproduct): WikiItemLine => [
      "A failed attempt to refine ",
      itemLink(byproduct.recipeOutputItemId),
      ` can leave ${itemQuantityLabel(itemId, byproduct.quantity, entry.name)} behind.`,
    ],
  );

  return {
    itemId,
    slug: entry.slug,
    name: entry.name,
    path: wikiItemPath(itemId),
    categoryLabel: category.label,
    summary,
    ...(getItemPresentation(itemId)?.description
      ? { description: getItemPresentation(itemId)!.description! }
      : {}),
    rare: getItemPresentation(itemId)?.rarity === "rare",
    properties: propertyRows(
      itemId,
      reference,
      registries.balance.mining.powerCellBoost.speedMultiplier,
    ),
    obtain: reference.sources.map((source) => sourceLine(itemId, source)),
    oneTime,
    byproducts,
    recipes: reference.recipes.map(recipeView),
    usedIn: ["Recipes", "Repairs", "Missions"].flatMap((heading) => {
      const lines = usedIn.get(heading);
      return lines ? [{ heading, lines }] : [];
    }),
  };
}
