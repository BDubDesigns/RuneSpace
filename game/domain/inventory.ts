import type { ItemId } from "@/game/config/foundations";

export type StackState<Id = string> = {
  id: Id;
  itemId: ItemId;
  quantity: number;
  /** Optional persistence metadata used to make stack selection deterministic. */
  createdAt?: Date | string;
};

export type StackUpdate<Id> = {
  id: Id;
  quantity: number;
};

export type NewStack = {
  itemId: ItemId;
  quantity: number;
};

export type StackAdditionPlan<Id> = {
  updatedStacks: readonly StackUpdate<Id>[];
  createdStacks: readonly NewStack[];
  remainingQuantity: number;
};

export type ExactStackAdditionPlan<Id> =
  | { ok: true; plan: StackAdditionPlan<Id> }
  | { ok: false; reason: "slots" | "mass"; missingQuantity: number };

export type UniqueItemAdditionPlan = { ok: true } | { ok: false; reason: "slots" | "mass" };

function compareStackCreationOrder<Id>(a: StackState<Id>, b: StackState<Id>): number {
  const aCreatedAt = a.createdAt instanceof Date ? a.createdAt.toISOString() : (a.createdAt ?? "");
  const bCreatedAt = b.createdAt instanceof Date ? b.createdAt.toISOString() : (b.createdAt ?? "");
  return aCreatedAt.localeCompare(bCreatedAt) || String(a.id).localeCompare(String(b.id));
}

function compareStackAdditionOrder<Id>(a: StackState<Id>, b: StackState<Id>): number {
  return b.quantity - a.quantity || compareStackCreationOrder(a, b);
}

/**
 * Preflight one unequipped unique item against the authoritative carried
 * Inventory projection. Unique items consume exactly one carried slot and
 * their content-owned mass, while equipped containers continue to supply the
 * slot capacity used by the caller.
 */
export function planUniqueItemAddition(input: {
  inventorySlotsUsed: number;
  slotCapacity: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
  itemMassGrams: number;
}): UniqueItemAdditionPlan {
  const values = [
    input.inventorySlotsUsed,
    input.slotCapacity,
    input.carriedMassGrams,
    input.maximumCarryCapacityGrams,
    input.itemMassGrams,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Unique-item capacity values must be non-negative numbers");
  }
  if (
    !Number.isInteger(input.inventorySlotsUsed) ||
    !Number.isInteger(input.slotCapacity) ||
    input.inventorySlotsUsed > input.slotCapacity
  ) {
    return { ok: false, reason: "slots" };
  }
  if (input.inventorySlotsUsed + 1 > input.slotCapacity) {
    return { ok: false, reason: "slots" };
  }
  if (input.carriedMassGrams + input.itemMassGrams > input.maximumCarryCapacityGrams) {
    return { ok: false, reason: "mass" };
  }
  return { ok: true };
}

export type ExactStackRemovalPlan<Id> =
  | {
      ok: true;
      updatedStacks: readonly StackUpdate<Id>[];
      deletedStackIds: readonly Id[];
    }
  | { ok: false; missingQuantity: number };

/**
 * Plan an exact fungible-stack removal without mutating the caller's rows.
 * Callers apply the returned diff inside their already-locked transaction.
 */
export function planExactStackRemoval<Id>(
  existingStacks: readonly StackState<Id>[],
  itemId: ItemId,
  quantity: number,
): ExactStackRemovalPlan<Id> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError("Quantity must be non-negative");
  }
  if (quantity === 0) return { ok: true, updatedStacks: [], deletedStackIds: [] };

  let remainingQuantity = quantity;
  const updatedStacks: StackUpdate<Id>[] = [];
  const deletedStackIds: Id[] = [];
  const matchingStacks = existingStacks
    .filter((stack) => stack.itemId === itemId)
    .sort((a, b) => a.quantity - b.quantity || compareStackCreationOrder(a, b));
  for (const stack of matchingStacks) {
    if (remainingQuantity === 0) continue;
    if (!Number.isInteger(stack.quantity) || stack.quantity <= 0) {
      throw new RangeError("Existing stack quantity is invalid");
    }
    if (stack.quantity <= remainingQuantity) {
      remainingQuantity -= stack.quantity;
      deletedStackIds.push(stack.id);
    } else {
      updatedStacks.push({ id: stack.id, quantity: stack.quantity - remainingQuantity });
      remainingQuantity = 0;
    }
  }

  return remainingQuantity === 0
    ? { ok: true, updatedStacks, deletedStackIds }
    : { ok: false, missingQuantity: remainingQuantity };
}

export type PossibleAward = {
  itemId: ItemId;
  quantity: number;
  stackLimit: number;
  itemWeight: number;
};

export type PossibleAwardAdditionPlan<Id> =
  | { ok: true; plans: readonly StackAdditionPlan<Id>[] }
  | {
      ok: false;
      reason: "slots" | "mass";
      itemId: ItemId;
      missingQuantity: number;
    };

