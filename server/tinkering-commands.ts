import { eq } from "drizzle-orm";
import { activeActions, characterTinkeringState, characters } from "@/db/rune-space";
import { getEffectiveGameBalance, tinkeringTargetForActionId } from "@/game/config/balance";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import { checkBoundedRunSelection, type BoundedRunSelection } from "@/game/domain/bounded-run";
import type { MiningRandom } from "@/game/domain/mining";
import {
  tinkeringAffordableBatches,
  tinkeringScrapYield,
  tinkeringStartCheck,
  type TinkeringBlockReason,
} from "@/game/domain/tinkering";
import { addStackExact, workingInventory } from "@/game/domain/working-inventory";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { defaultMiningRandom } from "@/server/mining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  commitTinkeringCycle,
  ensureTinkeringState,
  interruptTinkering,
  isTinkeringAction,
  loadTinkeringRow,
  loadTinkeringSnapshot,
  loadTinkeringUnlocked,
  resetTinkeringRun,
  tinkeringCycleFromRow,
} from "@/server/tinkering";

/**
 * Tinkering's player commands (#232). Every rule is revalidated in the
 * character lock after due work resolves: Rusk Recovery, Tansy's demonstration
 * having unlocked it, the level, a complete eligible batch, the last-Cutter
 * guard, room for the Scrap unless it is being discarded, and the selection.
 */

export type TinkeringCommandError =
  | "tinkering_unavailable_here"
  | "tinkering_locked"
  | "tinkering_unknown_target"
  | "tinkering_recipe_locked"
  | "tinkering_no_items"
  /** The batch would leave the character with no usable Mining Cutter. */
  | "tinkering_last_cutter"
  | "tinkering_no_room"
  /** The selected number exceeds what the eligible items now form (#229); choose again. */
  | "tinkering_quantity_unavailable"
  /** A committed cycle of another item is waiting; it has to be finished first. */
  | "tinkering_resume_pending"
  /** Finish Current with nothing committed on the station. */
  | "tinkering_nothing_to_finish";

function stateWith(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  error?: TinkeringCommandError | "another_action_active",
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    error === "another_action_active" ? "another_action_active" : undefined,
    undefined,
    undefined,
    now,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    error && error !== "another_action_active" ? { tinkeringError: error } : undefined,
  );
}

const BLOCK_ERRORS: Record<TinkeringBlockReason, TinkeringCommandError> = {
  no_eligible_items: "tinkering_no_items",
  last_cutter: "tinkering_last_cutter",
  no_room_for_scrap: "tinkering_no_room",
  recipe_locked: "tinkering_recipe_locked",
};

async function standingAtRusk(transaction: DatabaseTransaction, characterId: string) {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId === RUSK_RECOVERY_CONTENT.locationId;
}

function runTinkeringCommand(
  userId: string,
  characterId: string,
  now: Date,
  random: MiningRandom,
  command: (
    transaction: DatabaseTransaction,
    context: { characterId: string; actionId: string | undefined },
  ) => Promise<PlayGameplayState>,
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return command(transaction, {
        characterId: context.character.id,
        actionId: context.action?.actionId,
      });
    },
    now,
  );
}

async function insertTinkeringAction(
  transaction: DatabaseTransaction,
  characterId: string,
  actionId: string,
  now: Date,
) {
  await transaction.insert(activeActions).values({
    characterId,
    actionId,
    startedAt: now,
    resolvedThroughAt: now,
  });
}

/**
 * Start — or Resume — Tinkering.
 *
 * With no committed cycle, this commits (destroys) the first complete batch of
 * the target now, after every ordinary check. With a committed cycle waiting,
 * it resumes that same cycle and commits nothing: that is the only thing Start
 * can mean until the cycle is done, so a Start for another item is refused.
 * The selection counts complete batches, a resumed cycle being the first; a
 * number is revalidated against what the eligible items form and refused —
 * never shortened — when it no longer fits.
 */
