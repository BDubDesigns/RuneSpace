import { getEquipmentDefinition, getItemDefinition } from "@/game/config/balance";
import { planUniqueItemAddition } from "@/game/domain/inventory";

/**
 * Pure rules for a character's site stash container (#284).
 *
 * The authoritative commands in `server/site-stash` load locked rows and apply
 * the diff; every decision about which container may go where is made here, so
 * the rules are unit-testable without a database and no client value is ever
 * trusted.
 */

/**
 * A stash's slot capacity is exactly the installed container's authored
 * equipped slot capacity. `undefined` means the item is not a container at all.
 * There is no stash-specific capacity and no stored-mass limit.
 */
export function siteStashSlotCapacity(itemId: string): number | undefined {
  const equipment = getEquipmentDefinition(itemId);
  return equipment?.kind === "container" ? equipment.slotCapacity : undefined;
}

export type CarriedRoom = {
  inventorySlotsUsed: number;
  slotCapacity: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
};

export type ContainerRemovalPlan =
  | { ok: true }
  | { ok: false; reason: "not_empty" | "carried_capacity" };

/**
 * Removing a container outright needs the stash completely empty, and the
 * returned container must then fit in carried Inventory by normal slot AND mass
 * rules.
 */
export function planSiteStashRemoval(input: {
  occupiedSlots: number;
  installedItemId: string;
  carried: CarriedRoom;
}): ContainerRemovalPlan {
  if (input.occupiedSlots > 0) return { ok: false, reason: "not_empty" };
  const fit = planUniqueItemAddition({
    ...input.carried,
    itemMassGrams: getItemDefinition(input.installedItemId)?.massGrams ?? 0,
  });
  return fit.ok ? { ok: true } : { ok: false, reason: "carried_capacity" };
}

export type ContainerSwapPlan =
  | { ok: true }
  | {
      ok: false;
      reason: "not_a_container" | "same_container_type" | "stash_capacity" | "carried_capacity";
    };

/**
 * Swapping in a DIFFERENT container item type, without emptying the stash.
 *
 * - The replacement must be a container; the same item TYPE is refused even for
 *   a different instance (equivalent equipment has no replacement benefit).
 * - Its authored slot capacity must hold every currently occupied slot. Equal
 *   capacity is fine, so a heavy model may be exchanged for a lighter one.
 * - The replacement leaves carried Inventory in the same transaction, so the
 *   returned old container is checked against carried room AFTER that
 *   consumption: its slot and mass are measured with the replacement gone.
 */
export function planSiteStashSwap(input: {
  installedItemId: string;
  replacementItemId: string;
  occupiedSlots: number;
  carried: CarriedRoom;
}): ContainerSwapPlan {
  const replacementCapacity = siteStashSlotCapacity(input.replacementItemId);
  if (replacementCapacity === undefined) return { ok: false, reason: "not_a_container" };
  if (input.replacementItemId === input.installedItemId) {
    return { ok: false, reason: "same_container_type" };
  }
  if (replacementCapacity < input.occupiedSlots) return { ok: false, reason: "stash_capacity" };
  const replacementMass = getItemDefinition(input.replacementItemId)?.massGrams ?? 0;
  const fit = planUniqueItemAddition({
    inventorySlotsUsed: Math.max(0, input.carried.inventorySlotsUsed - 1),
    slotCapacity: input.carried.slotCapacity,
    carriedMassGrams: Math.max(0, input.carried.carriedMassGrams - replacementMass),
    maximumCarryCapacityGrams: input.carried.maximumCarryCapacityGrams,
    itemMassGrams: getItemDefinition(input.installedItemId)?.massGrams ?? 0,
  });
  return fit.ok ? { ok: true } : { ok: false, reason: "carried_capacity" };
}
