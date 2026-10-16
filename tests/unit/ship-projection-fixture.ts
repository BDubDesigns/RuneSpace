import type { ShipProjection } from "@/server/ship-state";

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
