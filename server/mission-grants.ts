import { eq } from "drizzle-orm";
import { inventoryStacks, equippedItems } from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { planExactStackAddition } from "@/game/domain/inventory";
import { loadOwnedItemInstances, type addStackableItem } from "@/server/carried-inventory";
import type { DatabaseTransaction } from "@/server/action-resolution";
/**
 * Preflight one authored `stack_item` acceptance grant against ordinary
 * carrying capacity (#190).
 *
 * All-or-nothing by construction: this reuses the same exact-addition planner
 * the Power Annex allotment and Trade purchases use, so a grant that does not
 * wholly fit produces no plan at all rather than a partial one. It locks the
 * inventory rows it reads, so the plan it returns is still valid for the write
 * later in the same transaction.
 */

export async function planMissionItemGrant(
  transaction: DatabaseTransaction,
  characterId: string,
  grant: { itemId: string; quantity: number },
): Promise<
  | { ok: true; plan: Parameters<typeof addStackableItem>[1]["plan"] }
  | { ok: false; reason: "slots" | "mass"; message: string }
> {
  const balance = getEffectiveGameBalance();
  const itemDefinition = getItemDefinition(grant.itemId, balance);
  if (!itemDefinition || itemDefinition.kind !== "stack") {
    throw new Error(`Mission acceptance grant references a non-stackable item "${grant.itemId}"`);
  }
  const [stacks, itemState, assignments] = await Promise.all([
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .for("update"),
    loadOwnedItemInstances(transaction, characterId),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const loadout = deriveEquipmentLoadout({
    assignments,
    instances: itemState.carriedInstances,
    stacks,
    balance,
  });
  const plan = planExactStackAddition(
    stacks,
    grant.itemId,
    grant.quantity,
    itemDefinition.stackLimit,
    Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
    Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
    itemDefinition.massGrams,
  );
  if (plan.ok) return { ok: true, plan: plan.plan };
  const itemName = resolveItemPresentation(grant.itemId, grant.itemId).displayName;
  return {
    ok: false,
    reason: plan.reason,
    message:
      plan.reason === "mass"
        ? `All ${grant.quantity} ${itemName} will not fit within your carried-mass capacity. Free capacity and try again.`
        : `All ${grant.quantity} ${itemName} will not fit in your available inventory slots. Free capacity and try again.`,
  };
}
