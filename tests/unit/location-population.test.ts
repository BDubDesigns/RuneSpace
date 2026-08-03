import { describe, expect, it } from "vitest";
import { miningLevelThresholds } from "@/game/config/balance";
import {
  projectLocationPopulation,
  type LocationPopulationRow,
} from "@/game/domain/location-population";
import { levelFromXp } from "@/game/domain/progression";

/**
 * Unit coverage for the issue #62 public location-population projection. SQL
 * joins are never mirrored here; these tests prove the pure projection
 * contract (exclusion, per-owner multiplicity, deterministic ordering, narrow
 * public shape, and level derivation through the existing progression
 * boundary).
 */

const THRESHOLDS = miningLevelThresholds();

function row(overrides: Partial<LocationPopulationRow>): LocationPopulationRow {
  return {
    characterId: `char-${overrides.displayName ?? "x"}`,
    displayName: "Rada",
    normalizedName: "rada",
    ownerName: "Rada Stonehand",
    totalXp: 0,
    ...overrides,
  };
}

function project(rows: readonly LocationPopulationRow[], activeCharacterId = "active-char") {
  return projectLocationPopulation({
    activeCharacterId,
    rows,
    thresholds: THRESHOLDS,
  });
}

describe("issue #62 location population projection", () => {
  it("excludes the active character from its own location list", () => {
    const result = project(
      [
        row({ characterId: "active-char", displayName: "Me" }),
        row({ characterId: "other", displayName: "Rada" }),
      ],
      "active-char",
    );
    expect(result.map((entry) => entry.displayName)).toEqual(["Rada"]);
  });

  it("keeps multiple characters owned by one player as separate entries", () => {
    const result = project([
      row({ characterId: "a", displayName: "Rada One", ownerName: "Rada Stonehand" }),
      row({ characterId: "b", displayName: "Rada Two", ownerName: "Rada Stonehand" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.ownerName === "Rada Stonehand")).toBe(true);
  });

  it("orders deterministically by folded name then stable character ID", () => {
    const result = project([
      row({ characterId: "z", displayName: "Zed", normalizedName: "zed" }),
      row({ characterId: "y", displayName: "Alpha", normalizedName: "alpha" }),
      // Case-insensitive fold: "beta" sorts before "Gamma" even though the
      // preserved display capitalization differs.
      row({ characterId: "b", displayName: "Gamma", normalizedName: "gamma" }),
      row({ characterId: "a", displayName: "Beta", normalizedName: "beta" }),
    ]);
    expect(result.map((entry) => entry.displayName)).toEqual(["Alpha", "Beta", "Gamma", "Zed"]);
  });

  it("returns only the approved public fields: name, derived level, owner name", () => {
    const result = project([
      row({ characterId: "a", displayName: "Rada", ownerName: "Rada Stonehand", totalXp: 500 }),
    ]);
    expect(result).toEqual([
      {
        displayName: "Rada",
        level: 2,
        ownerName: "Rada Stonehand",
      },
    ]);
    // No email, account ID, character database ID, XP, or timestamp may leak.
    expect(Object.keys(result[0]!).sort()).toEqual(["displayName", "level", "ownerName"]);
  });

  it("derives levels through the existing progression boundary", () => {
    // Boundary behavior of the authoritative formula used by the projection.
    expect(levelFromXp(499, THRESHOLDS)).toBe(1);
    expect(levelFromXp(500, THRESHOLDS)).toBe(2);
    const result = project([row({ characterId: "a", displayName: "Rada", totalXp: 500 })]);
    expect(result[0]?.level).toBe(levelFromXp(500, THRESHOLDS));
  });

  it("treats an absent XP row as authoritative zero XP (level 1)", () => {
    const result = project([
      row({ characterId: "a", displayName: "Rada", totalXp: null }),
      row({ characterId: "b", displayName: "Kael", totalXp: 0 }),
    ]);
    expect(result.map((entry) => entry.level)).toEqual([1, 1]);
  });
});
