import { eq } from "drizzle-orm";
import { characters, characterTravelState, type CharacterTravelState } from "@/db/rune-space";
import { ACTION_IDS, type TravelMode } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import {
  isTravelRouteValid,
  resolveTravel,
  travelDurationTicks,
  type TravelState,
} from "@/game/domain/travel";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver } from "@/server/action-resolution";

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
};

export type TravelResolution = {
  arrived: boolean;
};

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
export function createTravelResolver(): ActionResolver<TravelSnapshot, TravelResolution> {
  return {
    supports: (action): boolean => action.actionId === ACTION_IDS.travel,
    load: async (transaction, { character }) => {
      const rows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, character.id))
        .for("update");
      return { travel: rows[0] };
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
      return {
        outcome: { arrived: result.arrived },
        transition: result.arrived
          ? { kind: "stop", consumedTicks: result.consumedTicks }
          : { kind: "continue", consumedTicks: result.consumedTicks },
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
        throw new TravelRuleError(
          `Unknown persisted origin: ${storedOrigin}`,
          "unknown_destination",
        );
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
        .where(eq(characters.id, context.character.id))
        .limit(1);
      if (!charRow || charRow.currentLocationId !== storedOrigin) {
        throw new TravelRuleError(
          `Character location (${charRow?.currentLocationId}) does not match stored travel origin (${storedOrigin})`,
          "not_adjacent",
        );
      }

      await transaction
        .update(characters)
        .set({ currentLocationId: storedDestination })
        .where(eq(characters.id, context.character.id));
      await transaction
        .delete(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id));
    },
  };
}
