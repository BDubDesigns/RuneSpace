import type { EffectiveGameBalance } from "@/game/config/balance";
import {
  calculateCarriedWeight,
  inventorySlotCapacityFromContainers,
  inventorySlotsUsed,
} from "./inventory";

export type EquipmentAssignmentState = {
  assignmentKind: string;
  suitSlotId: string;
  itemInstanceId: string;
};

export type EquipmentItemInstance = {
  id: string;
  itemId: string;
};

export type EquipmentInventoryStack = {
  itemId: string;
  quantity: number;
};

export type EquipmentTarget = Pick<EquipmentAssignmentState, "assignmentKind" | "suitSlotId">;

export type EquipmentChange =
  | { kind: "equip"; itemInstanceId: string; target: EquipmentTarget }
  | { kind: "unequip"; target: EquipmentTarget };

export class EquipmentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EquipmentRuleError";
  }
}

export type EquipmentLoadout = {
  assignments: readonly EquipmentAssignmentState[];
  equippedItemInstanceIds: ReadonlySet<string>;
  containerSlotCapacity: number;
  inventorySlotsUsed: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
  hasCompatibleMiningTool: boolean;
};

function itemEquipmentDefinition(itemId: string, balance: EffectiveGameBalance) {
  if (itemId === balance.items.salvageCutter.itemId)
    return {
      assignmentKind: "gear" as const,
      suitSlotIds: [balance.items.salvageCutter.suitSlotId],
      massGrams: balance.items.salvageCutter.massGrams,
    };
  if (itemId === balance.items.starterContainer.itemId)
    return {
      assignmentKind: "container" as const,
      suitSlotIds: balance.carrying.containerSuitSlotIds,
      massGrams: balance.items.starterContainer.massGrams,
      containerSlotCapacity: balance.items.starterContainer.slotCapacity,
    };
  return undefined;
}

export function isApprovedEquipmentTarget(
  target: EquipmentTarget,
  balance: EffectiveGameBalance,
): boolean {
  return (
    (target.assignmentKind === "gear" &&
      target.suitSlotId === balance.items.salvageCutter.suitSlotId) ||
    (target.assignmentKind === "container" &&
      balance.carrying.containerSuitSlotIds.includes(
        target.suitSlotId as (typeof balance.carrying.containerSuitSlotIds)[number],
      ))
  );
}

export function isCompatibleEquipmentAssignment(
  itemId: string,
  target: EquipmentTarget,
  balance: EffectiveGameBalance,
): boolean {
  const definition = itemEquipmentDefinition(itemId, balance);
  const compatibleSuitSlotIds: readonly string[] = definition?.suitSlotIds ?? [];
  return Boolean(
    definition &&
      isApprovedEquipmentTarget(target, balance) &&
      definition.assignmentKind === target.assignmentKind &&
      compatibleSuitSlotIds.includes(target.suitSlotId),
  );
}

export function carriedItemMassGrams(itemId: string, balance: EffectiveGameBalance): number {
  if (itemId === balance.items.ferriteShale.itemId) return balance.items.ferriteShale.massGrams;
  return itemEquipmentDefinition(itemId, balance)?.massGrams ?? 0;
}

function assignmentKey(assignment: EquipmentTarget): string {
  return `${assignment.assignmentKind}:${assignment.suitSlotId}`;
}

function assertValidAssignments(
  assignments: readonly EquipmentAssignmentState[],
  instances: readonly EquipmentItemInstance[],
  balance: EffectiveGameBalance,
): void {
  const instanceIds = new Set(instances.map((instance) => instance.id));
  const assignmentKeys = new Set<string>();
  const assignedItemIds = new Set<string>();
  for (const assignment of assignments) {
    if (!isApprovedEquipmentTarget(assignment, balance))
      throw new EquipmentRuleError("Equipment assignment is not approved.");
    if (!instanceIds.has(assignment.itemInstanceId))
      throw new EquipmentRuleError("Equipped item is not owned by this character.");
    if (assignmentKeys.has(assignmentKey(assignment)))
      throw new EquipmentRuleError("An item is already assigned to that equipment slot.");
    if (assignedItemIds.has(assignment.itemInstanceId))
      throw new EquipmentRuleError("The same item cannot be equipped twice.");
    const item = instances.find((instance) => instance.id === assignment.itemInstanceId)!;
    if (!isCompatibleEquipmentAssignment(item.itemId, assignment, balance))
      throw new EquipmentRuleError("Item is not compatible with that equipment slot.");
    assignmentKeys.add(assignmentKey(assignment));
    assignedItemIds.add(assignment.itemInstanceId);
  }
}

