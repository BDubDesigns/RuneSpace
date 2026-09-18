import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  planExactStackAddition,
  planExactStackAdditions,
  planExactStackRemovals,
  type StackBundleEntry,
  type StackState,
} from "@/game/domain/inventory";

/**
 * Issue #207 — the two cumulative bundle planners the Work Order boundary
 * needs: granting several stacks together (a job's rewards, or "10,001
 * Hours") and taking several stacks together (a job's recipe). Both compose
 * the single-item planners entry by entry against the state the previous
 * entries already left behind, which is the whole reason they exist instead
 * of the caller just looping the single-item planner itself.
 */

const balance = getEffectiveGameBalance();

describe("planExactStackAdditions — the real 10,001 Hours bundle (#207)", () => {
  it("plans Refined Ferrite x10 and Power Cell x5 into an empty inventory", () => {
    const entries: StackBundleEntry[] = [
      {
        itemId: ITEM_IDS.refinedFerrite,
        quantity: 10,
        stackLimit: balance.items.refinedFerrite.stackLimit,
        itemWeight: balance.items.refinedFerrite.massGrams,
      },
      {
        itemId: ITEM_IDS.powerCell,
        quantity: 5,
        stackLimit: balance.items.powerCell.stackLimit,
        itemWeight: balance.items.powerCell.massGrams,
      },
    ];
    // Ten Ferrite at a stack limit of five is two full stacks; five Cells at a
    // stack limit of five is one full stack.
    const result = planExactStackAdditions<string>([], entries, 10, 100_000);
    expect(result).toEqual({
      ok: true,
      plans: [
        {
          updatedStacks: [],
          createdStacks: [
            { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
            { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
          ],
          remainingQuantity: 0,
        },
        {
          updatedStacks: [],
          createdStacks: [{ itemId: ITEM_IDS.powerCell, quantity: 5 }],
          remainingQuantity: 0,
        },
      ],
    });
  });
});

describe("The cumulative property is the whole reason planExactStackAdditions exists (#207)", () => {
  it("refuses on SLOTS when two entries each fit alone but not together, and names the offending item", () => {
    const entries: StackBundleEntry[] = [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 10, stackLimit: 5, itemWeight: 150 },
      { itemId: ITEM_IDS.powerCell, quantity: 10, stackLimit: 5, itemWeight: 500 },
    ];
    // Planned separately against the same untouched, empty snapshot, each
    // entry needs exactly the two slots available and fits.
    for (const entry of entries) {
      expect(
        planExactStackAddition<string>([], entry.itemId, entry.quantity, entry.stackLimit, 2),
      ).toMatchObject({ ok: true });
    }
    // Planned together, the Ferrite entry spends both slots and nothing is
    // left for the Cells — which two independent checks would never catch.
    expect(planExactStackAdditions<string>([], entries, 2)).toEqual({
      ok: false,
      reason: "slots",
      itemId: ITEM_IDS.powerCell,
      missingQuantity: 10,
    });
  });

  it("refuses on MASS when two entries each fit alone but not together, and names the offending item", () => {
    const entries: StackBundleEntry[] = [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 6, stackLimit: 5, itemWeight: 150 },
      { itemId: ITEM_IDS.powerCell, quantity: 1, stackLimit: 5, itemWeight: 500 },
    ];
    // 900 g and 500 g each fit inside a 1,000 g budget on their own.
    expect(
      planExactStackAddition<string>(
        [],
        entries[0]!.itemId,
        entries[0]!.quantity,
        entries[0]!.stackLimit,
        10,
        1_000,
        entries[0]!.itemWeight,
      ),
    ).toMatchObject({ ok: true });
    expect(
      planExactStackAddition<string>(
        [],
        entries[1]!.itemId,
        entries[1]!.quantity,
        entries[1]!.stackLimit,
        10,
        1_000,
        entries[1]!.itemWeight,
      ),
    ).toMatchObject({ ok: true });
    // Together, the Ferrite entry spends 900 of the 1,000 g budget, leaving
    // only 100 g — not enough for one more 500 g Cell.
    expect(planExactStackAdditions<string>([], entries, 10, 1_000)).toEqual({
      ok: false,
      reason: "mass",
      itemId: ITEM_IDS.powerCell,
      missingQuantity: 1,
    });
  });

  it("tops up an existing partial stack before creating a new one", () => {
    const existing: readonly StackState<string>[] = [
      { id: "partial-ferrite", itemId: ITEM_IDS.refinedFerrite, quantity: 2 },
    ];
    const entries: StackBundleEntry[] = [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 1, stackLimit: 5, itemWeight: 150 },
    ];
    expect(planExactStackAdditions<string>(existing, entries, 5)).toEqual({
      ok: true,
      plans: [
        {
          updatedStacks: [{ id: "partial-ferrite", quantity: 3 }],
          createdStacks: [],
          remainingQuantity: 0,
        },
      ],
    });
  });

  it("lets a later entry of the same item top up a stack an earlier entry just created", () => {
    const entries: StackBundleEntry[] = [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 3, stackLimit: 5, itemWeight: 150 },
      { itemId: ITEM_IDS.refinedFerrite, quantity: 2, stackLimit: 5, itemWeight: 150 },
    ];
    const result = planExactStackAdditions<string>([], entries, 5);
    expect(result).toEqual({
      ok: true,
      plans: [
        {
          updatedStacks: [],
          createdStacks: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 3 }],
          remainingQuantity: 0,
        },
        // The second entry never creates a stack of its own: it tops up the
        // hypothetical stack the first entry just created, up to the shared
        // stack limit of five.
        {
          updatedStacks: [{ id: "bundle-0-0", quantity: 5 }],
          createdStacks: [],
          remainingQuantity: 0,
        },
      ],
    });
  });
});

describe("planExactStackRemovals — an atomic Work Order recipe (#207)", () => {
  it("removes a mixed Ferrite + Cell recipe atomically", () => {
    const existing: readonly StackState<string>[] = [
      { id: "ferrite-1", itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
      { id: "cell-1", itemId: ITEM_IDS.powerCell, quantity: 1 },
    ];
    const result = planExactStackRemovals<string>(existing, [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
      { itemId: ITEM_IDS.powerCell, quantity: 1 },
    ]);
    expect(result).toEqual({
      ok: true,
      updatedStacks: [],
      deletedStackIds: ["ferrite-1", "cell-1"],
    });
  });

  it("refuses when any one item is short, and reports no partial diff for the items that did fit", () => {
    // Only Ferrite is carried; the recipe also needs a Cell nobody has.
    const existing: readonly StackState<string>[] = [
      { id: "ferrite-1", itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
    ];
    const result = planExactStackRemovals<string>(existing, [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
      { itemId: ITEM_IDS.powerCell, quantity: 1 },
    ]);
    // The Ferrite requirement would have succeeded on its own, but the whole
    // recipe is one atomic commitment: the failure carries only the short
    // item and how much of it is missing, never the Ferrite diff already
    // computed internally.
    expect(result).toEqual({ ok: false, itemId: ITEM_IDS.powerCell, missingQuantity: 1 });
  });

  it("handles the same item appearing across several stacks", () => {
    const existing: readonly StackState<string>[] = [
      { id: "small", itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
      { id: "large", itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
    ];
    const result = planExactStackRemovals<string>(existing, [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 7 },
    ]);
    // The smaller stack is fully consumed first; the remainder comes off the
    // larger one, which survives with one left.
    expect(result).toEqual({
      ok: true,
      updatedStacks: [{ id: "large", quantity: 1 }],
      deletedStackIds: ["small"],
    });
  });
});
