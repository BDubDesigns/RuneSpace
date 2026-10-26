import type { ShipProjection } from "@/server/ship-state";
import type { PassengerProjection } from "@/server/passenger-state";

/** An untouched Rivet at the Crash Site with an empty tank (#358), for state fixtures. */
export const EMPTY_SHIP_PROJECTION: ShipProjection = {
  berthLocationId: "crash_site",
  berthName: "Crash Site",
  fuelUnits: 0,
  tankCapacityFuelUnits: 300,
  canisterFuelUnits: 50,
  canisters: { inventory: 0, cargoHold: 0 },
  routes: [],
};

/** A character who has never booked passage and whose service is not yet unlocked (#404). */
export const EMPTY_PASSENGER_PROJECTION: PassengerProjection = {
  unlocked: false,
  fareCredits: 200,
  durationMs: 180_000,
};
