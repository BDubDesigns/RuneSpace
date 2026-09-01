import { eq } from "drizzle-orm";
import { characterSkillXp, equippedItems, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { deriveEquipmentLoadout, type EquipmentLoadout } from "@/game/domain/equipment";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The shared authoritative play-state snapshot loader.
 *
 * This is the genuinely generic carried/equipment/play-state read used by the
 * play state assembly (`stateFromTransaction`), Scavenge capacity preflight,
 * and each activity resolver's snapshot derivation. It loads the same rows in
 * the same `FOR UPDATE` order the pre-#127 code used, so locking semantics are
 * unchanged.
 */
export type PlaySnapshot = {
  xpRows: (typeof characterSkillXp.$inferSelect)[];
  stacks: (typeof inventoryStacks.$inferSelect)[];
  allItemInstances: Awaited<ReturnType<typeof loadOwnedItemInstances>>["allInstances"];
  carriedInstances: Awaited<ReturnType<typeof loadOwnedItemInstances>>["carriedInstances"];
  equipmentLoadout: EquipmentLoadout;
  slotsUsed: number;
  slotCapacity: number;
  slotsAvailable: number;
  massAvailableGrams: number;
  carriedMassGrams: number;
  maximumCarryCapacityGrams: number;
};

export async function loadPlaySnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<PlaySnapshot> {
  const balance = getEffectiveGameBalance();
  const [xpRows, stacks, itemState, assignments] = await Promise.all([
    transaction
      .select()
      .from(characterSkillXp)
      .where(eq(characterSkillXp.characterId, characterId))
      .for("update"),
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
  const equipmentLoadout = deriveEquipmentLoadout({
    assignments,
    instances: itemState.carriedInstances,
    stacks,
    balance,
  });
  return {
    xpRows,
    stacks,
    allItemInstances: itemState.allInstances,
    carriedInstances: itemState.carriedInstances,
    equipmentLoadout,
    slotsUsed: equipmentLoadout.inventorySlotsUsed,
    slotCapacity: equipmentLoadout.containerSlotCapacity,
    slotsAvailable: Math.max(
      0,
      equipmentLoadout.containerSlotCapacity - equipmentLoadout.inventorySlotsUsed,
    ),
    massAvailableGrams: Math.max(
      0,
      equipmentLoadout.maximumCarryCapacityGrams - equipmentLoadout.carriedMassGrams,
    ),
    carriedMassGrams: equipmentLoadout.carriedMassGrams,
    maximumCarryCapacityGrams: equipmentLoadout.maximumCarryCapacityGrams,
  };
}
