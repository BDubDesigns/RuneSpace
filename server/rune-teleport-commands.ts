import { and, eq, isNull } from "drizzle-orm";
import { characterRuneTeleports, characters, inventoryStacks } from "@/db/rune-space";
import { planExactStackRemoval } from "@/game/domain/inventory";
import {
  planRuneTeleport,
  RUNE_TELEPORT_REFUSALS,
  type RuneTeleportRefusalReason,
} from "@/game/domain/rune-teleport";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { applyStackRemovalPlan } from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * The Skatboll TP Rune's Use (#438).
 *
 * The browser names intent only: the intent id it minted for this confirmation,
 * the carried stack it selected and the quantity it confirmed against. Every rule
 * is revalidated inside the character lock after due work has reconciled, and a
 * refusal writes nothing. One transaction consumes exactly one rune from the named
 * stack, moves only the character, and inserts the intent's receipt, so a
 * duplicate click, a retried request, a second tab or a lost response can find
 * that receipt and change nothing: no second rune is spent and no second arrival
 * is issued. The ship, its fuel, the Cargo Hold and installed infrastructure are
 * keyed elsewhere and never touched.
 */

export type TeleportWithRuneRequest = {
  intentId: string;
  stackId: string;
  /** Optimistic concurrency precondition: the quantity the player confirmed. */
  expectedQuantity: number;
};

export type TeleportRuneStatus =
  | {
      status: "teleported";
      intentId: string;
      /** True when this intent had already been settled by an earlier request. */
      alreadySettled: boolean;
    }
  | { status: "refused"; reason: RuneTeleportRefusalReason; message: string };

export type TeleportRuneResult = { state: PlayGameplayState; teleport: TeleportRuneStatus };

export async function teleportWithRune(
  userId: string,
  characterId: string,
  request: TeleportWithRuneRequest,
  now = new Date(),
): Promise<TeleportRuneResult> {
  let resolvedAttempts = { successes: 0, failures: 0, awardedXp: 0 };
  let miningStopReason: import("@/game/domain/mining").MiningStopReason | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(undefined, (outcome) => {
      resolvedAttempts = {
        successes: outcome.successes,
        failures: outcome.failures,
        awardedXp: outcome.awardedXp,
      };
      miningStopReason = outcome.stopReason;
    }),
    async (transaction, { character, action }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const stateNow = () =>
        stateFromTransaction(
          transaction,
          character.id,
          resolvedAttempts,
          miningStopReason,
          undefined,
          undefined,
          undefined,
          now,
        );
      const refused = async (reason: RuneTeleportRefusalReason): Promise<TeleportRuneResult> => ({
        state: await stateNow(),
        teleport: { status: "refused", reason, message: RUNE_TELEPORT_REFUSALS[reason] },
      });

      // Settlement first: an intent this character already confirmed is done, however
      // the stack or the location looks now. Nothing is spent or moved again.
      const [settled] = await transaction
        .select({ intentId: characterRuneTeleports.intentId })
        .from(characterRuneTeleports)
        .where(
          and(
            eq(characterRuneTeleports.characterId, character.id),
            eq(characterRuneTeleports.intentId, request.intentId),
          ),
        )
        .limit(1);
      if (settled) {
        return {
          state: await stateNow(),
          teleport: { status: "teleported", intentId: request.intentId, alreadySettled: true },
        };
      }

      // Re-read the position after reconciliation: a due arrival has landed.
      const [position] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, character.id))
        .limit(1);
      const currentLocationId = position?.currentLocationId ?? character.currentLocationId;
      // Only a carried stack of this character's own can be named; Cargo Hold and
      // stash items live in other tables and never match.
      const [stack] = await transaction
        .select()
        .from(inventoryStacks)
        .where(
          and(
            eq(inventoryStacks.id, request.stackId),
            eq(inventoryStacks.characterId, character.id),
          ),
        )
        .for("update");
      const plan = planRuneTeleport({
        stack,
        expectedQuantity: request.expectedQuantity,
        currentLocationId,
        hasActiveAction: action !== undefined,
      });
      if (!plan.ok) return refused(plan.reason);

      const removal = planExactStackRemoval([stack!], stack!.itemId as never, 1);
      if (!removal.ok) throw new Error("A locked teleport rune stack could not lose one rune");
      await applyStackRemovalPlan(transaction, { characterId: character.id, plan: removal, now });
      // Only the character moves, with the Inventory and Equipment bound to them.
      await transaction
        .update(characters)
        .set({ currentLocationId: plan.destinationLocationId })
        .where(eq(characters.id, character.id));
      await transaction.insert(characterRuneTeleports).values({
        characterId: character.id,
        intentId: request.intentId,
        itemId: plan.itemId,
        originLocationId: currentLocationId,
        destinationLocationId: plan.destinationLocationId,
        teleportedAt: now,
      });
      return {
        state: await stateNow(),
        teleport: { status: "teleported", intentId: request.intentId, alreadySettled: false },
      };
    },
    now,
  );
}

/**
 * Dismiss the arrival receipt. Presentation only and idempotent: it moves
 * nothing, consumes nothing and cannot replay a teleport.
 */
export function acknowledgeRuneTeleportArrival(
  userId: string,
  characterId: string,
  now = new Date(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, { character }) => {
      await ensurePlayProvisioning(transaction, character.id);
      await transaction
        .update(characterRuneTeleports)
        .set({ arrivalAcknowledgedAt: now })
        .where(
          and(
            eq(characterRuneTeleports.characterId, character.id),
            isNull(characterRuneTeleports.arrivalAcknowledgedAt),
          ),
        );
      return stateFromTransaction(
        transaction,
        character.id,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
    { allowDuringTrade: true, allowDuringFlight: true },
  );
}
