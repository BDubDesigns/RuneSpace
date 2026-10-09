import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, inventoryItemDefinitions } from "@/game/config/balance";
import { ITEM_IDS, MISSION_IDS } from "@/game/config/foundations";
import {
  ITEM_CATEGORY_BY_ITEM_ID,
  ITEM_CATEGORY_IDS,
  validateItemCategories,
} from "@/game/content/item-categories";
import { MERCHANTS } from "@/game/content/merchants";
import { KEEP_THE_CHANGE_CELL_COUNT } from "@/game/content/missions";
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
    expect(text).toMatch(/hand in|is kept/);
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

const hrefs = (lines: readonly WikiItemLine[]) =>
  lines.flatMap((line) => line.flatMap((s) => (typeof s === "string" ? [] : [s.href])));

describe("Fabrication Station unlock", () => {
  it("shows the station prerequisite beside, and apart from, the recipe's skill level", () => {
    const page = buildWikiItemPage(ITEM_IDS.powerCell)!;
    const facts = page.recipes[0]!.facts.map(lineText);
    expect(facts[0]).toBe("Requires Fabrication 5");
    expect(facts[1]).toContain("Needs the Fabrication Station");
    expect(facts[1]).toContain("accepted Return the Favor");
    expect(facts[1]).toContain("separate from the skill level");
    expect(hrefs(page.recipes[0]!.facts)).toContain("/wiki/mission-return-the-favor");
    // The acquisition line states it too.
    expect(page.obtain.map(lineText).join("\n")).toContain("accepted Return the Favor");
    expect(hrefs(page.obtain)).toContain("/wiki/mission-return-the-favor");
  });

  it("derives the Mission from the station authorization, not from item pages", () => {
    const { registries } = doctoredRegistries();
    registries.workstations = {
      ...registries.workstations,
      fabricationAuthorizingMissionId: MISSION_IDS.walkItOff,
    };
    const page = buildWikiItemPage(ITEM_IDS.mountingBracket, registries)!;
    expect(hrefs(page.recipes[0]!.facts)).toContain("/wiki/mission-walk-it-off");
    expect(hrefs(page.recipes[0]!.facts)).not.toContain("/wiki/mission-return-the-favor");
    // Refining has no station gate.
    expect(
      buildWikiItemPage(ITEM_IDS.refinedFerrite)!
        .recipes.flatMap((recipe) => recipe.facts)
        .map(lineText)
        .join("\n"),
    ).not.toContain("Fabrication Station");
  });
});

describe("Tinkering Scrap Metal", () => {
  function tinkering(registries?: ItemReferenceRegistries) {
    const source = buildItemReference(ITEM_IDS.scrapMetal, registries)!.sources.find(
      (candidate) => candidate.kind === "tinkering",
    );
    if (source?.kind !== "tinkering") throw new Error("no Tinkering source");
    return source;
  }

  it("pays one Scrap per two ingredient units, rounded up, for each eligible item", () => {
    const source = tinkering();
    const balance = getEffectiveGameBalance();
    expect(source.targets.length).toBe(Object.keys(balance.tinkering.targets).length);
    const units = (itemId: string) => {
      const recipe = Object.values(balance.fabrication.recipes).find(
        (candidate) => candidate.outputItemId === itemId,
      )!;
      return recipe.inputs.reduce((total, input) => total + input.quantity, 0);
    };
    for (const target of source.targets) {
      expect(target.scrapYield).toBe(Math.ceil(units(target.dismantledItemId) / 2));
    }
    // Scrap Box: 1 Bracket + 2 Scrap + 3 Ferrite = 6 units -> 3 Scrap.
    expect(source.targets.find((t) => t.dismantledItemId === ITEM_IDS.scrapBox)?.scrapYield).toBe(
      3,
    );
  });

  it("follows the formula when the balance changes, and explains the rules", () => {
    const { registries, balance } = doctoredRegistries();
    balance.tinkering.inputUnitsPerScrap = 3;
    expect(
      tinkering(registries).targets.find((t) => t.dismantledItemId === ITEM_IDS.scrapBox)
        ?.scrapYield,
    ).toBe(2);

    const text = buildWikiItemPage(ITEM_IDS.scrapMetal)!.obtain.map(lineText).join("\n");
    expect(text).toContain("consumes the dismantled item");
    expect(text).toContain("only Scrap Metal, never the ingredients");
    expect(text).toContain("completed Return the Favor");
    expect(text).toContain("Auto-discard Scrap");
    expect(text).toContain("Dismantle 1 Scrap Box (Fabrication 1) for 3 Scrap Metal.");
    expect(text).toContain("Rusk Recovery");
  });

  it("is a source of Scrap Metal only", () => {
    for (const itemId of shippedIds) {
      const kinds = buildItemReference(itemId)!.sources.map((source) => source.kind);
      expect(kinds.includes("tinkering"), itemId).toBe(itemId === ITEM_IDS.scrapMetal);
    }
  });
});

