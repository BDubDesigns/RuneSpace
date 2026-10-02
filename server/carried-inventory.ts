import { and, asc, eq, inArray } from "drizzle-orm";
import {
  cargoHoldItemInstances,
  equippedItems,
  inventoryStacks,
  itemInstances,
  siteStashContainers,
  siteStashItemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import type { ItemId } from "@/game/config/foundations";
import {
  deriveEquipmentLoadout,
  type EquipmentAssignmentState,
  type EquipmentItemInstance,
} from "@/game/domain/equipment";
import {
  planExactStackRemoval,
  type ExactStackRemovalPlan,
  type StackAdditionPlan,
} from "@/game/domain/inventory";
import type { WorkingInventoryDiff } from "@/game/domain/working-inventory";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Apply one already-planned addition to carried fungible inventory.
 *
 * The caller owns the surrounding transaction, character lock, capacity
 * preflight, and any gameplay-specific all-or-nothing decision. This adapter
 * owns the carried-row mutation mechanics: preserving existing stack IDs,
 * creating new rows for the planned overflow, and scoping every update to the
 * character whose inventory was planned.
 */
export async function addStackableItem(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    plan: StackAdditionPlan<string>;
    now: Date;
  },
): Promise<void> {
  await Promise.all([
    ...input.plan.updatedStacks.map((update) =>
      transaction
        .update(inventoryStacks)
        .set({ quantity: update.quantity, updatedAt: input.now })
        .where(
          and(
            eq(inventoryStacks.id, update.id),
            eq(inventoryStacks.characterId, input.characterId),
          ),
        ),
    ),
    ...(input.plan.createdStacks.length
      ? [
          transaction.insert(inventoryStacks).values(
            input.plan.createdStacks.map((stack) => ({
              characterId: input.characterId,
              itemId: stack.itemId,
              quantity: stack.quantity,
              createdAt: input.now,
              updatedAt: input.now,
            })),
          ),
        ]
      : []),
  ]);
}

/**
 * Apply one already-planned exact removal to carried fungible inventory.
 *
 * The caller owns the surrounding transaction, character lock, and any
 * gameplay-specific preconditions. This adapter owns only the row mechanics,
 * and scopes every mutation to the character whose rows were planned.
 */
export async function applyStackRemovalPlan(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    plan: Extract<ExactStackRemovalPlan<string>, { ok: true }>;
    now: Date;
  },
): Promise<void> {
  await Promise.all([
    ...input.plan.deletedStackIds.map((id) =>
      transaction
        .delete(inventoryStacks)
        .where(and(eq(inventoryStacks.id, id), eq(inventoryStacks.characterId, input.characterId))),
    ),
    ...input.plan.updatedStacks.map((update) =>
      transaction
        .update(inventoryStacks)
        .set({ quantity: update.quantity, updatedAt: input.now })
        .where(
          and(
            eq(inventoryStacks.id, update.id),
            eq(inventoryStacks.characterId, input.characterId),
          ),
        ),
    ),
  ]);
}

/**
 * Apply one already-planned whole-inventory diff (`workingInventoryDiff`) to a
 * character's carried stacks: rows deleted, rows resized, rows created.
 *
 * The caller planned the diff from rows it loaded under lock in this same
 * transaction. Every touched row is re-proved to still be that character's;
 * if one is not, this throws, so the caller's transaction rolls back rather
 * than writing a plan made against a different inventory.
 */
