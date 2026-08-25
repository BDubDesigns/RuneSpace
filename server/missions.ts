import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/action-resolution";
import {
  characterMissions,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  miningLevelThresholds,
} from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getNpc } from "@/game/content/npcs";
import { CUT_YOUR_TEETH, WALK_IT_OFF } from "@/game/content/missions";
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
import { grantCharacterSkillXp } from "@/server/progression";
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
      reason:
        | "not_accepted"
        | "not_stationary"
        | "capacity"
        | "prerequisite"
        | "equipment"
        | "insufficient_items";
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

function cutYourTeethRow(
  rows: readonly (typeof characterMissions.$inferSelect)[],
): typeof characterMissions.$inferSelect | undefined {
  return rows.find((row) => row.missionId === CUT_YOUR_TEETH.id);
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
 * Authenticated Walk It Off acceptance. The server action supplies the user
 * ID; this command then uses the same character lock/reconciliation boundary
 * as every other state-changing play command.
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
      const itemDefinition = getItemDefinition(
        WALK_IT_OFF.reward.kind === "item" ? WALK_IT_OFF.reward.itemId : ("" as never),
        balance,
      );
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

/**
 * Authenticated Cut Your Teeth acceptance (issue #110). Hard server-side
 * prerequisite: Walk It Off must already be completed for THIS character —
 * owning a Cutter or carrying shale never bypasses it. Tansy-only, stationary
 * at her home location. Character-scoped and idempotent like every mission
 * command.
 */
export async function acceptCutYourTeeth(
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
        .where(eq(characterMissions.characterId, context.character.id))
        .for("update");
      const existing = cutYourTeethRow(rows);
      const walkItOff = currentMissionRow(rows);
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
      // Hard prerequisite, rechecked inside the authoritative command.
      if (!walkItOff?.acceptedAt || !walkItOff.completedAt) {
        return stateFor({
          status: "refused",
          message: "Complete Walk It Off before Tansy can offer you more work.",
        });
      }

      const locationId = await currentLocation(transaction, context.character.id);
      const tansy = getNpc(CUT_YOUR_TEETH.completionNpcId);
      if (locationId !== tansy?.homeLocationId || context.action) {
        return stateFor({
          status: "refused",
          message: "Cut Your Teeth can only be accepted while you are stationary at The Jag.",
        });
      }

      await transaction
        .insert(characterMissions)
        .values({
          characterId: context.character.id,
          missionId: CUT_YOUR_TEETH.id,
          acceptedAt: now,
        })
        .onConflictDoNothing();
      return stateFor({ status: "accepted" });
    },
    now,
  );
}

/**
 * Atomically complete Cut Your Teeth (issue #110). All requirements are
 * rechecked inside the authoritative transaction; completion and the 100
 * Mining XP award commit together or not at all. The Ferrite Shale stack is
 * inspected, never consumed — showing is not giving. The character lock
 * serializes retries/concurrent submissions so XP cannot double-award.
 */
export async function completeCutYourTeeth(
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
        .where(eq(characterMissions.characterId, context.character.id))
        .for("update");
      const existing = cutYourTeethRow(rows);
      const walkItOff = currentMissionRow(rows);
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

      if (!existing?.acceptedAt) {
        return stateFor({
          status: "refused",
          reason: "not_accepted",
          message: "Accept Cut Your Teeth from Tansy first.",
        });
      }
      if (existing.completedAt) return stateFor({ status: "already_completed" });
      if (!walkItOff?.acceptedAt || !walkItOff.completedAt) {
        return stateFor({
          status: "refused",
          reason: "prerequisite",
          message: "Complete Walk It Off before claiming this reward.",
        });
      }

      const locationId = await currentLocation(transaction, context.character.id);
      const tansy = getNpc(CUT_YOUR_TEETH.completionNpcId);
      if (locationId !== tansy?.homeLocationId || context.action) {
        return stateFor({
          status: "refused",
          reason: "not_stationary",
          message: "Tansy can inspect your stack only while you are stationary at The Jag.",
        });
      }

      const balance = getEffectiveGameBalance();
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

      // Requirement 1: the Salvage Cutter is currently equipped in its
      // compatible gear slot on a genuinely carried instance.
      const cutterDefinition = getItemDefinition(ITEM_IDS.salvageCutter, balance);
      if (!cutterDefinition || cutterDefinition.kind !== "unique") {
        throw new Error("Salvage Cutter must have an authoritative unique definition");
      }
      const cutterSuitSlotId = balance.items.salvageCutter.suitSlotId;
      const carriedById = new Map(itemState.carriedInstances.map((i) => [i.id, i.itemId]));
      const cutterEquipped = assignments.some(
        (assignment) =>
          assignment.assignmentKind === "gear" &&
          assignment.suitSlotId === cutterSuitSlotId &&
          carriedById.get(assignment.itemInstanceId) === ITEM_IDS.salvageCutter,
      );
      if (!cutterEquipped) {
        return stateFor({
          status: "refused",
          reason: "equipment",
          message: "Equip the Salvage Cutter before showing Tansy your work.",
        });
      }

      // Requirement 2: currently carrying one full authoritative stack of
      // Ferrite Shale. Provenance does not matter; nothing is consumed.
      const shaleDefinition = getItemDefinition(ITEM_IDS.ferriteShale, balance);
      if (!shaleDefinition || shaleDefinition.kind !== "stack") {
        throw new Error("Ferrite Shale must have an authoritative stack definition");
      }
      const requiredShale = shaleDefinition.stackLimit;
      const carriedShale = stacks
        .filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)
        .reduce((total, stack) => total + stack.quantity, 0);
      if (carriedShale < requiredShale) {
        return stateFor({
          status: "refused",
          reason: "insufficient_items",
          message: `Bring a full stack of Ferrite Shale (${carriedShale} of ${requiredShale}) for Tansy to inspect.`,
        });
      }

      // Atomically stamp completion AND award the quest XP through the sole
      // progression boundary. Both succeed together or not at all; the
      // completedAt guard above keeps retries from re-awarding.
      await transaction
        .update(characterMissions)
        .set({ completedAt: now })
        .where(
          and(
            eq(characterMissions.characterId, context.character.id),
            eq(characterMissions.missionId, CUT_YOUR_TEETH.id),
            isNull(characterMissions.completedAt),
          ),
        );
      await grantCharacterSkillXp(transaction, {
        characterId: context.character.id,
        skillId: SKILL_IDS.mining,
        awardedXp: CUT_YOUR_TEETH.reward.kind === "skill_xp" ? CUT_YOUR_TEETH.reward.amount : 0,
        thresholds: miningLevelThresholds(balance),
      });
      return stateFor({ status: "completed" });
    },
    now,
  );
}
