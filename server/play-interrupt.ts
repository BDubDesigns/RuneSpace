import { eq } from "drizzle-orm";
import {
  activeActions,
  characterMiningState,
  characterRefiningState,
  characterTravelState,
  type ActiveAction,
  type Character,
} from "@/db/rune-space";
import { ACTION_IDS } from "@/game/config/foundations";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The smallest Play-owned "safely interrupt whatever remains" primitive
 * (Issue #113). It is deliberately NOT a plugin/event/scheduler framework and
 * NOT a second reconciliation: the caller reconciles due work exactly once
 * (through the shared action-resolution boundary), receives the authoritative
 * POST-reconciliation action, and passes it here to clean any remaining active
 * state so the character is guaranteed idle.
 *
 * Exact per-activity persistence (matching the current stop commands):
 * - Mining:   delete remaining active action + existing `manually_stopped`
 *             state semantics (as `stopMining`).
 * - Refining: delete remaining active action + existing `manually_stopped`
 *             state semantics (as `stopRefining`).
 * - Welding:  delete the remaining active action only (as `stopCargoHoldWelding`).
 *             No Welding stop reason/state field is invented.
 * - Travel:   delete the remaining active action + `characterTravelState` only;
 *             committed `characterScavengeReveals` are preserved untouched, and
 *             the character's authoritative origin row is not relocated here.
 * - idle / unknown: unknown action rows are deleted so the character is
 *             guaranteed idle; no auxiliary activity rows are invented.
 *
 * Operator identity belongs in the audit log, never in a new in-world gameplay
 * stop reason (`operator_interrupted` is deliberately not introduced).
 */

export type ForceIdleResult = {
  /** True only when a real active action was interrupted. */
  interrupted: boolean;
  /** The action id that was interrupted, when one was cleared. */
  interruptedActionId?: string;
};

export async function forceIdleResolvedAction(
  transaction: DatabaseTransaction,
  input: {
    character: Character;
    /** The authoritative post-reconciliation active action, or undefined when idle. */
    action?: ActiveAction;
    now: Date;
  },
): Promise<ForceIdleResult> {
  const { character, action, now } = input;
  if (!action) {
    return { interrupted: false };
  }

  const actionId = action.actionId;

  if (actionId === ACTION_IDS.ferriteShaleMining || actionId === ACTION_IDS.refining) {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
    const stateTable =
      actionId === ACTION_IDS.ferriteShaleMining ? characterMiningState : characterRefiningState;
    await transaction
      .insert(stateTable)
      .values({ characterId: character.id, lastStopReason: "manually_stopped" })
      .onConflictDoUpdate({
        target: stateTable.characterId,
        set: { lastStopReason: "manually_stopped", updatedAt: now },
      });
    return { interrupted: true, interruptedActionId: actionId };
  }

  if (actionId === ACTION_IDS.cargoHoldWelding) {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
    return { interrupted: true, interruptedActionId: actionId };
  }

  if (actionId === ACTION_IDS.travel) {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
    await transaction
      .delete(characterTravelState)
      .where(eq(characterTravelState.characterId, character.id));
    // Committed character_scavenge_reveals is intentionally preserved.
    return { interrupted: true, interruptedActionId: actionId };
  }

  // Unknown/stale action id: guarantee the character is idle by clearing the
  // active action row without inventing activity-specific state.
  await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
  return { interrupted: true, interruptedActionId: actionId };
}
