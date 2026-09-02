import { describe, expect, it } from "vitest";
import {
  AdminAddItemRequestSchema,
  AdminCarriedStackRemovalRequestSchema,
  AdminSetSkillXpRequestSchema,
  AdminTeleportRequestSchema,
} from "@/game/schemas/admin";
import { LOCATION_IDS } from "@/game/config/foundations";

/**
 * Request-boundary validation for the admin operator schemas (Issue #113).
 * The server never trusts browser-contained gameplay values: teleport accepts
 * only the canonical location id, Force Unequip / deletion accept only a real
 * UUID instance, and SET TOTAL XP accepts only a canonical skill plus an
 * absolute non-negative whole XP integer.
 */

const CID = "4ef0cd69-7d40-4b6d-bdfc-0f7e6cc4e5d0";

describe("AdminTeleportRequestSchema", () => {
  it("accepts a canonical destination location id", () => {
    expect(
      AdminTeleportRequestSchema.safeParse({
        characterId: CID,
        destinationLocationId: LOCATION_IDS.crashSite,
      }).success,
    ).toBe(true);
  });

  it("rejects an arbitrary non-canonical location id", () => {
    const result = AdminTeleportRequestSchema.safeParse({
      characterId: CID,
      destinationLocationId: "not_a_real_location",
    });
    expect(result.success).toBe(false);
  });
});

describe("AdminCarriedStackRemovalRequestSchema", () => {
  it("accepts a one/stack removal with a positive expected quantity", () => {
    for (const mode of ["one", "stack"] as const) {
      expect(
        AdminCarriedStackRemovalRequestSchema.safeParse({
          characterId: CID,
          stackId: "ef6a288e-2b0a-4d5f-9f9c-0c7e8a1f0001",
          mode,
          expectedQuantity: 1,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects a non-positive or fractional expected quantity", () => {
    expect(
      AdminCarriedStackRemovalRequestSchema.safeParse({
        characterId: CID,
        stackId: "ef6a288e-2b0a-4d5f-9f9c-0c7e8a1f0001",
        mode: "stack",
        expectedQuantity: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe("AdminAddItemRequestSchema", () => {
  it("accepts a canonical item id without a quantity (unique)", () => {
    expect(
      AdminAddItemRequestSchema.safeParse({ characterId: CID, itemId: "salvage_cutter" }).success,
    ).toBe(true);
  });

  it("accepts a stackable quantity", () => {
    expect(
      AdminAddItemRequestSchema.safeParse({
        characterId: CID,
        itemId: "ferrite_shale",
        quantity: 5,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown item id", () => {
    expect(
      AdminAddItemRequestSchema.safeParse({ characterId: CID, itemId: "no_such_item" }).success,
    ).toBe(false);
  });
});

describe("AdminSetSkillXpRequestSchema", () => {
  it("accepts a canonical skill and a non-negative whole XP total", () => {
    for (const skillId of ["mining", "refining", "welding"]) {
      expect(
        AdminSetSkillXpRequestSchema.safeParse({
          characterId: CID,
          skillId,
          totalXp: 0,
        }).success,
      ).toBe(true);
      expect(
        AdminSetSkillXpRequestSchema.safeParse({
          characterId: CID,
          skillId,
          totalXp: 450,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects a negative or fractional XP total", () => {
    for (const totalXp of [-1, 0.5]) {
      expect(
        AdminSetSkillXpRequestSchema.safeParse({
          characterId: CID,
          skillId: "mining",
          totalXp,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts a syntactically valid canonical SkillId (incl. strength) at the schema boundary", () => {
    // The schema validates skill syntax only. The authoritative "supported
    // skills with an approved progression curve" rule (Strength has no curve) is
    // enforced by the server command layer, covered by PostgreSQL integration.
    expect(
      AdminSetSkillXpRequestSchema.safeParse({ characterId: CID, skillId: "strength", totalXp: 0 })
        .success,
    ).toBe(true);
  });
});
