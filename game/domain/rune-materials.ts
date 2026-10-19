import type { EffectiveGameBalance } from "@/game/config/balance";
import type { ItemId } from "@/game/config/foundations";
import type { StackState } from "@/game/domain/inventory";
import {
  addStackExact,
  removeFromStack,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Pure rules for breaking an intact Runestone apart (#367).
 *
 * Break Apart destroys exactly one Runestone from the stack the player selected
 * and grants the authored number of Rune Fragments, all-or-nothing, in carried
 * Inventory. The hypothetical-inventory mechanics are the shared ones
 * (`game/domain/working-inventory.ts`, also behind Fabrication, Tinkering and
 * player-trade settlement): this module owns only what is specific to the
 * conversion — the authored ratio and the selected-stack precondition — and
 * returns the same `WorkingInventoryDiff` the carried-stack adapter applies.
 */

/** The authored conversion's item facts, joined from the item definitions. */
export type BreakApartFacts = {
  inputItemId: ItemId;
  inputMassGrams: number;
  outputItemId: ItemId;
  outputQuantity: number;
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
    inputItemId: breakApart.inputItemId,
    inputMassGrams: input.massGrams,
    outputItemId: breakApart.outputItemId,
    outputQuantity: breakApart.outputQuantity,
  };
}

/** Whether an item is one Break Apart consumes. The one answer UI and server share. */
export function canBreakApart(itemId: string, balance: EffectiveGameBalance): boolean {
  return balance.runeMaterials.breakApart.inputItemId === itemId;
}

export type BreakApartRefusalReason =
  /** The selected stack is no longer carried. */
  | "stack_not_found"
  /** The stack is not an intact Runestone. */
  | "not_breakable"
  /** The stack's quantity is not the one the player confirmed. */
  | "stack_changed"
  /** The Fragments would not fit in the free slots. */
  | "slots"
  /** The Fragments would not fit in the free carry mass. */
  | "mass";

export type BreakApartPlan =
  | {
      ok: true;
      /** The whole change to the carried rows: the stone consumed, every Fragment placed. */
      diff: WorkingInventoryDiff;
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
 *
 * `slotsAvailable` and `massAvailableGrams` are the carried room before the
 * conversion, as every carried-inventory command reads it.
 */
export function planBreakApart(input: {
  stacks: readonly StackState<string>[];
  selected: { stackId: string; expectedQuantity: number };
  slotsAvailable: number;
  massAvailableGrams: number;
  balance: EffectiveGameBalance;
}): BreakApartPlan {
  const { stacks, selected, balance } = input;
  const facts = breakApartFacts(balance);
  const stack = stacks.find((candidate) => candidate.id === selected.stackId);
  if (!stack) return { ok: false, reason: "stack_not_found" };
  if (stack.itemId !== facts.inputItemId) return { ok: false, reason: "not_breakable" };
  if (stack.quantity !== selected.expectedQuantity) return { ok: false, reason: "stack_changed" };

  const consumed = removeFromStack(
    workingInventory({
      stacks,
      slotsAvailable: input.slotsAvailable,
      massAvailableGrams: input.massAvailableGrams,
    }),
    stack.id,
    1,
    balance,
  );
  if (!consumed.ok) return { ok: false, reason: "stack_changed" };
  const produced = addStackExact(
    consumed.inventory,
    facts.outputItemId,
    facts.outputQuantity,
    balance,
  );
  if (!produced.ok) return { ok: false, reason: produced.reason };
  return {
    ok: true,
    diff: workingInventoryDiff(stacks, produced.inventory),
    consumedQuantity: 1,
    producedQuantity: facts.outputQuantity,
  };
}
