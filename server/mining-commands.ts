import { and, eq } from "drizzle-orm";
import {
  activeActions,
  characters,
  characterMiningState,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { isActionAvailableAtLocation } from "@/game/content/locations";
import {
  miningPreflightStopReason,
  normalizeCutterCharge,
  type MiningRandom,
} from "@/game/domain/mining";
import { isCompatibleEquipmentAssignment } from "@/game/domain/equipment";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  consumeStackableItem,
  loadOwnedItemInstances,
  removeFromSelectedStack,
} from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  loadMiningSnapshot,
  defaultMiningRandom,
  type PersistedMiningOutcome,
} from "@/server/mining";

export type LoadPowerCellStatus =
  | { status: "loaded"; remainingCharge: number }
  | { status: "already_loaded"; remainingCharge: number; message: string }
  | { status: "no_cutter" | "no_cell" | "stale_selection"; message: string };

export type LoadPowerCellResult = {
  state: PlayGameplayState;
  load: LoadPowerCellStatus;
};

export type LoadPowerCellSelection = {
  stackId: string;
  expectedQuantity: number;
};

function recentFrom(
  outcome: PersistedMiningOutcome | undefined,
): PlayGameplayState["recentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}

/**
 * Begin a Mining run at the authoritative Ferrite location. The shared
 * owned-character lock first resolves any due active action work, then this
 * command starts Mining in the same transaction.
 */
export async function startFerriteShaleMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const unsupportedAction =
        context.action && context.action.actionId !== ACTION_IDS.ferriteShaleMining;
      // Reload the character after lazy resolution so location reflects any
      // travel arrival that just committed in this same transaction.
      const [reloaded] = await transaction
        .select()
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const currentLocationId = reloaded?.currentLocationId ?? LOCATION_IDS.crashSite;
      const traveling = context.action?.actionId === ACTION_IDS.travel;
      // Mining may only start at the authoritative Ferrite location (The Jag after issue #83).
      const miningBlockedHere = !isActionAvailableAtLocation(
        currentLocationId,
        ACTION_IDS.ferriteShaleMining,
      );
      const snapshot = await loadMiningSnapshot(transaction, context.character.id);
      const preflightStopReason =
        context.action || traveling || miningBlockedHere
          ? undefined
          : miningPreflightStopReason(snapshot, getEffectiveGameBalance());
      if (!context.action && !preflightStopReason && !miningBlockedHere) {
        await transaction.insert(activeActions).values({
          characterId: context.character.id,
          actionId: ACTION_IDS.ferriteShaleMining,
          startedAt: now,
          resolvedThroughAt: now,
        });
        await transaction
          .insert(characterMiningState)
          .values({
            characterId: context.character.id,
            runAttempts: 0,
            runSuccesses: 0,
            runShaleGained: 0,
            runXpGained: 0,
            recentAttempts: [],
            lastStopReason: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: {
              runAttempts: 0,
              runSuccesses: 0,
              runShaleGained: 0,
              runXpGained: 0,
              recentAttempts: [],
              lastStopReason: null,
              updatedAt: now,
            },
          });
      }
      if (!unsupportedAction && !preflightStopReason)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: null })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: null, updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        preflightStopReason ?? outcome?.stopReason,
        unsupportedAction ? "another_action_active" : undefined,
        miningBlockedHere ? "mining_unavailable_here" : undefined,
        undefined,
        now,
      );
    },
    now,
  );
}

/** Stop the active Mining run. */
export async function stopMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const manuallyStopped = context.action?.actionId === ACTION_IDS.ferriteShaleMining;
      if (manuallyStopped)
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
      if (manuallyStopped)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: "manually_stopped" })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: "manually_stopped", updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        recentFrom(outcome),
        manuallyStopped ? "manually_stopped" : outcome?.stopReason,
        context.action && context.action.actionId !== ACTION_IDS.ferriteShaleMining
          ? "another_action_active"
          : undefined,
        undefined,
        context.character,
        now,
      );
    },
    now,
  );
}

/**
 * Load exactly one loose Power Cell into the equipped Cutter. The shared
 * character lock first resolves any due active action work, then this command
 * changes the Cutter and inventory in the same transaction. Loading is allowed
 * while idle, Mining, or another action is in progress; only due Mining work is
 * resolved by the supplied play resolver.
 */
export async function loadSalvageCutterPowerCell(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
  selectedStack?: LoadPowerCellSelection,
): Promise<LoadPowerCellResult> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const [itemState, assignments] = await Promise.all([
        loadOwnedItemInstances(transaction, context.character.id),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, context.character.id))
          .for("update"),
      ]);
      const cutterAssignment = assignments.find(
        (assignment) =>
          assignment.assignmentKind === "gear" &&
          assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
      );
      const cutter = cutterAssignment
        ? itemState.carriedInstances.find(
            (instance) =>
              instance.id === cutterAssignment.itemInstanceId &&
              instance.itemId === balance.items.salvageCutter.itemId &&
              isCompatibleEquipmentAssignment(instance.itemId, cutterAssignment, balance),
          )
        : undefined;

      const stateFor = async (load: LoadPowerCellStatus): Promise<LoadPowerCellResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(outcome),
          outcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
        ),
        load,
      });

      if (!cutter) {
        return stateFor({
          status: "no_cutter",
          message: "Equip a Salvage Cutter before loading a Power Cell.",
        });
      }

      const currentCharge = normalizeCutterCharge(cutter.currentCharge, balance);
      if (currentCharge > 0) {
        return stateFor({
          status: "already_loaded",
          remainingCharge: currentCharge,
          message: `Power Cell already loaded — ${currentCharge} boosted attempts remain.`,
        });
      }

      const consumption = selectedStack
        ? await removeFromSelectedStack(transaction, {
            characterId: context.character.id,
            stackId: selectedStack.stackId,
            expectedQuantity: selectedStack.expectedQuantity,
            expectedItemId: balance.items.powerCell.itemId,
            quantity: 1,
            now,
          })
        : await consumeStackableItem(transaction, {
            characterId: context.character.id,
            itemId: balance.items.powerCell.itemId,
            quantity: 1,
            now,
          });
      if (!consumption.ok) {
        return stateFor(
          selectedStack
            ? {
                status: "stale_selection",
                message: "Inventory changed. Review the selected Power Cell and try again.",
              }
            : { status: "no_cell", message: "No loose Power Cells are carried." },
        );
      }
      await transaction
        .update(itemInstances)
        .set({ currentCharge: balance.items.salvageCutter.maximumCharge, updatedAt: now })
        .where(
          and(eq(itemInstances.id, cutter.id), eq(itemInstances.characterId, context.character.id)),
        );

      return stateFor({
        status: "loaded",
        remainingCharge: balance.items.salvageCutter.maximumCharge,
      });
    },
    now,
  );
}
