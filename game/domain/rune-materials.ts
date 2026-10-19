import type { EffectiveGameBalance } from "@/game/config/balance";
import {
  planExactStackAddition,
  planExactStackRemoval,
  type StackAdditionPlan,
  type StackState,
  type StackUpdate,
} from "@/game/domain/inventory";

/**
 * Pure rules for breaking an intact Runestone apart (#367).
 *
 * Break Apart destroys exactly one Runestone from the stack the player selected
 * and grants the authored number of Rune Fragments, all-or-nothing, in carried
 * Inventory. Server commands load locked rows and apply the returned diff; every
 * decision about whether the conversion fits is made here, against the
 * HYPOTHETICAL Inventory that exists once the stone has been consumed, so no
 * client value is ever trusted and the rules are unit-testable without a
 * database.
 */

/** The authored conversion's item facts, joined from the item definitions. */
export type BreakApartFacts = {
  inputItemId: string;
  inputMassGrams: number;
  outputItemId: string;
  outputQuantity: number;
  outputStackLimit: number;
  outputMassGrams: number;
};

/** The Break Apart conversion, or why the balance cannot express one. */
export function breakApartFacts(balance: EffectiveGameBalance): BreakApartFacts {
  const { breakApart } = balance.runeMaterials;
  const items = Object.values(balance.items);
  const input = items.find((item) => item.itemId === breakApart.inputItemId);
  const output = items.find((item) => item.itemId === breakApart.outputItemId);
  if (!input || !output || !("stackLimit" in output)) {
    throw new Error("Break Apart authors an item that is not a shipped stackable item");
  }
  return {
    inputItemId: input.itemId,
    inputMassGrams: input.massGrams,
    outputItemId: output.itemId,
    outputQuantity: breakApart.outputQuantity,
    outputStackLimit: output.stackLimit,
    outputMassGrams: output.massGrams,
  };
}

/** Whether an item is one Break Apart consumes. The one answer UI and server share. */
export function canBreakApart(itemId: string, balance: EffectiveGameBalance): boolean {
  return balance.runeMaterials.breakApart.inputItemId === itemId;
}

/** The carried room the conversion is planned against, before the stone is consumed. */
export type BreakApartRoom = {
  slotsUsed: number;
  slotCapacity: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
};

export type BreakApartRefusalReason =
  /** The selected stack is no longer carried. */
  | "stack_not_found"
  /** The stack is not an intact Runestone. */
  | "not_breakable"
  /** The stack's quantity is not the one the player confirmed. */
  | "stack_changed"
  /** The five Fragments would not fit in the free slots. */
  | "slots"
  /** The five Fragments would not fit in the free carry mass. */
  | "mass";

export type BreakApartPlan<Id> =
  | {
      ok: true;
      /** The selected stack after one stone is consumed: resized, or deleted when it was the last. */
      removal: { updatedStacks: readonly StackUpdate<Id>[]; deletedStackIds: readonly Id[] };
      /** Where the Fragments land: partial Fragment stacks first, then new stacks. */
      addition: StackAdditionPlan<Id>;
      consumedQuantity: 1;
      producedQuantity: number;
    }
  | { ok: false; reason: BreakApartRefusalReason };

/**
 * Plan one Break Apart of the selected Runestone stack.
 *
 * The selected row alone decides what is consumed — never "any matching stack" —
 * and its confirmed quantity is an optimistic precondition. Capacity is then
 * judged on the Inventory the conversion would leave behind: the stone's slot is
 * freed only when that was the stack's last stone (a stack of two still occupies
 * its slot), its mass is freed either way, and the Fragments merge into partial
 * Fragment stacks before any new slot is taken. Nothing is partially applied: a
 * refusal carries no diff.
 */
export function planBreakApart<Id>(input: {
  stacks: readonly StackState<Id>[];
  selected: { stackId: Id; expectedQuantity: number };
  room: BreakApartRoom;
  balance: EffectiveGameBalance;
}): BreakApartPlan<Id> {
  const { stacks, selected, room, balance } = input;
  const facts = breakApartFacts(balance);
  const stack = stacks.find((candidate) => candidate.id === selected.stackId);
  if (!stack) return { ok: false, reason: "stack_not_found" };
  if (stack.itemId !== facts.inputItemId) return { ok: false, reason: "not_breakable" };
  if (stack.quantity !== selected.expectedQuantity) return { ok: false, reason: "stack_changed" };

  const removal = planExactStackRemoval([stack], stack.itemId, 1);
  if (!removal.ok) return { ok: false, reason: "stack_changed" };

  const remainingStacks = stacks.flatMap((candidate) => {
    if (removal.deletedStackIds.includes(candidate.id)) return [];
    const update = removal.updatedStacks.find((entry) => entry.id === candidate.id);
    return [update ? { ...candidate, quantity: update.quantity } : candidate];
  });
  // Signed on purpose: a room already past its capacity is refused rather than
  // clamped to "zero free", which would let a conversion look like it fits.
  const slotsFree = room.slotCapacity - (room.slotsUsed - removal.deletedStackIds.length);
  const massFree = room.maximumCarryCapacityGrams - (room.carriedMassGrams - facts.inputMassGrams);
  if (slotsFree < 0) return { ok: false, reason: "slots" };
  if (massFree < 0) return { ok: false, reason: "mass" };

  const addition = planExactStackAddition(
    remainingStacks,
    facts.outputItemId as StackState<Id>["itemId"],
    facts.outputQuantity,
    facts.outputStackLimit,
    slotsFree,
    massFree,
    facts.outputMassGrams,
  );
  if (!addition.ok) return { ok: false, reason: addition.reason };
  return {
    ok: true,
    removal: { updatedStacks: removal.updatedStacks, deletedStackIds: removal.deletedStackIds },
    addition: addition.plan,
    consumedQuantity: 1,
    producedQuantity: facts.outputQuantity,
  };
}
