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

  it("uses the supplied item name as text fallback when artwork metadata is unavailable", () => {
    expect(getItemPresentation(ITEM_IDS.refinedFerrite)).toBeUndefined();
    expect(resolveItemPresentation(ITEM_IDS.refinedFerrite, "Refined Ferrite")).toEqual({
      displayName: "Refined Ferrite",
      accessibleDescription: "Refined Ferrite",
      textFallback: "Refined Ferrite",
    });
  });
});
