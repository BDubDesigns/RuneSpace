import { and, eq } from "drizzle-orm";
import {
  characterResearchAssignments,
  characterSkillXp,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { levelFromXp } from "@/game/domain/progression";
import {
  planUniqueItemDisposal,
  UNIQUE_DISPOSAL_REFUSALS,
  type UniqueDisposalRefusalReason,
} from "@/game/domain/unique-item-disposal";
import { planBreakApart, type BreakApartRefusalReason } from "@/game/domain/rune-materials";
import {
  applyCarriedStackDiff,
  loadCarriedCapacity,
  loadOwnedItemInstances,
  removeFromSelectedStack,
} from "@/server/carried-inventory";
import { assertActiveWorkpieceResolvable } from "@/server/fabrication-reservation";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import type { MiningRandom } from "@/game/domain/mining";

export type DiscardInventoryStackRequest = {
  stackId: string;
  /** "one" removes exactly one item; "stack" removes the confirmed quantity. */
  mode: "one" | "stack";
  /** Optimistic concurrency precondition: the quantity the player confirmed. */
  expectedQuantity: number;
};

export type DiscardInventoryStackStatus =
  | { status: "discarded"; discardedQuantity: number }
  | { status: "refused"; message: string };

export type DiscardInventoryStackResult = {
  state: PlayGameplayState;
  discard: DiscardInventoryStackStatus;
};

/**
 * The narrow discard transaction body shared by the public command and
 * integration coverage that proves rollback of the deletion itself. It locks
 * the target stack filtered by both character and stack identity, verifies the
 * expected quantity against the authoritative row (after any due-work
 * reconciliation already committed in this same transaction), and refuses
 * safely without deleting when the stack changed or no longer exists. Mass and
 * slot counts are never persisted here; the refreshed authoritative state
 * derives them.
 */
export async function discardInventoryStackInTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  request: DiscardInventoryStackRequest,
  now: Date,
  recentResult: PlayGameplayState["recentResult"],
  miningStopReason?: import("@/game/domain/mining").MiningStopReason,
): Promise<DiscardInventoryStackResult> {
  const refusalMessage = "Inventory changed. Review the stack and try again.";
  const refuse = async (): Promise<DiscardInventoryStackResult> => ({
    state: await stateFromTransaction(
      transaction,
      characterId,
      recentResult,
      miningStopReason,
      undefined,
      undefined,
      undefined,
      now,
    ),
    discard: { status: "refused", message: refusalMessage },
  });

  const removal = await removeFromSelectedStack(transaction, {
    characterId,
    stackId: request.stackId,
    expectedQuantity: request.expectedQuantity,
    quantity: request.mode === "stack" ? request.expectedQuantity : 1,
    now,
  });
  if (!removal.ok) return refuse();
  // Units a Fabrication workpiece has reserved can never be dropped (#232).
  await assertActiveWorkpieceResolvable(transaction, characterId);

  return {
    state: await stateFromTransaction(
      transaction,
      characterId,
      recentResult,
      miningStopReason,
      undefined,
      undefined,
      undefined,
      now,
    ),
    discard: {
      status: "discarded",
      discardedQuantity: request.mode === "stack" ? request.expectedQuantity : 1,
    },
  };
}

/**
 * Authoritative discard-from-inventory-stack command. Under the shared
 * character lock and lazy action resolution, already-due Mining work is
 * resolved exactly once before the selected stack is re-read and revalidated,
 * so newly mined quantity the player never confirmed can never be removed.
 */
export async function discardInventoryStack(
  userId: string,
  characterId: string,
  request: DiscardInventoryStackRequest,
  now = new Date(),
  random?: MiningRandom,
): Promise<DiscardInventoryStackResult> {
  let resolvedAttempts = { successes: 0, failures: 0, awardedXp: 0 };
  let miningStopReason: import("@/game/domain/mining").MiningStopReason | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (outcome) => {
      resolvedAttempts = {
        successes: outcome.successes,
        failures: outcome.failures,
        awardedXp: outcome.awardedXp,
      };
      miningStopReason = outcome.stopReason;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return discardInventoryStackInTransaction(
        transaction,
        context.character.id,
        request,
        now,
        resolvedAttempts,
        miningStopReason,
      );
    },
    now,
  );
}

export type DiscardUniqueItemRequest = {
  /** The one server-owned item instance to destroy. */
  itemInstanceId: string;
  /** The item the player confirmed; a mismatch refuses as stale or forged. */
  expectedItemId: string;
};

