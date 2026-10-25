import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  characterPassengerJourneys,
  characters,
  shipArrivalNotices,
  type CharacterPassengerJourney,
} from "@/db/rune-space";
import { ACTION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { getPassengerRoute } from "@/game/content/passenger-routes";
import {
  isPassengerJourneyValid,
  passengerFareCredits,
  passengerJourneyDurationMs,
  PASSENGER_UNLOCK_SHIP_ROUTE_ID,
} from "@/game/domain/passenger-travel";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";

/** A recorded integrity failure: the transaction rolls back and the journey stays as it was. */
export class PassengerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassengerRuleError";
  }
}

/** Everything the Milky Waymo kiosk and cabin read about the character's passage (#404). */
export type PassengerProjection = {
  /** The character has first arrived at Stillreach aboard their own Rivet. */
  unlocked: boolean;
  fareCredits: number;
  durationMs: number;
  /** Present only while the shuttle is in the air. */
  journey?: {
    routeId: string;
    originLocationId: string;
    destinationLocationId: string;
    destinationName: string;
    startedAt: string;
    arrivesAt: string;
    fareCredits: number;
  };
  /** The landed journey the player has not yet disembarked. */
  arrivalNotice?: {
    routeId: string;
    destinationLocationId: string;
    destinationName: string;
    arrivedAt: string;
  };
};

/** The character's journey row, or undefined when they have never booked. */
export async function loadPassengerJourney(
  transaction: DatabaseTransaction,
  characterId: string,
  options: { lock?: boolean } = {},
): Promise<CharacterPassengerJourney | undefined> {
  const query = transaction
    .select()
    .from(characterPassengerJourneys)
    .where(eq(characterPassengerJourneys.characterId, characterId));
  const rows = await (options.lock ? query.for("update") : query);
  return rows[0];
}

/**
 * Whether this character has ever landed at Stillreach on their own Rivet.
 *
 * Read from the durable landing receipt that flight wrote in the same
 * transaction that committed it. A receipt is only ever dismissed, never
 * deleted, so this stays true after the player has flown home to Skatboll and
 * cleared the notice. It is deliberately not inferred from where the ship is
 * berthed now, and no second flag records it.
 */
