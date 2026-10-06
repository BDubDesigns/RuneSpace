import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fabricationRecipes,
  getEffectiveGameBalance,
  refiningRecipes,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { LOCATIONS } from "@/game/content/locations";
import { merchantRetailPrice, MERCHANTS } from "@/game/content/merchants";
import { SCAVENGE_OUTCOMES } from "@/game/content/scavenge";
import {
  defaultItemSourceRegistries,
  extendItemSourcePath,
  resolveItemSources,
  type ItemSource,
  type ItemSourceFacts,
} from "@/game/domain/item-sources";
import { resolveLocationState } from "@/game/domain/location-state";
import { isItemTransferable } from "@/game/domain/player-trade";
import { POWER_ANNEX_CLAIM } from "@/game/domain/power-annex";

/**
 * Issue #326 — the item-source reference. Every expectation is read from the
 * same registries the resolver reads, so these tests prove it follows the
 * authoritative content rather than restating it.
 */

const balance = getEffectiveGameBalance();

/** A character who has been through the story that reveals every source. */
function facts(
  overrides: {
    levels?: Record<string, number>;
    accepted?: readonly string[];
    deepJagOpen?: boolean;
  } = {},
): ItemSourceFacts {
  const completedRepairTargetIds = new Set<string>(
    overrides.deepJagOpen === false ? [] : [balance.repairTargets.deepJagCaveIn.targetId],
  );
  return {
    skillLevels: { [SKILL_IDS.fabrication]: 5, [SKILL_IDS.refining]: 5, ...overrides.levels },
    acceptedMissionIds: new Set(
      overrides.accepted ?? [MISSION_IDS.returnTheFavor, MISSION_IDS.tenThousandHours],
    ),
    locationStates: Object.fromEntries(
      LOCATIONS.map((location) => [
        location.id,
        resolveLocationState(location, {
          acceptedMissionIds: new Set(overrides.accepted ?? []),
          completedRepairTargetIds,
        }),
      ]),
    ),
  };
}

const of = (sources: readonly ItemSource[], kind: ItemSource["kind"]) =>
  sources.filter((source) => source.kind === kind);

