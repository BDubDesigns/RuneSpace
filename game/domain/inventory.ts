import type { ItemId } from "@/game/config/foundations";

export type StackState = {
  itemId: ItemId;
  quantity: number;
};

export type StackAdditionPlan = {
  updatedStacks: readonly StackState[];
  createdStacks: readonly StackState[];
  remainingQuantity: number;
};

export function planStackAddition(
  existingStacks: readonly StackState[],
  itemId: ItemId,
  quantity: number,
  stackLimit: number,
  availableSlots: number,
  availableWeight: number = Number.POSITIVE_INFINITY,
  itemWeight: number = 0,
): StackAdditionPlan {
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new RangeError("Quantity must be non-negative");
  if (!Number.isInteger(stackLimit) || stackLimit <= 0)
    throw new RangeError("Stack limit must be positive");
  if (!Number.isInteger(availableSlots) || availableSlots < 0)
    throw new RangeError("Available slots must be non-negative");
  if (!Number.isFinite(availableWeight) && availableWeight !== Number.POSITIVE_INFINITY) {
    throw new RangeError("Available weight must be finite or unlimited");
  }
  if (availableWeight < 0 || !Number.isFinite(itemWeight) || itemWeight < 0) {
    throw new RangeError("Weight values must be non-negative");
  }

  const weightLimitedQuantity =
    itemWeight === 0 ? quantity : Math.min(quantity, Math.floor(availableWeight / itemWeight));
  let remainingQuantity = weightLimitedQuantity;
  const updatedStacks: StackState[] = [];
  for (const stack of existingStacks) {
    if (stack.itemId !== itemId || remainingQuantity === 0) continue;
    if (!Number.isInteger(stack.quantity) || stack.quantity <= 0 || stack.quantity > stackLimit) {
      throw new RangeError("Existing stack quantity is invalid");
    }
    const added = Math.min(stackLimit - stack.quantity, remainingQuantity);
    if (added > 0) updatedStacks.push({ ...stack, quantity: stack.quantity + added });
    remainingQuantity -= added;
  }

  const createdStacks: StackState[] = [];
  while (remainingQuantity > 0 && createdStacks.length < availableSlots) {
    const stackQuantity = Math.min(stackLimit, remainingQuantity);
    createdStacks.push({ itemId, quantity: stackQuantity });
    remainingQuantity -= stackQuantity;
  }
  return {
    updatedStacks,
    createdStacks,
    remainingQuantity: remainingQuantity + quantity - weightLimitedQuantity,
  };
}

export function calculateCarriedWeight(weights: readonly number[]): number {
  return weights.reduce((total, weight) => {
    if (!Number.isFinite(weight) || weight < 0)
      throw new RangeError("Item weight must be non-negative");
    return total + weight;
  }, 0);
}

export function inventorySlotCapacityFromContainers(
  containerCapacities: readonly number[],
): number {
  return containerCapacities.reduce((total, capacity) => {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError("Container capacity must be a non-negative integer");
    }
    return total + capacity;
  }, 0);
}

/** Equipped items contribute weight but never occupy inventory slots. */
export function inventorySlotsUsed(stackCount: number, carriedUniqueItemCount: number): number {
  if (!Number.isInteger(stackCount) || stackCount < 0)
    throw new RangeError("Stack count must be non-negative");
  if (!Number.isInteger(carriedUniqueItemCount) || carriedUniqueItemCount < 0) {
    throw new RangeError("Unique item count must be non-negative");
  }
  return stackCount + carriedUniqueItemCount;
}

/**
 * The future Strength formula supplies its contribution. This helper combines
 * that authoritative contribution with equipped and buff contributions only.
 */
export function deriveCarryingCapacity(input: {
  strengthCapacity: number;
  buffCapacities: readonly number[];
  equipmentCapacities: readonly number[];
}): number {
  return calculateCarriedWeight([
    input.strengthCapacity,
    ...input.buffCapacities,
    ...input.equipmentCapacities,
  ]);
}
