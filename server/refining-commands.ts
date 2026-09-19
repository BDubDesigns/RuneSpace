import { eq } from "drizzle-orm";
import {
  activeActions,
  characterRefiningState,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  refiningActionIds,
  refiningRecipeForActionId,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { ACTION_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { isActionAvailableAtLocation } from "@/game/content/locations";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { refiningPreflightStopReason, refiningRecipeUnlocked } from "@/game/domain/refining";
import { levelFromXp } from "@/game/domain/progression";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import { resetE2eRefiningRandom, type PersistedRefiningOutcome } from "@/server/refining";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import type { PersistedMiningOutcome } from "@/server/mining";
import type { MiningRandom } from "@/game/domain/mining";

function miningRecentFrom(
  outcome: PersistedMiningOutcome | undefined,
): PlayGameplayState["recentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}

function refiningRecentFrom(
  outcome: PersistedRefiningOutcome | undefined,
): PlayGameplayState["refiningRecentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}

/**
 * Start a Refining run at the Processing Yard. The shared owned-character lock
 * first resolves any due active action work (Mining and Refining alike) via
 * the full play resolver, then this command starts Refining in the same
 * transaction — preserving the pre-#127 lazy-resolution semantics exactly.
 */
/**
 * Begin a Refining run on one authored recipe (#209).
 *
 * The client names a recipe; everything that decides whether it may run is
 * resolved here from authored content and the character's own authoritative
 * state — that the recipe exists, that Refining is available where they are
 * standing, and that their Refining level meets the recipe's minimum. A forged
 * request for Galvaferrite at Refining 1 is refused server-side, not merely
 * greyed out in the console.
 */
export async function startRefining(
  userId: string,
  characterId: string,
  recipeActionId: string = ACTION_IDS.refining,
  now = new Date(),
  random?: MiningRandom,
): Promise<PlayGameplayState> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  let refiningOutcome: PersistedRefiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (value) => {
        miningOutcome = value;
      },
      undefined,
      (value) => {
        refiningOutcome = value;
      },
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const [reloaded] = await transaction
        .select()
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const currentLocationId = reloaded?.currentLocationId ?? LOCATION_IDS.crashSite;
      const recipe = refiningRecipeForActionId(recipeActionId);
      const refiningBlockedHere = !isActionAvailableAtLocation(
        currentLocationId,
        ACTION_IDS.refining,
      );
      // If already refining this same recipe, idempotent
      if (recipe && context.action?.actionId === recipe.actionId) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          miningRecentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          refiningOutcome?.stopReason,
        );
      }
      if (context.action) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          miningRecentFrom(miningOutcome),
          miningOutcome?.stopReason,
          "another_action_active",
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          refiningOutcome?.stopReason,
        );
      }
      if (refiningBlockedHere || !recipe) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          miningRecentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          refiningOutcome?.stopReason,
          "refining_unavailable_here",
        );
      }
      // Preflight: need at least 2 shale and room for either output
      const balance = getEffectiveGameBalance();
      // Build snapshot for preflight: same as refining resolver would
      const [xpRows, stacks, itemState, assignments] = await Promise.all([
        transaction
          .select()
          .from(characterSkillXp)
          .where(eq(characterSkillXp.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(inventoryStacks)
          .where(eq(inventoryStacks.characterId, context.character.id))
          .for("update"),
        loadOwnedItemInstances(transaction, context.character.id),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, context.character.id))
          .for("update"),
      ]);
      const refiningXp = xpRows.find((r) => r.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
      const loadout = deriveEquipmentLoadout({
        assignments,
        instances: itemState.carriedInstances,
        stacks,
        balance,
      });
      const snapshot = {
        refiningLevel: levelFromXp(refiningXp, standardSkillLevelThresholds(balance)),
        existingStacks: stacks,
        slotsAvailable: Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
        massAvailableGrams: Math.max(
          0,
          loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams,
        ),
      };
      // Server-authoritative level gate: the console greys a locked recipe out,
      // but this is what actually refuses it (#209).
      if (!refiningRecipeUnlocked(snapshot.refiningLevel, recipe)) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          miningRecentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          refiningOutcome?.stopReason,
          "refining_recipe_locked",
        );
      }
      const preflight = refiningPreflightStopReason(snapshot, balance, recipe);
      if (preflight && preflight !== "action_replaced" && preflight !== "manually_stopped") {
        return stateFromTransaction(
          transaction,
          context.character.id,
          miningRecentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          preflight,
        );
      }
      resetE2eRefiningRandom(context.character.id);
      // The recipe's own action ID is what makes the selection durable across
      // refresh and lazy/offline resolution (#209).
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: recipe.actionId,
        startedAt: now,
        resolvedThroughAt: now,
      });
      // Reset run counters for a genuinely new run
      const freshRun = {
        runAttempts: 0,
        runSuccesses: 0,
        runOutputsGained: {},
        runInputsConsumed: {},
        runXpGained: 0,
        recentAttempts: [],
        lastStopReason: null,
        updatedAt: now,
      };
      await transaction
        .insert(characterRefiningState)
        .values({ characterId: context.character.id, ...freshRun })
        .onConflictDoUpdate({
          target: characterRefiningState.characterId,
          set: freshRun,
        });
      return stateFromTransaction(
        transaction,
        context.character.id,
        miningRecentFrom(miningOutcome),
        miningOutcome?.stopReason,
        undefined,
        undefined,
        undefined,
        now,
        refiningRecentFrom(refiningOutcome),
        refiningOutcome?.stopReason,
      );
    },
    now,
  );
}

/** Stop the active Refining run, resolving any due Mining work first. */
export async function stopRefining(
  userId: string,
  characterId: string,
  now = new Date(),
  random?: MiningRandom,
): Promise<PlayGameplayState> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  let refiningOutcome: PersistedRefiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (value) => {
        miningOutcome = value;
      },
      undefined,
      (value) => {
        refiningOutcome = value;
      },
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const manuallyStopped = context.action?.actionId === ACTION_IDS.refining;
      if (manuallyStopped) {
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        await transaction
          .insert(characterRefiningState)
          .values({ characterId: context.character.id, lastStopReason: "manually_stopped" })
          .onConflictDoUpdate({
            target: characterRefiningState.characterId,
            set: { lastStopReason: "manually_stopped", updatedAt: now },
          });
      }
      return stateFromTransaction(
        transaction,
        context.character.id,
        miningRecentFrom(miningOutcome),
        miningOutcome?.stopReason,
        context.action &&
          context.action.actionId !== ACTION_IDS.refining &&
          context.action.actionId !== ACTION_IDS.ferriteShaleMining &&
          context.action.actionId !== ACTION_IDS.travel
          ? "another_action_active"
          : undefined,
        undefined,
        context.character,
        now,
        refiningRecentFrom(refiningOutcome),
        manuallyStopped ? "manually_stopped" : refiningOutcome?.stopReason,
      );
    },
    now,
  );
}