describe("item sources — Fabrication, Refining, Mining", () => {
  it.each([
    ["Wheel Assembly", ITEM_IDS.wheelAssembly, balance.fabrication.recipes.wheelAssembly],
    ["Mounting Bracket", ITEM_IDS.mountingBracket, balance.fabrication.recipes.mountingBracket],
    [
      "Galvanic Wire Spool",
      ITEM_IDS.galvanicWireSpool,
      balance.fabrication.recipes.galvanicWireSpool,
    ],
  ])("%s resolves to its Fabrication recipe and player trade", (_name, itemId, recipe) => {
    const sources = resolveItemSources(itemId, facts());
    expect(of(sources, "fabricate")).toEqual([
      {
        kind: "fabricate",
        recipeActionId: recipe.actionId,
        skillId: balance.fabrication.skillId,
        minimumLevel: recipe.minimumLevel,
        locationIds: [LOCATION_IDS.ruskRecovery],
        inputs: recipe.inputs.map((input) => ({ ...input })),
        outputQuantity: recipe.outputQuantity,
        access: { state: "available" },
      },
    ]);
    expect(of(sources, "player_trade")).toHaveLength(1);
    expect(sources.at(-1)?.kind).toBe("player_trade");
  });

  it("Galvanic Stock resolves to its Refining recipe at the Processing Yard", () => {
    const sources = resolveItemSources(ITEM_IDS.galvanicStock, facts());
    const recipe = balance.refining.recipes.galvanicStock;
    expect(of(sources, "refine")).toEqual([
      {
        kind: "refine",
        recipeActionId: recipe.actionId,
        skillId: balance.refining.skillId,
        minimumLevel: recipe.minimumLevel,
        locationIds: [LOCATION_IDS.abandonedProcessingYard],
        inputs: recipe.inputs.map((input) => ({ ...input })),
        outputQuantity: recipe.outputQuantity,
        deterministic: false,
        access: { state: "available" },
      },
    ]);
  });

  it("a Mining primary item resolves to the mine that produces it", () => {
    const sources = resolveItemSources(ITEM_IDS.ferriteShale, facts());
    expect(of(sources, "mine")).toEqual([
      {
        kind: "mine",
        sourceActionId: balance.mining.sources.ferriteShale.actionId,
        skillId: balance.mining.skillId,
        locationIds: [LOCATION_IDS.theJag],
        role: "primary",
        oreItemId: ITEM_IDS.ferriteShale,
        access: { state: "available" },
      },
    ]);
  });

  it("a Secondary Find resolves to every mine whose table can produce it", () => {
    const topaz = of(resolveItemSources(ITEM_IDS.uncutTopaz, facts()), "mine");
    expect(topaz.map((source) => source.kind === "mine" && source.sourceActionId)).toEqual([
      balance.mining.sources.ferriteShale.actionId,
      balance.mining.sources.galvanite.actionId,
    ]);
    expect(topaz.every((source) => source.kind === "mine" && source.role === "secondary")).toBe(
      true,
    );
    const sapphire = of(resolveItemSources(ITEM_IDS.uncutSapphire, facts()), "mine");
    expect(sapphire).toHaveLength(1);
  });

  it("reports no odds for a Secondary Find or Scavenge", () => {
    const [find] = of(resolveItemSources(ITEM_IDS.uncutQuartz, facts()), "mine");
    expect(Object.keys(find ?? {}).sort()).toEqual(
      ["access", "kind", "locationIds", "oreItemId", "role", "skillId", "sourceActionId"].sort(),
    );
    const [scavenge] = of(resolveItemSources(ITEM_IDS.ferriteShale, facts()), "scavenge");
    expect(scavenge).toEqual({ kind: "scavenge", access: { state: "available" } });
  });

  it("keeps separate recipes for one output from replacing each other", () => {
    const slag = of(resolveItemSources(ITEM_IDS.slag, facts()), "refine");
    expect(slag.map((source) => source.kind === "refine" && source.recipeActionId).sort()).toEqual(
      [ACTION_IDS.ferriteShaleSlagRefining, ACTION_IDS.galvaniteSlagRefining].sort(),
    );
    const scrap = of(resolveItemSources(ITEM_IDS.scrapMetal, facts()), "fabricate");
    expect(scrap).toHaveLength(2);
  });
});

describe("item sources — merchants, fixed claims, Scavenge, multiple sources", () => {
  it("a merchant-sold item resolves to the merchant and its current retail price", () => {
    const sources = resolveItemSources(ITEM_IDS.powerCell, facts());
    const bix = MERCHANTS.find((merchant) => merchant.npcId === NPC_IDS.bixWeller);
    const [merchant] = of(sources, "merchant");
    expect(merchant).toMatchObject({
      kind: "merchant",
      unitPrice: merchantRetailPrice(bix?.id ?? "", ITEM_IDS.powerCell),
      dailyLimit: bix?.prices.find((line) => line.itemId === ITEM_IDS.powerCell)?.dailySellLimit,
      locationId: LOCATION_IDS.holoHollow,
    });
  });

  it("a merchant that only BUYS an item is not a source of it", () => {
    const sources = resolveItemSources(ITEM_IDS.refinedFerrite, facts());
    expect(of(sources, "merchant")).toEqual([]);
  });

  it("Power Cell exposes every legitimate method without one overwriting another", () => {
    const sources = resolveItemSources(ITEM_IDS.powerCell, facts());
    expect(sources.map((source) => source.kind)).toEqual([
      "fabricate",
      "merchant",
      "fixed_claim",
      "scavenge",
      "player_trade",
    ]);
    expect(of(sources, "fixed_claim")).toEqual([
      {
        kind: "fixed_claim",
        claimId: POWER_ANNEX_CLAIM.claimId,
        locationId: LOCATION_IDS.emergencyPowerAnnex,
        quantity: POWER_ANNEX_CLAIM.quantity,
        cadence: "daily",
        access: { state: "available" },
      },
    ]);
  });

  it("the Annex descriptor describes a claim the item and location can actually hold", () => {
    expect(isItemTransferable(POWER_ANNEX_CLAIM.itemId)).toBe(true);
    expect(POWER_ANNEX_CLAIM.quantity).toBeLessThanOrEqual(balance.items.powerCell.stackLimit);
    expect(POWER_ANNEX_CLAIM.itemId).toBe(balance.items.powerCell.itemId);
    expect(LOCATIONS.some((location) => location.id === POWER_ANNEX_CLAIM.locationId)).toBe(true);
  });

  it("Scavenge is offered exactly for the items its table awards", () => {
    const awarded = new Set(SCAVENGE_OUTCOMES.flatMap((o) => (o.itemId ? [o.itemId] : [])));
    for (const itemId of [
      ITEM_IDS.ferriteShale,
      ITEM_IDS.refinedFerrite,
      ITEM_IDS.powerCell,
      ITEM_IDS.galvanite,
    ]) {
      expect(of(resolveItemSources(itemId, facts()), "scavenge").length > 0).toBe(
        awarded.has(itemId),
      );
    }
  });
});

