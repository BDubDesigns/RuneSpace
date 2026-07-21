import { eq } from "drizzle-orm";
import {
  activeActions,
  characterMiningState,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { planEquipmentChange, type EquipmentChange } from "@/game/domain/equipment";
import { ACTION_IDS } from "@/game/config/foundations";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  createMiningResolver,
  defaultMiningRandom,
  ensureStarterMiningState,
  stateFromTransaction,
  type MiningGameplayState,
} from "@/server/mining";
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
  random: MiningRandom = defaultMiningRandom(),
): Promise<MiningGameplayState> {
  let resolvedAttempts = { successes: 0, failures: 0, awardedXp: 0 };
  let resolvedStopReason: MiningGameplayState["stoppingReason"];
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createMiningResolver(random, (outcome) => {
      resolvedAttempts = {
        successes: outcome.successes,
        failures: outcome.failures,
        awardedXp: outcome.awardedXp,
      };
      resolvedStopReason = outcome.stopReason;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const [instances, assignments, stacks] = await Promise.all([
        transaction
          .select()
          .from(itemInstances)
          .where(eq(itemInstances.characterId, context.character.id))
          .for("update"),
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
      const nextLoadout = planEquipmentChange({
        assignments,
        instances,
        stacks,
        balance: getEffectiveGameBalance(),
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

      const miningToolRemoved =
        context.action?.actionId === ACTION_IDS.crashSiteMining &&
        !nextLoadout.hasCompatibleMiningTool;
      if (miningToolRemoved) {
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        await transaction
          .insert(characterMiningState)
          .values({
            characterId: context.character.id,
            lastStopReason: "compatible_mining_tool_missing",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: "compatible_mining_tool_missing", updatedAt: now },
          });
        resolvedStopReason = "compatible_mining_tool_missing";
      }
      return stateFromTransaction(
        transaction,
        context.character.id,
        resolvedAttempts,
        resolvedStopReason,
      );
    },
    now,
  );
}
