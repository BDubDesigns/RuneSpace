import { getItemDefinition, type EffectiveGameBalance } from "@/game/config/balance";
import type { ItemId } from "@/game/config/foundations";
import {
  planExactStackAddition,
  planExactStackRemovals,
  planStackAddition,
  type NewStack,
  type StackRemovalRequirement,
  type StackState,
  type StackUpdate,
} from "@/game/domain/inventory";

/**
 * A hypothetical carried inventory a resolver can evolve unit by unit (#232).
 *
 * Fabrication and Tinkering both resolve several work units in one window, and
 * each unit has to be checked against the inventory the units before it left
 * behind — inputs removed free their mass and, when a stack empties, its slot;
 * outputs take them back. This carries exactly the numbers that question
 * needs, planned through the existing inventory planners, and reports the end
 * state as one diff against the rows it started from, so persistence writes
 * what resolution decided rather than replaying it.
 */
export type WorkingStack = StackState<string> & { persisted: boolean };

export type WorkingInventory = {
  readonly stacks: readonly WorkingStack[];
  readonly slotsAvailable: number;
  readonly massAvailableGrams: number;
  readonly createdCount: number;
};

export function workingInventory(input: {
  stacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
}): WorkingInventory {
  return {
    stacks: input.stacks.map((stack) => ({ ...stack, persisted: true })),
    slotsAvailable: input.slotsAvailable,
    massAvailableGrams: input.massAvailableGrams,
    createdCount: 0,
  };
}

function stackFacts(itemId: string, balance: EffectiveGameBalance) {
  const definition = getItemDefinition(itemId, balance);
  if (!definition || definition.kind !== "stack") {
    throw new Error(`"${itemId}" is not a stackable item`);
  }
  return definition;
}

export function carriedQuantity(inventory: WorkingInventory, itemId: string): number {
  return inventory.stacks
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.quantity, 0);
}

/**
 * Remove several stackable requirements together, all or nothing. Mass frees
 * immediately; a slot frees only when a stack empties.
 */
export function removeStacks(
  inventory: WorkingInventory,
  requirements: readonly StackRemovalRequirement[],
  balance: EffectiveGameBalance,
): { ok: true; inventory: WorkingInventory } | { ok: false; itemId: ItemId } {
  const plan = planExactStackRemovals(inventory.stacks, requirements);
  if (!plan.ok) return { ok: false, itemId: plan.itemId };
  const deleted = new Set(plan.deletedStackIds);
  const updated = new Map(plan.updatedStacks.map((update) => [update.id, update.quantity]));
  const massFreed = requirements.reduce(
    (total, requirement) =>
      total + requirement.quantity * stackFacts(requirement.itemId, balance).massGrams,
    0,
  );
  return {
    ok: true,
    inventory: {
      ...inventory,
      stacks: inventory.stacks
        .filter((stack) => !deleted.has(stack.id))
        .map((stack) =>
          updated.has(stack.id) ? { ...stack, quantity: updated.get(stack.id)! } : stack,
        ),
      slotsAvailable: inventory.slotsAvailable + deleted.size,
      massAvailableGrams: inventory.massAvailableGrams + massFreed,
    },
  };
}

function applyAddition(
  inventory: WorkingInventory,
  plan: { updatedStacks: readonly StackUpdate<string>[]; createdStacks: readonly NewStack[] },
  quantity: number,
  massGrams: number,
): WorkingInventory {
  const updated = new Map(plan.updatedStacks.map((update) => [update.id, update.quantity]));
  let createdCount = inventory.createdCount;
  const created: WorkingStack[] = plan.createdStacks.map((stack) => ({
    id: `created-${(createdCount += 1)}`,
    itemId: stack.itemId,
    quantity: stack.quantity,
    persisted: false,
  }));
  return {
    stacks: [
      ...inventory.stacks.map((stack) =>
        updated.has(stack.id) ? { ...stack, quantity: updated.get(stack.id)! } : stack,
      ),
      ...created,
    ],
    slotsAvailable: inventory.slotsAvailable - created.length,
    massAvailableGrams: inventory.massAvailableGrams - quantity * massGrams,
    createdCount,
  };
}

