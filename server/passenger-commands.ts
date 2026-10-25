import { eq, sql } from "drizzle-orm";
import {
  activeActions,
  characterPassengerJourneys,
  characters,
  characterTravelState,
} from "@/db/rune-space";
import { ACTION_IDS } from "@/game/config/foundations";
import {
  passengerRefusalMessage,
  planPassengerBooking,
  type PassengerRefusalReason,
} from "@/game/domain/passenger-travel";
import { withLockedOwnedCharacter, withResolvedOwnedCharacter } from "@/server/action-resolution";
import { acknowledgePassengerArrivalRow, loadPassengerUnlocked } from "@/server/passenger-state";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

const NO_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

export type BookPassageResult = {
  state: PlayGameplayState;
  booking:
    | {
        status: "booked";
        routeId: string;
        fareCredits: number;
        startedAt: string;
        arrivesAt: string;
      }
    | { status: "refused"; reason: PassengerRefusalReason; message: string };
};

export type PassengerArrivalAcknowledgmentResult = {
  state: PlayGameplayState;
  acknowledged: boolean;
};

function stateOf(
  transaction: Parameters<typeof stateFromTransaction>[0],
  characterId: string,
  now: Date,
) {
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
 * Book and board one Milky Waymo passage (#404).
 *
 * One character-authoritative transaction decides everything. The character row
 * is locked first, so concurrent or repeated confirmations queue behind it and
 * each finds the journey already under way; the boundary then lands any journey
 * that was due and refuses the command outright while a flight or a journey is
 * in the air. Under that lock the command re-derives where the character
 * actually is, that the named place is that hub's check-in, that the unlock is
 * theirs, that they are idle and that they can pay. Only then does a single
 * conditional debit, the journey's immutable schedule and the active action
 * commit together, so a refusal at any step writes nothing and a fare can never
 * be charged without a journey or a journey begun without its fare.
 *
 * It moves nothing: no character location (that happens at landing), and it
 * never reads or writes the ship, its tank, its berth or the Cargo Hold. There
 * is no cancel, abort or refund: once the row is written the shuttle lands on
 * its own recorded schedule.
 */
export async function bookPassage(
  userId: string,
  characterId: string,
  request: { localPlaceId: string },
  now = new Date(),
): Promise<BookPassageResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const refuse = async (reason: PassengerRefusalReason): Promise<BookPassageResult> => ({
        state: await stateOf(transaction, context.character.id, now),
        booking: { status: "refused", reason, message: passengerRefusalMessage(reason) },
      });

      // Re-read after reconciliation so a landing committed earlier in this very
      // transaction is the location and balance this booking is judged against.
      const [row] = await transaction
        .select({ currentLocationId: characters.currentLocationId, credits: characters.credits })
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      // A walk's Travel row with no matching action would be corrupt state; it
      // is still never an idle character.
      const [walking] = await transaction
        .select({ characterId: characterTravelState.characterId })
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id))
        .limit(1);
      const plan = planPassengerBooking({
        currentLocationId: row?.currentLocationId ?? "",
        localPlaceId: request.localPlaceId,
        unlocked: await loadPassengerUnlocked(transaction, context.character.id),
        busy: context.action !== undefined || walking !== undefined,
        credits: row?.credits ?? 0,
      });
      if (!plan.ok) return refuse(plan.reason);

      // The balance is decremented in SQL from the locked row, guarded so it can
      // never go negative, rather than written from a value read earlier.
      const charged = await transaction
        .update(characters)
        .set({ credits: sql`${characters.credits} - ${plan.fareCredits}` })
        .where(
          sql`${characters.id} = ${context.character.id} AND ${characters.credits} >= ${plan.fareCredits}`,
        )
        .returning({ id: characters.id });
      if (charged.length === 0) return refuse("insufficient_credits");

      const arrivesAt = new Date(now.getTime() + plan.durationMs);
      // One row per character: this booking replaces the last landed journey, so
      // an undismissed old receipt can never greet a player who has just left.
      await transaction
        .insert(characterPassengerJourneys)
        .values({
          characterId: context.character.id,
          routeId: plan.route.id,
          originLocationId: plan.route.originLocationId,
          destinationLocationId: plan.route.destinationLocationId,
          fareCredits: plan.fareCredits,
          startedAt: now,
          arrivesAt,
        })
        .onConflictDoUpdate({
          target: characterPassengerJourneys.characterId,
          set: {
            routeId: plan.route.id,
            originLocationId: plan.route.originLocationId,
            destinationLocationId: plan.route.destinationLocationId,
            fareCredits: plan.fareCredits,
            startedAt: now,
            arrivesAt,
            landedAt: null,
            acknowledgedAt: null,
          },
        });
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.passengerTravel,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return {
        state: await stateOf(transaction, context.character.id, now),
        booking: {
          status: "booked",
          routeId: plan.route.id,
          fareCredits: plan.fareCredits,
          startedAt: now.toISOString(),
          arrivesAt: arrivesAt.toISOString(),
        },
      };
    },
    now,
  );
}

/**
 * Disembark: dismiss the landed journey's receipt (#404). Presentation only and
 * idempotent: it changes no gameplay state, a replay or a second device finds
 * nothing left to dismiss, and the landing stands regardless.
 */
export async function acknowledgePassengerArrival(
  userId: string,
  characterId: string,
  now = new Date(),
): Promise<PassengerArrivalAcknowledgmentResult> {
  return withLockedOwnedCharacter(
    userId,
    characterId,
    async (transaction, context) => {
      const acknowledged = await acknowledgePassengerArrivalRow(transaction, {
        characterId: context.character.id,
        now,
      });
      return { state: await stateOf(transaction, context.character.id, now), acknowledged };
    },
    // Presentation only: it changes no trade- or journey-relevant state.
    { allowDuringTrade: true, allowDuringFlight: true, now },
  );
}
