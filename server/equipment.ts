import { eq } from "drizzle-orm";
import {
  activeActions,
  characterMiningState,
  equippedItems,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { planEquipmentChange, type EquipmentChange } from "@/game/domain/equipment";
import { ACTION_IDS } from "@/game/config/foundations";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import type { MiningRandom } from "@/game/domain/mining";

/**
 * Applies a current approved loadout change under the same character lock and
 * lazy Mining-resolution transaction as every other state-changing command.
 */
export async function changeEquipment(
  userId: string,
  characterId: string,
  change: EquipmentChange,
  now = new Date(),
  random?: MiningRandom,
): Promise<PlayGameplayState> {
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
      const [itemState, assignments, stacks] = await Promise.all([
        loadOwnedItemInstances(transaction, context.character.id),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(inventoryStacks)
          .where(eq(inventoryStacks.characterId, context.character.id))
          .for("update"),
      ]);
      const balance = getEffectiveGameBalance();
      const miningToolSlotId = balance.items.salvageCutter.suitSlotId;
      const previousToolAssignment = assignments.find(
        (a) => a.assignmentKind === "gear" && a.suitSlotId === miningToolSlotId,
      );

      const nextLoadout = planEquipmentChange({
        assignments,
        instances: itemState.carriedInstances,
        stacks,
        balance,
        change,
      });

      // The whole assignment set is tiny and is replaced inside this transaction,
      // avoiding transient unique-slot conflicts while preserving atomicity.
      await transaction
        .delete(equippedItems)
        .where(eq(equippedItems.characterId, context.character.id));
      await transaction.insert(equippedItems).values(
        nextLoadout.assignments.map((assignment) => ({
          characterId: context.character.id,
          ...assignment,
        })),
      );

      const currentToolAssignment = nextLoadout.assignments.find(
        (a) => a.assignmentKind === "gear" && a.suitSlotId === miningToolSlotId,
      );
      const miningToolChanged =
        context.action?.actionId === ACTION_IDS.ferriteShaleMining &&
        previousToolAssignment?.itemInstanceId !== currentToolAssignment?.itemInstanceId;
      if (miningToolChanged) {
        const miningStopReasonLocal: import("@/game/domain/mining").MiningStopReason =
          currentToolAssignment ? "mining_tool_replaced" : "compatible_mining_tool_missing";
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        await transaction
          .insert(characterMiningState)
          .values({
            characterId: context.character.id,
            lastStopReason: miningStopReasonLocal,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: miningStopReasonLocal, updatedAt: now },
          });
        miningStopReason = miningStopReasonLocal;
      }
      return stateFromTransaction(
        transaction,
        context.character.id,
        resolvedAttempts,
        miningStopReason,
      );
    },
    now,
  );
}
