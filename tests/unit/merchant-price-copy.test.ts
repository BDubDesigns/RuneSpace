import { describe, expect, it } from "vitest";
import { DIALOGUE_IDS, ITEM_IDS, MERCHANT_IDS } from "@/game/config/foundations";
import { DIALOGUE_SEQUENCES, getDialogue } from "@/game/content/dialogue";
import { merchantBuybackPrice, merchantRetailPrice } from "@/game/content/merchants";
import { spelledNumber, spelledNumberCapitalized } from "@/game/content/spelled-numbers";

/**
 * Issue #230 — dialogue that quotes a shop price reads it from the merchant
 * registry, so a price change cannot leave a line quoting the old one.
 */

function spokenText(dialogueId: string): string {
  return (getDialogue(dialogueId)?.beats ?? [])
    .map((beat) => (beat.kind === "npc" ? beat.text : ""))
    .join("\n");
}

describe("spelled numbers", () => {
  it("spells the everyday Credit amounts dialogue quotes", () => {
    expect(spelledNumber(0)).toBe("zero");
    expect(spelledNumber(1)).toBe("one");
    expect(spelledNumber(4)).toBe("four");
    expect(spelledNumber(12)).toBe("twelve");
    expect(spelledNumber(19)).toBe("nineteen");
    expect(spelledNumber(20)).toBe("twenty");
    expect(spelledNumber(36)).toBe("thirty-six");
    expect(spelledNumber(99)).toBe("ninety-nine");
    expect(spelledNumberCapitalized(36)).toBe("Thirty-six");
  });

  it("refuses anything it cannot spell honestly", () => {
    for (const value of [-1, 100, 1.5, Number.NaN]) {
      expect(() => spelledNumber(value)).toThrow(RangeError);
    }
  });
});

describe("dialogue quotes the live merchant prices", () => {
  const cellPrice = spelledNumber(merchantRetailPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell));
  const cellBuyback = spelledNumber(
    merchantBuybackPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell),
  );
  const scrapPrice = spelledNumber(merchantRetailPrice(MERCHANT_IDS.wadeRusk, ITEM_IDS.scrapMetal));

  it("has Bix quote twelve to buy a Cell and four to sell one back", () => {
    expect(cellPrice).toBe("twelve");
    expect(cellBuyback).toBe("four");
    const topic = spokenText(DIALOGUE_IDS.bixPowerCellsTopic);
    expect(topic).toContain("Power Cells are twelve Credits.");
    expect(topic).toContain("I'll buy them for four.");
  });

  it("has Wade quote four Credits a piece for Scrap everywhere he names it", () => {
    expect(scrapPrice).toBe("four");
    expect(spokenText(DIALOGUE_IDS.wadeTenThousandHoursPracticeReminder)).toContain(
      "Four credits a piece",
    );
    expect(spokenText(DIALOGUE_IDS.wadeTenThousandHoursCompletion)).toContain(
      "Scrap's four credits",
    );
  });

  it("leaves no line quoting the pre-#230 Cell or Scrap prices", () => {
    const allText = DIALOGUE_SEQUENCES.flatMap((sequence) => sequence.beats)
      .map((beat) => (beat.kind === "npc" ? beat.text : ""))
      .join("\n");
    expect(allText).not.toMatch(/\beight Credits\b/i);
    expect(allText).not.toMatch(/\btwenty-four\b/i);
    expect(allText).not.toMatch(/\btwo credits\b/i);
    expect(allText).not.toMatch(/buy them for three\b/i);
    expect(allText).not.toMatch(/give you three Credits/i);
  });
});
