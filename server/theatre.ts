import { and, eq, inArray, sql } from "drizzle-orm";
import {
  characterTheatreBuffs,
  characterTheatreLatestTickets,
  characterTheatreReceipts,
} from "@/db/rune-space";
import { isTheatreFilmId, PRE_ROLL_DURATION_MS, theatreViewerReady } from "@/game/content/theatre";
import type {
  CharacterTheatreProjection,
  LatestTicketProjection,
  TheatreProgrammeProjection,
  TheatreViewerProjection,
} from "@/game/domain/theatre";
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

/**
 * One skill's remaining film buff charges for a character, zero when they hold none (#491).
 * The Mining and Welding resolvers read this under the character lock they already hold, so
 * what a resolution judges is what the same transaction then spends.
 */
export async function loadTheatreBuffCharges(
  transaction: DatabaseTransaction,
  characterId: string,
  skillId: string,
): Promise<number> {
  const [row] = await transaction
    .select({ remainingCharges: characterTheatreBuffs.remainingCharges })
    .from(characterTheatreBuffs)
    .where(
      and(
        eq(characterTheatreBuffs.characterId, characterId),
        eq(characterTheatreBuffs.skillId, skillId),
      ),
    )
    .limit(1);
  return row?.remainingCharges ?? 0;
}

/**
 * Spend `charges` of one skill's film buff, in the same transaction that earned their effect
 * (#491). One guarded `UPDATE ... WHERE remaining_charges >= charges`, so a balance can never
 * go negative: a resolution that planned to spend more than the row holds throws, which rolls
 * the whole resolution back rather than leaving its XP without its charge. Spending nothing
 * writes nothing.
 */
export async function consumeTheatreBuffCharges(
  transaction: DatabaseTransaction,
  input: { characterId: string; skillId: string; charges: number; now: Date },
): Promise<void> {
  if (!Number.isInteger(input.charges) || input.charges < 0) {
    throw new RangeError("Charges to spend must be a non-negative integer");
  }
  if (input.charges === 0) return;
  const spent = await transaction
    .update(characterTheatreBuffs)
    .set({
      remainingCharges: sql`${characterTheatreBuffs.remainingCharges} - ${input.charges}`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterTheatreBuffs.characterId, input.characterId),
        eq(characterTheatreBuffs.skillId, input.skillId),
        sql`${characterTheatreBuffs.remainingCharges} >= ${input.charges}`,
      ),
    )
    .returning({ remainingCharges: characterTheatreBuffs.remainingCharges });
  if (spent.length === 0) {
    throw new Error("A resolution spent more film buff charges than the character held");
  }
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

/**
 * The replay entitlement as the Play state and the viewing command carry it. A receipt for a
 * film the catalog no longer carries has nothing to replay, so it projects as no ticket.
 */
export function projectLatestTheatreTicket(
  latest: LatestTheatreTicket | undefined,
): LatestTicketProjection | undefined {
  if (!latest || !isTheatreFilmId(latest.filmId)) return undefined;
  return {
    receiptId: latest.receiptId,
    filmId: latest.filmId,
    showtimeId: latest.showtimeId,
    tierId: latest.tierId,
    purchasedAt: latest.purchasedAt.toISOString(),
  };
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

/**
 * The film viewer the Play state offers (#491). Production: available only when all three
 * commercials exist (`theatreViewerReady`). A preview or local build may also set
 * `RUNESPACE_THEATRE_STAND_IN_ADS=true` so the viewer's whole lifecycle can be playtested and
 * browser-tested with clearly labelled stand-in cards in the three slots, and
 * `RUNESPACE_THEATRE_STAND_IN_AD_MS` to shorten them for tests; neither authors a commercial,
 * and no deployment sets them unless its owner is playtesting the viewer. Read on the server so
 * the browser never decides it.
 */
export function theatreViewerProjection(): TheatreViewerProjection {
  const ready = theatreViewerReady();
  const standIns = !ready && process.env.RUNESPACE_THEATRE_STAND_IN_ADS === "true";
  const override = Number(process.env.RUNESPACE_THEATRE_STAND_IN_AD_MS);
  return {
    available: ready || standIns,
    standInAds: standIns,
    preRollMs:
      standIns && Number.isInteger(override) && override >= 500 && override <= PRE_ROLL_DURATION_MS
        ? override
        : PRE_ROLL_DURATION_MS,
  };
}

export function theatreViewerAvailable(): boolean {
  return theatreViewerProjection().available;
}

/**
 * A character's own theatre facts for the Play state (#491, slice 4), read in the state's
 * transaction: both film buff balances, the replay entitlement and the tier of any ticket they
 * already hold for what each screen is showing now. Three small keyed reads, issued only for a
 * character standing at a theatre.
 */
export async function loadCharacterTheatreProjection(
  transaction: DatabaseTransaction,
  characterId: string,
  programme: TheatreProgrammeProjection,
  locationId: string,
): Promise<CharacterTheatreProjection | undefined> {
  const screens = programme.screens.filter((screen) => screen.locationId === locationId);
  if (screens.length === 0) return undefined;
  const showtimeIds = [...new Set(screens.map((screen) => screen.now.showtimeId))];
  const [buffs, latest, receipts] = await Promise.all([
    loadTheatreBuffs(transaction, characterId),
    loadLatestTheatreTicket(transaction, characterId),
    transaction
      .select({
        filmId: characterTheatreReceipts.filmId,
        showtimeId: characterTheatreReceipts.showtimeId,
        tierId: characterTheatreReceipts.tierId,
      })
      .from(characterTheatreReceipts)
      .where(
        and(
          eq(characterTheatreReceipts.characterId, characterId),
          inArray(characterTheatreReceipts.showtimeId, showtimeIds),
        ),
      ),
  ]);
  const heldTiers: Record<string, string> = {};
  for (const screen of screens) {
    const held = receipts.find(
      (receipt) =>
        receipt.filmId === screen.now.filmId && receipt.showtimeId === screen.now.showtimeId,
    );
    if (held) heldTiers[screen.now.showingId] = held.tierId;
  }
  const latestTicket = projectLatestTheatreTicket(latest);
  return {
    buffs,
    ...(latestTicket ? { latestTicket } : {}),
    heldTiers,
    viewer: theatreViewerProjection(),
  };
}
