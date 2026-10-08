import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, inventoryItemDefinitions } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  ITEM_CATEGORY_BY_ITEM_ID,
  ITEM_CATEGORY_IDS,
  validateItemCategories,
} from "@/game/content/item-categories";
import { MERCHANTS } from "@/game/content/merchants";
import {
  buildItemReference,
  defaultItemReferenceRegistries,
  type ItemReferenceRegistries,
} from "@/game/domain/item-reference";
import { resolveItemSources, type ItemSourceFacts } from "@/game/domain/item-sources";
import { isItemTransferable } from "@/game/domain/player-trade";
import {
  buildWikiItemPage,
  getWikiItemBySlug,
  getWikiItemGroups,
  getWikiItems,
  wikiItemPath,
  wikiItemSlug,
  type WikiItemLine,
} from "@/features/public-site/public-item-wiki";
import { getWikiArticle, getWikiArticleGroups } from "@/features/public-site/public-wiki";

const shippedIds = inventoryItemDefinitions().map((definition) => definition.itemId);

function lineText(line: WikiItemLine): string {
  return line.map((segment) => (typeof segment === "string" ? segment : segment.text)).join("");
}

function allLines(itemId: string): WikiItemLine[] {
  const page = buildWikiItemPage(itemId)!;
  return [
    ...page.obtain,
    ...page.oneTime,
    ...page.byproducts,
    ...page.recipes.flatMap((recipe) => [...recipe.facts, ...recipe.inputs]),
    ...page.usedIn.flatMap((group) => group.lines),
  ];
}

/**
 * A copy of the default registries whose balance a test may freely doctor. The
 * balance schema pins authored numbers as literal types, so the mutable handle
 * is deliberately loose.
 */
function doctoredRegistries(): {
  registries: ItemReferenceRegistries;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  balance: any;
} {
  const balance = structuredClone(getEffectiveGameBalance());
  return { registries: { ...defaultItemReferenceRegistries(), balance }, balance };
}