describe("item sources — discovery versus capability gates", () => {
  it("shows an under-level recipe locked with its concrete gate, after usable sources", () => {
    const sources = resolveItemSources(
      ITEM_IDS.scrapMetal,
      facts({ levels: { [SKILL_IDS.fabrication]: 1 } }),
    );
    const galvanicScrap = balance.fabrication.recipes.galvanicScrap;
    const locked = sources.find(
      (source) => source.kind === "fabricate" && source.recipeActionId === galvanicScrap.actionId,
    );
    expect(locked?.access).toEqual({
      state: "locked",
      gates: [
        {
          kind: "skill_level",
          skillId: balance.fabrication.skillId,
          level: galvanicScrap.minimumLevel,
        },
      ],
    });
    // Usable methods first, then what is locked, then trading as the fallback.
    const reference = sources.filter((source) => source.kind !== "player_trade");
    const firstLocked = reference.findIndex((source) => source.access.state === "locked");
    expect(firstLocked).toBeGreaterThan(0);
    expect(reference.slice(firstLocked).every((source) => source.access.state === "locked")).toBe(
      true,
    );
    expect(reference.slice(0, firstLocked).every((s) => s.access.state === "available")).toBe(true);
    expect(sources.at(-1)?.kind).toBe("player_trade");
  });

  it("unlocks the same source at the required level", () => {
    const [recipe] = of(
      resolveItemSources(ITEM_IDS.wheelAssembly, facts({ levels: { [SKILL_IDS.fabrication]: 5 } })),
      "fabricate",
    );
    expect(recipe?.access).toEqual({ state: "available" });
  });

  it("hides the Fabrication Station entirely until its Mission is accepted", () => {
    const sources = resolveItemSources(ITEM_IDS.wheelAssembly, facts({ accepted: [] }));
    expect(sources.map((source) => source.kind)).toEqual(["player_trade"]);
    expect(JSON.stringify(sources)).not.toContain(MISSION_IDS.returnTheFavor);
  });

  it("hides a merchant until the Mission that opens them is accepted", () => {
    const wade = resolveItemSources(ITEM_IDS.scrapMetal, facts({ accepted: [] }));
    expect(of(wade, "merchant")).toEqual([]);
    const opened = resolveItemSources(
      ITEM_IDS.scrapMetal,
      facts({ accepted: [MISSION_IDS.tenThousandHours] }),
    );
    expect(of(opened, "merchant")).toHaveLength(1);
  });

  it("finds Deep Jag's mine only once its opened state resolves", () => {
    const closed = facts({ deepJagOpen: false });
    expect(of(resolveItemSources(ITEM_IDS.galvanite, closed), "mine")).toEqual([]);
    expect(of(resolveItemSources(ITEM_IDS.uncutSapphire, closed), "mine")).toEqual([]);
    expect(of(resolveItemSources(ITEM_IDS.galvanite, facts()), "mine")).toHaveLength(1);
  });
});

