import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  characterMissions,
  characterShips,
  characters,
  shipArrivalNotices,
  type Character,
  type CharacterShip,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getShipFlightBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, type ShipRouteId } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { MISSIONS, getMission } from "@/game/content/missions";
import { getShipRoute, SHIP_ROUTES, shipRoutesFrom } from "@/game/content/ship-routes";
import {
  INITIAL_SHIP_BERTH_LOCATION_ID,
  launchRefusalMessage,
  planLaunch,
  shipFlightDurationMs,
  shipReturnFuelShortfall,
  validateShipRoutes,
  type LaunchRefusalReason,
} from "@/game/domain/ship";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";

// An authored route that references an unknown location or has no approved cost
// fails at module load, not when a player first boards.
validateShipRoutes(SHIP_ROUTES);

/** A recorded integrity failure: the transaction rolls back and the flight stays as it was. */
export class ShipRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipRuleError";
  }
}

/** Everything the Ship panel reads about the character's ship (#358). */
export type ShipProjection = {
  /** The ship's actual physical berth. Moves only when a landing commits. */
  berthLocationId: string;
  berthName: string;
  fuelUnits: number;
  tankCapacityFuelUnits: number;
  /** Fuel Units one Full Small Fuel Canister adds. */
  canisterFuelUnits: number;
  /** Full Small Fuel Canisters available to each of the two load actions. */
  canisters: { inventory: number; cargoHold: number };
  /** Present only while the ship is in the air. */
  flight?: {
    routeId: string;
    originLocationId: string;
    destinationLocationId: string;
    destinationName: string;
    startedAt: string;
    arrivesAt: string;
    fuelCostFuelUnits: number;
  };
  /** The authored routes that depart from the ship's current berth. */
  routes: readonly {
    routeId: string;
    destinationLocationId: string;
    destinationName: string;
    fuelCostFuelUnits: number;
    durationMs: number;
    launchNotice: string;
    /**
     * Present when the tank would land holding less than the authored flight
     * back costs (#375). A warning only: it never blocks the launch, and nothing
     * refuels the ship for free at the other end.
     */
    returnFuelWarning?: { fuelAfterArrival: number; returnFuelCostFuelUnits: number };
    /** Why a launch would be refused right now, when it would be. */
    launchRefusal?: { reason: LaunchRefusalReason; message: string };
  }[];
  /** The oldest landing receipt the player has not dismissed yet. */
  arrivalNotice?: {
    noticeId: string;
    routeId: string;
    destinationLocationId: string;
    destinationName: string;
    arrivedAt: string;
    completedMissionId?: string;
    completedMissionTitle?: string;
  };
};

/** The ship row, or undefined for a character whose ship has never been touched. */
export async function loadShipRow(
  transaction: DatabaseTransaction,
  characterId: string,
  options: { lock?: boolean } = {},
): Promise<CharacterShip | undefined> {
  const query = transaction
    .select()
    .from(characterShips)
    .where(eq(characterShips.characterId, characterId));
  const rows = await (options.lock ? query.for("update") : query);
  return rows[0];
}

/**
 * The locked ship row, created at its untouched defaults the first time it is
 * needed. Absence means "Crash Site, empty tank", so no character is backfilled.
 */