/** Add a stackable output exactly, or report which capacity refused it. */
export function addStackExact(
  inventory: WorkingInventory,
  itemId: ItemId,
  quantity: number,
  balance: EffectiveGameBalance,
): { ok: true; inventory: WorkingInventory } | { ok: false; reason: "slots" | "mass" } {
  const facts = stackFacts(itemId, balance);
  const plan = planExactStackAddition(
    inventory.stacks,
    itemId,
    quantity,
    facts.stackLimit,
    inventory.slotsAvailable,
    inventory.massAvailableGrams,
    facts.massGrams,
  );
  if (!plan.ok) return { ok: false, reason: plan.reason };
  return { ok: true, inventory: applyAddition(inventory, plan.plan, quantity, facts.massGrams) };
}

/**
 * Add as much of a stackable byproduct as ordinary capacity allows and report
 * the rest as discarded. Never refuses: a completed unit is completed.
 */
export function addStackKeepingWhatFits(
  inventory: WorkingInventory,
  itemId: ItemId,
  quantity: number,
  balance: EffectiveGameBalance,
): { inventory: WorkingInventory; kept: number; discarded: number } {
  const facts = stackFacts(itemId, balance);
  const plan = planStackAddition(
    inventory.stacks,
    itemId,
    quantity,
    facts.stackLimit,
    inventory.slotsAvailable,
    inventory.massAvailableGrams,
    facts.massGrams,
  );
  const kept = quantity - plan.remainingQuantity;
  return {
    inventory: applyAddition(inventory, plan, kept, facts.massGrams),
    kept,
    discarded: plan.remainingQuantity,
  };
}

/** A unique item takes one carried slot and its own mass. */
export function addUnique(
  inventory: WorkingInventory,
  itemId: ItemId,
  balance: EffectiveGameBalance,
): { ok: true; inventory: WorkingInventory } | { ok: false; reason: "slots" | "mass" } {
  const definition = getItemDefinition(itemId, balance);
  if (!definition || definition.kind !== "unique") {
    throw new Error(`"${itemId}" is not a unique item`);
  }
  if (inventory.slotsAvailable < 1) return { ok: false, reason: "slots" };
  if (inventory.massAvailableGrams < definition.massGrams) return { ok: false, reason: "mass" };
  return {
    ok: true,
    inventory: {
      ...inventory,
      slotsAvailable: inventory.slotsAvailable - 1,
      massAvailableGrams: inventory.massAvailableGrams - definition.massGrams,
    },
  };
}

/** Removing a carried unique item frees its slot and its mass. */
export function removeUnique(
  inventory: WorkingInventory,
  itemId: ItemId,
  balance: EffectiveGameBalance,
): WorkingInventory {
  const definition = getItemDefinition(itemId, balance);
  if (!definition || definition.kind !== "unique") {
    throw new Error(`"${itemId}" is not a unique item`);
  }
  return {
    ...inventory,
    slotsAvailable: inventory.slotsAvailable + 1,
    massAvailableGrams: inventory.massAvailableGrams + definition.massGrams,
  };
}

/** The end state as a diff against the rows the inventory started from. */
export type WorkingInventoryDiff = {
  stackUpdates: readonly StackUpdate<string>[];
  deletedStackIds: readonly string[];
  createdStacks: readonly NewStack[];
};

export function workingInventoryDiff(
  original: readonly StackState<string>[],
  inventory: WorkingInventory,
): WorkingInventoryDiff {
  const finalById = new Map(inventory.stacks.map((stack) => [stack.id, stack]));
  const stackUpdates: StackUpdate<string>[] = [];
  const deletedStackIds: string[] = [];
  for (const stack of original) {
    const final = finalById.get(stack.id);
    if (!final) deletedStackIds.push(stack.id);
    else if (final.quantity !== stack.quantity) {
      stackUpdates.push({ id: stack.id, quantity: final.quantity });
    }
  }
  return {
    stackUpdates,
    deletedStackIds,
    createdStacks: inventory.stacks
      .filter((stack) => !stack.persisted && stack.quantity > 0)
      .map((stack) => ({ itemId: stack.itemId, quantity: stack.quantity })),
  };
}
