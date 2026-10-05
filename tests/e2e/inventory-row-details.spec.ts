import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { expectRowDetailsBeneathRow } from "./row-details";

// Issue #311: Inventory shows the selected item's details as one full-width row
// beneath the selected tile's own grid row, using the same shared row-details
// contract (and the same geometry helper) as Cargo Hold and Site Stash.

const STACKS = [
  { itemId: ITEM_IDS.ferriteShale, quantity: 4 },
  { itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
  { itemId: ITEM_IDS.slag, quantity: 2 },
  { itemId: ITEM_IDS.scrapMetal, quantity: 1 },
  { itemId: ITEM_IDS.powerCell, quantity: 2 },
];

test.beforeEach(async ({ page, testCharacter }) => {
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, testCharacter.id));
  await db
    .insert(inventoryStacks)
    .values(STACKS.map((stack) => ({ characterId: testCharacter.id, ...stack })));
  await openTestCharacter(page, testCharacter.id);
});

async function openInventory(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  return inventory;
}

test("phone: details follow the 2-column grid row, move between rows, and close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const inventory = await openInventory(page);
  const tiles = inventory.locator("button[aria-pressed]");
  const occupied = await tiles.count();
  expect(occupied).toBeGreaterThanOrEqual(STACKS.length);

  // First row, a later row, and the last occupied tile (its row also holds
  // empty slots, which count as grid cells).
  for (const index of [0, 1, 2, occupied - 1]) {
    const measured = await expectRowDetailsBeneathRow(page, inventory, index);
    expect(measured.columns).toBe(2);
    // Inventory's details are taller than the drawer's visible area, so the
    // contract here is that the drawer scrolls them clear of the fixed nav:
    // the panel's last controls can be revealed above it.
    const panel = inventory.locator("[data-row-details]");
    await panel.getByRole("button", { name: "Close details" }).scrollIntoViewIfNeeded();
    const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    const close = (await panel.getByRole("button", { name: "Close details" }).boundingBox())!;
    expect(close.y + close.height).toBeLessThanOrEqual(nav.y);
  }
  // Another row moves the one panel; the same tile again closes it.
  await expectRowDetailsBeneathRow(page, inventory, 0);
  await expect(inventory.locator("[data-row-details]")).toHaveCount(1);
  await tiles.nth(0).click();
  await expect(inventory.locator("[data-row-details]")).toHaveCount(0);
});

test("wider grid: four columns, short final row, and empty slots clear selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const inventory = await openInventory(page);
  const tiles = inventory.locator("button[aria-pressed]");
  const occupied = await tiles.count();
  for (const index of [0, 3, occupied - 1]) {
    const measured = await expectRowDetailsBeneathRow(page, inventory, index);
    expect(measured.columns).toBe(4);
  }
  // The inserted details keep every empty slot in the grid, after its row.
  const panel = inventory.locator("[data-row-details]");
  await expect(panel).toBeVisible();
  await inventory
    .getByLabel(/Empty inventory slot/)
    .first()
    .click();
  await expect(panel).toHaveCount(0);
  await expect(inventory.locator("button[aria-pressed='true']")).toHaveCount(0);
});

test("an action from the inserted details panel works: Drop 1 with confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const inventory = await openInventory(page);
  const slag = inventory.getByRole("button", { name: /Slag/ }).first();
  await slag.click();
  const panel = inventory.locator("[data-details-panel]");
  await expect(panel).toBeVisible();
  // Inventory keeps its own richer content, not the storage transfer summary.
  await expect(panel.getByRole("heading", { name: "Item details" })).toBeVisible();
  await panel.getByRole("button", { name: "Drop 1" }).click();
  await expect(inventory.getByRole("alert")).toContainText("Drop 1 Slag?");
  await inventory.getByRole("button", { name: "Cancel" }).click();
  await expect(slag).toBeFocused();
  await panel.getByRole("button", { name: "Drop 1" }).click();
  await inventory
    .getByRole("button", { name: /^Drop 1$/ })
    .last()
    .click();
  await expect(inventory.getByText("Dropped 1 Slag.")).toBeVisible();
  // Power Cells keep their Load affordance in the inserted panel.
  await inventory
    .getByRole("button", { name: /Power Cell/ })
    .first()
    .click();
  await expect(inventory.locator("[data-details-panel]")).toContainText("Load effect");
  await expect(inventory.getByRole("button", { name: /^Load into/ })).toBeVisible();
});
