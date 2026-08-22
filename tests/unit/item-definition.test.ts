import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";

describe("authoritative inventory item definitions", () => {
  it("exposes shared stack representation facts", () => {
    expect(getItemDefinition(ITEM_IDS.ferriteShale)).toEqual({
      itemId: ITEM_IDS.ferriteShale,
      kind: "stack",
      stackLimit: getEffectiveGameBalance().items.ferriteShale.stackLimit,
      massGrams: getEffectiveGameBalance().items.ferriteShale.massGrams,
    });
  });

  it("exposes shared unique representation facts and rejects unknown IDs", () => {
    expect(getItemDefinition(ITEM_IDS.salvageCutter)).toEqual({
      itemId: ITEM_IDS.salvageCutter,
      kind: "unique",
      massGrams: getEffectiveGameBalance().items.salvageCutter.massGrams,
    });
    expect(getItemDefinition("forged-item-id")).toBeUndefined();
  });
});
