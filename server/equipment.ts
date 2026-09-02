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
 * Songle authoritative "the Mining tool loadout changed while a Mining action is
 * live" invalidation. The player `changeEquipment` path and the admin
 * FORCE UNEQUIP path share this EXACT rule so an active
 * `ferrite_shale_mining` action can never be committed with no compatible tool.
 *
 * It deletes the active action and writes the authoritative `characterMiningState`
 * stop reason (the same persisted value a player loadout swap produces). This is
 * deliberately NOT a parallel rule: callers detect a mining-tool change and call
 * this shared primitive. It is a no-op when the Mining tool did not change.
 */
export async function invalidateMiningActionForChangedTool(
  transaction: import("@/server/action-resolution").DatabaseTransaction,
  input: {
    characterId: string;
    /** The authoritative post-reconciliation active action, or undefined when idle. */
    action: { actionId: string } | undefined;
    previousToolItemInstanceId?: string;
    currentToolItemInstanceId?: string;
    now: Date;
  },
): Promise<void> {
  const miningToolChanged =
    input.action?.actionId === ACTION_IDS.ferriteShaleMining &&
    input.previousToolItemInstanceId !== input.currentToolItemInstanceId;
  if (!miningToolChanged) return;
  const reason: import("@/game/domain/mining").MiningStopReason = input.currentToolItemInstanceId
    ? "mining_tool_replaced"
    : "compatible_mining_tool_missing";
  await transaction.delete(activeActions).where(eq(activeActions.characterId, input.characterId));
  await transaction
    .insert(characterMiningState)
    .values({ characterId: input.characterId, lastStopReason: reason, updatedAt: input.now })
    .onConflictDoUpdate({
      target: characterMiningState.characterId,
      set: { lastStopReason: reason, updatedAt: input.now },
    });
}

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
      // Shared authoritative Mining-loadout invalidation (also used by the admin
      // FORCE UNEQUIP path).
      await invalidateMiningActionForChangedTool(transaction, {
        characterId: context.character.id,
        action: context.action,
        previousToolItemInstanceId: previousToolAssignment?.itemInstanceId,
        currentToolItemInstanceId: currentToolAssignment?.itemInstanceId,
        now,
      });
      if (
        context.action?.actionId === ACTION_IDS.ferriteShaleMining &&
        previousToolAssignment?.itemInstanceId !== currentToolAssignment?.itemInstanceId
      ) {
        miningStopReason = currentToolAssignment
          ? "mining_tool_replaced"
          : "compatible_mining_tool_missing";
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
