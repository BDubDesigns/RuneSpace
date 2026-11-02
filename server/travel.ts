import { eq } from "drizzle-orm";
import {
  activeActions,
  characters,
  characterTravelState,
  type CharacterTravelState,
} from "@/db/rune-space";
import { ACTION_IDS, type TravelMode } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { scavengeOpportunityStartTick } from "@/game/domain/scavenge";
import {
  chainWalkingRouteLegs,
  isTravelRouteValid,
  planTravel,
  remainingRouteLocationIds,
  resolveTravel,
  travelDurationTicks,
  type TravelState,
  type WalkingRouteLeg,
} from "@/game/domain/travel";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { loadLocationStateFacts } from "@/server/location-state";
import type { LocationStateFacts } from "@/game/domain/location-state";

export class TravelRuleError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "unknown_destination"
      | "same_location"
      | "not_adjacent"
      | "already_traveling"
      | "unknown_route",
  ) {
    super(message);
    this.name = "TravelRuleError";
  }
}

export type TravelSnapshot = {
  travel: CharacterTravelState | undefined;
  /**
   * The destination's location-state facts, loaded with the travel row so
   * arrival validation can refuse a Journey into somewhere the character may
   * not currently enter (#209). Acceptance is permanent today, so this is a
   * guard rather than a reachable regression — but it means reachability is
   * checked at arrival by the same rule that checked it at departure.
   */
  locationStateFacts: LocationStateFacts;
};

export type TravelResolution = {
  arrived: boolean;
  /**
   * Route To (#450): the legs that follow the arrived one, already on the
   * authoritative timeline. Every `arrivedLegs` entry arrived inside this same
   * resolution window (an offline catch-up); `activeLeg` is the leg the
   * character is now walking. Absent for an ordinary walk or ride, and when
   * the arrived leg was a route's last.
   */
  routeContinuation?: {
    routeLocationIds: readonly string[];
    arrivedLegs: readonly WalkingRouteLeg[];
    activeLeg?: WalkingRouteLeg;
  };
};

/** The one random source a walking leg needs: its Scavenge window roll. */
export type TravelRandom = { nextBasisPoints(): number };

/**
 * End the active Journey without arriving: delete the Travel action and its
 * `characterTravelState` row, nothing more. The one shared seam for an operator
 * force-idle and the player's own Turn Back (#312), so the two can never drift.
 *
 * `characters.current_location_id` is the authoritative origin for the whole
 * Journey and is never touched here, so the character stays where they left.
 * Committed `characterScavengeReveals` are preserved; an unclaimed Scavenge
 * opportunity lives on the travel row and disappears with it. Callers decide
 * what else the cancellation means (Scavenge suppression is the player
 * command's rule, not an operator's).
 */
export async function clearActiveJourney(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
  await transaction
    .delete(characterTravelState)
    .where(eq(characterTravelState.characterId, characterId));
}

/**
 * The Travel resolver is a blocking one-active-action resolver. It owns no
 * progression of its own; arrival simply commits the destination as the new
 * authoritative location and clears the travel state, exactly once.
 *
 * Before commuting arrival, all persisted state is validated against the
 * authoritative location registry. Missing, malformed, inconsistent, or
 * manipulated Travel state raises a server-side integrity failure that
 * rolls back the transaction and preserves the current character location
 * and the active Travel action.
 */
