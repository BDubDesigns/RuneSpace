import { eq } from "drizzle-orm";
import {
  activeActions,
  characterMiningState,
  characterRefiningState,
  characterTravelState,
  type ActiveAction,
  type Character,
} from "@/db/rune-space";
import { repairTargetForActionId, weldingActionIds } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { interruptPracticeWelding } from "@/server/practice-welding";
import { missOpenWorkOrderCleanPass } from "@/server/work-orders";
import { missOpenRepairCleanPass } from "@/server/welding";

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
 * - Welding:  close an open Clean Pass window, then delete the remaining active
 *             action (as `stopCargoHoldWelding`). No Welding stop reason/state
 *             field is invented.
 * - Practice: the shared Practice interruption — close an open Clean Pass
 *             window and delete the action, preserving the partial weld and the
 *             Scrap already spent on it.
 * - Travel:   delete the remaining active action + `characterTravelState` only;
 *             committed `characterScavengeReveals` are preserved untouched, and
 *             the character's authoritative origin row is not relocated here.
 * - idle: returns `interrupted: false` (nothing to clean).
 * - unsupported/unknown action: THROWS and fails closed so a future activity's
 *   auxiliary persistence cannot be orphaned by deleting only the active row.
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

  // Welding on any repair target: resolved increments are already committed and
  // a partial pass never became progress, so the only durable extra is closing
  // an open Clean Pass window (#190) before the action row goes.
  if (weldingActionIds().includes(actionId)) {
    const targetId = repairTargetForActionId(actionId);
    if (targetId) {
      await missOpenRepairCleanPass(transaction, { characterId: character.id, targetId, now });
    }
    await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
    return { interrupted: true, interruptedActionId: actionId };
  }

  // Practice Welding: the one shared interruption, so an operator force-idle,
  // the player's own Stop, and Travel cannot drift apart (#190).
  if (actionId === ACTION_IDS.practiceWelding) {
    await interruptPracticeWelding(transaction, character.id, now);
    return { interrupted: true, interruptedActionId: actionId };
  }

  // A customer Work Order: the accepted job, its paid materials, and its
  // resolved sections all stay exactly where they are. Only an open Clean Pass
  // window is spent, through the same helper Stop and Travel use (#207).
  if (actionId === ACTION_IDS.workOrderWelding) {
    await missOpenWorkOrderCleanPass(transaction, { characterId: character.id, now });
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

  // Unsupported/unknown action id: FAIL CLOSED. #113 only knows how to clean
  // Mining / Refining / Welding / Travel safely. A future activity could add
  // activity-specific auxiliary persistence that this switch does not know how
  // to remove; deleting the active_actions row blindly could orphan that state,
  // so we refuse to interrupt rather than leave the character inconsistent.
  throw new Error(`Cannot interrupt unsupported activity action "${actionId}".`);
}