describe("Wiki item catalog", () => {
  it("lists every shipped inventory item exactly once, and not ITEM_IDS alone", () => {
    const listed = getWikiItems().map((item) => item.itemId);
    expect([...listed].sort()).toEqual([...shippedIds].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // An ID that is named but has no inventory definition is not a shipped item.
    expect(Object.values(ITEM_IDS)).toContain("crash_grade_structural_alloy");
    expect(listed).not.toContain("crash_grade_structural_alloy");
  });

  it("derives each slug from the stable item ID only", () => {
    expect(wikiItemSlug("wheel_assembly")).toBe("wheel-assembly");
    expect(wikiItemSlug(ITEM_IDS.mykeaSchleppraum8)).toBe("mykea-schleppraum-8");
    const slugs = getWikiItems().map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(wikiItemPath("wheel_assembly")).toBe("/wiki/items/wheel-assembly");
  });

  it("does not collide with an authored article and 404s unknown slugs", () => {
    expect(getWikiArticle("items")).toBeUndefined();
    expect(getWikiItemBySlug("not-an-item")).toBeUndefined();
    expect(getWikiItemBySlug("wheel_assembly")).toBeUndefined();
    expect(getWikiItemBySlug("crash-grade-structural-alloy")).toBeUndefined();
    expect(buildWikiItemPage("crash_grade_structural_alloy")).toBeUndefined();
  });

  it("groups the four approved categories, ordered by displayed name", () => {
    const groups = getWikiItemGroups();
    expect(groups.map((group) => group.id)).toEqual([...ITEM_CATEGORY_IDS]);
    expect(groups.map((group) => group.items.map((item) => item.name))).toEqual([
      ["Ferrite Shale", "Galvanite", "Uncut Quartz", "Uncut Sapphire", "Uncut Topaz"],
      ["Galvaferrite", "Galvanic Stock", "Refined Ferrite", "Scrap Metal", "Slag"],
      ["Drive Mount", "Galvanic Wire Spool", "Mounting Bracket", "Power Cell", "Wheel Assembly"],
      ["Freight Harness", "Loadsteel Cutter", "MYKEA SCHLEPPRAUM-8", "Salvage Cutter", "Scrap Box"],
    ]);
  });
});

describe("item category validation", () => {
  it("accepts the shipped registry", () => {
    expect(() => validateItemCategories(shippedIds)).not.toThrow();
  });

  it("fails when a shipped item has no category", () => {
    expect(() => validateItemCategories([...shippedIds, "brand_new_item"])).toThrow(
      /no Wiki category/,
    );
  });

  it("fails on an invalid category, a non-shipped item, a duplicate or an empty category", () => {
    expect(() =>
      validateItemCategories(shippedIds, { ...ITEM_CATEGORY_BY_ITEM_ID, slag: "scrap" }),
    ).toThrow(/unknown Wiki category/);
    expect(() =>
      validateItemCategories(shippedIds, { ...ITEM_CATEGORY_BY_ITEM_ID, ghost: "slag" }),
    ).toThrow(/not a shipped item/);
    expect(() => validateItemCategories([...shippedIds, shippedIds[0]!])).toThrow(/more than once/);
    const onlyOres = Object.fromEntries(
      shippedIds.map((id) => [id, "ores-and-gemstones"] as const),
    );
    expect(() => validateItemCategories(shippedIds, onlyOres)).toThrow(/has no items/);
  });
});

describe("Wiki item pages", () => {
  it("builds a page for every shipped item whose links all resolve", () => {
    for (const itemId of shippedIds) {
      const page = buildWikiItemPage(itemId);
      expect(page, itemId).toBeDefined();
      for (const line of allLines(itemId)) {
        for (const segment of line) {
          if (typeof segment === "string") continue;
          const [, area, second, third] = segment.href.split("/");
          expect(area).toBe("wiki");
          if (second === "items") {
            expect(getWikiItemBySlug(third!), segment.href).toBeDefined();
          } else {
            expect(getWikiArticle(second!), segment.href).toBeDefined();
          }
        }
      }
    }
  });

  it("links the directory from the Gear & Credits panel of the index", () => {
    const gear = getWikiArticleGroups().find((group) => group.id === "gear-and-credits")!;
    expect(gear.directories).toEqual([{ title: "Items & Recipes", path: "/wiki/items" }]);
  });

  it("omits optional prose for an item with no authored description", () => {
    const page = buildWikiItemPage(ITEM_IDS.ferriteShale)!;
    expect(page.description).toBeUndefined();
    expect(page.summary).toContain("Ferrite Shale is a stackable item");
    expect(buildWikiItemPage(ITEM_IDS.uncutTopaz)!.description).toBeDefined();
  });

  it("lists every recipe that makes an item, including several for one item", () => {
    for (const itemId of [ITEM_IDS.slag, ITEM_IDS.scrapMetal]) {
      const page = buildWikiItemPage(itemId)!;
      expect(page.recipes.length, itemId).toBe(2);
      expect(new Set(page.recipes.map((recipe) => recipe.key)).size).toBe(2);
    }
    const slag = buildWikiItemPage(ITEM_IDS.slag)!;
    expect(slag.recipes.map((recipe) => recipe.yields)).toEqual(["Makes 1 Slag", "Makes 2 Slag"]);
  });

  it("states a Secondary Find chance per successful extraction, from the authored oneIn", () => {
    const topaz = buildWikiItemPage(ITEM_IDS.uncutTopaz)!;
    const text = topaz.obtain.map(lineText).join("\n");
    expect(text).toContain("1 in 60 chance");
    expect(text).toContain("1 in 35 chance");
    expect(text).toContain("successful extraction");
    // A primary ore carries no chance.
    expect(buildWikiItemPage(ITEM_IDS.ferriteShale)!.obtain.map(lineText).join()).not.toMatch(
      /1 in/,
    );
  });

  it("reverse-links a material to what its recipes and repairs use", () => {
    const stock = buildWikiItemPage(ITEM_IDS.galvanicStock)!;
    const recipes = stock.usedIn.find((group) => group.heading === "Recipes")!;
    expect(recipes.lines.some((line) => lineText(line).includes("Wheel Assembly"))).toBe(true);
    const repairs = stock.usedIn.find((group) => group.heading === "Repairs")!;
    // Both Rusk Recovery and the Processing Yard stash mounts, listed separately.
    expect(repairs.lines.filter((line) => lineText(line).startsWith("Stash Mount")).length).toBe(3);
    // A cited repair links its authorizing Mission's published guide.
    const bracket = buildWikiItemPage(ITEM_IDS.mountingBracket)!;
    const landing = bracket.usedIn
      .flatMap((group) => group.lines)
      .find((line) => lineText(line).includes("Landing Gear"))!;
    expect(
      landing.some((s) => typeof s !== "string" && s.href === "/wiki/mission-wheel-be-right-back"),
    ).toBe(true);
  });

  it("labels Mission requirements as shown, equipped or handed in", () => {
    const cutter = buildWikiItemPage(ITEM_IDS.salvageCutter)!;
    const missions = cutter.usedIn.find((group) => group.heading === "Missions")!;
    const text = missions.lines.map(lineText).join("\n");
    expect(text).toMatch(/must be equipped/);
    expect(text).toMatch(/is handed in|is kept/);
  });

  it("keeps one-time payouts and failure byproducts out of the ordinary sources", () => {
    const reference = buildItemReference(ITEM_IDS.powerCell)!;
    expect(reference.sources.map((source) => source.kind)).toEqual([
      "fabricate",
      "merchant",
      "fixed_claim",
      "scavenge",
      "player_trade",
    ]);
    expect(reference.oneTime.length).toBeGreaterThan(0);
    const slag = buildItemReference(ITEM_IDS.slag)!;
    expect(slag.byproducts.length).toBe(2);
    expect(slag.sources.some((source) => source.kind === "fabricate")).toBe(false);
  });

  it("never treats a merchant buy price as a way to get the item", () => {
    const bixBuysFerrite = MERCHANTS.some((merchant) =>
      merchant.prices.some((line) => line.itemId === ITEM_IDS.refinedFerrite && line.buyPrice),
    );
    expect(bixBuysFerrite).toBe(true);
    expect(
      buildItemReference(ITEM_IDS.refinedFerrite)!.sources.some((s) => s.kind === "merchant"),
    ).toBe(false);
  });

  it("follows the real trade rule for player trading", () => {
    for (const itemId of shippedIds) {
      const sources = buildItemReference(itemId)!.sources.map((source) => source.kind);
      expect(sources.includes("player_trade"), itemId).toBe(isItemTransferable(itemId));
    }
  });
});

describe("public reference versus the in-game resolver (#326)", () => {
  const undiscovered: ItemSourceFacts = {
    skillLevels: {},
    acceptedMissionIds: new Set(),
    completedMissionIds: new Set(),
    fabricationStationUnlocked: false,
    locationStates: {},
  };

  it("lists a source the resolver hides from an undiscovered character", () => {
    const hidden = resolveItemSources(ITEM_IDS.galvanite, undiscovered).map(
      (source) => source.kind,
    );
    expect(hidden).not.toContain("mine");
    const publicKinds = buildItemReference(ITEM_IDS.galvanite)!.sources.map(
      (source) => source.kind,
    );
    expect(publicKinds).toContain("mine");
    expect(
      resolveItemSources(ITEM_IDS.powerCell, undiscovered).map((source) => source.kind),
    ).not.toContain("fabricate");
    expect(buildItemReference(ITEM_IDS.powerCell)!.sources.map((source) => source.kind)).toContain(
      "fabricate",
    );
  });
});

describe("derivation from canonical data", () => {
  it("changes recipe inputs, output counts and gates when the balance changes", () => {
    const { registries, balance } = doctoredRegistries();
    const recipe = balance.fabrication.recipes.powerCells;
    recipe.inputs = [{ itemId: ITEM_IDS.ferriteShale, quantity: 7 }];
    recipe.outputQuantity = 4;
    recipe.minimumLevel = 9;
    const reference = buildItemReference(ITEM_IDS.powerCell, registries)!;
    const fabricate = reference.recipes.find((candidate) => candidate.kind === "fabricate")!;
    expect(fabricate.inputs).toEqual([{ itemId: ITEM_IDS.ferriteShale, quantity: 7 }]);
    expect(fabricate.outputQuantity).toBe(4);
    expect(fabricate.minimumLevel).toBe(9);
    const page = buildWikiItemPage(ITEM_IDS.powerCell, registries)!;
    expect(page.recipes[0]!.yields).toBe("Makes 4 Power Cells");
    expect(page.recipes[0]!.inputs.map(lineText)).toEqual(["7 Ferrite Shale"]);
    expect(page.recipes[0]!.facts.map(lineText)[0]).toBe("Requires Fabrication 9");
  });

  it("changes merchant prices and limits, and Secondary Find odds, with the data", () => {
    const { registries, balance } = doctoredRegistries();
    registries.merchants = registries.merchants.map((merchant) => ({
      ...merchant,
      prices: merchant.prices.map((line) =>
        line.itemId === ITEM_IDS.powerCell ? { ...line, sellPrice: 99, dailySellLimit: 3 } : line,
      ),
    }));
    const merchant = buildItemReference(ITEM_IDS.powerCell, registries)!.sources.find(
      (source) => source.kind === "merchant",
    );
    expect(merchant).toMatchObject({ unitPrice: 99, dailyLimit: 3 });

    balance.mining.sources.ferriteShale.secondaryFinds[1]!.oneIn = 77;
    const topaz = buildWikiItemPage(ITEM_IDS.uncutTopaz, registries)!;
    expect(topaz.obtain.map(lineText).join("\n")).toContain("1 in 77 chance");
  });

  it("changes repair requirements with the repair balance", () => {
    const { registries, balance } = doctoredRegistries();
    balance.repairTargets.landingGear.materials = [{ itemId: ITEM_IDS.wheelAssembly, quantity: 9 }];
    const uses = buildItemReference(ITEM_IDS.wheelAssembly, registries)!.uses;
    expect(uses.find((use) => use.kind === "repair")).toMatchObject({ quantity: 9 });
    expect(
      buildItemReference(ITEM_IDS.mountingBracket, registries)!.uses.some(
        (use) => use.kind === "repair" && use.repairTargetId === "landing_gear",
      ),
    ).toBe(false);
  });
});