export function createTravelResolver(
  random: TravelRandom,
): ActionResolver<TravelSnapshot, TravelResolution> {
  return {
    supports: (action): boolean => action.actionId === ACTION_IDS.travel,
    load: async (transaction, { character }) => {
      const rows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, character.id))
        .for("update");
      return {
        travel: rows[0],
        locationStateFacts: await loadLocationStateFacts(transaction, character.id),
      };
    },
    resolve: ({ action, snapshot, window }) => {
      // A Travel action without a travel state row is corrupted state.
      // Do not silently complete the action — throw so the transaction rolls
      // back, preserving the character location and the active action.
      if (!snapshot.travel) {
        throw new TravelRuleError(
          "Active Travel action has no corresponding travel state row",
          "unknown_destination",
        );
      }
      // The active action's startedAt is the sole authoritative Travel start
      // time; the travel row stores route data and the optional Scavenge state.
      const startedAt = new Date(action.startedAt.getTime());
      const mode = snapshot.travel.mode as TravelMode;
      const travel: TravelState = {
        originLocationId: snapshot.travel.originLocationId as TravelState["originLocationId"],
        destinationLocationId: snapshot.travel
          .destinationLocationId as TravelState["destinationLocationId"],
        mode,
        startedAt,
        arrivesAt: new Date(startedAt.getTime() + ticksToMilliseconds(travelDurationTicks(mode))),
      };
      const result = resolveTravel({
        travel,
        windowStartsAt: window.startsAt,
        elapsedTicks: window.elapsedTicks,
        alreadyConsumedTicks: Math.round(
          (action.resolvedThroughAt.getTime() - action.startedAt.getTime()) /
            ticksToMilliseconds(1),
        ),
      });
      if (!result.arrived) {
        return {
          outcome: { arrived: false },
          transition: { kind: "continue", consumedTicks: result.consumedTicks },
        };
      }

      // Route To (#450): an arrived leg of a route chains straight into the
      // next ordinary walk, starting at this leg's own arrival instant. Every
      // further leg already due inside this window (an offline return) arrives
      // in order here too, so no committed location is ever skipped and no leg
      // is shorter or longer than a walk.
      const remaining =
        mode === "walk" && snapshot.travel.routeLocationIds
          ? remainingRouteLocationIds({
              routeLocationIds: snapshot.travel.routeLocationIds,
              originLocationId: travel.originLocationId,
              destinationLocationId: travel.destinationLocationId,
            })
          : undefined;
      if (!remaining || remaining.length === 0) {
        return {
          outcome: { arrived: true },
          transition: { kind: "stop", consumedTicks: result.consumedTicks },
        };
      }
      const chain = chainWalkingRouteLegs({
        arrivedAt: travel.arrivesAt,
        fromLocationId: travel.destinationLocationId,
        remainingLocationIds: remaining,
        availableThroughAt: window.availableThroughAt,
        // Each leg is held to exactly the rule an ordinary Walk is, with this
        // character's own location-state facts.
        canWalk: (originLocationId, destinationLocationId) =>
          planTravel({
            currentLocationId: originLocationId,
            destinationLocationId,
            alreadyTraveling: false,
            locationStateFacts: snapshot.locationStateFacts as LocationStateFacts,
          }).ok,
      });
      const outcome: TravelResolution = {
        arrived: true,
        routeContinuation: {
          routeLocationIds: [...snapshot.travel.routeLocationIds!],
          arrivedLegs: chain.arrivedLegs,
          ...(chain.activeLeg ? { activeLeg: chain.activeLeg } : {}),
        },
      };
      if (!chain.activeLeg) {
        // The whole rest of the route arrived inside this window, or the next
        // leg was refused: the Journey ends where the last arrival left it.
        return {
          outcome,
          transition: { kind: "stop", consumedTicks: result.consumedTicks },
        };
      }
      // The active leg is a fresh Travel action from its own start instant.
      // The cursor consumes the whole window, which ends no earlier than that
      // start: every leg before it arrived inside this window.
      return {
        outcome,
        transition: {
          kind: "replace",
          consumedTicks: window.elapsedTicks,
          action: { actionId: ACTION_IDS.travel, startedAt: chain.activeLeg.startedAt },
        },
      };
    },
    persist: async (transaction, outcome, context) => {
      if (!outcome.arrived || !context) return;

      const travelRows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id))
        .limit(1);
      const travel = travelRows[0];

      // A Travel action reaching the persist step with no travel state row is
      // corrupt state. Throw so the transaction rolls back, preserving the
      // character location and active action.
      if (!travel) {
        throw new TravelRuleError(
          "Active Travel action has no corresponding travel state row",
          "unknown_destination",
        );
      }

      await commitTravelArrival(transaction, context.character.id, travel);

      // Route To (#450): each following leg begins as an ordinary walk at the
      // previous leg's arrival instant, with its own single Scavenge window
      // roll. The walking arrival just committed lifted any Turn Back
      // suppression, exactly as it does for a Walk, so every chained leg rolls.
      // A leg that also arrived inside this window commits in order, so the
      // character genuinely stands at each intermediate hex before leaving it;
      // its window is long past and nothing is ever claimed on its behalf.
      const continuation = outcome.routeContinuation;
      if (!continuation) return;
      const legs = [
        ...continuation.arrivedLegs.map((leg) => ({ leg, arrived: true })),
        ...(continuation.activeLeg ? [{ leg: continuation.activeLeg, arrived: false }] : []),
      ];
      for (const { leg, arrived } of legs) {
        const [legRow] = await transaction
          .insert(characterTravelState)
          .values({
            characterId: context.character.id,
            originLocationId: leg.originLocationId,
            destinationLocationId: leg.destinationLocationId,
            mode: "walk",
            scavengeOpportunityStartTick: scavengeOpportunityStartTick(random.nextBasisPoints()),
            routeLocationIds: [...continuation.routeLocationIds],
          })
          .returning();
        if (arrived && legRow) await commitTravelArrival(transaction, context.character.id, legRow);
      }
    },
  };
}

