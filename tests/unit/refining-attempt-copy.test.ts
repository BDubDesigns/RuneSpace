import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { describeFailureOutcome, describeQuantities } from "@/features/refining/attempt-copy";
import type { RefiningRunAttempt } from "@/server/refining";

/**
 * Issue #211 review — a failed attempt's wording has to match what the failure
 * actually did.
 *
 * Generalizing the copy for Galvaferrite made every failure say "returned",
 * which is right for the one shape that hands an input back and wrong for the
 * two that make Slag out of a ruined pour. The attempt records both what it
 * took and what it gave, so the verb is derivable rather than assumed.
 */

const balance = getEffectiveGameBalance();
const shale = balance.items.ferriteShale.itemId;
const refinedFerrite = balance.items.refinedFerrite.itemId;
const galvanicStock = balance.items.galvanicStock.itemId;
const galvanite = balance.items.galvanite.itemId;
const slag = balance.items.slag.itemId;

function failedAttempt(
  consumed: readonly { itemId: string; quantity: number }[],
  awarded: readonly { itemId: string; quantity: number }[],
): RefiningRunAttempt {
  return {
    sequence: 1,
    resolvedAt: "2026-09-19T00:00:00.000Z",
    success: false,
    rolledBasisPoints: 9_000,
    thresholdBasisPoints: 4_000,
    consumed,
    awarded,
    xpAwarded: 3,
    durationTicks: 7,
  };
}

describe("a failed Refining attempt says what it did", () => {
  it("calls Slag from a ruined Ferrite pour produced, not returned", () => {
    expect(
      describeFailureOutcome(
        failedAttempt([{ itemId: shale, quantity: 2 }], [{ itemId: slag, quantity: 1 }]),
      ),
    ).toBe("1 Slag produced");
  });

  it("calls the Galvanic Stock failure's two Slag produced as well", () => {
    expect(
      describeFailureOutcome(
        failedAttempt([{ itemId: galvanite, quantity: 2 }], [{ itemId: slag, quantity: 2 }]),
      ),
    ).toBe("2 Slag produced");
  });

  it("calls a Galvaferrite input handed straight back returned", () => {
    const consumed = [
      { itemId: refinedFerrite, quantity: 1 },
      { itemId: galvanicStock, quantity: 1 },
    ];
    expect(
      describeFailureOutcome(failedAttempt(consumed, [{ itemId: refinedFerrite, quantity: 1 }])),
    ).toBe("1 Refined Ferrite returned");
    // The other branch of the same 50/50, so neither input is privileged.
    expect(
      describeFailureOutcome(failedAttempt(consumed, [{ itemId: galvanicStock, quantity: 1 }])),
    ).toBe("1 Galvanic Stock returned");
  });

  it("says both when a failure would do both, without a third branch", () => {
    expect(
      describeFailureOutcome(
        failedAttempt(
          [{ itemId: refinedFerrite, quantity: 1 }],
          [
            { itemId: refinedFerrite, quantity: 1 },
            { itemId: slag, quantity: 1 },
          ],
        ),
      ),
    ).toBe("1 Slag produced, 1 Refined Ferrite returned");
  });

  it("does not claim anything came back when nothing did", () => {
    expect(describeFailureOutcome(failedAttempt([{ itemId: shale, quantity: 2 }], []))).toBe(
      "nothing recovered",
    );
  });
});

describe("quantities read as the player's own material", () => {
  it("names every item by its authoritative display name", () => {
    expect(
      describeQuantities([
        { itemId: refinedFerrite, quantity: 1 },
        { itemId: galvanicStock, quantity: 1 },
      ]),
    ).toBe("1 Refined Ferrite + 1 Galvanic Stock");
    expect(describeQuantities([{ itemId: galvanite, quantity: 2 }])).toBe("2 Galvanite");
    expect(describeQuantities([])).toBe("nothing");
  });
});
