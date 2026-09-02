import { describe, expect, it } from "vitest";
import { ADMIN_DESTINATIONS } from "@/features/admin/admin-format";
import { getLocation } from "@/game/content/locations";

/**
 * Issue #113 regression guard: every location the operator console offers as a
 * teleport destination must resolve against the canonical location registry.
 * Destinations are derived from `LOCATIONS` (not hand-maintained in the admin
 * feature), so this can never drift into a typo'd id like the former
 * `dwhat_emergency_power_annex`.
 */
describe("ADMIN_DESTINATIONS canonical resolution", () => {
  it("offers at least the five authored world locations", () => {
    const ids = ADMIN_DESTINATIONS.map((d) => d.locationId);
    expect(ids.sort()).toEqual(
      [
        "crash_site",
        "abandoned_processing_yard",
        "dewhat_emergency_power_annex",
        "the_long_scramble",
        "the_jag",
      ].sort(),
    );
  });

  it("every offered destination resolves canonically via getLocation", () => {
    for (const destination of ADMIN_DESTINATIONS) {
      expect(getLocation(destination.locationId), destination.locationId).toBeDefined();
    }
  });

  it("every offered label matches the canonical display name", () => {
    for (const destination of ADMIN_DESTINATIONS) {
      const resolved = getLocation(destination.locationId);
      expect(destination.label).toBe(resolved?.displayName);
    }
  });

  it("uses the canonical emergency-power-annex id (not the old typo)", () => {
    expect(ADMIN_DESTINATIONS.some((d) => d.locationId === "dwhat_emergency_power_annex")).toBe(
      false,
    );
    expect(ADMIN_DESTINATIONS.some((d) => d.locationId === "dewhat_emergency_power_annex")).toBe(
      true,
    );
  });
});
