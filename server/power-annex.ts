import { and, eq } from "drizzle-orm";
import {
  activeActions,
  characterPowerCellDailyClaims,
  characterTravelState,
  equippedItems,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import {
  POWER_ANNEX_REWARD_SOURCE_ID,
  POWER_CELL_DAILY_ALLOTMENT,
  pacificResetDate,
} from "@/game/domain/power-annex";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { planExactStackAddition } from "@/game/domain/inventory";
import { withLockedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import {
  ensureStarterMiningState,
  stateFromTransaction,
  type MiningGameplayState,
} from "@/server/mining";
import { powerAnnexNow } from "@/server/power-annex-clock";

type ClaimStatus =
  | { status: "claimed"; resetDate: string; quantity: number }
  | { status: "already_claimed"; resetDate: string; quantity: number }
  | {
      status: "error";
      reason: "in_transit" | "active_action" | "not_at_annex" | "slots" | "mass";
      message: string;
    };

export type PowerAnnexClaimResult = {
  state: MiningGameplayState;
  claim: ClaimStatus;
};

async function stateForClaim(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<MiningGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

/**
 * Claim the fixed Power Annex allotment without touching the active-action
 * resolver. A claim is an instantaneous interaction, so even an expired action
 * remains blocking until its own authoritative command resolves it.
 */
export async function claimPowerCells(
  userId: string,
  characterId: string,
  now = powerAnnexNow(),
): Promise<PowerAnnexClaimResult> {
  return withLockedOwnedCharacter(userId, characterId, async (transaction, { character }) => {
    const resetDate = pacificResetDate(now);
    const balance = getEffectiveGameBalance();

    const [actionRows, travelRows] = await Promise.all([
      transaction
        .select()
        .from(activeActions)
        .where(eq(activeActions.characterId, character.id))
        .for("update"),
      transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, character.id))
        .for("update"),
    ]);
    const action = actionRows[0];

    await ensureStarterMiningState(transaction, character.id);

    if (action || travelRows[0]) {
      const inTransit = action?.actionId === ACTION_IDS.travel || Boolean(travelRows[0]);
      return {
        state: await stateForClaim(transaction, character.id, now),
        claim: {
          status: "error",
          reason: inTransit ? "in_transit" : "active_action",
          message: inTransit
            ? "Arrive at the Power Annex before claiming its allotment."
            : "Finish the active activity before claiming Power Cells.",
        },
      };
    }

    if (character.currentLocationId !== LOCATION_IDS.emergencyPowerAnnex) {
      return {
        state: await stateForClaim(transaction, character.id, now),
        claim: {
          status: "error",
          reason: "not_at_annex",
          message: "Travel to the DeWhat? Emergency Power Annex before claiming Power Cells.",
        },
      };
    }

    const existingClaim = await transaction
      .select({ characterId: characterPowerCellDailyClaims.characterId })
      .from(characterPowerCellDailyClaims)
      .where(
        and(
          eq(characterPowerCellDailyClaims.characterId, character.id),
          eq(characterPowerCellDailyClaims.rewardSourceId, POWER_ANNEX_REWARD_SOURCE_ID),
          eq(characterPowerCellDailyClaims.resetDate, resetDate),
        ),
      )
      .limit(1);
    if (existingClaim[0]) {
      return {
        state: await stateForClaim(transaction, character.id, now),
        claim: {
          status: "already_claimed",
          resetDate,
          quantity: POWER_CELL_DAILY_ALLOTMENT,
        },
      };
    }

    const [stacks, itemState, assignments] = await Promise.all([
      transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, character.id))
        .for("update"),
      loadOwnedItemInstances(transaction, character.id),
      transaction
        .select()
        .from(equippedItems)
        .where(eq(equippedItems.characterId, character.id))
        .for("update"),
    ]);
    const loadout = deriveEquipmentLoadout({
      assignments,
      instances: itemState.carriedInstances,
      stacks,
      balance,
    });
    const plan = planExactStackAddition(
      stacks,
      ITEM_IDS.powerCell,
      POWER_CELL_DAILY_ALLOTMENT,
      balance.items.powerCell.stackLimit,
      Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
      Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
      balance.items.powerCell.massGrams,
    );
    if (!plan.ok) {
      return {
        state: await stateForClaim(transaction, character.id, now),
        claim: {
          status: "error",
          reason: plan.reason,
          message:
            plan.reason === "mass"
              ? "The full five-cell allotment will not fit within carried-mass capacity."
              : "The full five-cell allotment will not fit in your available inventory slots.",
        },
      };
    }

    const inserted = await transaction
      .insert(characterPowerCellDailyClaims)
      .values({
        characterId: character.id,
        rewardSourceId: POWER_ANNEX_REWARD_SOURCE_ID,
        resetDate,
        claimedAt: now,
      })
      .onConflictDoNothing({
        target: [
          characterPowerCellDailyClaims.characterId,
          characterPowerCellDailyClaims.rewardSourceId,
          characterPowerCellDailyClaims.resetDate,
        ],
      })
      .returning({ characterId: characterPowerCellDailyClaims.characterId });
    if (!inserted[0]) {
      return {
        state: await stateForClaim(transaction, character.id, now),
        claim: {
          status: "already_claimed",
          resetDate,
          quantity: POWER_CELL_DAILY_ALLOTMENT,
        },
      };
    }

    for (const update of plan.plan.updatedStacks) {
      await transaction
        .update(inventoryStacks)
        .set({ quantity: update.quantity, updatedAt: now })
        .where(eq(inventoryStacks.id, update.id));
    }
    if (plan.plan.createdStacks.length) {
      await transaction.insert(inventoryStacks).values(
        plan.plan.createdStacks.map((stack) => ({
          characterId: character.id,
          itemId: stack.itemId,
          quantity: stack.quantity,
        })),
      );
    }

    return {
      state: await stateForClaim(transaction, character.id, now),
      claim: { status: "claimed", resetDate, quantity: POWER_CELL_DAILY_ALLOTMENT },
    };
  });
}
