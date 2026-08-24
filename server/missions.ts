import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/action-resolution";
import {
  characterMissions,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getNpc } from "@/game/content/npcs";
import { WALK_IT_OFF } from "@/game/content/missions";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { planUniqueItemAddition } from "@/game/domain/inventory";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  createPlayResolver,
  defaultMiningRandom,
  ensureStarterMiningState,
  stateFromTransaction,
  type MiningGameplayState,
} from "@/server/mining";
import { loadOwnedItemInstances } from "@/server/carried-inventory";

export type MissionAcceptance =
  | { status: "accepted" | "already_accepted" | "already_completed" }
  | { status: "refused"; message: string };

export type MissionCompletion =
  | {
      status: "completed" | "already_completed";
      reward?: { itemId: typeof ITEM_IDS.salvageCutter; quantity: 1; itemInstanceId?: string };
    }
  | {
      status: "refused";
      reason: "not_accepted" | "not_stationary" | "capacity";
      capacityReason?: "slots" | "mass";
      message: string;
    };

export type MissionAcceptanceResult = {
  state: MiningGameplayState;
  mission: MissionAcceptance;
};

export type MissionCompletionResult = {
  state: MiningGameplayState;
  mission: MissionCompletion;
};

const NO_RECENT_MINING_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

function currentMissionRow(
  rows: readonly (typeof characterMissions.$inferSelect)[],
): typeof characterMissions.$inferSelect | undefined {
  return rows.find((row) => row.missionId === WALK_IT_OFF.id);
}

async function currentLocation(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const row = (
    await transaction
      .select({ currentLocationId: characters.currentLocationId })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1)
  )[0];
  return row?.currentLocationId ?? LOCATION_IDS.crashSite;
}

function rewardRefusal(reason: "slots" | "mass"): string {
  return reason === "slots"
    ? "The Salvage Cutter needs one free carried Inventory slot. Free capacity and try again."
    : "The Salvage Cutter is too heavy for your current carried-mass capacity. Free capacity and try again.";
}

function recentFrom(value: { successes: number; failures: number; awardedXp: number } | undefined) {
  return value ?? NO_RECENT_MINING_RESULT;
}

/**
 * Authenticated mission acceptance. The server action supplies the user ID;
 * this command then uses the same character lock/reconciliation boundary as
 * every other state-changing play command.
 */
export async function acceptWalkItOff(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionAcceptanceResult> {
  let miningOutcome: { successes: number; failures: number; awardedXp: number } | undefined;
  let refiningOutcome: { successes: number; failures: number; awardedXp: number } | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (outcome) => {
        miningOutcome = outcome;
      },
      undefined,
      (outcome) => {
        refiningOutcome = outcome;
      },
    ),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const rows = await transaction
        .select()
        .from(characterMissions)
        .where(
          and(
            eq(characterMissions.characterId, context.character.id),
            eq(characterMissions.missionId, WALK_IT_OFF.id),
          ),
        )
        .for("update");
      const existing = currentMissionRow(rows);
      const stateFor = async (mission: MissionAcceptance): Promise<MissionAcceptanceResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          undefined,
          undefined,
          undefined,
          undefined,
          now,
          recentFrom(refiningOutcome),
        ),
        mission,
      });

      if (existing?.completedAt) return stateFor({ status: "already_completed" });
      if (existing?.acceptedAt) return stateFor({ status: "already_accepted" });

      const locationId = await currentLocation(transaction, context.character.id);
      const wade = getNpc(WALK_IT_OFF.offeringNpcId);
      const tansy = getNpc(WALK_IT_OFF.completionNpcId);
      const canAcceptAtLocation =
        locationId === wade?.homeLocationId || locationId === tansy?.homeLocationId;
      if (!canAcceptAtLocation || context.action) {
        return stateFor({
          status: "refused",
          message:
            "Walk It Off can only be accepted while you are stationary at the Crash Site or The Jag.",
        });
      }

      await transaction
        .insert(characterMissions)
        .values({
          characterId: context.character.id,
          missionId: WALK_IT_OFF.id,
          acceptedAt: now,
        })
        .onConflictDoNothing();
      return stateFor({ status: "accepted" });
    },
    now,
  );
}

