import { and, asc, eq } from "drizzle-orm";
import { cargoHoldItemInstances, inventoryStacks, itemInstances } from "@/db/rune-space";
import type { ItemId } from "@/game/config/foundations";
import {
  planExactStackRemoval,
  type ExactStackRemovalPlan,
  type StackAdditionPlan,
} from "@/game/domain/inventory";
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
 * The Cargo relation is the authoritative location assignment: an instance
 * with a Cargo row is owned, but it is not currently carried.
 */
export async function loadOwnedItemInstances(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<{
  allInstances: (typeof itemInstances.$inferSelect)[];
  carriedInstances: (typeof itemInstances.$inferSelect)[];
  cargoAssignments: (typeof cargoHoldItemInstances.$inferSelect)[];
}> {
  const [allInstances, cargoAssignments] = await Promise.all([
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
  ]);
  const cargoInstanceIds = new Set(cargoAssignments.map((assignment) => assignment.itemInstanceId));
  return {
    allInstances,
    carriedInstances: allInstances.filter((instance) => !cargoInstanceIds.has(instance.id)),
    cargoAssignments,
  };
}
