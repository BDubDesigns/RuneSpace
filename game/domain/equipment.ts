import {
  getEquipmentDefinition,
  getItemDefinition,
  type EffectiveGameBalance,
  type MiningToolDefinition,
} from "@/game/config/balance";
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

/** The Mining tool genuinely occupying the Mining-tool slot, with its authored definition (#233). */
export type EquippedMiningTool = {
  itemInstanceId: string;
  itemId: string;
  definition: MiningToolDefinition;
};

export type EquipmentLoadout = {
  assignments: readonly EquipmentAssignmentState[];
  equippedItemInstanceIds: ReadonlySet<string>;
  containerSlotCapacity: number;
  inventorySlotsUsed: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
  /**
   * Whichever authored Mining tool is equipped (#233) — the Salvage Cutter, the
   * Loadsteel Cutter, or none. Compatibility only: whether the character's
   * Mining level lets them use it is Mining's own question.
   */
  miningTool?: EquippedMiningTool;
};

/**
 * Every container and Mining tool resolves through the one authored
 * equipment-definition boundary (`getEquipmentDefinition`, #233): the MYKEA,
 * the Scrap Box and the Freight Harness are ordinary containers there, and the
 * Salvage and Loadsteel Cutters ordinary Mining tools. There is no per-item
 * rule in this module, no third container slot, and no second tool slot.
 */
export function isApprovedEquipmentTarget(
  target: EquipmentTarget,
  balance: EffectiveGameBalance,
): boolean {
  return (
    (target.assignmentKind === "gear" &&
      target.suitSlotId === balance.carrying.miningToolSuitSlotId) ||
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
  const definition = getEquipmentDefinition(itemId, balance);
  const compatibleSuitSlotIds: readonly string[] = definition?.suitSlotIds ?? [];
  return Boolean(
    definition &&
      isApprovedEquipmentTarget(target, balance) &&
      definition.assignmentKind === target.assignmentKind &&
      compatibleSuitSlotIds.includes(target.suitSlotId),
  );
}

export function carriedItemMassGrams(itemId: string, balance: EffectiveGameBalance): number {
  return getItemDefinition(itemId, balance)?.massGrams ?? 0;
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
      throw new EquipmentRuleError("Equipped item is not currently carried by this character.");
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
      const definition = getEquipmentDefinition(instance.itemId, balance);
      if (definition?.kind !== "container")
        throw new EquipmentRuleError("Container assignment is incompatible.");
      return definition.slotCapacity;
    }),
  );
  const carriedMassGrams = calculateCarriedWeight([
    ...stacks.map((stack) => carriedItemMassGrams(stack.itemId, balance) * stack.quantity),
    ...instances.map((instance) => carriedItemMassGrams(instance.itemId, balance)),
  ]);
  const miningTool = assigned.flatMap(({ assignment, instance }) => {
    if (
      assignment.assignmentKind !== "gear" ||
      assignment.suitSlotId !== balance.carrying.miningToolSuitSlotId
    )
      return [];
    const definition = getEquipmentDefinition(instance.itemId, balance);
    return definition?.kind === "mining_tool"
      ? [{ itemInstanceId: instance.id, itemId: instance.itemId, definition }]
      : [];
  })[0];
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
    ...(miningTool ? { miningTool } : {}),
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

/**
 * The Mining level an item requires before it may be equipped (#233), or
 * undefined when it requires none beyond what every character has. Only a
 * Mining tool can author one today; the Salvage Cutter's is level 1.
 */
export function unmetEquipRequirement(
  itemId: string,
  miningLevel: number,
  balance: EffectiveGameBalance,
): { requiredMiningLevel: number } | undefined {
  const definition = getEquipmentDefinition(itemId, balance);
  if (definition?.kind !== "mining_tool") return undefined;
  return miningLevel >= definition.requiredMiningLevel
    ? undefined
    : { requiredMiningLevel: definition.requiredMiningLevel };
}

/** Validates a requested change against the complete resulting authoritative loadout. */
export function planEquipmentChange(input: {
  assignments: readonly EquipmentAssignmentState[];
  instances: readonly EquipmentItemInstance[];
  stacks: readonly EquipmentInventoryStack[];
  balance: EffectiveGameBalance;
  change: EquipmentChange;
  /** The character's authoritative Mining level, for a Mining tool's requirement (#233). */
  miningLevel: number;
}): EquipmentLoadout {
  const { assignments, instances, stacks, balance, change } = input;
  if (!isApprovedEquipmentTarget(change.target, balance))
    throw new EquipmentRuleError("Equipment target is not approved.");

  let nextAssignments: EquipmentAssignmentState[];
  if (change.kind === "equip") {
    const item = instances.find((instance) => instance.id === change.itemInstanceId);
    if (!item) throw new EquipmentRuleError("Item is not currently carried by this character.");
    if (!isCompatibleEquipmentAssignment(item.itemId, change.target, balance))
      throw new EquipmentRuleError("Item is not compatible with that equipment slot.");
    const unmet = unmetEquipRequirement(item.itemId, input.miningLevel, balance);
    if (unmet)
      throw new EquipmentRuleError(`Requires Mining ${unmet.requiredMiningLevel} to equip.`);
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
