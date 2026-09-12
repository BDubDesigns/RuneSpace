import { eq } from "drizzle-orm";
import {
  activeActions,
  characters,
  characterTravelState,
  equippedItems,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getMerchant } from "@/game/content/merchants";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import { planExactStackAddition } from "@/game/domain/inventory";
import { deriveLocalPlaceAccess } from "@/game/domain/local-places";
import { quoteTrade, type TradeDirection } from "@/game/domain/trade";
import { loadCompletedMissionIds } from "@/server/mission-state";
import { withLockedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import {
  addStackableItem,
  consumeStackableItem,
  loadOwnedItemInstances,
} from "@/server/carried-inventory";
import {
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

export type TradeRequest = {
  localPlaceId: string;
  itemId: string;
  direction: TradeDirection;
  quantity: number;
};

export type TradeRefusalReason =
  | "in_transit"
  | "active_action"
  | "unknown_place"
  | "place_locked"
  | "no_merchant"
  | "not_traded"
  | "invalid_quantity"
  | "insufficient_credits"
  | "insufficient_items"
  | "slots"
  | "mass";

export type TradeStatus =
  | {
      status: "traded";
      direction: TradeDirection;
      itemId: string;
      quantity: number;
      totalCredits: number;
      credits: number;
    }
  | { status: "refused"; reason: TradeRefusalReason; message: string };

export type TradeResult = {
  state: PlayGameplayState;
  trade: TradeStatus;
};

async function stateForTrade(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
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
 * Authoritative merchant transaction.
 *
 * Trade is an instantaneous interaction, so it takes the locked-character
 * boundary rather than the resolving one: an expired Mining or Travel row stays
 * blocking until its own command resolves it, and can never be progressed as a
 * side effect of buying something.
 *
 * The requested Local Place is treated strictly as a request. Which place the
 * browser has open is presentation state and is never persisted, so this
 * command does not — and cannot — verify "the shop is on screen". What it
 * verifies is that the requested trade is authoritative and currently allowed:
 * the character is owned and stationary, its authoritative World Location is
 * this Local Place's parent, the Local Place exists there, its derived access
 * permits entry, and that Local Place genuinely owns the merchant being traded
 * with. Prices and totals come from authored content; nothing about the money
 * is taken from the client.
 */
export async function tradeWithMerchant(
  userId: string,
  characterId: string,
  request: TradeRequest,
  now = new Date(),
): Promise<TradeResult> {
  return withLockedOwnedCharacter(userId, characterId, async (transaction, { character }) => {
    const balance = getEffectiveGameBalance();
    const refuse = async (reason: TradeRefusalReason, message: string): Promise<TradeResult> => ({
      state: await stateForTrade(transaction, character.id, now),
      trade: { status: "refused", reason, message },
    });

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

    await ensurePlayProvisioning(transaction, character.id);

    const action = actionRows[0];
    if (action || travelRows[0]) {
      const inTransit = action?.actionId === ACTION_IDS.travel || Boolean(travelRows[0]);
      return inTransit
        ? refuse("in_transit", "Arrive before trading.")
        : refuse("active_action", "Finish the active activity before trading.");
    }

    // The authoritative position decides which Local Places are reachable at
    // all; a requested place belonging to any other World Location resolves to
    // nothing here regardless of what the client asked for.
    const place = getLocalPlaceInLocation(character.currentLocationId, request.localPlaceId);
    if (!place) return refuse("unknown_place", "That place is not open to you from here.");

    // Access is revalidated from the character's own completed Missions, so a
    // mission-gated place cannot be traded in merely because the browser had it
    // on screen.
    const access = deriveLocalPlaceAccess(
      place,
      await loadCompletedMissionIds(transaction, character.id),
    );
    if (!access.available) return refuse("place_locked", access.reason);

    const merchant = place.merchantId ? getMerchant(place.merchantId) : undefined;
    if (!merchant) return refuse("no_merchant", "Nobody trades here.");

    const quoted = quoteTrade({
      merchant,
      itemId: request.itemId,
      direction: request.direction,
      quantity: request.quantity,
    });
    if (!quoted.ok) {
      return quoted.reason === "not_traded"
        ? refuse("not_traded", "That is not traded here.")
        : refuse("invalid_quantity", "Choose a whole quantity of at least one.");
    }
    const { quote } = quoted;

    const itemDefinition = getItemDefinition(request.itemId, balance);
    if (!itemDefinition || itemDefinition.kind !== "stack") {
      return refuse("not_traded", "That is not traded here.");
    }

    if (quote.direction === "sell") {
      const consumption = await consumeStackableItem(transaction, {
        characterId: character.id,
        itemId: request.itemId,
        quantity: quote.quantity,
        now,
      });
      if (!consumption.ok) {
        return refuse("insufficient_items", "You no longer carry that many to sell.");
      }
      const credits = character.credits + quote.totalCredits;
      await transaction.update(characters).set({ credits }).where(eq(characters.id, character.id));
      return {
        state: await stateForTrade(transaction, character.id, now),
        trade: {
          status: "traded",
          direction: "sell",
          itemId: quote.itemId,
          quantity: quote.quantity,
          totalCredits: quote.totalCredits,
          credits,
        },
      };
    }

    if (character.credits < quote.totalCredits) {
      return refuse("insufficient_credits", "You cannot afford that many.");
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
      request.itemId,
      quote.quantity,
      itemDefinition.stackLimit,
      Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
      Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
      itemDefinition.massGrams,
    );
    if (!plan.ok) {
      return plan.reason === "mass"
        ? refuse("mass", "That purchase will not fit within carried-mass capacity.")
        : refuse("slots", "That purchase will not fit in your available inventory slots.");
    }

    const credits = character.credits - quote.totalCredits;
    await transaction.update(characters).set({ credits }).where(eq(characters.id, character.id));
    await addStackableItem(transaction, { characterId: character.id, plan: plan.plan, now });

    return {
      state: await stateForTrade(transaction, character.id, now),
      trade: {
        status: "traded",
        direction: "buy",
        itemId: quote.itemId,
        quantity: quote.quantity,
        totalCredits: quote.totalCredits,
        credits,
      },
    };
  });
}
