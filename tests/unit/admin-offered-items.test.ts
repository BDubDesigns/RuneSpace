import { describe, expect, it } from "vitest";
import { ADMIN_OFFERED_ITEMS } from "@/features/admin/admin-format";
import { getItemDefinition } from "@/game/config/balance";

/**
 * Issue #113 third-pass regression guard: the ADD ITEM control's item list must
 * not drift from the authoritative balance definitions. The UI uses a declared
 * `kind` (stack vs unique) to decide whether a quantity input applies — a unique
 * must be added exactly one-per-command (quantity disabled), a stack must take a
 * positive whole quantity. If a declared kind ever contradicts the canonical
 * item definition, this guard fails so the operator never gets a "Qty" field
 * (or a silently-ignored quantity) for the wrong item shape.
 */
describe("ADMIN_OFFERED_ITEMS item-kind contract", () => {
  it("declares each offered item's kind to match the authoritative balance definition", () => {
    for (const option of ADMIN_OFFERED_ITEMS) {
      const definition = getItemDefinition(option.itemId);
      expect(definition, `offer ${option.itemId} must resolve canonically`).toBeDefined();
      if (!definition) continue;
      expect(definition.kind, `${option.itemId} kind mismatch`).toBe(option.kind);
    }
  });

  it("offers uniques explicitly so the UI disables quantity for them", () => {
    const uniques = ADMIN_OFFERED_ITEMS.filter((option) => option.kind === "unique").map(
      (option) => option.itemId,
    );
    expect(uniques).toContain("salvage_cutter");
    expect(uniques).toContain("mykea_schleppraum_8");
  });
});