export async function startTinkering(
  userId: string,
  characterId: string,
  targetActionId: string,
  selection: BoundedRunSelection = 1,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runTinkeringCommand(userId, characterId, now, random, async (transaction, context) => {
    const id = context.characterId;
    const target = tinkeringTargetForActionId(targetActionId);
    if (!target) return stateWith(transaction, id, now, "tinkering_unknown_target");
    if (context.actionId === target.actionId) return stateWith(transaction, id, now);
    if (context.actionId) return stateWith(transaction, id, now, "another_action_active");
    if (!(await standingAtRusk(transaction, id))) {
      return stateWith(transaction, id, now, "tinkering_unavailable_here");
    }
    if (!(await loadTinkeringUnlocked(transaction, id))) {
      return stateWith(transaction, id, now, "tinkering_locked");
    }
    const snapshot = await loadTinkeringSnapshot(transaction, id);
    const cycle = snapshot.cycle;
    if (cycle && cycle.targetActionId !== target.actionId) {
      return stateWith(transaction, id, now, "tinkering_resume_pending");
    }
    if (!cycle) {
      const check = tinkeringStartCheck(snapshot, target);
      if (!check.ok) return stateWith(transaction, id, now, BLOCK_ERRORS[check.reason]);
    } else if (!snapshot.autoDiscardScrap) {
      // The waiting cycle's batch is already gone; what Resume still needs is
      // room for its Scrap, unless that Scrap is being discarded.
      const room = addStackExact(
        workingInventory(snapshot),
        getEffectiveGameBalance().tinkering.recoveredItemId,
        tinkeringScrapYield(target.recipe),
        getEffectiveGameBalance(),
      );
      if (!room.ok) return stateWith(transaction, id, now, "tinkering_no_room");
    }
    const quantityCheck = checkBoundedRunSelection(
      selection,
      tinkeringAffordableBatches(snapshot, target) + (cycle ? 1 : 0),
    );
    if (!quantityCheck.ok) {
      return stateWith(transaction, id, now, "tinkering_quantity_unavailable");
    }
    await ensureTinkeringState(transaction, id);
    await resetTinkeringRun(transaction, id, quantityCheck.selection, now);
    if (!cycle) {
      const blocked = await commitTinkeringCycle(transaction, { characterId: id, target, now });
      // The start check above asked the same question of the same state.
      if (blocked) throw new Error(`Tinkering could not commit a checked batch: ${blocked}`);
    }
    await insertTinkeringAction(transaction, id, target.actionId, now);
    return stateWith(transaction, id, now);
  });
}

/**
 * Stop Tinkering, keeping the committed cycle and every tick already worked on
 * it. Nothing is refunded and nothing is rerolled; Resume continues it.
 */
export async function stopTinkering(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runTinkeringCommand(userId, characterId, now, random, async (transaction, context) => {
    const id = context.characterId;
    if (!isTinkeringAction(context.actionId)) {
      return stateWith(
        transaction,
        id,
        now,
        context.actionId ? "another_action_active" : undefined,
      );
    }
    await interruptTinkering(transaction, id);
    return stateWith(transaction, id, now);
  });
}

/**
 * Finish the committed item, then stop: it completes with its normal XP and
 * Scrap, and no next batch is committed. A stopped cycle is resumed so that it
 * can finish.
 */
export async function finishCurrentTinkering(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runTinkeringCommand(userId, characterId, now, random, async (transaction, context) => {
    const id = context.characterId;
    const cycle = tinkeringCycleFromRow(await loadTinkeringRow(transaction, id));
    // Reconciliation may already have finished the item — which is what was asked.
    if (!cycle) {
      return stateWith(
        transaction,
        id,
        now,
        isTinkeringAction(context.actionId) ? undefined : "tinkering_nothing_to_finish",
      );
    }
    if (context.actionId && !isTinkeringAction(context.actionId)) {
      return stateWith(transaction, id, now, "another_action_active");
    }
    if (!(await standingAtRusk(transaction, id))) {
      return stateWith(transaction, id, now, "tinkering_unavailable_here");
    }
    await transaction
      .update(characterTinkeringState)
      .set({ finishCurrent: true, updatedAt: now })
      .where(eq(characterTinkeringState.characterId, id));
    if (!context.actionId) await insertTinkeringAction(transaction, id, cycle.targetActionId, now);
    return stateWith(transaction, id, now);
  });
}

/**
 * The persistent Auto-discard Scrap preference, default off. Read at each
 * cycle, so flipping it mid-cycle applies to the cycle that is finishing.
 */
export async function setTinkeringScrapPreference(
  userId: string,
  characterId: string,
  autoDiscardScrap: boolean,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return runTinkeringCommand(userId, characterId, now, random, async (transaction, context) => {
    const id = context.characterId;
    if (!(await loadTinkeringUnlocked(transaction, id))) {
      return stateWith(transaction, id, now, "tinkering_locked");
    }
    await ensureTinkeringState(transaction, id);
    await transaction
      .update(characterTinkeringState)
      .set({ autoDiscardScrap, updatedAt: now })
      .where(eq(characterTinkeringState.characterId, id));
    return stateWith(transaction, id, now);
  });
}
