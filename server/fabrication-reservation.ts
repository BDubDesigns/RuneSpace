import { eq } from "drizzle-orm";
import { activeActions } from "@/db/rune-space";
import { fabricationRecipeForActionId } from "@/game/config/balance";
import { fabricationStartCheck } from "@/game/domain/fabrication";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadFabricationCapacity } from "@/server/fabrication";

/**
 * The Fabrication workpiece reservation (#232).
 *
 * A started workpiece reserves its complete input set: the units stay in the
 * real Inventory, still counted for mass and slots, but nothing may make them
 * unavailable, and nothing may take away the room its output was guaranteed.
 * Almost every command that changes carried items already refuses while any
 * action is running. The few that deliberately do not — dropping a stack,
 * changing equipment, loading a Power Cell, and the operator's carried-item
 * tools — each end by asking this one question in their own transaction:
 * could the workpiece on the machine still resolve exactly as committed?
 *
 * A "no" throws, which rolls the whole command back. A player may still drop
 * Refined Ferrite the workpiece does not need, or swap equipment that leaves
 * its output room; they can never strand the workpiece. Asking about the
 * resulting state, rather than listing forbidden commands, is what keeps that
 * true for any future command that remembers to ask.
 */
export class FabricationReservationError extends Error {
  constructor(
    message = "That would take something the workpiece on the Fabrication Station has reserved. Let the workpiece finish first.",
  ) {
    super(message);
    this.name = "FabricationReservationError";
  }
}

export async function assertActiveWorkpieceResolvable(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  const [action] = await transaction
    .select({ actionId: activeActions.actionId })
    .from(activeActions)
    .where(eq(activeActions.characterId, characterId));
  if (!action) return;
  const recipe = fabricationRecipeForActionId(action.actionId);
  if (!recipe) return;
  const check = fabricationStartCheck(
    await loadFabricationCapacity(transaction, characterId),
    recipe,
  );
  if (!check.ok) throw new FabricationReservationError();
}