export async function applyCarriedStackDiff(
  transaction: DatabaseTransaction,
  input: { characterId: string; diff: WorkingInventoryDiff; now: Date },
): Promise<void> {
  const { characterId, diff, now } = input;
  const touched = [...diff.deletedStackIds, ...diff.stackUpdates.map((update) => update.id)];
  if (touched.length > 0) {
    const owned = await transaction
      .select({ id: inventoryStacks.id })
      .from(inventoryStacks)
      .where(
        and(eq(inventoryStacks.characterId, characterId), inArray(inventoryStacks.id, touched)),
      )
      .for("update");
    if (owned.length !== new Set(touched).size) {
      throw new Error("A carried-stack diff named a row this character no longer has");
    }
  }
  if (diff.deletedStackIds.length > 0) {
    await transaction
      .delete(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, characterId),
          inArray(inventoryStacks.id, [...diff.deletedStackIds]),
        ),
      );
  }
  for (const update of diff.stackUpdates) {
    await transaction
      .update(inventoryStacks)
      .set({ quantity: update.quantity, updatedAt: now })
      .where(and(eq(inventoryStacks.id, update.id), eq(inventoryStacks.characterId, characterId)));
  }
  if (diff.createdStacks.length > 0) {
    await transaction.insert(inventoryStacks).values(
      diff.createdStacks.map((stack) => ({
        characterId,
        itemId: stack.itemId,
        quantity: stack.quantity,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
}

export type StackableConsumptionResult =
  | Extract<ExactStackRemovalPlan<string>, { ok: true }>
  | { ok: false; missingQuantity: number };

/**
 * Consume an exact quantity from carried fungible inventory.
 *
 * Matching rows are locked and selected in quantity, creation, and ID order.
 * The complete removal plan is built before any row is changed, so an
 * insufficient quantity returns without writing. The caller's transaction
 * remains responsible for rolling back this mutation with related gameplay
 * updates if a later operation fails.
 */
export async function consumeStackableItem(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
    now: Date;
  },
): Promise<StackableConsumptionResult> {
  const stacks = await transaction
    .select()
    .from(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, input.characterId),
        eq(inventoryStacks.itemId, input.itemId),
      ),
    )
    .orderBy(asc(inventoryStacks.quantity), asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
    .for("update");
  const plan = planExactStackRemoval(stacks, input.itemId, input.quantity);
  if (!plan.ok) return plan;
  await applyStackRemovalPlan(transaction, {
    characterId: input.characterId,
    plan,
    now: input.now,
  });
  return plan;
}

export type SelectedStackRemovalResult =
  | { ok: true; itemId: ItemId; removedQuantity: number }
  | {
      ok: false;
      reason: "not_found" | "changed" | "wrong_item" | "invalid_quantity";
    };

/**
 * Remove from the exact carried stack the player selected.
 *
 * This is intentionally separate from automatic consumption: the row is
 * locked by both character and stack identity, and the expected quantity is
 * checked before any plan is applied. A stale or wrong-item selection refuses
 * without searching for, or substituting, another matching stack.
 */
export async function removeFromSelectedStack(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    stackId: string;
    expectedQuantity: number;
    expectedItemId?: ItemId;
    quantity: number;
    now: Date;
  },
): Promise<SelectedStackRemovalResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    return { ok: false, reason: "invalid_quantity" };

  const rows = await transaction
    .select()
    .from(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, input.characterId),
        eq(inventoryStacks.id, input.stackId),
      ),
    )
    .for("update");
  const stack = rows[0];
  if (!stack) return { ok: false, reason: "not_found" };
  if (stack.quantity !== input.expectedQuantity) return { ok: false, reason: "changed" };
  if (input.expectedItemId !== undefined && stack.itemId !== input.expectedItemId)
    return { ok: false, reason: "wrong_item" };
  if (input.quantity > stack.quantity) return { ok: false, reason: "invalid_quantity" };

  const plan = planExactStackRemoval([stack], stack.itemId, input.quantity);
  if (!plan.ok) return { ok: false, reason: "invalid_quantity" };
  await applyStackRemovalPlan(transaction, {
    characterId: input.characterId,
    plan,
    now: input.now,
  });
  return { ok: true, itemId: stack.itemId, removedQuantity: input.quantity };
}

/**
 * Owned item instances retain their character ownership in item_instances.
 * Location is the presence of a relation row: an instance with a Cargo row, an
 * installed-container row, or a stash-stored row (#284) is owned, but it is not
 * currently carried. Subtracting every such relation here, in the one loader
 * every carried-capacity, Tinkering, Mission turn-in, trade, and equipment path
 * reads, is what keeps an installed or stashed item out of all of them.
 */