export function planStackAddition<Id>(
  existingStacks: readonly StackState<Id>[],
  itemId: ItemId,
  quantity: number,
  stackLimit: number,
  availableSlots: number,
  availableWeight: number = Number.POSITIVE_INFINITY,
  itemWeight: number = 0,
): StackAdditionPlan<Id> {
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
  const updatedStacks: StackUpdate<Id>[] = [];
  const matchingStacks = existingStacks.filter((stack) => stack.itemId === itemId);
  for (const stack of matchingStacks) {
    if (!Number.isInteger(stack.quantity) || stack.quantity <= 0 || stack.quantity > stackLimit) {
      throw new RangeError("Existing stack quantity is invalid");
    }
  }
  const partialStacks = matchingStacks
    .filter((stack) => stack.quantity < stackLimit)
    .sort(compareStackAdditionOrder);
  for (const stack of partialStacks) {
    if (remainingQuantity === 0) continue;
    const added = Math.min(stackLimit - stack.quantity, remainingQuantity);
    if (added > 0) updatedStacks.push({ id: stack.id, quantity: stack.quantity + added });
    remainingQuantity -= added;
  }

  const createdStacks: NewStack[] = [];
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

/**
 * Plan an all-or-nothing stack addition. The ordinary mining planner is
 * intentionally allowed to return a partial result; instantaneous rewards
 * such as the Power Annex allotment must use this boundary instead.
 */
export function planExactStackAddition<Id>(
  existingStacks: readonly StackState<Id>[],
  itemId: ItemId,
  quantity: number,
  stackLimit: number,
  availableSlots: number,
  availableWeight: number = Number.POSITIVE_INFINITY,
  itemWeight: number = 0,
): ExactStackAdditionPlan<Id> {
  const plan = planStackAddition(
    existingStacks,
    itemId,
    quantity,
    stackLimit,
    availableSlots,
    availableWeight,
    itemWeight,
  );
  if (plan.remainingQuantity === 0) return { ok: true, plan };

  const weightLimitedQuantity =
    itemWeight === 0 ? quantity : Math.min(quantity, Math.floor(availableWeight / itemWeight));
  return {
    ok: false,
    reason: weightLimitedQuantity < quantity ? "mass" : "slots",
    missingQuantity: plan.remainingQuantity,
  };
}

/**
 * Prove that every mutually exclusive exact award can fit independently from
 * the same inventory snapshot. This deliberately does not apply one branch's
 * hypothetical stack changes before planning the next branch.
 */
export function planPossibleAwardAdditions<Id>(
  existingStacks: readonly StackState<Id>[],
  awards: readonly PossibleAward[],
  availableSlots: number,
  availableWeight: number,
): PossibleAwardAdditionPlan<Id> {
  const plans: StackAdditionPlan<Id>[] = [];
  const failures: Array<{
    award: PossibleAward;
    result: Extract<ExactStackAdditionPlan<Id>, { ok: false }>;
  }> = [];

  for (const award of awards) {
    const result = planExactStackAddition(
      existingStacks,
      award.itemId,
      award.quantity,
      award.stackLimit,
      availableSlots,
      availableWeight,
      award.itemWeight,
    );
    if (result.ok) plans.push(result.plan);
    else failures.push({ award, result });
  }

  if (failures.length === 0) return { ok: true, plans };

  // Preserve the most actionable capacity classification when different
  // mutually exclusive branches fail for different reasons.
  const failure = failures.find(({ result }) => result.reason === "mass") ?? failures[0]!;
  return {
    ok: false,
    reason: failure.result.reason,
    itemId: failure.award.itemId,
    missingQuantity: failure.result.missingQuantity,
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
 * A carried unique item instance in authoritative, deterministic presentation
 * order. `createdAt` must be a canonical sortable string (callers supply
 * `Date#toISOString()`); the ID breaks insertion-time ties.
 */
export type CarriedUniqueItemInstance = {
  id: string;
  itemId: ItemId;
  createdAt: string;
};

/**
 * The carried-unique-item projection: every owned instance that is not
 * currently equipped, in stable (createdAt, id) order so refreshes and
 * equipment changes never reshuffle the remaining tiles.
 */
export function deriveCarriedUniqueItems<Instance extends CarriedUniqueItemInstance>(
  instances: readonly Instance[],
  equippedItemInstanceIds: ReadonlySet<string>,
): Instance[] {
  return instances
    .filter((instance) => !equippedItemInstanceIds.has(instance.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Clamp a stack's UI fill level without making presentation infer item rules. */
export function inventoryStackFillFraction(quantity: number, stackLimit: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(stackLimit) || stackLimit <= 0) return 0;
  return Math.min(1, Math.max(0, quantity / stackLimit));
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
