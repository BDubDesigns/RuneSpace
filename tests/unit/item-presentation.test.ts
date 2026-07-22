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
      artworkSrc: "/item-art/power-cell.png",
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

  it("resolves Refined Ferrite to its deliberate text fallback without artwork", () => {
    expect(getItemPresentation(ITEM_IDS.refinedFerrite)).toMatchObject({
      displayName: "Refined Ferrite",
      textFallback: "RF",
    });
    expect(getItemPresentation(ITEM_IDS.refinedFerrite)?.artworkSrc).toBeUndefined();
  });

  it("uses the supplied item name as text fallback when artwork metadata is unavailable", () => {
    expect(getItemPresentation(ITEM_IDS.slag)).toBeUndefined();
    expect(resolveItemPresentation(ITEM_IDS.slag, "Slag")).toEqual({
      displayName: "Slag",
      accessibleDescription: "Slag",
      textFallback: "Slag",
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
