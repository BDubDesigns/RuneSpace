import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import {
  LOCATIONS,
  areLocationsAdjacent,
  getLocation,
  isActionAvailableAtLocation,
} from "@/game/content/locations";
import { ACTION_IDS } from "@/game/config/foundations";

describe("issue #47 location content", () => {
  it("defaults new characters to the Crash Site matching the migration backfill", () => {
    // The committed migration uses the literal 'crash_site' default; keep the
    // authoritative constant and the persistent default in lockstep.
    expect(LOCATION_IDS.crashSite).toBe("crash_site");
  });

  it("resolves exactly the three approved local locations", () => {
    expect(LOCATIONS.map((l) => l.id).sort()).toEqual(
      [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.abandonedProcessingYard,
        LOCATION_IDS.emergencyPowerAnnex,
      ].sort(),
    );
    expect(getLocation(LOCATION_IDS.crashSite)?.displayName).toBe("Crash Site");
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.displayName).toBe(
      "Abandoned Processing Yard",
    );
    expect(getLocation(LOCATION_IDS.emergencyPowerAnnex)?.displayName).toBe(
      "DeWhat? Emergency Power Annex",
    );
  });

  it("adjacency is authoritative and bidirectional", () => {
    expect(areLocationsAdjacent(LOCATION_IDS.crashSite, LOCATION_IDS.abandonedProcessingYard)).toBe(
      true,
    );
    expect(areLocationsAdjacent(LOCATION_IDS.abandonedProcessingYard, LOCATION_IDS.crashSite)).toBe(
      true,
    );
    expect(areLocationsAdjacent(LOCATION_IDS.crashSite, LOCATION_IDS.emergencyPowerAnnex)).toBe(
      true,
    );
    expect(areLocationsAdjacent(LOCATION_IDS.emergencyPowerAnnex, LOCATION_IDS.crashSite)).toBe(
      true,
    );
    expect(
      areLocationsAdjacent(LOCATION_IDS.abandonedProcessingYard, LOCATION_IDS.emergencyPowerAnnex),
    ).toBe(true);
    expect(
      areLocationsAdjacent(LOCATION_IDS.emergencyPowerAnnex, LOCATION_IDS.abandonedProcessingYard),
    ).toBe(true);
    // No other edges exist in the initial world.
    expect(areLocationsAdjacent(LOCATION_IDS.crashSite, LOCATION_IDS.crashSite)).toBe(false);
  });

  it("derives activity availability from authoritative location content", () => {
    expect(isActionAvailableAtLocation(LOCATION_IDS.crashSite, ACTION_IDS.crashSiteMining)).toBe(
      true,
    );
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.abandonedProcessingYard, ACTION_IDS.crashSiteMining),
    ).toBe(false);
    expect(getLocation(LOCATION_IDS.emergencyPowerAnnex)?.availableActionIds).toHaveLength(0);
    // The Processing Yard's Metallurgy is dormant, not an enabled action.
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.availableActionIds).toHaveLength(0);
    expect(getLocation(LOCATION_IDS.abandonedProcessingYard)?.dormantActivities[0]?.skillId).toBe(
      "metallurgy",
    );
  });
});
