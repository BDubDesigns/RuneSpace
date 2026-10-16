import { and, asc, eq, sql } from "drizzle-orm";
import {
  activeActions,
  cargoHoldStacks,
  characterShips,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getShipFlightBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import {
  launchRefusalMessage,
  planLaunch,
  planRefuel,
  type LaunchRefusalReason,
  type RefuelSource,
} from "@/game/domain/ship";
import { getShipRoute } from "@/game/content/ship-routes";
import { withLockedOwnedCharacter, withResolvedOwnedCharacter } from "@/server/action-resolution";
import { consumeStackableItem } from "@/server/carried-inventory";
import { loadLocationStateFacts } from "@/server/location-state";
import { loadCompletedMissionIds } from "@/server/mission-state";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import { acknowledgeArrivalNotice, ensureShipRow } from "@/server/ship-state";

const NO_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

export type RefuelRefusalReason =
  | "not_at_ship"
  | "busy"
  | "ship_not_ready"
  | "tank_full"
  | "no_canister"
  | "tank_changed"
  | "confirmation_required";

export type RefuelResult = {
  state: PlayGameplayState;
  refuel:
    | {
        status: "loaded";
        source: RefuelSource;
        gainedFuelUnits: number;
        wastedFuelUnits: number;
        fuelUnits: number;
      }
    | { status: "refused"; reason: RefuelRefusalReason; message: string };
};

export type LaunchResult = {
  state: PlayGameplayState;
  launch:
    | { status: "launched"; routeId: string; arrivesAt: string }
    | { status: "refused"; reason: LaunchRefusalReason; message: string };
};

export type ShipArrivalAcknowledgmentResult = {
  state: PlayGameplayState;
  acknowledged: boolean;
};

const REFUEL_MESSAGES: Record<RefuelRefusalReason, string> = {
  not_at_ship: "Board the Rivet where it is parked to load its tank.",
  busy: "Finish what you are doing before loading the tank.",
  ship_not_ready: "The Rivet's propulsion must be restored before its tank can take fuel.",
  tank_full: "The tank is full.",
  no_canister: "No Full Small Fuel Canister is available from that source.",
  tank_changed: "The tank changed. Review the gauge and try again.",
  confirmation_required: "Confirm the exact amount to load.",
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
 * Take one Full Small Fuel Canister out of the character's attached Cargo Hold,
 * in quantity, creation and ID order so the choice is deterministic. Returns
 * false, having written nothing, when there is none.
 */
async function consumeCargoCanister(
  transaction: Parameters<typeof stateFromTransaction>[0],
  characterId: string,
  now: Date,
): Promise<boolean> {
  const [stack] = await transaction
    .select()
    .from(cargoHoldStacks)
    .where(
      and(
        eq(cargoHoldStacks.characterId, characterId),
        eq(cargoHoldStacks.itemId, ITEM_IDS.fullSmallFuelCanister),
      ),
    )
    .orderBy(asc(cargoHoldStacks.quantity), asc(cargoHoldStacks.createdAt), asc(cargoHoldStacks.id))
    .limit(1)
    .for("update");
  if (!stack) return false;
  if (stack.quantity === 1) {
    await transaction.delete(cargoHoldStacks).where(eq(cargoHoldStacks.id, stack.id));
  } else {
    await transaction
      .update(cargoHoldStacks)
      .set({ quantity: stack.quantity - 1, updatedAt: now })
      .where(eq(cargoHoldStacks.id, stack.id));
  }
  return true;
}

/**
 * Load the Rivet's tank from one of its two sources (#358).
 *
 * Everything is decided here, under the character lock and in one transaction:
 * the character must be stationary at the ship's actual berth, the chosen
 * source must really hold a Full Small Fuel Canister, and the gain and waste
 * are recomputed from the tank as it is now. Exactly one canister is consumed,
 * its empty shell is never returned, and the tank can never exceed capacity.
 * `expectedFuelUnits` makes a retried or racing tap harmless: it sees a changed
 * tank and is refused without consuming anything. A partial load (headroom
 * under one canister) also needs the player's confirmation of the exact gain.
 */
export async function refuelShip(
  userId: string,
  characterId: string,
  request: {
    source: RefuelSource;
    expectedFuelUnits: number;
    confirmedGainFuelUnits?: number | undefined;
  },
  now = new Date(),
): Promise<RefuelResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const refuse = async (
        reason: RefuelRefusalReason,
        message?: string,
      ): Promise<RefuelResult> => ({
        state: await stateOf(transaction, context.character.id, now),
        refuel: { status: "refused", reason, message: message ?? REFUEL_MESSAGES[reason] },
      });

      if (context.action) return refuse("busy");
      const ship = await ensureShipRow(transaction, context.character.id, now);
      const [row] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      if (!row || row.currentLocationId !== ship.berthLocationId) return refuse("not_at_ship");
      const facts = await loadLocationStateFacts(transaction, context.character.id);
      // The tank is part of the restored propulsion, so a wreck takes no fuel.
      if (!facts.completedRepairTargetIds.has(REPAIR_TARGET_IDS.propulsionSystem)) {
        return refuse("ship_not_ready");
      }
      if (ship.fuelUnits !== request.expectedFuelUnits) return refuse("tank_changed");

      const balance = getEffectiveGameBalance();
      const canisterFuelUnits = balance.items.fullSmallFuelCanister.fuelUnits;
      // Whether the chosen source actually holds a canister is read from the
      // rows themselves, under the same lock the consumption below uses.
      const available =
        request.source === "cargo_hold"
          ? await countCargoCanisters(transaction, context.character.id)
          : await countCarriedCanisters(transaction, context.character.id);
      const plan = planRefuel({
        fuelUnits: ship.fuelUnits,
        tankCapacityFuelUnits: balance.ship.tankCapacityFuelUnits,
        canisterFuelUnits,
        canistersAvailable: available,
      });
      if (!plan.ok) return refuse(plan.reason);
      if (plan.requiresConfirmation && request.confirmedGainFuelUnits !== plan.gainedFuelUnits) {
        return refuse(
          "confirmation_required",
          `Loading a canister now adds ${plan.gainedFuelUnits} FU and wastes ${plan.wastedFuelUnits} FU. Confirm to load it.`,
        );
      }

      if (request.source === "cargo_hold") {
        if (!(await consumeCargoCanister(transaction, context.character.id, now))) {
          return refuse("no_canister");
        }
      } else {
        const consumed = await consumeStackableItem(transaction, {
          characterId: context.character.id,
          itemId: ITEM_IDS.fullSmallFuelCanister,
          quantity: 1,
          now,
        });
        if (!consumed.ok) return refuse("no_canister");
      }
      await transaction
        .update(characterShips)
        .set({ fuelUnits: plan.fuelAfter, updatedAt: now })
        .where(eq(characterShips.characterId, context.character.id));
      return {
        state: await stateOf(transaction, context.character.id, now),
        refuel: {
          status: "loaded",
          source: request.source,
          gainedFuelUnits: plan.gainedFuelUnits,
          wastedFuelUnits: plan.wastedFuelUnits,
          fuelUnits: plan.fuelAfter,
        },
      };
    },
    now,
  );
}

