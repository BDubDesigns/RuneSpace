import { eq } from "drizzle-orm";
import { characters, characterTravelState, type CharacterTravelState } from "@/db/rune-space";
import { ACTION_IDS } from "@/game/config/foundations";
import { adjacentWalkDurationTicks, resolveTravel, type TravelState } from "@/game/domain/travel";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver } from "@/server/action-resolution";

export class TravelRuleError extends Error {
  constructor(
    message: string,
    readonly reason: "unknown_destination" | "same_location" | "not_adjacent" | "already_traveling",
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
      // A concurrent resolution may have already cleared the travel row; a
      // missing row means arrival already committed, so this window is a no-op.
      if (!snapshot.travel) {
        return { outcome: { arrived: false }, transition: { kind: "stop", consumedTicks: 0 } };
      }
      const travel: TravelState = {
        originLocationId: snapshot.travel.originLocationId as TravelState["originLocationId"],
        destinationLocationId: snapshot.travel
          .destinationLocationId as TravelState["destinationLocationId"],
        startedAt: snapshot.travel.startedAt,
        arrivesAt: new Date(
          snapshot.travel.startedAt.getTime() + ticksToMilliseconds(adjacentWalkDurationTicks()),
        ),
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
      const destination = travelRows[0]?.destinationLocationId;
      if (!destination) return;
      await transaction
        .update(characters)
        .set({ currentLocationId: destination })
        .where(eq(characters.id, context.character.id));
      await transaction
        .delete(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id));
    },
  };
}
