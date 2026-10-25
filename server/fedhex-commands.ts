import { and, eq, isNull } from "drizzle-orm";
import { activeActions, characterTravelState, fedhexParcels, itemInstances } from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import {
  isFedhexMailboxPlace,
  planFedhexClaim,
  type FedhexClaimRefusal,
} from "@/game/domain/fedhex";
import { withLockedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { loadCarriedCapacity } from "@/server/carried-inventory";
import {
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

/**
 * The FedHex player command (#399): Claim one parcel. The mailbox's storage and
 * projection are `server/fedhex.ts`; this is the only code that moves an
 * attachment into carried Inventory.
 */

function stateAfterFedhex(
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

export type FedhexClaimResult = {
  state: PlayGameplayState;
  claim:
    | { status: "claimed"; parcelId: string; itemId: string; itemInstanceId: string }
    | { status: "refused"; reason: FedhexClaimRefusal; message: string };
};

/**
 * Claim one parcel's attachment into carried Inventory (#399).
 *
 * Every rule is revalidated inside the character lock: the character is
 * stationary (not travelling, not flying, nothing running), its authoritative
 * World Location is the parent of the FedHex Local Place requested, the parcel
 * is this character's and unclaimed, and the carried Inventory has both a slot
 * and the mass for the unique item. A refusal changes nothing; a claim creates
 * exactly one instance and stamps the parcel in the same transaction, and the
 * character-row lock serialises two sessions racing to claim the same parcel.
 */
export async function claimFedhexParcel(
  userId: string,
  characterId: string,
  request: { parcelId: string; localPlaceId: string },
  now = new Date(),
): Promise<FedhexClaimResult> {
  return withLockedOwnedCharacter(
    userId,
    characterId,
    async (transaction, { character }) => {
      const refuse = async (
        reason: FedhexClaimRefusal,
        message: string,
      ): Promise<FedhexClaimResult> => ({
        state: await stateAfterFedhex(transaction, character.id, now),
        claim: { status: "refused", reason, message },
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
        const inTransit =
          action?.actionId === ACTION_IDS.travel ||
          action?.actionId === ACTION_IDS.shipFlight ||
          Boolean(travelRows[0]);
        return inTransit
          ? refuse("in_transit", "Arrive before collecting parcels.")
          : refuse("active_action", "Finish the active activity before collecting parcels.");
      }

      // The place is resolved from the character's authoritative position, never
      // from what the browser had open: a FedHex place of any other World
      // Location resolves to nothing here.
      const place = getLocalPlaceInLocation(character.currentLocationId, request.localPlaceId);
      if (!place || !isFedhexMailboxPlace(place))
        return refuse("not_at_fedhex", "Collect parcels at a FedHex pickup.");

      const [parcel] = await transaction
        .select()
        .from(fedhexParcels)
        .where(
          and(eq(fedhexParcels.id, request.parcelId), eq(fedhexParcels.characterId, character.id)),
        )
        .for("update");
      if (!parcel) return refuse("not_found", "That parcel is not in your mailbox.");
      if (parcel.claimedAt)
        return refuse("already_claimed", "That parcel has already been collected.");

      const balance = getEffectiveGameBalance();
      const definition = getItemDefinition(parcel.attachmentItemId, balance);
      if (definition?.kind !== "unique")
        throw new Error(`FedHex attachment "${parcel.attachmentItemId}" is not a unique item`);
      const capacity = await loadCarriedCapacity(transaction, character.id);
      const plan = planFedhexClaim({
        massGrams: definition.massGrams,
        availableSlots: capacity.availableSlots,
        availableMassGrams: capacity.availableMassGrams,
      });
      if (!plan.ok) return refuse(plan.reason, plan.message);

      const [instance] = await transaction
        .insert(itemInstances)
        .values({
          characterId: character.id,
          itemId: parcel.attachmentItemId,
          currentCharge: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: itemInstances.id });
      if (!instance) throw new Error("The claimed FedHex item was not created");
      const stamped = await transaction
        .update(fedhexParcels)
        .set({ claimedAt: now, claimedItemInstanceId: instance.id })
        .where(and(eq(fedhexParcels.id, parcel.id), isNull(fedhexParcels.claimedAt)))
        .returning({ id: fedhexParcels.id });
      if (stamped.length !== 1) throw new Error("The FedHex parcel was claimed concurrently");

      return {
        state: await stateAfterFedhex(transaction, character.id, now),
        claim: {
          status: "claimed",
          parcelId: parcel.id,
          itemId: parcel.attachmentItemId,
          itemInstanceId: instance.id,
        },
      };
    },
    { now },
  );
}
