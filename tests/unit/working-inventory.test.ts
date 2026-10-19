import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  carriedQuantity,
  removeFromStack,
  removeStacks,
  workingInventory,
  workingInventoryDiff,
} from "@/game/domain/working-inventory";

const balance = getEffectiveGameBalance();
const { runestone: STONE, ferriteShale: SHALE } = ITEM_IDS;

const stacks = [
  { id: "big", itemId: STONE, quantity: 3 },
  { id: "small", itemId: STONE, quantity: 1 },
  { id: "shale", itemId: SHALE, quantity: 4 },
];
const start = () => workingInventory({ stacks, slotsAvailable: 2, massAvailableGrams: 5_000 });

describe("removeFromStack", () => {
  it("takes from the named stack, not the smallest one of the item", () => {
    const result = removeFromStack(start(), "big", 1, balance);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventory.stacks.find((stack) => stack.id === "big")?.quantity).toBe(2);
    expect(result.inventory.stacks.find((stack) => stack.id === "small")?.quantity).toBe(1);
    // A stack that keeps a stone keeps its slot; the stone's mass is freed.
    expect(result.inventory.slotsAvailable).toBe(2);
    expect(result.inventory.massAvailableGrams).toBe(6_000);
    // Contrast: removeStacks plans smallest-first, so it would empty "small" instead.
    const byItem = removeStacks(start(), [{ itemId: STONE, quantity: 1 }], balance);
    expect(byItem.ok && byItem.inventory.stacks.some((stack) => stack.id === "small")).toBe(false);
  });

  it("frees the slot only when the removal empties the stack", () => {
    const result = removeFromStack(start(), "small", 1, balance);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventory.stacks.map((stack) => stack.id)).toEqual(["big", "shale"]);
    expect(result.inventory.slotsAvailable).toBe(3);
    expect(carriedQuantity(result.inventory, STONE)).toBe(3);
    expect(workingInventoryDiff(stacks, result.inventory)).toEqual({
      stackUpdates: [],
      deletedStackIds: ["small"],
      createdStacks: [],
    });
  });

  it("refuses a missing stack, more than it holds, and a non-positive quantity without change", () => {
    const inventory = start();
    expect(removeFromStack(inventory, "gone", 1, balance)).toEqual({ ok: false });
    expect(removeFromStack(inventory, "small", 2, balance)).toEqual({ ok: false });
    expect(removeFromStack(inventory, "big", 0, balance)).toEqual({ ok: false });
    expect(removeFromStack(inventory, "big", 1.5, balance)).toEqual({ ok: false });
    expect(inventory.stacks).toHaveLength(3);
  });
});