export type DiscardUniqueItemStatus =
  | { status: "discarded"; itemId: string }
  | { status: "refused"; reason: UniqueDisposalRefusalReason; message: string };

export type DiscardUniqueItemResult = {
  state: PlayGameplayState;
  discard: DiscardUniqueItemStatus;
};

/**
 * The unique-item discard transaction body (#456). It reads the character's
 * COMPLETE ownership picture under lock (`loadOwnedItemInstances` returns every
 * instance regardless of location, with the Cargo and site-stash relations) and
 * lets `planUniqueItemDisposal` decide, so the last-usable-Cutter guard counts
 * equipped, carried, Cargo and every stash. Equipped gear is refused outright,
 * which is also what keeps the final equipped container in place: equipment
 * changes alone own the "at least one container" rule. A held research loan is
 * refused too, because only its Destroy & Abandon cancels the run it belongs to.
 * Nothing is deleted on a refusal; the single delete is scoped to character and
 * instance and must hit exactly one row.
 */
export async function discardUniqueItemInTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  request: DiscardUniqueItemRequest,
  now: Date,
  recentResult: PlayGameplayState["recentResult"],
  miningStopReason?: import("@/game/domain/mining").MiningStopReason,
): Promise<DiscardUniqueItemResult> {
  const stateNow = () =>
    stateFromTransaction(
      transaction,
      characterId,
      recentResult,
      miningStopReason,
      undefined,
      undefined,
      undefined,
      now,
    );
  const refuse = async (reason: UniqueDisposalRefusalReason): Promise<DiscardUniqueItemResult> => ({
    state: await stateNow(),
    discard: { status: "refused", reason, message: UNIQUE_DISPOSAL_REFUSALS[reason] },
  });

  const balance = getEffectiveGameBalance();
  const owned = await loadOwnedItemInstances(transaction, characterId);
  const [equipped, [miningXp], [assignment]] = await Promise.all([
    transaction
      .select({ itemInstanceId: equippedItems.itemInstanceId })
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
    transaction
      .select({ totalXp: characterSkillXp.totalXp })
      .from(characterSkillXp)
      .where(
        and(
          eq(characterSkillXp.characterId, characterId),
          eq(characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      )
      .for("update"),
    transaction
      .select({ itemInstanceId: characterResearchAssignments.itemInstanceId })
      .from(characterResearchAssignments)
      .where(eq(characterResearchAssignments.characterId, characterId))
      .for("update"),
  ]);

  const plan = planUniqueItemDisposal({
    itemInstanceId: request.itemInstanceId,
    expectedItemId: request.expectedItemId,
    instances: owned.allInstances,
    equippedInstanceIds: new Set(equipped.map((row) => row.itemInstanceId)),
    cargoInstanceIds: new Set(owned.cargoAssignments.map((row) => row.itemInstanceId)),
    installedContainerInstanceIds: new Set(
      owned.siteStashContainerRows.map((row) => row.itemInstanceId),
    ),
    storedInstanceIds: new Set(owned.siteStashItemRows.map((row) => row.itemInstanceId)),
    missionBoundInstanceId: assignment?.itemInstanceId ?? undefined,
    miningLevel: levelFromXp(miningXp?.totalXp ?? 0, standardSkillLevelThresholds(balance)),
    balance,
  });
  if (!plan.ok) return refuse(plan.reason);

  const deleted = await transaction
    .delete(itemInstances)
    .where(
      and(eq(itemInstances.id, request.itemInstanceId), eq(itemInstances.characterId, characterId)),
    )
    .returning({ id: itemInstances.id });
  if (deleted.length !== 1) throw new Error("Unique item discard did not remove exactly one row");
  // Freeing a slot or mass can never strand a workpiece, but ask the shared
  // question anyway so every carried-item command keeps the same contract.
  await assertActiveWorkpieceResolvable(transaction, characterId);

  return {
    state: await stateNow(),
    discard: { status: "discarded", itemId: plan.itemId },
  };
}

/**
 * Authoritative unique-item discard command. Like the stack discard it runs
 * under the shared character lock after due Mining is resolved exactly once, so
 * a duplicate or concurrent request finds the instance already gone and refuses.
 */
export async function discardUniqueItem(
  userId: string,
  characterId: string,
  request: DiscardUniqueItemRequest,
  now = new Date(),
  random?: MiningRandom,
): Promise<DiscardUniqueItemResult> {
  let resolvedAttempts = { successes: 0, failures: 0, awardedXp: 0 };
  let miningStopReason: import("@/game/domain/mining").MiningStopReason | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (outcome) => {
      resolvedAttempts = {
        successes: outcome.successes,
        failures: outcome.failures,
        awardedXp: outcome.awardedXp,
      };
      miningStopReason = outcome.stopReason;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return discardUniqueItemInTransaction(
        transaction,
        context.character.id,
        request,
        now,
        resolvedAttempts,
        miningStopReason,
      );
    },
    now,
  );
}

export type BreakApartRunestoneRequest = {
  stackId: string;
  /** Optimistic concurrency precondition: the quantity the player confirmed. */
  expectedQuantity: number;
};

export type BreakApartRunestoneStatus =
  | { status: "broken"; consumedQuantity: number; producedQuantity: number }
  | { status: "refused"; reason: BreakApartRefusalReason; message: string };

export type BreakApartRunestoneResult = {
  state: PlayGameplayState;
  breakApart: BreakApartRunestoneStatus;
};

const BREAK_APART_REFUSALS = {
  stack_not_found: "Inventory changed. Review the stack and try again.",
  stack_changed: "Inventory changed. Review the stack and try again.",
  not_breakable: "That item cannot be broken apart.",
  slots:
    "Not enough free Inventory slots to hold the Rune Fragments. Free a slot and try again; the Runestone is unchanged.",
  mass: "The Rune Fragments would be too heavy to carry. Make room and try again; the Runestone is unchanged.",
} as const satisfies Record<BreakApartRefusalReason, string>;

/**
 * The Break Apart transaction body (#367), shared by the public command and the
 * integration coverage that proves rollback. It reads the character's carried
 * stacks and room under lock, plans the whole conversion against the Inventory
 * that exists AFTER the selected stone is consumed (`planBreakApart`), and only
 * then writes: one stone leaves the selected stack and every Fragment lands, in
 * this one transaction. A refusal writes nothing, so neither item changes; a
 * failure while writing rolls the whole transaction back.
 */
export async function breakApartRunestoneInTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  request: BreakApartRunestoneRequest,
  now: Date,
  recentResult: PlayGameplayState["recentResult"],
  miningStopReason?: import("@/game/domain/mining").MiningStopReason,
): Promise<BreakApartRunestoneResult> {
  const stateNow = async () =>
    stateFromTransaction(
      transaction,
      characterId,
      recentResult,
      miningStopReason,
      undefined,
      undefined,
      undefined,
      now,
    );
  const carry = await loadCarriedCapacity(transaction, characterId);
  const plan = planBreakApart({
    stacks: carry.stacks,
    selected: { stackId: request.stackId, expectedQuantity: request.expectedQuantity },
    slotsAvailable: carry.availableSlots,
    massAvailableGrams: carry.availableMassGrams,
    balance: getEffectiveGameBalance(),
  });
  if (!plan.ok) {
    return {
      state: await stateNow(),
      breakApart: {
        status: "refused",
        reason: plan.reason,
        message: BREAK_APART_REFUSALS[plan.reason],
      },
    };
  }
  await applyCarriedStackDiff(transaction, { characterId, diff: plan.diff, now });
  // The Fragments take slots a running Fabrication workpiece may have needed.
  await assertActiveWorkpieceResolvable(transaction, characterId);
  return {
    state: await stateNow(),
    breakApart: {
      status: "broken",
      consumedQuantity: plan.consumedQuantity,
      producedQuantity: plan.producedQuantity,
    },
  };
}

/**
 * Authoritative Break Apart command. Under the shared character lock and lazy
 * action resolution, already-due Mining is resolved exactly once before the
 * selected stack is re-read, so a double-click, replay or concurrent request can
 * consume a stone only while the stack still holds it, and can never mint
 * Fragments from a stone that is already gone.
 */
export async function breakApartRunestone(
  userId: string,
  characterId: string,
  request: BreakApartRunestoneRequest,
  now = new Date(),
  random?: MiningRandom,
): Promise<BreakApartRunestoneResult> {
  let resolvedAttempts = { successes: 0, failures: 0, awardedXp: 0 };
  let miningStopReason: import("@/game/domain/mining").MiningStopReason | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (outcome) => {
      resolvedAttempts = {
        successes: outcome.successes,
        failures: outcome.failures,
        awardedXp: outcome.awardedXp,
      };
      miningStopReason = outcome.stopReason;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return breakApartRunestoneInTransaction(
        transaction,
        context.character.id,
        request,
        now,
        resolvedAttempts,
        miningStopReason,
      );
    },
    now,
  );
}
