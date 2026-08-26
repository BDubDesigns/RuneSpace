import { removeFromSelectedStack } from "@/server/carried-inventory";
import {
  createPlayResolver,
  defaultMiningRandom,
  ensureStarterMiningState,
  stateFromTransaction,
  type MiningGameplayState,
} from "@/server/mining";
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
  state: MiningGameplayState;
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
  recentResult: MiningGameplayState["recentResult"],
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
  random: MiningRandom = defaultMiningRandom(),
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
      await ensureStarterMiningState(transaction, context.character.id);
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
