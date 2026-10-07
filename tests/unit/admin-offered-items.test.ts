import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminGrantableItems, filterAdminGrantableItems } from "@/features/admin/admin-format";
import { ITEM_IDS } from "@/game/config/foundations";
import { getItemDefinition, inventoryItemDefinitions } from "@/game/config/balance";
import { getItemPresentation } from "@/game/content/item-presentation";
import { AdminAddItemRequestSchema } from "@/game/schemas/admin";

/**
 * The operator ADD ITEM picker offers every canonical inventory item (#333).
 * It is derived from the authoritative item definitions and presentation, so
 * these tests pin the derivation rather than a list: a newly authored item must
 * appear with no admin edit, and nothing in the admin feature may restate an
 * item id, name, kind, mass or stack limit.
 */
describe("adminGrantableItems catalog", () => {
  const catalog = adminGrantableItems();

  it("offers exactly the items that have a canonical inventory definition", () => {
    const defined = inventoryItemDefinitions().map((definition) => definition.itemId);
    expect(catalog.map((item) => item.itemId).sort()).toEqual([...defined].sort());
    // An id with no inventory definition is not a grantable item.
    const undefinedIds = Object.values(ITEM_IDS).filter((id) => !getItemDefinition(id));
    for (const id of undefinedIds) {
      expect(
        catalog.some((item) => item.itemId === id),
        id,
      ).toBe(false);
    }
  });

  it("includes the advanced materials, components, gems, tools and containers", () => {
    const offered = new Set(catalog.map((item) => item.itemId));
    for (const id of [
      ITEM_IDS.galvanite,
      ITEM_IDS.galvanicStock,
      ITEM_IDS.galvaferrite,
      ITEM_IDS.mountingBracket,
      ITEM_IDS.galvanicWireSpool,
      ITEM_IDS.wheelAssembly,
      ITEM_IDS.driveMount,
      ITEM_IDS.uncutQuartz,
      ITEM_IDS.uncutTopaz,
      ITEM_IDS.uncutSapphire,
      ITEM_IDS.scrapMetal,
      ITEM_IDS.loadsteelCutter,
      ITEM_IDS.scrapBox,
      ITEM_IDS.freightHarness,
      ITEM_IDS.salvageCutter,
      ITEM_IDS.mykeaSchleppraum8,
    ]) {
      expect(offered.has(id), id).toBe(true);
    }
  });

  it("derives each kind and label from the canonical definition and presentation", () => {
    for (const item of catalog) {
      const definition = getItemDefinition(item.itemId);
      expect(definition, item.itemId).toBeDefined();
      expect(item.kind, item.itemId).toBe(definition?.kind);
      expect(item.label, item.itemId).toBe(
        getItemPresentation(item.itemId)?.displayName ?? item.itemId,
      );
    }
  });

  it("offers every item as a valid ADD ITEM request for its kind", () => {
    for (const item of catalog) {
      const request =
        item.kind === "unique"
          ? { characterId: "0b6d1f0e-5a47-4d3a-9d1e-4a3a3c1d5b11", itemId: item.itemId }
          : {
              characterId: "0b6d1f0e-5a47-4d3a-9d1e-4a3a3c1d5b11",
              itemId: item.itemId,
              quantity: 1,
            };
      expect(AdminAddItemRequestSchema.safeParse(request).success, item.itemId).toBe(true);
    }
  });

  it("is ordered by display name", () => {
    const labels = catalog.map((item) => item.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("keeps stackables and uniques distinct so the UI knows when to ask for a quantity", () => {
    expect(catalog.find((item) => item.itemId === ITEM_IDS.driveMount)?.kind).toBe("stack");
    expect(catalog.find((item) => item.itemId === ITEM_IDS.loadsteelCutter)?.kind).toBe("unique");
    expect(catalog.find((item) => item.itemId === ITEM_IDS.freightHarness)?.kind).toBe("unique");
  });

  it("restates no item id in the admin feature (no starter-only duplicate registry)", () => {
    const dir = join(process.cwd(), "features/admin");
    const files = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name));
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const id of Object.values(ITEM_IDS)) {
        expect(source.includes(`"${id}"`), `${file} hard-codes "${id}"`).toBe(false);
      }
    }
  });
});

describe("filterAdminGrantableItems", () => {
  const catalog = adminGrantableItems();

  it("keeps the whole catalog for a blank query", () => {
    expect(filterAdminGrantableItems(catalog, "")).toEqual(catalog);
    expect(filterAdminGrantableItems(catalog, "   ")).toEqual(catalog);
  });

  it("matches the display name case-insensitively", () => {
    const labels = filterAdminGrantableItems(catalog, "dRiVe").map((item) => item.label);
    expect(labels).toContain("Drive Mount");
    expect(labels.every((label) => label.toLowerCase().includes("drive"))).toBe(true);
  });

  it("returns nothing for a query that matches no item", () => {
    expect(filterAdminGrantableItems(catalog, "zzzz-no-such-item")).toEqual([]);
  });
});