export async function ensureShipRow(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<CharacterShip> {
  await transaction
    .insert(characterShips)
    .values({
      characterId,
      berthLocationId: INITIAL_SHIP_BERTH_LOCATION_ID,
      fuelUnits: getEffectiveGameBalance().ship.startingFuelUnits,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const row = await loadShipRow(transaction, characterId, { lock: true });
  if (!row) throw new ShipRuleError("The ship row could not be created.");
  return row;
}

/** The ship's berth for a character, with the untouched default for a missing row. */
export async function loadShipBerthLocationId(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const row = await loadShipRow(transaction, characterId);
  return row?.berthLocationId ?? INITIAL_SHIP_BERTH_LOCATION_ID;
}

/**
 * The Rivet flight resolver (#358).
 *
 * Like Travel, a flight is a blocking one-active-action state resolved lazily
 * on the next authenticated read or command, with no per-character background
 * timer. Unlike Travel, the schedule is the recorded absolute arrival instant,
 * not a tick count: it was fixed once at launch and is immutable, so the
 * generic offline-work cap cannot delay a landing — a return three hours after a
 * 15-second flight lands immediately, because the capped window still ends long
 * after the arrival instant.
 *
 * Arrival is one transactional resolution: the character, the ship (and with it
 * the attached Cargo Hold, whose access follows the berth) relocate together, a
 * Mission authored to complete on this flight is stamped complete, the flight
 * state is cleared, and the durable arrival receipt is written. Fuel was spent
 * at launch and is never touched here. Anything inconsistent throws, rolling
 * the transaction back with the character, the ship and the flight untouched.
 */
export type ShipFlightResolution = {
  arrived: boolean;
};

export function createShipFlightResolver(
  onArrival?: (arrival: ShipArrival) => void,
): ActionResolver<{ ship: CharacterShip | undefined }, ShipFlightResolution> {
  return {
    supports: (action): boolean => action.actionId === ACTION_IDS.shipFlight,
    load: async (transaction, { character }) => ({
      ship: await loadShipRow(transaction, character.id, { lock: true }),
    }),
    resolve: ({ snapshot, window }) => {
      const arrivesAt = snapshot.ship?.flightArrivesAt;
      // A flight action without a recorded flight is corrupt state; do not
      // silently complete it.
      if (!arrivesAt) throw new ShipRuleError("Active ship flight has no recorded flight.");
      const arrived = window.availableThroughAt.getTime() >= arrivesAt.getTime();
      return {
        outcome: { arrived },
        transition: arrived
          ? { kind: "stop", consumedTicks: window.elapsedTicks }
          : { kind: "continue", consumedTicks: window.elapsedTicks },
      };
    },
    persist: async (transaction, outcome, context) => {
      if (!outcome.arrived || !context) return;
      const arrival = await commitShipArrival(transaction, context.character);
      onArrival?.(arrival);
    },
  };
}

export type ShipArrival = {
  routeId: ShipRouteId;
  destinationLocationId: string;
  arrivedAt: Date;
  completedMissionId?: string;
};

async function commitShipArrival(
  transaction: DatabaseTransaction,
  character: Pick<Character, "id">,
): Promise<ShipArrival> {
  const ship = await loadShipRow(transaction, character.id, { lock: true });
  if (
    !ship ||
    !ship.flightRouteId ||
    !ship.flightOriginLocationId ||
    !ship.flightDestinationLocationId ||
    !ship.flightArrivesAt
  ) {
    throw new ShipRuleError("Active ship flight has no recorded flight.");
  }
  const route = getShipRoute(ship.flightRouteId);
  if (
    !route ||
    route.originLocationId !== ship.flightOriginLocationId ||
    route.destinationLocationId !== ship.flightDestinationLocationId ||
    !getLocation(route.destinationLocationId)
  ) {
    throw new ShipRuleError(`Persisted flight route is not valid: ${ship.flightRouteId}`);
  }
  // The character row is locked FOR UPDATE by the command boundary; re-read it
  // so the check does not depend on a frozen snapshot.
  const [row] = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, character.id))
    .limit(1);
  if (!row || row.currentLocationId !== route.originLocationId) {
    throw new ShipRuleError(
      `Character location (${row?.currentLocationId}) does not match the flight origin (${route.originLocationId}).`,
    );
  }
  // The scheduled arrival instant is the landing's own timestamp: deterministic
  // across retries, so the receipt and the Mission stamp can never be minted twice.
  const arrivedAt = ship.flightArrivesAt;

  await transaction
    .update(characterShips)
    .set({
      berthLocationId: route.destinationLocationId,
      flightRouteId: null,
      flightOriginLocationId: null,
      flightDestinationLocationId: null,
      flightStartedAt: null,
      flightArrivesAt: null,
      updatedAt: arrivedAt,
    })
    .where(eq(characterShips.characterId, character.id));
  await transaction
    .update(characters)
    .set({ currentLocationId: route.destinationLocationId })
    .where(eq(characters.id, character.id));

  // The first non-NPC, gameplay-triggered Mission completion: only a Mission
  // that authors this exact flight as its completion, only if it was accepted,
  // and only once (the stamp is guarded by `completed_at IS NULL`).
  let completedMissionId: string | undefined;
  for (const mission of MISSIONS) {
    if (
      mission.autoCompletion?.kind !== "ship_flight" ||
      mission.autoCompletion.routeId !== route.id
    ) {
      continue;
    }
    const stamped = await transaction
      .update(characterMissions)
      .set({ completedAt: arrivedAt })
      .where(
        and(
          eq(characterMissions.characterId, character.id),
          eq(characterMissions.missionId, mission.id),
          isNotNull(characterMissions.acceptedAt),
          isNull(characterMissions.completedAt),
        ),
      )
      .returning({ missionId: characterMissions.missionId });
    if (stamped.length > 0) completedMissionId ??= mission.id;
  }

  // A newer landing supersedes any receipt the player never dismissed (#375):
  // with repeatable flights, an old "Arrived at Holo Hollow Landing" must never
  // greet a player who has just landed somewhere else. Superseding stamps the
  // older receipt dismissed at this arrival's instant; the arrival and any
  // Mission it completed are untouched, as for any dismissal.
  await transaction
    .update(shipArrivalNotices)
    .set({ acknowledgedAt: arrivedAt })
    .where(
      and(
        eq(shipArrivalNotices.characterId, character.id),
        isNull(shipArrivalNotices.acknowledgedAt),
      ),
    );
  await transaction
    .insert(shipArrivalNotices)
    .values({
      characterId: character.id,
      routeId: route.id,
      destinationLocationId: route.destinationLocationId,
      completedMissionId: completedMissionId ?? null,
      arrivedAt,
    })
    .onConflictDoNothing();

  return {
    routeId: route.id,
    destinationLocationId: route.destinationLocationId,
    arrivedAt,
    ...(completedMissionId ? { completedMissionId } : {}),
  };
}

/** Dismiss one arrival receipt. Idempotent; presentation only. */
export async function acknowledgeArrivalNotice(
  transaction: DatabaseTransaction,
  input: { characterId: string; noticeId: string; now: Date },
): Promise<boolean> {
  const updated = await transaction
    .update(shipArrivalNotices)
    .set({ acknowledgedAt: input.now })
    .where(
      and(
        eq(shipArrivalNotices.id, input.noticeId),
        eq(shipArrivalNotices.characterId, input.characterId),
        isNull(shipArrivalNotices.acknowledgedAt),
      ),
    )
    .returning({ id: shipArrivalNotices.id });
  return updated.length > 0;
}

/**
 * Project the ship for the Play state. Every input is a fact `stateFromTransaction`
 * already loaded, so the launch verdict shown to the player is the same
 * `planLaunch` the launch command re-runs, from the same facts.
 */
export async function projectShip(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    /** The ship row `stateFromTransaction` already read, or undefined for an untouched ship. */
    ship: CharacterShip | undefined;
    currentLocationId: string;
    action: { actionId: string } | undefined;
    completedRepairTargetIds: ReadonlySet<string>;
    completedMissionIds: ReadonlySet<string>;
    acceptedMissionIds: ReadonlySet<string>;
    carriedFullCanisters: number;
    cargoFullCanisters: number;
  },
): Promise<ShipProjection> {
  const balance = getEffectiveGameBalance();
  const { ship } = input;
  const [notice] = await transaction
    .select()
    .from(shipArrivalNotices)
    .where(
      and(
        eq(shipArrivalNotices.characterId, input.characterId),
        isNull(shipArrivalNotices.acknowledgedAt),
      ),
    )
    .orderBy(asc(shipArrivalNotices.arrivedAt), asc(shipArrivalNotices.id))
    .limit(1);
  const berthLocationId = ship?.berthLocationId ?? INITIAL_SHIP_BERTH_LOCATION_ID;
  const fuelUnits = ship?.fuelUnits ?? balance.ship.startingFuelUnits;
  const flightRoute = ship?.flightRouteId ? getShipRoute(ship.flightRouteId) : undefined;
  const inFlight =
    input.action?.actionId === ACTION_IDS.shipFlight &&
    ship?.flightArrivesAt != null &&
    ship.flightStartedAt != null &&
    flightRoute !== undefined;

  return {
    berthLocationId,
    berthName: getLocation(berthLocationId)?.displayName ?? berthLocationId,
    fuelUnits,
    tankCapacityFuelUnits: balance.ship.tankCapacityFuelUnits,
    canisterFuelUnits: balance.items.fullSmallFuelCanister.fuelUnits,
    canisters: { inventory: input.carriedFullCanisters, cargoHold: input.cargoFullCanisters },
    ...(inFlight && ship?.flightArrivesAt && ship.flightStartedAt && flightRoute
      ? {
          flight: {
            routeId: flightRoute.id,
            originLocationId: flightRoute.originLocationId,
            destinationLocationId: flightRoute.destinationLocationId,
            destinationName:
              getLocation(flightRoute.destinationLocationId)?.displayName ??
              flightRoute.destinationLocationId,
            startedAt: ship.flightStartedAt.toISOString(),
            arrivesAt: ship.flightArrivesAt.toISOString(),
            fuelCostFuelUnits: getShipFlightBalance(flightRoute.id).fuelCostFuelUnits,
          },
        }
      : {}),
    routes: inFlight
      ? []
      : shipRoutesFrom(berthLocationId).map((route) => {
          const flight = getShipFlightBalance(route.id);
          const plan = planLaunch(route.id, {
            characterLocationId: input.currentLocationId,
            shipBerthLocationId: berthLocationId,
            inFlight: false,
            characterBusy: input.action !== undefined,
            fuelUnits,
            completedRepairTargetIds: input.completedRepairTargetIds,
            completedMissionIds: input.completedMissionIds,
            acceptedMissionIds: input.acceptedMissionIds,
          });
          // A launch already refused for fuel says so; the warning is only for
          // a launch that would go ahead.
          const shortfall =
            !plan.ok && plan.reason === "insufficient_fuel"
              ? undefined
              : shipReturnFuelShortfall(route, fuelUnits);
          return {
            routeId: route.id,
            destinationLocationId: route.destinationLocationId,
            destinationName:
              getLocation(route.destinationLocationId)?.displayName ?? route.destinationLocationId,
            fuelCostFuelUnits: flight.fuelCostFuelUnits,
            durationMs: shipFlightDurationMs(route.id),
            launchNotice: route.launchNotice,
            ...(shortfall ? { returnFuelWarning: shortfall } : {}),
            ...(plan.ok
              ? {}
              : {
                  launchRefusal: {
                    reason: plan.reason,
                    message: launchRefusalMessage(plan.reason, route),
                  },
                }),
          };
        }),
    ...(notice
      ? {
          arrivalNotice: {
            noticeId: notice.id,
            routeId: notice.routeId,
            destinationLocationId: notice.destinationLocationId,
            destinationName:
              getLocation(notice.destinationLocationId)?.displayName ??
              notice.destinationLocationId,
            arrivedAt: notice.arrivedAt.toISOString(),
            ...(notice.completedMissionId
              ? {
                  completedMissionId: notice.completedMissionId,
                  completedMissionTitle:
                    getMission(notice.completedMissionId)?.title ?? notice.completedMissionId,
                }
              : {}),
          },
        }
      : {}),
  };
}

/** The Full Small Fuel Canister item the two load actions consume. */
export const FUEL_CANISTER_ITEM_ID = ITEM_IDS.fullSmallFuelCanister;
