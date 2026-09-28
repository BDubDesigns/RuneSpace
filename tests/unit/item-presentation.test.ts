import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getItemPresentation, resolveItemPresentation } from "@/game/content/item-presentation";
import { ITEM_IDS } from "@/game/config/foundations";

describe("item presentation content", () => {
  it("resolves the approved Ferrite Shale artwork metadata", () => {
    expect(getItemPresentation(ITEM_IDS.ferriteShale)).toEqual({
      displayName: "Ferrite Shale",
      accessibleDescription: "Ferrite Shale mineral fragment",
      textFallback: "FS",
      artworkSrc: "/item-art/ferrite-shale.webp",
    });
  });

  it("resolves Salvage Cutter to the approved artwork path", () => {
    expect(getItemPresentation(ITEM_IDS.salvageCutter)).toMatchObject({
      displayName: "Salvage Cutter",
      artworkSrc: "/item-art/salvage-cutter.png",
    });
  });

  it("resolves MYKEA SCHLEPPRAUM-8 to the approved artwork path", () => {
    expect(getItemPresentation(ITEM_IDS.mykeaSchleppraum8)).toMatchObject({
      displayName: "MYKEA SCHLEPPRAUM-8",
      artworkSrc: "/item-art/mykea-schleppraum-8.png",
    });
  });

  it("resolves Power Cell to the approved artwork path", () => {
    expect(getItemPresentation(ITEM_IDS.powerCell)).toMatchObject({
      displayName: "Power Cell",
      artworkSrc: "/item-art/power-cell.webp",
    });
  });

  it("provides accessible descriptions for all items with artwork", () => {
    expect(getItemPresentation(ITEM_IDS.salvageCutter)?.accessibleDescription).toBe(
      "Vice-jaw improvised Salvage Cutter mining tool",
    );
    expect(getItemPresentation(ITEM_IDS.mykeaSchleppraum8)?.accessibleDescription).toBe(
      "White-and-blue MYKEA industrial flat-pack container with eight drawers",
    );
    expect(getItemPresentation(ITEM_IDS.powerCell)?.accessibleDescription).toBe(
      "Salvaged DeWhat? power cell with QC FAILED marking and visible repairs",
    );
  });

  it("preserves text fallbacks for all items", () => {
    expect(getItemPresentation(ITEM_IDS.ferriteShale)?.textFallback).toBe("FS");
    expect(getItemPresentation(ITEM_IDS.salvageCutter)?.textFallback).toBe("SC");
    expect(getItemPresentation(ITEM_IDS.mykeaSchleppraum8)?.textFallback).toBe("MY-8");
    expect(getItemPresentation(ITEM_IDS.powerCell)?.textFallback).toBe("PC");
  });

  it("resolves Refined Ferrite to its artwork and deliberate presentation", () => {
    expect(getItemPresentation(ITEM_IDS.refinedFerrite)).toMatchObject({
      displayName: "Refined Ferrite",
      textFallback: "RF",
      artworkSrc: "/item-art/refined-ferrite.webp",
    });
  });

  it("resolves Slag to its artwork and deliberate presentation", () => {
    expect(getItemPresentation(ITEM_IDS.slag)).toMatchObject({
      displayName: "Slag",
      textFallback: "SL",
      artworkSrc: "/item-art/slag.webp",
    });
  });

  it("resolves the Tier-1 Fabrication outputs (#232) to their committed artwork", () => {
    expect(getItemPresentation(ITEM_IDS.mountingBracket)).toMatchObject({
      displayName: "Mounting Bracket",
      textFallback: "MB",
      artworkSrc: "/item-art/mounting-bracket.webp",
    });
    expect(getItemPresentation(ITEM_IDS.scrapBox)).toMatchObject({
      displayName: "Scrap Box",
      textFallback: "SB",
      artworkSrc: "/item-art/scrap-box.webp",
    });
    for (const itemId of [ITEM_IDS.mountingBracket, ITEM_IDS.scrapBox]) {
      const src = getItemPresentation(itemId)!.artworkSrc!;
      expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
    }
  });

  it("resolves the Fabrication 5 and 8 outputs (#233) to their committed artwork, not initials", () => {
    for (const [itemId, displayName, src] of [
      [ITEM_IDS.galvanicWireSpool, "Galvanic Wire Spool", "/item-art/galvanic-wire-spool.webp"],
      [ITEM_IDS.loadsteelCutter, "Loadsteel Cutter", "/item-art/loadsteel-cutter.webp"],
      [ITEM_IDS.freightHarness, "Freight Harness", "/item-art/freight-harness.webp"],
    ] as const) {
      expect(getItemPresentation(itemId)).toMatchObject({ displayName, artworkSrc: src });
      expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
    }
  });

  it("gives every item with an inventory definition committed artwork", () => {
    for (const itemId of Object.values(ITEM_IDS)) {
      const presentation = getItemPresentation(itemId);
      if (!presentation) continue;
      expect(presentation.artworkSrc, itemId).toBeDefined();
      expect(existsSync(join(process.cwd(), "public", presentation.artworkSrc!)), itemId).toBe(
        true,
      );
    }
  });

  it("uses the supplied item name as text fallback when artwork metadata is unavailable", () => {
    expect(getItemPresentation("unknown_item_xyz" as string)).toBeUndefined();
    expect(resolveItemPresentation("unknown_item_xyz" as string, "Unknown")).toEqual({
      displayName: "Unknown",
      accessibleDescription: "Unknown",
      textFallback: "Unknown",
    });
  });

  it("returns deliberate text fallback for unknown items", () => {
    expect(resolveItemPresentation("unknown_item", "Unknown")).toEqual({
      displayName: "Unknown",
      accessibleDescription: "Unknown",
      textFallback: "Unknown",
    });
  });
});
