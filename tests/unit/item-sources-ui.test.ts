import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, skillLevelThresholds } from "@/game/config/balance";
import { ITEM_IDS, MISSION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { LOCATIONS } from "@/game/content/locations";
import { merchantRetailPrice, MERCHANTS } from "@/game/content/merchants";
import { itemQuantityLabel } from "@/game/content/item-presentation";
import { resolveItemSources, type ItemSourceFacts } from "@/game/domain/item-sources";
import { resolveLocationState } from "@/game/domain/location-state";
import { ItemSourcesDetails } from "@/features/item-sources/ItemSourcesDrawer";
import { itemSourceFactsFromState } from "@/features/item-sources/item-source-facts";
import { describeItemSources } from "@/features/item-sources/item-source-presentation";
import type { PlayGameplayState } from "@/server/play";

/**
 * Issue #326 — how the item-source reference reads. Every figure is taken from
 * the authored registries, so a changed recipe or price changes these
 * expectations with it; none of them is a copy.
 */

const balance = getEffectiveGameBalance();

function facts(fabricationLevel = 5): ItemSourceFacts {
  const completedRepairTargetIds = new Set<string>([balance.repairTargets.deepJagCaveIn.targetId]);
  return {
    skillLevels: { [SKILL_IDS.fabrication]: fabricationLevel, [SKILL_IDS.refining]: 5 },
    acceptedMissionIds: new Set([MISSION_IDS.returnTheFavor, MISSION_IDS.tenThousandHours]),
    completedMissionIds: new Set(),
    fabricationStationUnlocked: true,
    locationStates: Object.fromEntries(
      LOCATIONS.map((location) => [
        location.id,
        resolveLocationState(location, {
          acceptedMissionIds: new Set(),
          completedRepairTargetIds,
        }),
      ]),
    ),
  };
}

const describeFor = (itemId: string, level = 5) =>
  describeItemSources(itemId, resolveItemSources(itemId, facts(level)), facts(level));

describe("item source wording", () => {
  it("describes a Fabrication recipe from the recipe itself", () => {
    const recipe = balance.fabrication.recipes.wheelAssembly;
    const [fabricate] = describeFor(ITEM_IDS.wheelAssembly);
    expect(fabricate).toMatchObject({
      title: "Fabricate",
      where: "Rusk Recovery",
      requirement: `Fabrication ${recipe.minimumLevel}`,
      yields: `Makes ${itemQuantityLabel(ITEM_IDS.wheelAssembly, recipe.outputQuantity, "")}`,
    });
    expect(fabricate?.inputs?.map((input) => input.label)).toEqual(
      recipe.inputs.map((input) => itemQuantityLabel(input.itemId, input.quantity, "")),
    );
    expect(fabricate?.locked).toBeUndefined();
  });

  it("states the concrete gate of a locked recipe and keeps the character's own level", () => {
    const recipe = balance.fabrication.recipes.wheelAssembly;
    const [locked] = describeFor(ITEM_IDS.wheelAssembly, 2);
    expect(locked?.locked).toBe(`Requires Fabrication ${recipe.minimumLevel} — you are 2`);
  });

  it("shows a merchant's name, place, current price and cap", () => {
    const merchant = MERCHANTS.find((m) =>
      m.prices.some((line) => line.itemId === ITEM_IDS.powerCell && line.sellPrice !== undefined),
    );
    const buy = describeFor(ITEM_IDS.powerCell).find((entry) => entry.kind === "merchant");
    expect(buy?.price).toBe(merchantRetailPrice(merchant?.id ?? "", ITEM_IDS.powerCell));
    expect(buy?.where).toContain("Bix Weller");
    expect(buy?.notes).toEqual([
      `Up to ${merchant?.prices.find((l) => l.itemId === ITEM_IDS.powerCell)?.dailySellLimit} a day`,
    ]);
  });

  it("reads Scavenge qualitatively, with no odds", () => {
    const scavenge = describeFor(ITEM_IDS.ferriteShale).find((entry) => entry.kind === "scavenge");
    expect(scavenge?.notes).toEqual(["Occasionally found while walking"]);
    expect(JSON.stringify(scavenge)).not.toMatch(/\d/);
  });

  it("calls player trade a capability, not a price", () => {
    const trade = describeFor(ITEM_IDS.wheelAssembly).at(-1);
    expect(trade).toMatchObject({ kind: "player_trade", title: "Player trade" });
    expect(trade?.price).toBeUndefined();
  });
});

describe("item source details", () => {
  const render = (path: readonly string[], level = 5) =>
    renderToStaticMarkup(
      React.createElement(ItemSourcesDetails, {
        path,
        facts: facts(level),
        onDrill: () => undefined,
        onBack: () => undefined,
      }),
    );

  it("makes each recipe ingredient inspectable through the same surface", () => {
    const markup = render([ITEM_IDS.wheelAssembly]);
    for (const input of balance.fabrication.recipes.wheelAssembly.inputs) {
      expect(markup).toContain(`data-item-source-inspect="${input.itemId}"`);
    }
    expect(markup).not.toContain("data-item-sources-back");
  });

  it("shows a drilled item with a way back and its own sources", () => {
    const markup = render([ITEM_IDS.wheelAssembly, ITEM_IDS.galvanicStock]);
    expect(markup).toContain('data-item-sources="galvanic_stock"');
    expect(markup).toContain("Back to Wheel Assembly");
    expect(markup).toContain('data-item-source-kind="refine"');
  });

  it("does not offer to inspect an ingredient already on the path", () => {
    const markup = render([ITEM_IDS.galvanicStock, ITEM_IDS.galvanite]);
    // Galvanite has Mining sources and is no recipe's input here, so nothing loops.
    expect(markup).toContain('data-item-source-kind="mine"');
    // Wheel Assembly needs Refined Ferrite; with Refined Ferrite already on the
    // path it cannot be drilled into again, but its other ingredients can.
    const cyclic = render([ITEM_IDS.refinedFerrite, ITEM_IDS.wheelAssembly]);
    expect(cyclic).not.toContain(`data-item-source-inspect="${ITEM_IDS.refinedFerrite}"`);
    expect(cyclic).toContain(`data-item-source-inspect="${ITEM_IDS.galvanicStock}"`);
  });

  it("marks a locked source and sorts it after usable ones", () => {
    const markup = render([ITEM_IDS.scrapMetal], 1);
    expect(markup).toContain('data-item-source-locked="true"');
    expect(markup).toContain('data-item-source-badge="locked"');
    expect(markup.indexOf('data-item-source-locked="false"')).toBeLessThan(
      markup.indexOf('data-item-source-locked="true"'),
    );
  });

  it("says plainly when nothing is known", () => {
    expect(render(["not_an_item"])).toContain("No known way to get this yet.");
  });
});

describe("facts from the Play projection", () => {
  const xpFor = (skillId: string, level: number) =>
    skillLevelThresholds(skillId)!.find((threshold) => threshold.level === level)!.totalXp;

  it("reads levels through each skill's own curve and the shared Mission and unlock projections", () => {
    const state = {
      skillTotalXp: {
        [SKILL_IDS.mining]: xpFor(SKILL_IDS.mining, 3),
        [SKILL_IDS.fabrication]: xpFor(SKILL_IDS.fabrication, 6),
      },
      fabricationStation: { unlocked: true },
      missions: [
        { missionId: "a", state: "active" },
        { missionId: "b", state: "completed" },
        { missionId: "c", state: "not_accepted" },
      ],
      locationStates: { the_jag: { availableActionIds: ["x"] } },
    } as unknown as PlayGameplayState;
    const built = itemSourceFactsFromState(state);
    expect(built.skillLevels[SKILL_IDS.mining]).toBe(3);
    expect(built.skillLevels[SKILL_IDS.fabrication]).toBe(6);
    // A skill with no XP row is authoritative zero: the starting level, never absent.
    expect(built.skillLevels[SKILL_IDS.refining]).toBe(1);
    expect([...built.acceptedMissionIds].sort()).toEqual(["a", "b"]);
    expect([...built.completedMissionIds]).toEqual(["b"]);
    expect(built.fabricationStationUnlocked).toBe(true);
    expect(built.locationStates).toBe(state.locationStates);
  });

  it("covers every skill that has an approved level curve", () => {
    const built = itemSourceFactsFromState({
      skillTotalXp: {},
      fabricationStation: { unlocked: false },
      missions: [],
      locationStates: {},
    } as unknown as PlayGameplayState);
    for (const skillId of Object.values(SKILL_IDS)) {
      expect(skillId in built.skillLevels).toBe(skillLevelThresholds(skillId) !== undefined);
    }
  });
});