/**
 * Atomically claim the first Cutter reward. The character lock serializes
 * retries/concurrent clicks; the mission row and capacity snapshot are read
 * inside that transaction, and the new unique instance plus completion stamp
 * commit together or not at all.
 */
export async function completeWalkItOff(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionCompletionResult> {
  let miningOutcome: { successes: number; failures: number; awardedXp: number } | undefined;
  let refiningOutcome: { successes: number; failures: number; awardedXp: number } | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (outcome) => {
        miningOutcome = outcome;
      },
      undefined,
      (outcome) => {
        refiningOutcome = outcome;
      },
    ),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const rows = await transaction
        .select()
        .from(characterMissions)
        .where(
          and(
            eq(characterMissions.characterId, context.character.id),
            eq(characterMissions.missionId, WALK_IT_OFF.id),
          ),
        )
        .for("update");
      const existing = currentMissionRow(rows);
      const stateFor = async (mission: MissionCompletion): Promise<MissionCompletionResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          undefined,
          undefined,
          undefined,
          undefined,
          now,
          recentFrom(refiningOutcome),
        ),
        mission,
      });

      if (!existing) {
        return stateFor({
          status: "refused",
          reason: "not_accepted",
          message: "Accept Walk It Off with Wade before claiming this reward.",
        });
      }
      if (existing.completedAt) return stateFor({ status: "already_completed" });

      const locationId = await currentLocation(transaction, context.character.id);
      const tansy = getNpc(WALK_IT_OFF.completionNpcId);
      if (locationId !== tansy?.homeLocationId || context.action) {
        return stateFor({
          status: "refused",
          reason: "not_stationary",
          message: "Tansy can complete Walk It Off only while you are stationary at The Jag.",
        });
      }

      const balance = getEffectiveGameBalance();
      const itemDefinition = getItemDefinition(WALK_IT_OFF.rewardItemId, balance);
      if (!itemDefinition || itemDefinition.kind !== "unique") {
        throw new Error("Walk It Off reward is not a unique item definition");
      }
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
      const loadout = deriveEquipmentLoadout({
        assignments,
        instances: itemState.carriedInstances,
        stacks,
        balance,
      });
      const capacity = planUniqueItemAddition({
        inventorySlotsUsed: loadout.inventorySlotsUsed,
        slotCapacity: loadout.containerSlotCapacity,
        carriedMassGrams: loadout.carriedMassGrams,
        maximumCarryCapacityGrams: loadout.maximumCarryCapacityGrams,
        itemMassGrams: itemDefinition.massGrams,
      });
      if (!capacity.ok) {
        return stateFor({
          status: "refused",
          reason: "capacity",
          capacityReason: capacity.reason,
          message: rewardRefusal(capacity.reason),
        });
      }

      const created = await transaction
        .insert(itemInstances)
        .values({
          characterId: context.character.id,
          itemId: ITEM_IDS.salvageCutter,
          currentCharge: 0,
        })
        .returning({ id: itemInstances.id });
      const cutter = created[0];
      if (!cutter) throw new Error("Walk It Off Cutter reward was not created");

      await transaction
        .update(characterMissions)
        .set({ completedAt: now })
        .where(
          and(
            eq(characterMissions.characterId, context.character.id),
            eq(characterMissions.missionId, WALK_IT_OFF.id),
            isNull(characterMissions.completedAt),
          ),
        );
      return stateFor({
        status: "completed",
        reward: { itemId: ITEM_IDS.salvageCutter, quantity: 1, itemInstanceId: cutter.id },
      });
    },
    now,
  );
}
