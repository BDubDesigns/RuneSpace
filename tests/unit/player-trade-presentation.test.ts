import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemMaximumCharge } from "@/game/config/balance";
import {
  endedRequestNote,
  formatCredits,
  isEmptyOfferLines,
  itemStateLabel,
  offerableStacks,
  tradeStage,
} from "@/features/player-trade/trade-presentation";

const { items } = getEffectiveGameBalance();
const SHALE = items.ferriteShale.itemId;
const FERRITE = items.refinedFerrite.itemId;
const CUTTER = items.salvageCutter.itemId;

const offer = (ready: boolean, confirmed = false) => ({
  credits: 0,
  stacks: [],
  items: [],
  ready,
  confirmed,
});

/** Issue #268: presentation helpers only; the server owns every rule. */
describe("player trade presentation", () => {
  it("derives the acting character's stage from the server's phase and consent", () => {
    expect(tradeStage({ phase: "compose", yours: offer(false) })).toBe("compose");
    expect(tradeStage({ phase: "compose", yours: offer(true) })).toBe("ready");
    expect(tradeStage({ phase: "review", yours: offer(true) })).toBe("review");
    expect(tradeStage({ phase: "review", yours: offer(true, true) })).toBe("confirmed");
  });

  it("merges carried stacks by item and reports what is already offered", () => {
    const rows = offerableStacks(
      [
        { itemId: SHALE, quantity: 10 },
        { itemId: SHALE, quantity: 3 },
        { itemId: FERRITE, quantity: 5 },
      ],
      [{ itemId: SHALE, quantity: 4 }],
    );
    expect(rows.map(({ itemId, carried, offered }) => ({ itemId, carried, offered }))).toEqual(
      expect.arrayContaining([
        { itemId: SHALE, carried: 13, offered: 4 },
        { itemId: FERRITE, carried: 5, offered: 0 },
      ]),
    );
    expect(rows).toHaveLength(2);
    // Sorted by the player-facing name, not by id.
    expect(rows.map((row) => row.name)).toEqual([...rows.map((row) => row.name)].sort());
  });

  it("shows a Cutter's charge against its own maximum and nothing for stateless items", () => {
    const maximum = getItemMaximumCharge(CUTTER);
    expect(maximum).toBeGreaterThan(0);
    expect(itemStateLabel(CUTTER, 7)).toBe(`Charge 7/${maximum}`);
    expect(itemStateLabel(CUTTER, null)).toBe(`Charge 0/${maximum}`);
    expect(itemStateLabel(items.scrapBox.itemId, null)).toBeUndefined();
  });

  it("formats Credits and recognizes an empty side", () => {
    expect(formatCredits(1)).toBe("1 Credit");
    expect(formatCredits(1200)).toBe("1,200 Credits");
    expect(isEmptyOfferLines({ credits: 0, stacks: [], items: [] })).toBe(true);
    expect(isEmptyOfferLines({ credits: 1, stacks: [], items: [] })).toBe(false);
  });

  it("words why a request stopped waiting, and says nothing when the player withdrew it", () => {
    expect(endedRequestNote("Wren", "declined")).toBe("Wren declined your trade request.");
    expect(endedRequestNote("Wren", "expired")).toContain("in time");
    expect(endedRequestNote("Wren", "invalidated")).toContain("moved");
    expect(endedRequestNote("Wren", "canceled")).toBeUndefined();
    // A missed prompt still yields a true, generic line.
    expect(endedRequestNote("Wren", undefined)).toBe(
      "Wren isn't waiting on your trade request anymore.",
    );
  });
});
