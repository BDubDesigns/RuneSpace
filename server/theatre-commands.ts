import { eq, sql } from "drizzle-orm";
import {
  activeActions,
  characters,
  characterTheatreBuffs,
  characterTheatreLatestTickets,
  characterTheatreReceipts,
  characterTravelState,
} from "@/db/rune-space";
import { ACTION_IDS } from "@/game/config/foundations";
import {
  planTicketPurchase,
  ticketRefusalMessage,
  type TicketRefusalReason,
  type TopUp,
} from "@/game/domain/theatre";
import { withLockedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { stateFromTransaction, type PlayGameplayState } from "@/server/play";
import { loadTheatreBuffs, loadTheatreReceipts } from "@/server/theatre";

/**
 * NOT YET REACHABLE BY PLAYERS (#491). This command is the server half of buying a Holo
 * Drive-In ticket and is deliberately wired to no route, action or UI: the Mining and
 * Welding buff effects it grants are later slices, and a ticket must not be sellable
 * before the thing it sells exists. `tests/unit/theatre-exposure.test.ts` fails if any
 * shipped surface imports it; the slice that implements the effects removes that guard in
 * the same change that exposes the purchase.
 */

export type TheatreTicketRequest = {
  /** The showing the player saw, as `ShowingInstance.showingId`. */
  showingId: string;
  tierId: string;
};

export type TheatreTicketResult = {
  state: PlayGameplayState;
  purchase:
    | {
        status: "purchased";
        receiptId: string;
        showingId: string;
        showtimeId: string;
        filmId: string;
        tierId: string;
        skillId: string;
        creditsPaid: number;
        /** The character's Credits after the purchase. */
        credits: number;
        buff: TopUp;
      }
    | {
        status: "refused";
        reason: TicketRefusalReason;
        message: string;
        /**
         * For `already_purchased`: the tier the existing receipt was bought at, so a client
         * whose first response was lost can recognise its own purchase rather than report
         * a failure.
         */
        heldTierId?: string;
      };
};

const NO_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

async function stateOf(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    NO_RESULT,
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

/**
 * Buy one Holo Drive-In ticket.
 *
 * One character-authoritative transaction decides everything. The character row is locked
 * first, so concurrent tabs, a double tap and a retry after a lost response queue behind
 * it and each finds the one before. Under that lock the command re-derives, from the
 * server's own clock and rows, where the character actually is, that they are idle, which
 * showing is on right now, that they do not already hold a receipt for that film and
 * showtime, that they can pay, and what their buff balance is. Only then does one conditional
 * Credit debit, the unique receipt, the latest-ticket replay pointer and the buff top-up
 * commit together, so a refusal at any step writes nothing and a ticket can never be charged
 * without its receipt, its replay or its buff, or granted without its payment.
 *
 * - The showing is the one the server says is on at `now`: a request naming a showing that has
 *   turned over is refused (`showing_changed`) rather than silently bought as the incoming
 *   film, and an instant exactly on the hour belongs to the incoming one.
 * - A character holds at most one receipt per film and showtime; a same-show rebuy, upgrade
 *   or retry is refused (`already_purchased`) with nothing charged or granted, even when the
 *   buff has since been spent.
 * - The buff is set to the larger of what remains and the tier's capacity (the upsert's own
 *   `GREATEST`), never a sum and never less than the character already bought, and an
 *   already-covered balance still buys the receipt and the replay.
 * - Playback, completion and the viewer play no part: the buff is the payment's, immediately.
 * - It moves nothing and reads no ship, inventory or Mission state.
 */
export async function buyTheatreTicket(
  userId: string,
  characterId: string,
  request: TheatreTicketRequest,
  now = new Date(),
): Promise<TheatreTicketResult> {
  return withLockedOwnedCharacter(
    userId,
    characterId,
    async (transaction, { character }) => {
      const refuse = async (
        reason: TicketRefusalReason,
        heldTierId?: string,
      ): Promise<TheatreTicketResult> => ({
        state: await stateOf(transaction, character.id, now),
        purchase: {
          status: "refused",
          reason,
          message: ticketRefusalMessage(reason),
          ...(heldTierId === undefined ? {} : { heldTierId }),
        },
      });

      // An unrelated action or a walk blocks the purchase for the same reason it blocks a
      // trade: the character must be physically standing at the theatre, not on the way.
      const [[action], [walking]] = await Promise.all([
        transaction
          .select({ actionId: activeActions.actionId })
          .from(activeActions)
          .where(eq(activeActions.characterId, character.id))
          .for("update"),
        transaction
          .select({ characterId: characterTravelState.characterId })
          .from(characterTravelState)
          .where(eq(characterTravelState.characterId, character.id))
          .for("update"),
      ]);
      const busy =
        walking || action?.actionId === ACTION_IDS.travel
          ? ("in_transit" as const)
          : action
            ? ("active_action" as const)
            : undefined;

      const [receipts, buffs] = await Promise.all([
        loadTheatreReceipts(transaction, character.id),
        loadTheatreBuffs(transaction, character.id, { lockRows: true }),
      ]);
      const plan = planTicketPurchase({
        atLocationId: character.currentLocationId,
        busy,
        requestedShowingId: request.showingId,
        requestedTierId: request.tierId,
        nowMs: now.getTime(),
        credits: character.credits,
        receipts,
        remainingBySkill: buffs,
      });
      if (!plan.ok) {
        if (plan.reason !== "already_purchased") return refuse(plan.reason);
        const held = receipts.find(
          (receipt) =>
            receipt.filmId === plan.held?.filmId && receipt.showtimeId === plan.held?.showtimeId,
        );
        return refuse(plan.reason, held?.tierId);
      }

      // The balance is decremented in SQL from the locked row, guarded so it can never go
      // negative, rather than written from a value read earlier.
      const charged = await transaction
        .update(characters)
        .set({ credits: sql`${characters.credits} - ${plan.tier.credits}` })
        .where(
          sql`${characters.id} = ${character.id} AND ${characters.credits} >= ${plan.tier.credits}`,
        )
        .returning({ credits: characters.credits });
      // Unreachable while the character lock holds, and the balance was checked above. If it
      // ever is, throwing rolls the whole purchase back instead of leaving a half-written one.
      if (charged.length === 0) throw new Error("Theatre ticket debit was refused after planning.");

      const [receipt] = await transaction
        .insert(characterTheatreReceipts)
        .values({
          characterId: character.id,
          filmId: plan.showing.filmId,
          showtimeId: plan.showing.showtimeId,
          screenId: plan.showing.screenId,
          showingId: plan.showing.showingId,
          tierId: plan.tier.id,
          skillId: plan.film.skillId,
          creditsPaid: plan.tier.credits,
          tierCapacity: plan.tier.capacity,
          chargesBefore: plan.topUp.remainingBefore,
          chargesAfter: plan.topUp.remainingAfter,
          purchasedAt: now,
        })
        // The unique (character, film, showtime) index is the one-purchase rule's backstop:
        // a conflict mints nothing, and rolls the debit back below.
        .onConflictDoNothing()
        .returning({ id: characterTheatreReceipts.id });
      if (!receipt) throw new Error("Theatre receipt already existed after planning.");

      await transaction
        .insert(characterTheatreLatestTickets)
        .values({
          characterId: character.id,
          receiptId: receipt.id,
          filmId: plan.showing.filmId,
          showtimeId: plan.showing.showtimeId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: characterTheatreLatestTickets.characterId,
          set: {
            receiptId: receipt.id,
            filmId: plan.showing.filmId,
            showtimeId: plan.showing.showtimeId,
            updatedAt: now,
          },
        });

      const [buff] = await transaction
        .insert(characterTheatreBuffs)
        .values({
          characterId: character.id,
          skillId: plan.film.skillId,
          remainingCharges: plan.tier.capacity,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [characterTheatreBuffs.characterId, characterTheatreBuffs.skillId],
          set: {
            // Never a sum, and never below what the character already bought.
            remainingCharges: sql`GREATEST(${characterTheatreBuffs.remainingCharges}, ${plan.tier.capacity})`,
            updatedAt: now,
          },
        })
        .returning({ remainingCharges: characterTheatreBuffs.remainingCharges });
      if (buff?.remainingCharges !== plan.topUp.remainingAfter) {
        throw new Error("Theatre buff balance disagreed with its planned top-up.");
      }

      return {
        state: await stateOf(transaction, character.id, now),
        purchase: {
          status: "purchased",
          receiptId: receipt.id,
          showingId: plan.showing.showingId,
          showtimeId: plan.showing.showtimeId,
          filmId: plan.showing.filmId,
          tierId: plan.tier.id,
          skillId: plan.film.skillId,
          creditsPaid: plan.tier.credits,
          credits: charged[0]!.credits,
          buff: plan.topUp,
        },
      };
    },
    { now },
  );
}