async function countCarriedCanisters(
  transaction: Parameters<typeof stateFromTransaction>[0],
  characterId: string,
): Promise<number> {
  const [row] = await transaction
    .select({ total: sql<number>`coalesce(sum(${inventoryStacks.quantity}), 0)::int` })
    .from(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, characterId),
        eq(inventoryStacks.itemId, ITEM_IDS.fullSmallFuelCanister),
      ),
    );
  return row?.total ?? 0;
}

async function countCargoCanisters(
  transaction: Parameters<typeof stateFromTransaction>[0],
  characterId: string,
): Promise<number> {
  const [row] = await transaction
    .select({ total: sql<number>`coalesce(sum(${cargoHoldStacks.quantity}), 0)::int` })
    .from(cargoHoldStacks)
    .where(
      and(
        eq(cargoHoldStacks.characterId, characterId),
        eq(cargoHoldStacks.itemId, ITEM_IDS.fullSmallFuelCanister),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Launch the Rivet on an authored route (#358).
 *
 * One character-authoritative transaction decides everything: the route is
 * authored and departs from the ship's actual berth, the character is
 * stationary and idle there, the repairs and Missions are what the route
 * requires (Move Along must have been accepted), and the tank holds the fuel.
 * Fuel is deducted once, the flight's start and arrival instants are recorded
 * immutably, and the character, ship and Cargo Hold stay put until arrival
 * commits. There is no cancel, abort, refund or second launch: a retry finds the
 * flight already under way and is refused without touching anything.
 */
export async function launchShip(
  userId: string,
  characterId: string,
  routeId: string,
  now = new Date(),
): Promise<LaunchResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const refuse = async (reason: LaunchRefusalReason): Promise<LaunchResult> => ({
        state: await stateOf(transaction, context.character.id, now),
        launch: {
          status: "refused",
          reason,
          message: launchRefusalMessage(reason, getShipRoute(routeId)),
        },
      });

      const ship = await ensureShipRow(transaction, context.character.id, now);
      const [row] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const facts = await loadLocationStateFacts(transaction, context.character.id);
      const completedMissionIds = await loadCompletedMissionIds(transaction, context.character.id);
      const plan = planLaunch(routeId, {
        characterLocationId: row?.currentLocationId ?? "",
        shipBerthLocationId: ship.berthLocationId,
        inFlight: ship.flightArrivesAt != null,
        characterBusy: context.action !== undefined,
        fuelUnits: ship.fuelUnits,
        completedRepairTargetIds: facts.completedRepairTargetIds,
        completedMissionIds,
        acceptedMissionIds: facts.acceptedMissionIds,
      });
      if (!plan.ok) return refuse(plan.reason);

      const arrivesAt = new Date(now.getTime() + plan.durationMs);
      await transaction
        .update(characterShips)
        .set({
          fuelUnits: ship.fuelUnits - getShipFlightBalance(plan.route.id).fuelCostFuelUnits,
          flightRouteId: plan.route.id,
          flightOriginLocationId: plan.route.originLocationId,
          flightDestinationLocationId: plan.route.destinationLocationId,
          flightStartedAt: now,
          flightArrivesAt: arrivesAt,
          updatedAt: now,
        })
        .where(eq(characterShips.characterId, context.character.id));
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.shipFlight,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return {
        state: await stateOf(transaction, context.character.id, now),
        launch: { status: "launched", routeId: plan.route.id, arrivesAt: arrivesAt.toISOString() },
      };
    },
    now,
  );
}

/**
 * Dismiss one landing receipt (#358). Presentation only and idempotent: it
 * changes no gameplay state, a replay or a second device finds nothing left to
 * dismiss, and the arrival and any completed Mission stand regardless.
 */
export async function acknowledgeShipArrival(
  userId: string,
  characterId: string,
  noticeId: string,
  now = new Date(),
): Promise<ShipArrivalAcknowledgmentResult> {
  return withLockedOwnedCharacter(
    userId,
    characterId,
    async (transaction, context) => {
      const acknowledged = await acknowledgeArrivalNotice(transaction, {
        characterId: context.character.id,
        noticeId,
        now,
      });
      return { state: await stateOf(transaction, context.character.id, now), acknowledged };
    },
    // Presentation only: it changes no trade- or flight-relevant state.
    { allowDuringTrade: true, allowDuringFlight: true, now },
  );
}
