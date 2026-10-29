import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ITEM_RARITY_STYLE } from "@/components/items/item-rarity";
import { ItemVisual } from "@/components/items/ItemVisual";
import { RarityShimmer } from "@/components/items/RarityShimmer";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  getItemPresentation,
  ITEM_RARITY_LABELS,
  TRADE_SCARCITY_RARITIES,
} from "@/game/content/item-presentation";
import {
  TRADE_SCARCITY_WARNING,
  tradeHasScarcityWarning,
} from "@/features/player-trade/trade-presentation";
import { legendaryFindAnnouncementBody } from "@/game/domain/echo-hunts";

/**
 * Exactly two animated rarity tiers (#399): Ultra Rare keeps the small plus
 * sparkles only (its sweeping sheen is gone), Legendary has the sparkles AND the
 * travelling sweep plus its own visible label and accent. Rare and ordinary are
 * untouched. The effect is one shared overlay, so every item card agrees.
 */

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("the shared rarity overlay", () => {
  it("renders nothing for an ordinary or merely Rare item", () => {
    expect(render(React.createElement(RarityShimmer, { rarity: undefined }))).toBe("");
    expect(render(React.createElement(RarityShimmer, { rarity: "rare" }))).toBe("");
  });

  it("gives Ultra Rare the three sparkles and no sweep", () => {
    const html = render(React.createElement(RarityShimmer, { rarity: "ultra_rare" }));
    expect(html).toContain('data-item-shimmer="ultra_rare"');
    expect(html.match(/rs-item-shimmer__spark/g)).toHaveLength(3);
    expect(html).not.toContain("data-item-shimmer-sweep");
    expect(html).toContain('aria-hidden="true"');
  });

  it("gives Legendary the same three sparkles plus the sweep", () => {
    const html = render(React.createElement(RarityShimmer, { rarity: "legendary" }));
    expect(html).toContain('data-item-shimmer="legendary"');
    expect(html.match(/rs-item-shimmer__spark/g)).toHaveLength(3);
    expect(html).toContain("data-item-shimmer-sweep");
  });
});

describe("the tile treatment", () => {
  it("labels a Legendary tile in words and accent, and no other tier", () => {
    const boots = render(
      React.createElement(ItemVisual, { itemId: ITEM_IDS.minersBoots, name: "Miner's Boots" }),
    );
    expect(boots).toContain('data-item-rarity="legendary"');
    expect(boots).toContain('data-item-rarity-label="legendary"');
    expect(boots).toContain("Legendary");
    expect(boots).toContain("data-item-shimmer-sweep");
    const slab = render(
      React.createElement(StackItemVisual, {
        itemId: ITEM_IDS.motherlodeSlab,
        name: "Motherlode Slab",
        quantity: 1,
        stackLimit: 1,
      }),
    );
    expect(slab).toContain('data-item-rarity="ultra_rare"');
    expect(slab).not.toContain("data-item-rarity-label");
    expect(slab).not.toContain("data-item-shimmer-sweep");
    expect(slab).toContain('data-item-shimmer="ultra_rare"');
    const sapphire = render(
      React.createElement(StackItemVisual, {
        itemId: ITEM_IDS.uncutSapphire,
        name: "Uncut Sapphire",
        quantity: 1,
        stackLimit: 2,
      }),
    );
    expect(sapphire).toContain('data-item-rarity="rare"');
    expect(sapphire).not.toContain("data-item-shimmer");
    // A cut gem (#433) draws the same rare treatment as the stone it is cut from.
    for (const [itemId, name] of [
      [ITEM_IDS.cutQuartz, "Cut Quartz"],
      [ITEM_IDS.cutTopaz, "Cut Topaz"],
      [ITEM_IDS.cutSapphire, "Cut Sapphire"],
    ] as const) {
      const cut = render(
        React.createElement(StackItemVisual, { itemId, name, quantity: 1, stackLimit: 2 }),
      );
      expect(cut).toContain('data-item-rarity="rare"');
      expect(cut).not.toContain("data-item-shimmer");
    }
  });

  it("gives each tier its own accent and a readable label", () => {
    const accents = new Set(Object.values(ITEM_RARITY_STYLE).map((style) => style.accent));
    expect(accents.size).toBe(3);
    expect(ITEM_RARITY_LABELS.legendary).toBe("Legendary");
    expect(ITEM_RARITY_LABELS.ultra_rare).toBe("Ultra Rare");
  });
});

describe("the trade scarcity warning", () => {
  const none = { credits: 0, stacks: [], items: [] };
  const stack = (itemId: string) => ({ ...none, stacks: [{ itemId, quantity: 1 }] });
  const item = (itemId: string) => ({ ...none, items: [{ itemInstanceId: "i1", itemId }] });

  it("derives from rarity: Ultra Rare and Legendary warn, Rare and ordinary do not", () => {
    expect([...TRADE_SCARCITY_RARITIES].sort()).toEqual(["legendary", "ultra_rare"]);
    expect(tradeHasScarcityWarning(item(ITEM_IDS.minersBoots), none)).toBe(true);
    expect(tradeHasScarcityWarning(none, item(ITEM_IDS.minersGloves))).toBe(true);
    expect(tradeHasScarcityWarning(stack(ITEM_IDS.motherlodeSlab), none)).toBe(true);
    expect(tradeHasScarcityWarning(stack(ITEM_IDS.boulder), none)).toBe(true);
    expect(tradeHasScarcityWarning(stack(ITEM_IDS.uncutSapphire), none)).toBe(false);
    expect(tradeHasScarcityWarning(item(ITEM_IDS.salvageCutter), stack(ITEM_IDS.slag))).toBe(false);
    expect(tradeHasScarcityWarning(none, none)).toBe(false);
  });

  it("uses the approved wording and states no price", () => {
    expect(TRADE_SCARCITY_WARNING).toBe(
      "Very rare item! Check recent player-to-player prices in Trade chat before confirming. Trades are final.",
    );
    expect(TRADE_SCARCITY_WARNING).not.toMatch(/\d/);
  });

  it("names no item ID: every tier's authored rarity is the only input", () => {
    for (const itemId of Object.values(ITEM_IDS)) {
      const rarity = getItemPresentation(itemId)?.rarity;
      const warns = tradeHasScarcityWarning(stack(itemId), none);
      expect(warns).toBe(rarity === "ultra_rare" || rarity === "legendary");
    }
  });
});

describe("the Legendary discovery announcement", () => {
  it("is one excited line that names the character, the item and the planet", () => {
    expect(
      legendaryFindAnnouncementBody({
        characterName: "Vesper",
        itemName: "Miner's Gloves",
        planetName: "Stillreach",
      }),
    ).toBe("Vesper uncovered Legendary Miner's Gloves from a Resonance Echo on Stillreach!");
  });
});
