import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import type { StackState } from "@/game/domain/inventory";
import {
  breakApartFacts,
  canBreakApart,
  planBreakApart,
  type BreakApartRoom,
} from "@/game/domain/rune-materials";

/**
 * Break Apart (#367): one selected Runestone becomes exactly five Rune Fragments,
 * judged against the Inventory that exists once the stone is consumed.
 */

const balance = getEffectiveGameBalance();
const { runestone: STONE, runeFragment: FRAGMENT, ferriteShale: SHALE } = ITEM_IDS;

const stack = (id: string, itemId: StackState["itemId"], quantity: number): StackState => ({
  id,
  itemId,
  quantity,
});

/** A room with 8 slots, 50 kg of carry capacity and the given occupancy. */
const room = (overrides: Partial<BreakApartRoom> = {}): BreakApartRoom => ({
  slotsUsed: 1,
  slotCapacity: 8,
  carriedMassGrams: 1_000,
  maximumCarryCapacityGrams: 50_000,
  ...overrides,
});

function plan(input: {
  stacks: StackState[];
  stackId?: string;
  expectedQuantity?: number;
  room?: Partial<BreakApartRoom>;
}) {
  const selected = input.stacks.find((candidate) => candidate.id === (input.stackId ?? "stone"))!;
  return planBreakApart({
    stacks: input.stacks,
    selected: {
      stackId: input.stackId ?? "stone",
      expectedQuantity: input.expectedQuantity ?? selected?.quantity ?? 1,
    },
    room: room(input.room),
    balance,
  });
}

describe("the authored Break Apart conversion", () => {
  it("destroys one Runestone for exactly five Rune Fragments, conserving mass", () => {
    const facts = breakApartFacts(balance);
    expect(facts).toMatchObject({
      inputItemId: STONE,
      outputItemId: FRAGMENT,
      outputQuantity: 5,
    });
    expect(facts.inputMassGrams).toBe(1_000);
    expect(facts.outputQuantity * facts.outputMassGrams).toBe(facts.inputMassGrams);
  });

  it("matches the locked item definitions", () => {
    expect(getItemDefinition(FRAGMENT, balance)).toEqual({
      itemId: FRAGMENT,
      kind: "stack",
      stackLimit: 10,
      massGrams: 200,
    });
    expect(getItemDefinition(STONE, balance)).toEqual({
      itemId: STONE,
      kind: "stack",
      stackLimit: 5,
      massGrams: 1_000,
    });
  });

  it("offers Break Apart for the Runestone and nothing else", () => {
    expect(canBreakApart(STONE, balance)).toBe(true);
    expect(canBreakApart(FRAGMENT, balance)).toBe(false);
    expect(canBreakApart(SHALE, balance)).toBe(false);
  });
});