export function deriveEquipmentLoadout(input: {
  assignments: readonly EquipmentAssignmentState[];
  instances: readonly EquipmentItemInstance[];
  stacks: readonly EquipmentInventoryStack[];
  balance: EffectiveGameBalance;
}): EquipmentLoadout {
  const { assignments, instances, stacks, balance } = input;
  assertValidAssignments(assignments, instances, balance);
  const equippedItemInstanceIds = new Set(
    assignments.map((assignment) => assignment.itemInstanceId),
  );
  const assigned = assignments.map((assignment) => ({
    assignment,
    instance: instances.find((instance) => instance.id === assignment.itemInstanceId)!,
  }));
  const equippedContainers = assigned.filter(
    ({ assignment }) => assignment.assignmentKind === "container",
  );
  const containerSlotCapacity = inventorySlotCapacityFromContainers(
    equippedContainers.map(({ instance }) => {
      const definition = itemEquipmentDefinition(instance.itemId, balance);
      if (!definition || definition.assignmentKind !== "container")
        throw new EquipmentRuleError("Container assignment is incompatible.");
      return definition.containerSlotCapacity;
    }),
  );
  const carriedMassGrams = calculateCarriedWeight([
    ...stacks.map((stack) => carriedItemMassGrams(stack.itemId, balance) * stack.quantity),
    ...instances.map((instance) => carriedItemMassGrams(instance.itemId, balance)),
  ]);
  const hasCompatibleMiningTool = assigned.some(
    ({ assignment, instance }) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId &&
      instance.itemId === balance.items.salvageCutter.itemId,
  );
  return {
    assignments,
    equippedItemInstanceIds,
    containerSlotCapacity,
    inventorySlotsUsed: inventorySlotsUsed(
      stacks.length,
      instances.length - equippedItemInstanceIds.size,
    ),
    carriedMassGrams,
    maximumCarryCapacityGrams: balance.carrying.startingCapacityGrams,
    hasCompatibleMiningTool,
  };
}

function validateCandidateLoadout(loadout: EquipmentLoadout): EquipmentLoadout {
  if (!loadout.assignments.some((assignment) => assignment.assignmentKind === "container"))
    throw new EquipmentRuleError("At least one compatible container must remain equipped.");
  if (loadout.inventorySlotsUsed > loadout.containerSlotCapacity)
    throw new EquipmentRuleError("Cannot change containers: current inventory would not fit.");
  if (loadout.carriedMassGrams > loadout.maximumCarryCapacityGrams)
    throw new EquipmentRuleError("Cannot change equipment: carried mass would exceed capacity.");
  return loadout;
}

/** Validates a requested change against the complete resulting authoritative loadout. */
export function planEquipmentChange(input: {
  assignments: readonly EquipmentAssignmentState[];
  instances: readonly EquipmentItemInstance[];
  stacks: readonly EquipmentInventoryStack[];
  balance: EffectiveGameBalance;
  change: EquipmentChange;
}): EquipmentLoadout {
  const { assignments, instances, stacks, balance, change } = input;
  if (!isApprovedEquipmentTarget(change.target, balance))
    throw new EquipmentRuleError("Equipment target is not approved.");

  let nextAssignments: EquipmentAssignmentState[];
  if (change.kind === "equip") {
    const item = instances.find((instance) => instance.id === change.itemInstanceId);
    if (!item) throw new EquipmentRuleError("Item is not owned by this character.");
    if (!isCompatibleEquipmentAssignment(item.itemId, change.target, balance))
      throw new EquipmentRuleError("Item is not compatible with that equipment slot.");
    const source = assignments.find((assignment) => assignment.itemInstanceId === item.id);
    if (source && assignmentKey(source) === assignmentKey(change.target))
      throw new EquipmentRuleError("Item is already equipped in that slot.");
    nextAssignments = assignments.filter(
      (assignment) =>
        assignment.itemInstanceId !== item.id &&
        assignmentKey(assignment) !== assignmentKey(change.target),
    );
    nextAssignments.push({ ...change.target, itemInstanceId: item.id });
  } else {
    const assignment = assignments.find(
      (candidate) => assignmentKey(candidate) === assignmentKey(change.target),
    );
    if (!assignment) throw new EquipmentRuleError("That equipment slot is already empty.");
    nextAssignments = assignments.filter(
      (candidate) => assignmentKey(candidate) !== assignmentKey(change.target),
    );
  }

  return validateCandidateLoadout(
    deriveEquipmentLoadout({ assignments: nextAssignments, instances, stacks, balance }),
  );
}
