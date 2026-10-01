import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { playerTradeAudits, type PlayerTradeAudit } from "@/db/rune-space";
import type { SettledTradeOffer } from "@/game/domain/player-trade-settlement";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The committed player-trade economic audit (issue #267): the one write, made
 * by settlement inside its own transaction, and the alpha review query seams.
 *
 * The rows are permanent and immutable. Nothing here updates or deletes one,
 * and nothing else may: `player_trade_audits` has no update or delete path.
 * The reads are internal seams for operational review, not a player surface;
 * a future operator surface that exposes them must record privileged access
 * the way the moderation reads do (`server/privileged-access.ts`).
 */

type Reader = Pick<DatabaseTransaction, "select">;

export type TradeAuditRecord = {
  tradeId: string;
  committedAt: Date;
  locationId: string;
  requester: { playerAccountId: string; characterId: string; offer: SettledTradeOffer };
  recipient: { playerAccountId: string; characterId: string; offer: SettledTradeOffer };
};

/**
 * Write the audit row for one committed trade. The caller is settlement, in
 * the transaction that moves the assets: if this insert fails, nothing moves.
 * The primary key is the trade id, so a second row for one trade fails too.
 */
export async function insertTradeAudit(
  tx: DatabaseTransaction,
  record: TradeAuditRecord,
): Promise<void> {
  await tx.insert(playerTradeAudits).values({
    tradeId: record.tradeId,
    committedAt: record.committedAt,
    locationId: record.locationId,
    requesterPlayerAccountId: record.requester.playerAccountId,
    requesterCharacterId: record.requester.characterId,
    recipientPlayerAccountId: record.recipient.playerAccountId,
    recipientCharacterId: record.recipient.characterId,
    requesterCredits: record.requester.offer.credits,
    recipientCredits: record.recipient.offer.credits,
    requesterStacks: record.requester.offer.stacks,
    recipientStacks: record.recipient.offer.stacks,
    requesterItems: record.requester.offer.items,
    recipientItems: record.recipient.offer.items,
  });
}

function recordFromRow(row: PlayerTradeAudit): TradeAuditRecord {
  return {
    tradeId: row.tradeId,
    committedAt: row.committedAt,
    locationId: row.locationId,
    requester: {
      playerAccountId: row.requesterPlayerAccountId,
      characterId: row.requesterCharacterId,
      offer: {
        credits: row.requesterCredits,
        stacks: row.requesterStacks as SettledTradeOffer["stacks"],
        items: row.requesterItems as SettledTradeOffer["items"],
      },
    },
    recipient: {
      playerAccountId: row.recipientPlayerAccountId,
      characterId: row.recipientCharacterId,
      offer: {
        credits: row.recipientCredits,
        stacks: row.recipientStacks as SettledTradeOffer["stacks"],
        items: row.recipientItems as SettledTradeOffer["items"],
      },
    },
  };
}

/** The audit of one committed trade, by its trade (session) id. */
export async function findTradeAudit(
  tradeId: string,
  reader: Reader = db,
): Promise<TradeAuditRecord | undefined> {
  const [row] = await reader
    .select()
    .from(playerTradeAudits)
    .where(eq(playerTradeAudits.tradeId, tradeId));
  return row ? recordFromRow(row) : undefined;
}

/** Every committed trade either side of which was this Player account, newest first. */
export async function listTradeAuditsForAccount(
  playerAccountId: string,
  reader: Reader = db,
): Promise<TradeAuditRecord[]> {
  const rows = await reader
    .select()
    .from(playerTradeAudits)
    .where(
      or(
        eq(playerTradeAudits.requesterPlayerAccountId, playerAccountId),
        eq(playerTradeAudits.recipientPlayerAccountId, playerAccountId),
      ),
    )
    .orderBy(desc(playerTradeAudits.committedAt), desc(playerTradeAudits.tradeId));
  return rows.map(recordFromRow);
}

/** Every committed trade either side of which was this character, newest first. */
export async function listTradeAuditsForCharacter(
  characterId: string,
  reader: Reader = db,
): Promise<TradeAuditRecord[]> {
  const rows = await reader
    .select()
    .from(playerTradeAudits)
    .where(
      or(
        eq(playerTradeAudits.requesterCharacterId, characterId),
        eq(playerTradeAudits.recipientCharacterId, characterId),
      ),
    )
    .orderBy(desc(playerTradeAudits.committedAt), desc(playerTradeAudits.tradeId));
  return rows.map(recordFromRow);
}