describe("item sources — drill-down and cycles", () => {
  it("every recipe input is inspectable through the same resolver", () => {
    const wheel = of(resolveItemSources(ITEM_IDS.wheelAssembly, facts()), "fabricate")[0];
    expect(wheel?.kind === "fabricate" && wheel.inputs.length).toBeGreaterThan(0);
    const stock = ITEM_IDS.galvanicStock;
    // Wheel Assembly → Galvanic Stock → Refining → Galvanite → Mining.
    expect(of(resolveItemSources(stock, facts()), "refine")).toHaveLength(1);
    const [refine] = of(resolveItemSources(stock, facts()), "refine");
    const galvanite = refine?.kind === "refine" ? refine.inputs[0]?.itemId : undefined;
    expect(galvanite).toBe(ITEM_IDS.galvanite);
    expect(of(resolveItemSources(galvanite ?? "", facts()), "mine")).toHaveLength(1);
  });

  it("every authored recipe input resolves to at least one source", () => {
    const inputs = new Set<string>();
    for (const recipe of [...fabricationRecipes(balance), ...refiningRecipes(balance)]) {
      for (const input of recipe.inputs) inputs.add(input.itemId);
    }
    for (const itemId of inputs) {
      expect(resolveItemSources(itemId, facts()).length, itemId).toBeGreaterThan(0);
    }
  });

  it("refuses to drill into an item already on the path", () => {
    expect(extendItemSourcePath([ITEM_IDS.wheelAssembly], ITEM_IDS.galvanicStock)).toEqual([
      ITEM_IDS.wheelAssembly,
      ITEM_IDS.galvanicStock,
    ]);
    expect(
      extendItemSourcePath(
        [ITEM_IDS.wheelAssembly, ITEM_IDS.galvanicStock],
        ITEM_IDS.wheelAssembly,
      ),
    ).toBeUndefined();
  });
});

describe("item sources — follow the authoritative content", () => {
  it("copies a changed recipe value with no second edit", () => {
    const doctored = structuredClone(balance) as unknown as {
      fabrication: {
        recipes: { wheelAssembly: { minimumLevel: number; inputs: { quantity: number }[] } };
      };
    };
    doctored.fabrication.recipes.wheelAssembly.minimumLevel = 9;
    doctored.fabrication.recipes.wheelAssembly.inputs[0]!.quantity = 7;
    const registries = {
      ...defaultItemSourceRegistries(),
      balance: doctored as unknown as EffectiveGameBalance,
    };
    const [source] = of(
      resolveItemSources(ITEM_IDS.wheelAssembly, facts(), registries),
      "fabricate",
    );
    expect(source).toMatchObject({
      minimumLevel: 9,
      access: { state: "locked", gates: [{ level: 9 }] },
      inputs: [{ quantity: 7 }, expect.anything(), expect.anything()],
    });
  });

  it("follows a changed merchant price", () => {
    const merchants = MERCHANTS.map((merchant) => ({
      ...merchant,
      prices: merchant.prices.map((line) =>
        line.itemId === ITEM_IDS.powerCell ? { ...line, sellPrice: 99 } : line,
      ),
    }));
    const registries = { ...defaultItemSourceRegistries(), merchants };
    const [source] = of(resolveItemSources(ITEM_IDS.powerCell, facts(), registries), "merchant");
    expect(source).toMatchObject({ unitPrice: 99 });
  });

  it("omits Player trade for an item the trade rules do not accept", () => {
    expect(of(resolveItemSources("not_an_item", facts()), "player_trade")).toEqual([]);
    expect(isItemTransferable("not_an_item")).toBe(false);
    expect(isItemTransferable(ITEM_IDS.wheelAssembly)).toBe(true);
  });
});

describe("item sources — what is deliberately not a source", () => {
  it("never reads Mission, dialogue or Work Order content", () => {
    const source = readFileSync("game/domain/item-sources.ts", "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const forbidden of [
      "content/missions",
      "domain/missions",
      "content/dialogue",
      "content/work-orders",
      "domain/work-orders",
      "domain/tinkering",
      "domain/practice-welding",
    ]) {
      expect(
        imports.some((path) => path?.endsWith(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });

  it("does not list a failed Refining pour's Slag as a way to get Slag from Refined Ferrite", () => {
    const slag = of(resolveItemSources(ITEM_IDS.slag, facts()), "refine");
    expect(
      slag.some(
        (source) => source.kind === "refine" && source.recipeActionId === ACTION_IDS.refining,
      ),
    ).toBe(false);
    expect(of(resolveItemSources(ITEM_IDS.slag, facts()), "fabricate")).toEqual([]);
  });
});
