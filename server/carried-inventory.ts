import { eq } from "drizzle-orm";
import { cargoHoldItemInstances, itemInstances } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

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