describe("Practice Welding Slag", () => {
  it("documents Slag per weld, its Scrap cost, the unlock and the room rules", () => {
    const text = buildWikiItemPage(ITEM_IDS.slag)!.obtain.map(lineText).join("\n");
    expect(text).toContain("each complete practice weld of 10 sections spends 2 Scrap Metal");
    expect(text).toContain("produces up to 2 Slag");
    expect(text).toContain("accepted 10,000 Hours");
    expect(text).toContain("Rusk Recovery");
    expect(text).toContain("thrown out");
    expect(text).toContain("Auto-discard Slag");
    expect(hrefs(buildWikiItemPage(ITEM_IDS.slag)!.obtain)).toContain("/wiki/items/scrap-metal");
  });

  it("reads the quantities and unlock from the balance and workstation content", () => {
    const { registries, balance } = doctoredRegistries();
    balance.practiceWelding.slagPerWeld = 5;
    balance.practiceWelding.scrapPerWeld = 3;
    registries.workstations = {
      ...registries.workstations,
      practiceAuthorizingMissionId: MISSION_IDS.walkItOff,
    };
    const text = buildWikiItemPage(ITEM_IDS.slag, registries)!.obtain.map(lineText).join("\n");
    expect(text).toContain("spends 3 Scrap Metal");
    expect(text).toContain("up to 5 Slag");
    expect(text).toContain("accepted Walk It Off");
  });

  it("is a Slag-only source that never joins the failure byproducts", () => {
    for (const itemId of shippedIds) {
      const reference = buildItemReference(itemId)!;
      const has = reference.sources.some((source) => source.kind === "practice_welding");
      expect(has, itemId).toBe(itemId === ITEM_IDS.slag);
    }
    const slag = buildItemReference(ITEM_IDS.slag)!;
    expect(slag.byproducts.map((byproduct) => byproduct.recipeActionId).length).toBe(2);
    expect(slag.oneTime).toEqual([]);
  });
});

describe("Mission item quantities under Used In", () => {
  const missionLine = (itemId: string, registries?: ItemReferenceRegistries) =>
    buildWikiItemPage(itemId, registries)!
      .usedIn.filter((group) => group.heading === "Missions")
      .flatMap((group) => group.lines)
      .map(lineText);

  it("states an explicit quantity and what happens to it", () => {
    expect(missionLine(ITEM_IDS.powerCell)).toContain(
      `Keep the Change — carry and hand in ${KEEP_THE_CHANGE_CELL_COUNT} Power Cells.`,
    );
  });

  it("resolves a full-stack requirement from the item's stack limit", () => {
    expect(missionLine(ITEM_IDS.ferriteShale)).toContain(
      "Cut Your Teeth — carry and show 10 Ferrite Shale (a full stack); it is kept.",
    );
    const { registries, balance } = doctoredRegistries();
    balance.items.ferriteShale.stackLimit = 4;
    expect(missionLine(ITEM_IDS.ferriteShale, registries)).toContain(
      "Cut Your Teeth — carry and show 4 Ferrite Shale (a full stack); it is kept.",
    );
  });

  it("follows an edited explicit quantity and keeps equipped distinct", () => {
    const { registries } = doctoredRegistries();
    registries.missions = registries.missions.map((mission) =>
      mission.id === MISSION_IDS.keepTheChange
        ? {
            ...mission,
            requirements: mission.requirements.map((requirement) =>
              requirement.kind === "carried_stack" ? { ...requirement, quantity: 4 } : requirement,
            ),
          }
        : mission,
    );
    expect(missionLine(ITEM_IDS.powerCell, registries)).toContain(
      "Keep the Change — carry and hand in 4 Power Cells.",
    );
    expect(missionLine(ITEM_IDS.salvageCutter).join("\n")).toContain(
      "Cut Your Teeth — Salvage Cutter must be equipped.",
    );
  });

  it("links the Mission guide and does not repeat a repair a Mission only observes", () => {
    const page = buildWikiItemPage(ITEM_IDS.powerCell)!;
    const missions = page.usedIn.find((group) => group.heading === "Missions")!;
    expect(hrefs(missions.lines)).toContain("/wiki/mission-keep-the-change");
    // Hold It Together only observes the Cargo Hold repair, which Repairs already lists.
    const refined = buildItemReference(ITEM_IDS.refinedFerrite)!;
    expect(
      refined.uses.some(
        (use) => use.kind === "mission_requirement" && use.missionId === MISSION_IDS.holdItTogether,
      ),
    ).toBe(false);
    expect(refined.uses.some((use) => use.kind === "repair")).toBe(true);
  });
});

describe("source gating is unchanged for the in-game resolver", () => {
  it("keeps Tinkering and Practice Welding out of the character-aware resolver", () => {
    const everything: ItemSourceFacts = {
      skillLevels: { fabrication: 99, refining: 99, mining: 99, welding: 99 },
      acceptedMissionIds: new Set(Object.values(MISSION_IDS)),
      completedMissionIds: new Set(Object.values(MISSION_IDS)),
      fabricationStationUnlocked: true,
      locationStates: Object.fromEntries(
        defaultItemReferenceRegistries().locations.map((location) => [
          location.id,
          { availableActionIds: location.availableActionIds },
        ]),
      ),
    };
    for (const itemId of [ITEM_IDS.scrapMetal, ITEM_IDS.slag]) {
      const kinds: string[] = resolveItemSources(itemId, everything).map((source) => source.kind);
      expect(kinds).not.toContain("tinkering");
      expect(kinds).not.toContain("practice_welding");
    }
  });

  it("leaves the ordinary source kinds of Scrap Metal and Slag in their prior order", () => {
    expect(buildItemReference(ITEM_IDS.scrapMetal)!.sources.map((s) => s.kind)).toEqual([
      "fabricate",
      "fabricate",
      "merchant",
      "tinkering",
      "player_trade",
    ]);
    expect(buildItemReference(ITEM_IDS.slag)!.sources.map((s) => s.kind)).toEqual([
      "refine",
      "refine",
      "practice_welding",
      "player_trade",
    ]);
  });
});
