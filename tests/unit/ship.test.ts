import { describe, expect, it } from "vitest";
import { SHIP_TANK_CAPACITY_FUEL_UNITS } from "@/db/rune-space";
import { getEffectiveGameBalance, getShipFlightBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { MOVE_ALONG } from "@/game/content/missions";
import { getShipRoute, SHIP_ROUTES, shipRoutesFrom } from "@/game/content/ship-routes";
import { resolveLocationState, type LocationStateFacts } from "@/game/domain/location-state";
import {
  flightHasArrived,
  flightRemainingMs,
  launchRefusalMessage,
  planLaunch,
  planRefuel,
  shipFlightDurationMs,
  validateShipRoutes,
  type LaunchFacts,
} from "@/game/domain/ship";
import { GAME_TICK_MS } from "@/game/config/foundations";

const balance = getEffectiveGameBalance();
const ROUTE = SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding;

describe("approved ship numbers (#358)", () => {
  it("has a 300 FU tank that starts empty, mirrored by the database CHECK", () => {
    expect(balance.ship.tankCapacityFuelUnits).toBe(300);
    expect(balance.ship.startingFuelUnits).toBe(0);
    expect(SHIP_TANK_CAPACITY_FUEL_UNITS).toBe(balance.ship.tankCapacityFuelUnits);
    expect(balance.ship.actionId).toBe(ACTION_IDS.shipFlight);
  });

  it("makes the first flight 10 FU and 15 real seconds", () => {
    expect(getShipFlightBalance(ROUTE)).toEqual({ fuelCostFuelUnits: 10, durationSeconds: 15 });
    expect(shipFlightDurationMs(ROUTE)).toBe(15_000);
    // Unchanged from the shipped 25 ticks when durations moved to seconds (#375).
    expect(25 * GAME_TICK_MS).toBe(15_000);
  });

  it("keeps the Mission's objective copy in step with the approved cost", () => {
    expect(MOVE_ALONG.requirements[0]).toMatchObject({
      kind: "ship_fuel",
      objective: "Fuel the Rivet for the trip ({required} FU).",
    });
    expect(getShipFlightBalance(ROUTE).fuelCostFuelUnits).toBe(10);
  });

  it("loads exactly the 50 FU a Full Small Fuel Canister carries", () => {
    expect(balance.items.fullSmallFuelCanister.fuelUnits).toBe(50);
  });
});

describe("authored routes", () => {
  it("authors the first flight Crash Site to Holo Hollow Landing, with no way back", () => {
    // The first flight plus the interplanetary leg's two directions (#375).
    expect(SHIP_ROUTES).toHaveLength(3);
    const route = getShipRoute(ROUTE)!;
    expect(route.originLocationId).toBe(LOCATION_IDS.crashSite);
    expect(route.destinationLocationId).toBe(LOCATION_IDS.holoHollowLanding);
    expect(shipRoutesFrom(LOCATION_IDS.crashSite)).toEqual([route]);
    // Nothing ever flies back to the Crash Site.
    expect(
      SHIP_ROUTES.filter((entry) => entry.destinationLocationId === LOCATION_IDS.crashSite),
    ).toEqual([]);
    expect(
      shipRoutesFrom(LOCATION_IDS.holoHollowLanding).map((entry) => entry.destinationLocationId),
    ).toEqual([LOCATION_IDS.stillreachLandingStation]);
  });

  it("requires the whole ship, a reported Thrust Issues, and an accepted Move Along", () => {
    const route = getShipRoute(ROUTE)!;
    expect(route.requiredRepairTargetIds).toEqual([
      REPAIR_TARGET_IDS.cargoHold,
      REPAIR_TARGET_IDS.landingGear,
      REPAIR_TARGET_IDS.propulsionSystem,
    ]);
    expect(route.requiredCompletedMissionIds).toEqual([MISSION_IDS.thrustIssues]);
    expect(route.requiredAcceptedMissionId).toBe(MISSION_IDS.moveAlong);
  });

  it("validates, and rejects a route that departs and lands in one place", () => {
    expect(() => validateShipRoutes(SHIP_ROUTES)).not.toThrow();
    expect(() =>
      validateShipRoutes([{ ...SHIP_ROUTES[0]!, destinationLocationId: LOCATION_IDS.crashSite }]),
    ).toThrow(/same location/);
    expect(() =>
      validateShipRoutes([{ ...SHIP_ROUTES[0]!, originLocationId: "nowhere" as never }]),
    ).toThrow(/unknown location/);
    expect(() => validateShipRoutes([SHIP_ROUTES[0]!, SHIP_ROUTES[0]!])).toThrow(/more than once/);
  });
});

describe("planRefuel", () => {
  const tank = (fuelUnits: number, canistersAvailable = 1) =>
    planRefuel({
      fuelUnits,
      tankCapacityFuelUnits: 300,
      canisterFuelUnits: 50,
      canistersAvailable,
    });

  it("loads a whole canister with no confirmation when there is room for 50 FU", () => {
    expect(tank(0)).toEqual({
      ok: true,
      gainedFuelUnits: 50,
      wastedFuelUnits: 0,
      requiresConfirmation: false,
      fuelAfter: 50,
    });
    expect(tank(250)).toMatchObject({ ok: true, gainedFuelUnits: 50, requiresConfirmation: false });
  });

  it("states the exact gain and waste, and needs confirmation, for 1-49 FU of headroom", () => {
    for (const headroom of [1, 20, 49]) {
      expect(tank(300 - headroom)).toEqual({
        ok: true,
        gainedFuelUnits: headroom,
        wastedFuelUnits: 50 - headroom,
        requiresConfirmation: true,
        fuelAfter: 300,
      });
    }
  });

  it("refuses a full tank and an empty source", () => {
    expect(tank(300)).toEqual({ ok: false, reason: "tank_full" });
    expect(tank(100, 0)).toEqual({ ok: false, reason: "no_canister" });
    // A full tank wins over an empty source: the tank, not the source, is why.
    expect(tank(300, 0)).toEqual({ ok: false, reason: "tank_full" });
  });

  it("never lets the tank exceed capacity", () => {
    for (let fuel = 0; fuel <= 300; fuel += 7) {
      const plan = tank(fuel);
      if (plan.ok) expect(plan.fuelAfter).toBeLessThanOrEqual(300);
    }
  });
});

describe("planLaunch", () => {
  const ready: LaunchFacts = {
    characterLocationId: LOCATION_IDS.crashSite,
    shipBerthLocationId: LOCATION_IDS.crashSite,
    inFlight: false,
    characterBusy: false,
    fuelUnits: 10,
    completedRepairTargetIds: new Set([
      REPAIR_TARGET_IDS.cargoHold,
      REPAIR_TARGET_IDS.landingGear,
      REPAIR_TARGET_IDS.propulsionSystem,
    ]),
    completedMissionIds: new Set([MISSION_IDS.thrustIssues]),
    acceptedMissionIds: new Set([MISSION_IDS.thrustIssues, MISSION_IDS.moveAlong]),
  };

  it("launches with exactly 10 FU, charging 10 over 15 seconds", () => {
    expect(planLaunch(ROUTE, ready)).toMatchObject({
      ok: true,
      fuelCostFuelUnits: 10,
      durationMs: 15_000,
    });
  });

  it.each([
    ["unknown route", "no_such_route", ready, "unknown_route"],
    ["in flight", ROUTE, { ...ready, inFlight: true }, "in_flight"],
    ["busy", ROUTE, { ...ready, characterBusy: true }, "busy"],
    [
      "ship parked elsewhere",
      ROUTE,
      { ...ready, shipBerthLocationId: LOCATION_IDS.holoHollowLanding },
      "ship_not_berthed_here",
    ],
    [
      "character elsewhere",
      ROUTE,
      { ...ready, characterLocationId: LOCATION_IDS.holoHollowLanding },
      "not_at_berth",
    ],
    ["9 FU", ROUTE, { ...ready, fuelUnits: 9 }, "insufficient_fuel"],
    [
      "a repair missing",
      ROUTE,
      { ...ready, completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.cargoHold]) },
      "repairs_incomplete",
    ],
    [
      "Thrust Issues unreported",
      ROUTE,
      { ...ready, completedMissionIds: new Set<string>() },
      "mission_incomplete",
    ],
    [
      "Move Along not accepted",
      ROUTE,
      { ...ready, acceptedMissionIds: new Set([MISSION_IDS.thrustIssues]) },
      "mission_not_accepted",
    ],
  ] as const)("refuses %s", (_label, routeId, facts, reason) => {
    expect(planLaunch(routeId, facts)).toEqual({ ok: false, reason });
  });

  it("explains every refusal in words the Ship panel can show", () => {
    const route = getShipRoute(ROUTE)!;
    expect(launchRefusalMessage("mission_not_accepted", route)).toBe(
      "Report Thrust Issues to Wade at Rusk Recovery to start Move Along.",
    );
    expect(launchRefusalMessage("insufficient_fuel", route)).toBe(
      "The tank needs at least 10 FU to launch.",
    );
    expect(launchRefusalMessage("mission_incomplete", route)).toContain("Thrust Issues");
  });
});

