import { lapidaryRecipeForActionId } from "@/game/config/balance";
import { lapidaryActivity } from "@/server/lapidary";
import { craftingStartCheck } from "@/game/domain/deterministic-crafting";
import { eq } from "drizzle-orm";
import { activeActions } from "@/db/rune-space";
import { fabricationRecipeForActionId, runeworkingRecipeForActionId } from "@/game/config/balance";
import { fabricationStartCheck } from "@/game/domain/fabrication";
import { canBeginEchoReading } from "@/game/domain/echo-hunts";
import { runeworkingStartCheck } from "@/game/domain/runeworking";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadFabricationCapacity } from "@/server/fabrication";
import { isEchoReadingAction } from "@/server/echo-hunts";
import { loadPlaySnapshot } from "@/server/play-state";
import { loadRuneworkingCapacity } from "@/server/runeworking";

/**
 * The Fabrication workpiece reservation (#232), which a Runeworking cycle on
 * the Resonance Rig shares (#391).
 *
 * A started workpiece reserves its complete input set: the units stay in the
 * real Inventory, still counted for mass and slots, but nothing may make them
 * unavailable, and nothing may take away the room its output was guaranteed.
 * Almost every command that changes carried items already refuses while any
 * action is running. The few that deliberately do not — dropping a stack,
 * changing equipment, loading a Power Cell, and the operator's carried-item
 * tools — each end by asking this one question in their own transaction:
 * could the work on the machine still resolve exactly as committed?
 *
 * A "no" throws, which rolls the whole command back. A player may still drop
 * Refined Ferrite the workpiece does not need, or swap equipment that leaves
 * its output room; they can never strand the workpiece. Asking about the
 * resulting state, rather than listing forbidden commands, is what keeps that
 * true for any future command that remembers to ask — and is why a begun
 * Runeworking cycle, which must also complete rather than be cancelled, is
 * protected by the same question rather than a second guard.
 */
export class FabricationReservationError extends Error {
  constructor(
    message = "That would take something the workpiece on the Fabrication Station has reserved. Let the workpiece finish first.",
  ) {
    super(message);
    this.name = "FabricationReservationError";
  }
}

/** The same refusal for the cycle on the Resonance Rig (#391). */
export class RuneworkingReservationError extends FabricationReservationError {
  constructor() {
    super(
      "That would take something the attunement on the Resonance Rig has reserved. Let the current cycle finish first.",
    );
    this.name = "RuneworkingReservationError";
  }
}

/**
 * The same refusal for a Beginner Echo reading (#393): the Seeker a started
 * reading will consume stays in the Inventory until the reading resolves.
 */
export class EchoReadingReservationError extends FabricationReservationError {
  constructor() {
    super(
      "That would take the Beginner Echo Seeker your reading is using. Let the reading finish first.",
    );
    this.name = "EchoReadingReservationError";
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
  if (recipe) {
    const check = fabricationStartCheck(
      await loadFabricationCapacity(transaction, characterId),
      recipe,
    );
    if (!check.ok) throw new FabricationReservationError();
    return;
  }
  if (isEchoReadingAction(action.actionId)) {
    const { stacks } = await loadPlaySnapshot(transaction, characterId);
    if (!canBeginEchoReading(stacks)) throw new EchoReadingReservationError();
    return;
  }
  const lapidaryRecipe = lapidaryRecipeForActionId(action.actionId);
  if (lapidaryRecipe) {
    if (
      !craftingStartCheck(
        await lapidaryActivity.loadCapacity(transaction, characterId),
        lapidaryRecipe,
      ).ok
    )
      throw new FabricationReservationError(
        "That would take material or capacity reserved by the Lapidary lesson. Let the current piece finish first.",
      );
    return;
  }
  const runeworkingRecipe = runeworkingRecipeForActionId(action.actionId);
  if (runeworkingRecipe) {
    const check = runeworkingStartCheck(
      await loadRuneworkingCapacity(transaction, characterId),
      runeworkingRecipe,
    );
    if (!check.ok) throw new RuneworkingReservationError();
  }
}