export async function loadPassengerUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ id: shipArrivalNotices.id })
    .from(shipArrivalNotices)
    .where(
      and(
        eq(shipArrivalNotices.characterId, characterId),
        eq(shipArrivalNotices.routeId, PASSENGER_UNLOCK_SHIP_ROUTE_ID),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The passenger journey resolver (#404).
 *
 * Like a Rivet flight, a journey is a blocking one-active-action state resolved
 * lazily on the next authenticated read or command, with no per-character
 * background timer, and it is scheduled by its recorded absolute arrival instant
 * rather than a tick count: it was fixed at booking and is immutable, so the
 * generic offline-work cap cannot delay a landing.
 *
 * Landing is one transactional resolution: only the character's location moves,
 * the journey row is stamped landed (which is also the durable arrival receipt),
 * and the action ends. Nothing else is read or written: no ship, no fuel, no
 * Cargo Hold, no Inventory, no Equipment, no Credits. The character's carried
 * belongings follow because they belong to the character. Anything inconsistent
 * throws, rolling the transaction back with the character and the journey
 * untouched.
 */
export type PassengerJourneyResolution = { arrived: boolean };

export type PassengerArrival = {
  routeId: string;
  destinationLocationId: string;
  arrivedAt: Date;
};

export function createPassengerTravelResolver(
  onArrival?: (arrival: PassengerArrival) => void,
): ActionResolver<{ journey: CharacterPassengerJourney | undefined }, PassengerJourneyResolution> {
  return {
    supports: (action): boolean => action.actionId === ACTION_IDS.passengerTravel,
    load: async (transaction, { character }) => ({
      journey: await loadPassengerJourney(transaction, character.id, { lock: true }),
    }),
    resolve: ({ snapshot, window }) => {
      const journey = snapshot.journey;
      // A journey action without an in-flight journey is corrupt state; do not
      // silently complete it.
      if (!journey || journey.landedAt) {
        throw new PassengerRuleError("Active passenger journey has no recorded journey.");
      }
      const arrived = window.availableThroughAt.getTime() >= journey.arrivesAt.getTime();
      return {
        outcome: { arrived },
        transition: arrived
          ? { kind: "stop", consumedTicks: window.elapsedTicks }
          : { kind: "continue", consumedTicks: window.elapsedTicks },
      };
    },
    persist: async (transaction, outcome, context) => {
      if (!outcome.arrived || !context) return;
      const arrival = await commitPassengerArrival(transaction, context.character.id);
      onArrival?.(arrival);
    },
  };
}

async function commitPassengerArrival(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<PassengerArrival> {
  const journey = await loadPassengerJourney(transaction, characterId, { lock: true });
  if (!journey || journey.landedAt) {
    throw new PassengerRuleError("Active passenger journey has no recorded journey.");
  }
  if (!isPassengerJourneyValid(journey) || !getLocation(journey.destinationLocationId)) {
    throw new PassengerRuleError(`Persisted passenger route is not valid: ${journey.routeId}`);
  }
  // The character row is locked FOR UPDATE by the command boundary; re-read it
  // so the check does not depend on a frozen snapshot.
  const [row] = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!row || row.currentLocationId !== journey.originLocationId) {
    throw new PassengerRuleError(
      `Character location (${row?.currentLocationId}) does not match the journey origin (${journey.originLocationId}).`,
    );
  }
  // The scheduled arrival instant is the landing's own timestamp: deterministic
  // across retries, so the receipt can never be minted twice.
  const arrivedAt = journey.arrivesAt;
  await transaction
    .update(characterPassengerJourneys)
    .set({ landedAt: arrivedAt })
    .where(eq(characterPassengerJourneys.characterId, characterId));
  await transaction
    .update(characters)
    .set({ currentLocationId: journey.destinationLocationId })
    .where(eq(characters.id, characterId));
  return {
    routeId: journey.routeId,
    destinationLocationId: journey.destinationLocationId,
    arrivedAt,
  };
}

/** Dismiss the landed journey's receipt. Idempotent; presentation only. */
export async function acknowledgePassengerArrivalRow(
  transaction: DatabaseTransaction,
  input: { characterId: string; now: Date },
): Promise<boolean> {
  const updated = await transaction
    .update(characterPassengerJourneys)
    .set({ acknowledgedAt: input.now })
    .where(
      and(
        eq(characterPassengerJourneys.characterId, input.characterId),
        isNotNull(characterPassengerJourneys.landedAt),
        isNull(characterPassengerJourneys.acknowledgedAt),
      ),
    )
    .returning({ characterId: characterPassengerJourneys.characterId });
  return updated.length > 0;
}

/**
 * Project the passage for the Play state. The journey is shown only while the
 * character's active action really is a passenger journey, so a stray row can
 * never present a shuttle that nothing will land.
 */
export async function projectPassenger(
  transaction: DatabaseTransaction,
  input: { characterId: string; action: { actionId: string } | undefined },
): Promise<PassengerProjection> {
  const [journey, unlocked] = await Promise.all([
    loadPassengerJourney(transaction, input.characterId),
    loadPassengerUnlocked(transaction, input.characterId),
  ]);
  const base = {
    unlocked,
    fareCredits: passengerFareCredits(),
    durationMs: passengerJourneyDurationMs(),
  };
  if (!journey || !getPassengerRoute(journey.routeId)) return base;
  const destinationName =
    getLocation(journey.destinationLocationId)?.displayName ?? journey.destinationLocationId;
  if (!journey.landedAt) {
    return input.action?.actionId === ACTION_IDS.passengerTravel
      ? {
          ...base,
          journey: {
            routeId: journey.routeId,
            originLocationId: journey.originLocationId,
            destinationLocationId: journey.destinationLocationId,
            destinationName,
            startedAt: journey.startedAt.toISOString(),
            arrivesAt: journey.arrivesAt.toISOString(),
            fareCredits: journey.fareCredits,
          },
        }
      : base;
  }
  return journey.acknowledgedAt
    ? base
    : {
        ...base,
        arrivalNotice: {
          routeId: journey.routeId,
          destinationLocationId: journey.destinationLocationId,
          destinationName,
          arrivedAt: journey.landedAt.toISOString(),
        },
      };
}