describe("flight timing", () => {
  const arrivesAt = new Date("2026-10-15T12:00:15.000Z");

  it("arrives at the recorded instant and not a millisecond earlier", () => {
    expect(flightHasArrived(arrivesAt, new Date(arrivesAt.getTime() - 1))).toBe(false);
    expect(flightHasArrived(arrivesAt, arrivesAt)).toBe(true);
    expect(flightHasArrived(arrivesAt, new Date(arrivesAt.getTime() + 3 * 60 * 60 * 1000))).toBe(
      true,
    );
  });

  it("never reports a negative remaining time", () => {
    expect(flightRemainingMs(arrivesAt, new Date(arrivesAt.getTime() - 4_000))).toBe(4_000);
    expect(flightRemainingMs(arrivesAt, new Date(arrivesAt.getTime() + 4_000))).toBe(0);
  });
});

describe("the ship's berth drives the scenes", () => {
  const facts = (overrides: Partial<LocationStateFacts> = {}): LocationStateFacts => ({
    acceptedMissionIds: new Set(),
    completedRepairTargetIds: new Set(),
    ...overrides,
  });
  const crashSite = getLocation(LOCATION_IDS.crashSite)!;
  const landing = getLocation(LOCATION_IDS.holoHollowLanding)!;
  const repaired = new Set<string>([REPAIR_TARGET_IDS.propulsionSystem]);

  it("shows crashed, repaired, then empty at the Crash Site as the ship is wrecked, whole, then gone", () => {
    expect(resolveLocationState(crashSite, facts()).scene.overlay?.asset).toBe(
      "/location-scenes/rivet-crashed.webp",
    );
    expect(
      resolveLocationState(crashSite, facts({ completedRepairTargetIds: repaired })).scene.overlay
        ?.asset,
    ).toBe("/location-scenes/rivet-repaired.webp");
    const departed = resolveLocationState(
      crashSite,
      facts({
        completedRepairTargetIds: repaired,
        shipBerthLocationId: LOCATION_IDS.holoHollowLanding,
      }),
    );
    expect(departed.scene.overlay).toBeUndefined();
    expect(departed.scene.asset).toBe(crashSite.presentation.scene.asset);
  });

  it("treats a missing berth as an untouched ship at the Crash Site", () => {
    const untouched = resolveLocationState(
      crashSite,
      facts({ completedRepairTargetIds: repaired }),
    );
    const explicit = resolveLocationState(
      crashSite,
      facts({ completedRepairTargetIds: repaired, shipBerthLocationId: LOCATION_IDS.crashSite }),
    );
    expect(untouched.variantId).toBe(explicit.variantId);
  });

  it("shows the Rivet on the pad only while it is berthed there, over the same pano", () => {
    const empty = resolveLocationState(landing, facts());
    const berthed = resolveLocationState(
      landing,
      facts({ shipBerthLocationId: LOCATION_IDS.holoHollowLanding }),
    );
    expect(empty.scene.overlay).toBeUndefined();
    expect(berthed.scene.overlay?.asset).toBe("/location-scenes/rivet-repaired.webp");
    // No bespoke art: the same pano file, the same 4:1 canvas.
    expect(berthed.scene.asset).toBe(empty.scene.asset);
    expect(`${berthed.scene.width}x${berthed.scene.height}`).toBe("1536x384");
    // The ship never leaves its canvas.
    const { placement } = berthed.scene.overlay!;
    const heightPercent =
      (placement.width * (1536 / 384) * berthed.scene.overlay!.height) /
      berthed.scene.overlay!.width;
    expect(placement.left + placement.width).toBeLessThanOrEqual(100);
    expect(placement.top + heightPercent).toBeLessThanOrEqual(100);
  });

  it("is untouched by where the character stands: only the ship's berth counts", () => {
    // A character who walked to the Landing but never flew still has the empty pad.
    expect(resolveLocationState(landing, facts()).scene.overlay).toBeUndefined();
  });

  it("uses the fuel canister item the tank is loaded from", () => {
    expect(ITEM_IDS.fullSmallFuelCanister).toBeDefined();
  });
});