/**
 * Commit one Journey's arrival exactly once: validate the persisted leg against
 * the authoritative registry and the character's own location, move the
 * character to its destination, and clear the travel row. Any inconsistency is
 * an integrity failure that rolls the whole transaction back, preserving the
 * character location and the active action. Shared by an ordinary arrival and
 * every leg of a route (#450), so a route leg can never commit more loosely
 * than a Walk.
 */
async function commitTravelArrival(
  transaction: DatabaseTransaction,
  characterId: string,
  travel: CharacterTravelState,
): Promise<void> {
  const {
    originLocationId: storedOrigin,
    destinationLocationId: storedDestination,
    mode: storedMode,
  } = travel;

  // Validate all persisted state against the authoritative location
  // registry before committing. Any inconsistency is an integrity failure:
  // roll back the transaction, preserve the character location and action.
  const originDef = getLocation(storedOrigin);
  const destDef = getLocation(storedDestination);

  if (!originDef) {
    throw new TravelRuleError(`Unknown persisted origin: ${storedOrigin}`, "unknown_destination");
  }
  if (!destDef) {
    throw new TravelRuleError(
      `Unknown persisted destination: ${storedDestination}`,
      "unknown_destination",
    );
  }
  if (storedOrigin === storedDestination) {
    throw new TravelRuleError(
      "Persisted origin and destination are the same location",
      "same_location",
    );
  }
  // Walking is validated against map adjacency; an authored transport ride
  // is validated against its own route, which is deliberately not an
  // adjacency. Either way, an unrecognised route never commits an arrival.
  if (
    !isTravelRouteValid({
      mode: storedMode as TravelMode,
      originLocationId: storedOrigin,
      destinationLocationId: storedDestination,
      locationStateFacts: await loadLocationStateFacts(transaction, characterId),
    })
  ) {
    throw new TravelRuleError(
      `Persisted ${storedMode} route is not valid: ${storedOrigin} -> ${storedDestination}`,
      storedMode === "walk" ? "not_adjacent" : "unknown_route",
    );
  }
  // The character row was locked FOR UPDATE at the top of this transaction.
  // Its currentLocationId is the authoritative location at resolution time.
  // Re-read it inside the transaction to avoid depending on the frozen snapshot.
  const [charRow] = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!charRow || charRow.currentLocationId !== storedOrigin) {
    throw new TravelRuleError(
      `Character location (${charRow?.currentLocationId}) does not match stored travel origin (${storedOrigin})`,
      "not_adjacent",
    );
  }

  // Completing a walking Journey is the only thing that lifts Scavenge
  // suppression (#312); a ride arriving leaves it exactly as it was.
  await transaction
    .update(characters)
    .set(
      storedMode === "walk"
        ? { currentLocationId: storedDestination, scavengeSuppressed: false }
        : { currentLocationId: storedDestination },
    )
    .where(eq(characters.id, characterId));
  await transaction
    .delete(characterTravelState)
    .where(eq(characterTravelState.characterId, characterId));
}