describe("planBreakApart", () => {
  it("consumes a lone Runestone and creates one Fragment stack of five", () => {
    const result = plan({ stacks: [stack("stone", STONE, 1)] });
    expect(result).toEqual({
      ok: true,
      removal: { updatedStacks: [], deletedStackIds: ["stone"] },
      addition: {
        updatedStacks: [],
        createdStacks: [{ itemId: FRAGMENT, quantity: 5 }],
        remainingQuantity: 0,
      },
      consumedQuantity: 1,
      producedQuantity: 5,
    });
  });

  it("breaks only one stone from a larger stack", () => {
    const result = plan({
      stacks: [stack("stone", STONE, 3), stack("other-stone", STONE, 2)],
      room: { slotsUsed: 2 },
    });
    expect(result).toMatchObject({
      ok: true,
      removal: { updatedStacks: [{ id: "stone", quantity: 2 }], deletedStackIds: [] },
      addition: { createdStacks: [{ itemId: FRAGMENT, quantity: 5 }] },
    });
  });

  it("uses the slot a last stone frees, even when every slot is occupied", () => {
    // 8 of 8 slots used; the lone stone's slot is the Fragments' new home.
    const stacks = [
      stack("stone", STONE, 1),
      ...Array.from({ length: 7 }, (_, index) => stack(`shale-${index}`, SHALE, 10)),
    ];
    const result = plan({ stacks, room: { slotsUsed: 8 } });
    expect(result).toMatchObject({
      ok: true,
      removal: { deletedStackIds: ["stone"] },
      addition: { createdStacks: [{ itemId: FRAGMENT, quantity: 5 }] },
    });
  });

  it("frees no slot while the stack still holds a stone, so a full pack refuses", () => {
    const stacks = [
      stack("stone", STONE, 2),
      ...Array.from({ length: 7 }, (_, index) => stack(`shale-${index}`, SHALE, 10)),
    ];
    expect(plan({ stacks, room: { slotsUsed: 8 } })).toEqual({ ok: false, reason: "slots" });
  });

  it("merges into partial Fragment stacks before taking a new slot", () => {
    // A stack of two stones keeps its slot, so only the partial Fragment stacks have room.
    const stacks = [
      stack("stone", STONE, 2),
      stack("frag-a", FRAGMENT, 8),
      stack("frag-b", FRAGMENT, 7),
    ];
    // Full pack: 3 slots used of 3. Room is 2 + 3 = 5: exactly enough.
    const result = plan({ stacks, room: { slotsUsed: 3, slotCapacity: 3 } });
    expect(result).toMatchObject({
      ok: true,
      addition: {
        updatedStacks: [
          { id: "frag-a", quantity: 10 },
          { id: "frag-b", quantity: 10 },
        ],
        createdStacks: [],
      },
    });
  });

  it("splits across a partial stack and a new stack when needed", () => {
    const stacks = [stack("stone", STONE, 1), stack("frag", FRAGMENT, 8)];
    const result = plan({ stacks, room: { slotsUsed: 2, slotCapacity: 2 } });
    // The stone's freed slot takes the 3 that do not fit in the partial stack.
    expect(result).toMatchObject({
      ok: true,
      addition: {
        updatedStacks: [{ id: "frag", quantity: 10 }],
        createdStacks: [{ itemId: FRAGMENT, quantity: 3 }],
      },
    });
  });

  it("refuses without any diff when the Fragments do not fit", () => {
    const stacks = [stack("stone", STONE, 2), stack("frag", FRAGMENT, 10)];
    const result = plan({ stacks, room: { slotsUsed: 2, slotCapacity: 2 } });
    expect(result).toEqual({ ok: false, reason: "slots" });
    expect(result).not.toHaveProperty("removal");
    expect(result).not.toHaveProperty("addition");
  });

  it("counts every occupied slot, unique items included, against the room", () => {
    // Two slots used by an unrelated stack and a carried unique item.
    const stacks = [stack("stone", STONE, 2), stack("shale", SHALE, 4)];
    expect(plan({ stacks, room: { slotsUsed: 3, slotCapacity: 3 } })).toEqual({
      ok: false,
      reason: "slots",
    });
    expect(plan({ stacks, room: { slotsUsed: 3, slotCapacity: 4 } }).ok).toBe(true);
  });

  it("is mass-neutral, so it fits a carry cap the stone already filled exactly", () => {
    const result = plan({
      stacks: [stack("stone", STONE, 1)],
      room: { carriedMassGrams: 50_000, maximumCarryCapacityGrams: 50_000 },
    });
    expect(result.ok).toBe(true);
  });

  it("refuses by mass when the carried load is already past the cap", () => {
    const result = plan({
      stacks: [stack("stone", STONE, 1)],
      room: { carriedMassGrams: 51_001, maximumCarryCapacityGrams: 50_000 },
    });
    expect(result).toEqual({ ok: false, reason: "mass" });
  });

  it("refuses by slots when the room is already past its slot capacity", () => {
    const result = plan({
      stacks: [stack("stone", STONE, 2)],
      room: { slotsUsed: 3, slotCapacity: 2 },
    });
    expect(result).toEqual({ ok: false, reason: "slots" });
  });

  it("rejects a stale quantity without a diff", () => {
    expect(plan({ stacks: [stack("stone", STONE, 3)], expectedQuantity: 2 })).toEqual({
      ok: false,
      reason: "stack_changed",
    });
  });

  it("rejects a stack that is no longer carried", () => {
    expect(
      planBreakApart({
        stacks: [stack("other", STONE, 1)],
        selected: { stackId: "gone", expectedQuantity: 1 },
        room: room(),
        balance,
      }),
    ).toEqual({ ok: false, reason: "stack_not_found" });
  });

  it("rejects a selection that is not a Runestone", () => {
    expect(plan({ stacks: [stack("stone", FRAGMENT, 5)] })).toEqual({
      ok: false,
      reason: "not_breakable",
    });
  });

  it("never substitutes another Runestone stack for the selected one", () => {
    const stacks = [stack("stone", STONE, 1), stack("other", STONE, 4)];
    const result = plan({ stacks, stackId: "other", room: { slotsUsed: 2 } });
    expect(result).toMatchObject({
      ok: true,
      removal: { updatedStacks: [{ id: "other", quantity: 3 }], deletedStackIds: [] },
    });
  });

  it("converts exactly 1 stone to 5 Fragments across many carried layouts", () => {
    let seed = 367;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % max;
    };
    let accepted = 0;
    let refused = 0;
    for (let scenario = 0; scenario < 500; scenario += 1) {
      const stoneQuantity = 1 + next(5);
      const stacks: StackState[] = [stack("stone", STONE, stoneQuantity)];
      for (let index = next(3); index > 0; index -= 1)
        stacks.push(stack(`frag-${index}`, FRAGMENT, 1 + next(10)));
      for (let index = next(4); index > 0; index -= 1)
        stacks.push(stack(`shale-${index}`, SHALE, 1 + next(10)));
      const uniqueItems = next(2);
      const slotsUsed = stacks.length + uniqueItems;
      const slotCapacity = slotsUsed + next(3);
      const result = plan({ stacks, room: { slotsUsed, slotCapacity } });
      if (!result.ok) {
        refused += 1;
        expect(["slots", "mass"]).toContain(result.reason);
        continue;
      }
      accepted += 1;
      // Apply the diff the way the server does and check the invariants.
      const after = new Map(stacks.map((entry) => [entry.id, { ...entry }]));
      for (const id of result.removal.deletedStackIds) after.delete(id);
      for (const update of result.removal.updatedStacks)
        after.get(update.id)!.quantity = update.quantity;
      for (const update of result.addition.updatedStacks)
        after.get(update.id)!.quantity = update.quantity;
      result.addition.createdStacks.forEach((created, index) =>
        after.set(`new-${index}`, { id: `new-${index}`, ...created }),
      );
      const total = (itemId: string) =>
        [...after.values()]
          .filter((entry) => entry.itemId === itemId)
          .reduce((sum, entry) => sum + entry.quantity, 0);
      const before = (itemId: string) =>
        stacks.filter((entry) => entry.itemId === itemId).reduce((sum, e) => sum + e.quantity, 0);
      expect(total(STONE)).toBe(before(STONE) - 1);
      expect(total(FRAGMENT)).toBe(before(FRAGMENT) + 5);
      expect(total(SHALE)).toBe(before(SHALE));
      expect(after.size + uniqueItems).toBeLessThanOrEqual(slotCapacity);
      for (const entry of after.values()) {
        const definition = getItemDefinition(entry.itemId, balance);
        expect(definition?.kind).toBe("stack");
        if (definition?.kind === "stack")
          expect(entry.quantity).toBeLessThanOrEqual(definition.stackLimit);
      }
    }
    // The generator must exercise both outcomes, or the invariants above prove nothing.
    expect(accepted).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});
