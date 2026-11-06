import { eq } from "drizzle-orm";
import {
  characterTheatreBuffs,
  characterTheatreLatestTickets,
  characterTheatreReceipts,
} from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The Holo Drive-In's persisted state (#491): a character's receipts, their one replay
 * entitlement and their buff balances. Its own small module because the purchase command
 * writes it and, in later slices, the Play state and the Mining and Welding resolvers read
 * it. Nothing here is a rule: the rules are `game/domain/theatre`, and the schedule is
 * judged against the server's clock inside the purchase transaction
 * (`server/theatre-commands`).
 */

export type TheatreReceiptRow = {
  id: string;
  filmId: string;
  showtimeId: string;
  screenId: string;
  showingId: string;
  tierId: string;
  skillId: string;
  creditsPaid: number;
  tierCapacity: number;
  chargesBefore: number;
  chargesAfter: number;
  purchasedAt: Date;
};

/** Every receipt a character holds: the history one-purchase-per-showing is judged from. */
export async function loadTheatreReceipts(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<TheatreReceiptRow[]> {
  return transaction
    .select({
      id: characterTheatreReceipts.id,
      filmId: characterTheatreReceipts.filmId,
      showtimeId: characterTheatreReceipts.showtimeId,
      screenId: characterTheatreReceipts.screenId,
      showingId: characterTheatreReceipts.showingId,
      tierId: characterTheatreReceipts.tierId,
      skillId: characterTheatreReceipts.skillId,
      creditsPaid: characterTheatreReceipts.creditsPaid,
      tierCapacity: characterTheatreReceipts.tierCapacity,
      chargesBefore: characterTheatreReceipts.chargesBefore,
      chargesAfter: characterTheatreReceipts.chargesAfter,
      purchasedAt: characterTheatreReceipts.purchasedAt,
    })
    .from(characterTheatreReceipts)
    .where(eq(characterTheatreReceipts.characterId, characterId));
}

/**
 * A character's remaining buff charges keyed by skill ID. A skill with no row has none, and
 * a spent-out one is a row at zero; both read as zero here.
 */
export async function loadTheatreBuffs(
  transaction: DatabaseTransaction,
  characterId: string,
  options: { lockRows?: boolean } = {},
): Promise<Record<string, number>> {
  const query = transaction
    .select({
      skillId: characterTheatreBuffs.skillId,
      remainingCharges: characterTheatreBuffs.remainingCharges,
    })
    .from(characterTheatreBuffs)
    .where(eq(characterTheatreBuffs.characterId, characterId));
  const rows = await (options.lockRows ? query.for("update") : query);
  return Object.fromEntries(rows.map((row) => [row.skillId, row.remainingCharges]));
}

export type LatestTheatreTicket = {
  receiptId: string;
  filmId: string;
  showtimeId: string;
  tierId: string;
  purchasedAt: Date;
};

/**
 * The one most recently purchased ticket, or undefined for a character who has never
 * bought one. This is the replay entitlement: it survives logout, travel and showtime
 * rollover, and only a newer purchase replaces it.
 */
export async function loadLatestTheatreTicket(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<LatestTheatreTicket | undefined> {
  const [row] = await transaction
    .select({
      receiptId: characterTheatreLatestTickets.receiptId,
      filmId: characterTheatreLatestTickets.filmId,
      showtimeId: characterTheatreLatestTickets.showtimeId,
      tierId: characterTheatreReceipts.tierId,
      purchasedAt: characterTheatreReceipts.purchasedAt,
    })
    .from(characterTheatreLatestTickets)
    .innerJoin(
      characterTheatreReceipts,
      eq(characterTheatreReceipts.id, characterTheatreLatestTickets.receiptId),
    )
    .where(eq(characterTheatreLatestTickets.characterId, characterId))
    .limit(1);
  return row;
}

/** A character's whole theatre state in one read, for the Play projection of a later slice. */
export type CharacterTheatreState = {
  buffs: Readonly<Record<string, number>>;
  latestTicket: LatestTheatreTicket | undefined;
  receipts: readonly TheatreReceiptRow[];
};

export async function loadCharacterTheatreState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<CharacterTheatreState> {
  const [buffs, latestTicket, receipts] = await Promise.all([
    loadTheatreBuffs(transaction, characterId),
    loadLatestTheatreTicket(transaction, characterId),
    loadTheatreReceipts(transaction, characterId),
  ]);
  return { buffs, latestTicket, receipts };
}
