import { and, asc, eq, isNull } from "drizzle-orm";
import { fedhexParcels } from "@/db/rune-space";
import {
  FEDHEX_ECHO_RECOVERY_BODY,
  FEDHEX_ECHO_RECOVERY_MESSAGE_TYPE,
  FEDHEX_ECHO_RECOVERY_SUBJECT,
  fedhexEchoRecoverySender,
} from "@/game/content/fedhex";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The FedHex mailbox (#399): one durable, character-owned set of parcels that
 * both FedHex Local Places open.
 *
 * A parcel is a message with at most one claimable attachment. Slice J writes
 * exactly one kind, the Wise Old Enby's Legendary Echo recovery parcel, and the
 * player's only action is Claim one parcel at a time (`server/fedhex-commands.ts`). The attachment is an item
 * definition; the unique instance is minted by the claim, once, under the
 * character lock, so an unclaimed parcel is never carried, tradable or
 * equippable, and no sequence of retries or sessions can mint a second instance.
 */

/**
 * Persist the recovery parcel for a Legendary that did not fit (#399). Called in
 * the same transaction as the discovery it recovers; `source_key` is the
 * reading's own instant, so a replayed write cannot create a second parcel.
 */
export async function createEchoRecoveryParcel(
  transaction: DatabaseTransaction,
  input: { characterId: string; itemId: string; readAt: Date },
): Promise<void> {
  const sender = fedhexEchoRecoverySender();
  await transaction
    .insert(fedhexParcels)
    .values({
      characterId: input.characterId,
      messageType: FEDHEX_ECHO_RECOVERY_MESSAGE_TYPE,
      sourceKey: `echo_reading:${input.readAt.toISOString()}`,
      senderKind: sender.kind,
      senderId: sender.id,
      senderDisplayName: sender.displayName,
      subject: FEDHEX_ECHO_RECOVERY_SUBJECT,
      body: FEDHEX_ECHO_RECOVERY_BODY,
      attachmentItemId: input.itemId,
      receivedAt: input.readAt,
    })
    .onConflictDoNothing();
}

export type FedhexParcelProjection = {
  parcelId: string;
  senderDisplayName: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachment: { itemId: string; name: string };
};

/** The mailbox as a player may see it: every pending parcel, oldest first. */
export type FedhexMailboxProjection = {
  pendingCount: number;
  parcels: readonly FedhexParcelProjection[];
};

export async function loadFedhexProjection(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<FedhexMailboxProjection> {
  const rows = await transaction
    .select()
    .from(fedhexParcels)
    .where(and(eq(fedhexParcels.characterId, characterId), isNull(fedhexParcels.claimedAt)))
    .orderBy(asc(fedhexParcels.receivedAt), asc(fedhexParcels.id));
  return {
    pendingCount: rows.length,
    parcels: rows.map((row) => ({
      parcelId: row.id,
      senderDisplayName: row.senderDisplayName,
      subject: row.subject,
      body: row.body,
      receivedAt: row.receivedAt.toISOString(),
      attachment: {
        itemId: row.attachmentItemId,
        name: resolveItemPresentation(row.attachmentItemId, row.attachmentItemId).displayName,
      },
    })),
  };
}