export async function loadOwnedItemInstances(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<{
  allInstances: (typeof itemInstances.$inferSelect)[];
  carriedInstances: (typeof itemInstances.$inferSelect)[];
  cargoAssignments: (typeof cargoHoldItemInstances.$inferSelect)[];
  siteStashContainerRows: (typeof siteStashContainers.$inferSelect)[];
  siteStashItemRows: (typeof siteStashItemInstances.$inferSelect)[];
}> {
  const [allInstances, cargoAssignments, siteStashContainerRows, siteStashItemRows] =
    await Promise.all([
      transaction
        .select()
        .from(itemInstances)
        .where(eq(itemInstances.characterId, characterId))
        .for("update"),
      transaction
        .select()
        .from(cargoHoldItemInstances)
        .where(eq(cargoHoldItemInstances.characterId, characterId))
        .for("update"),
      transaction
        .select()
        .from(siteStashContainers)
        .where(eq(siteStashContainers.characterId, characterId))
        .for("update"),
      transaction
        .select()
        .from(siteStashItemInstances)
        .where(eq(siteStashItemInstances.characterId, characterId))
        .for("update"),
    ]);
  const notCarriedInstanceIds = new Set([
    ...cargoAssignments.map((assignment) => assignment.itemInstanceId),
    ...siteStashContainerRows.map((row) => row.itemInstanceId),
    ...siteStashItemRows.map((row) => row.itemInstanceId),
  ]);
  return {
    allInstances,
    carriedInstances: allInstances.filter((instance) => !notCarriedInstanceIds.has(instance.id)),
    cargoAssignments,
    siteStashContainerRows,
    siteStashItemRows,
  };
}

/**
 * Where, if anywhere, a unique item instance sits in a site stash (#284).
 *
 * `installed` means it is the container serving a mount; `stored` means it is
 * stashed contents. Either way it is owned but unavailable to every carried
 * path. The hand-written lookups that cannot go through
 * `loadOwnedItemInstances` (Cargo deposit, trade offers, the operator tools)
 * ask this instead of re-deriving the two relations.
 */
export async function siteStashPlacementOf(
  transaction: DatabaseTransaction,
  characterId: string,
  itemInstanceId: string,
): Promise<{ kind: "installed" | "stored"; locationId: string } | undefined> {
  const [[installed], [stored]] = await Promise.all([
    transaction
      .select({ locationId: siteStashContainers.locationId })
      .from(siteStashContainers)
      .where(
        and(
          eq(siteStashContainers.characterId, characterId),
          eq(siteStashContainers.itemInstanceId, itemInstanceId),
        ),
      )
      .limit(1),
    transaction
      .select({ locationId: siteStashItemInstances.locationId })
      .from(siteStashItemInstances)
      .where(
        and(
          eq(siteStashItemInstances.characterId, characterId),
          eq(siteStashItemInstances.itemInstanceId, itemInstanceId),
        ),
      )
      .limit(1),
  ]);
  if (installed) return { kind: "installed", locationId: installed.locationId };
  if (stored) return { kind: "stored", locationId: stored.locationId };
  return undefined;
}

/**
 * The character's carried stacks and remaining carried room, read under lock.
 *
 * Shared by every storage host that moves items back into carried Inventory
 * (the ship Cargo Hold and site stashes, #284): slots come from the equipped
 * containers, mass from the flat carry cap, and `carriedInstances` already
 * excludes anything held in Cargo or a stash.
 */
export async function loadCarriedCapacity(transaction: DatabaseTransaction, characterId: string) {
  const balance = getEffectiveGameBalance();
  const [stacks, itemState, assignments] = await Promise.all([
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
      .for("update"),
    loadOwnedItemInstances(transaction, characterId),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const loadout = deriveEquipmentLoadout({
    assignments: assignments as EquipmentAssignmentState[],
    instances: itemState.carriedInstances as EquipmentItemInstance[],
    stacks,
    balance,
  });
  return {
    stacks,
    carriedInstances: itemState.carriedInstances,
    loadout,
    availableSlots: Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
    availableMassGrams: Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
  };
}
