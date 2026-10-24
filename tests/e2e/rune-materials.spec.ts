import { eq } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
import { db } from "@/db";
import { inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

// Issue #367: a carried intact Runestone is broken into five Rune Fragments from
// its ordinary Inventory Item Details, at the portrait/mobile width the
// Inventory is designed for.

const { runestone: STONE, runeFragment: FRAGMENT, ferriteShale: SHALE } = ITEM_IDS;

async function seed(characterId: string, stacks: { itemId: string; quantity: number }[]) {
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db.insert(inventoryStacks).values(stacks.map((stack) => ({ characterId, ...stack })));
}

const rows = (characterId: string) =>
  db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));

const total = (stacks: { itemId: string; quantity: number }[], itemId: string) =>
  stacks.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.quantity, 0);

async function openInventory(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  return inventory;
}

const tile = (inventory: Locator, name: string) =>
  inventory.getByRole("button", { name: new RegExp(`^\\d+ ${name}`) });

test.describe("Runestone Break Apart", () => {
  test("offers Break Apart only on a Runestone, with the approved art and description", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [
      { itemId: STONE, quantity: 2 },
      { itemId: FRAGMENT, quantity: 4 },
    ]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    await tile(inventory, "Rune Fragment").click();
    const details = inventory.locator("[data-details-panel]");
    await expect(details).toBeVisible();
    await expect(details.locator("[data-item-description]")).toContainText(
      "A broken piece of an unusual mineral",
    );
    await expect(details.getByRole("button", { name: "Break Apart" })).toHaveCount(0);

    await tile(inventory, "Runestone").click();
    await expect(details.locator("[data-item-description]")).toContainText(
      "can be broken into five Rune Fragments",
    );
    await expect(details.getByRole("button", { name: "Break Apart" })).toBeVisible();
    await expect(details.getByRole("button", { name: "Drop 1" })).toBeVisible();

    // Both tiles use the transparent optimized runtime art, not a text fallback.
    for (const name of ["Rune Fragment", "Runestone"]) {
      const artwork = tile(inventory, name).locator("img");
      await expect(artwork).toBeVisible();
      await expect
        .poll(() => artwork.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    }
  });

  test("confirms the irreversible 1 → 5 conversion and reconciles Inventory from the server", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [
      { itemId: STONE, quantity: 2 },
      { itemId: FRAGMENT, quantity: 8 },
    ]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    await tile(inventory, "Runestone").click();
    await expect(inventory.getByRole("button", { name: "Break Apart" })).toBeVisible();
    await captureReviewScreenshot(page, "rune-materials-mobile-runestone-details.png");
    await inventory.getByRole("button", { name: "Break Apart" }).click();
    const panel = inventory.locator("[data-details-panel]");
    const confirmation = panel.locator("[data-break-apart-confirmation]");
    // Inline in the selected details panel, replacing the initiating button.
    await expect(inventory.locator("[data-break-apart-confirmation]")).toHaveCount(1);
    await expect(panel.getByRole("button", { name: "Break Apart", exact: true })).toHaveCount(0);
    await expect(confirmation.getByText("Warning:")).toBeAttached();
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(confirmation).toContainText(
      "Destroy 1 Runestone and receive exactly 5 Rune Fragments",
    );
    await expect(confirmation).toContainText("cannot be undone");
    await captureReviewScreenshot(page, "rune-materials-mobile-confirm-break-apart.png");

    // Cancelling changes nothing.
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Break Apart", exact: true })).toBeFocused();
    expect(total(await rows(testCharacter.id), STONE)).toBe(2);

    await inventory.getByRole("button", { name: "Break Apart" }).click();
    await confirmation.getByRole("button", { name: "Confirm break apart" }).click();
    await expect(
      inventory.getByText("Broke apart 1 Runestone into 5 Rune Fragments."),
    ).toBeVisible();

    await captureReviewScreenshot(page, "rune-materials-mobile-after-break-apart.png");
    // One stone is gone, five Fragments landed (topping up the partial stack first).
    const after = await rows(testCharacter.id);
    expect(total(after, STONE)).toBe(1);
    expect(total(after, FRAGMENT)).toBe(13);
    await expect(tile(inventory, "Runestone")).toContainText("x1");
    await expect(tile(inventory, "Rune Fragment").first()).toBeVisible();
  });

  test("removes a lone Runestone's tile and clears its selection", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [{ itemId: STONE, quantity: 1 }]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    await tile(inventory, "Runestone").click();
    await inventory.getByRole("button", { name: "Break Apart" }).click();
    await inventory
      .locator("[data-break-apart-confirmation]")
      .getByRole("button", { name: "Confirm break apart" })
      .click();
    await expect(
      inventory.getByText("Broke apart 1 Runestone into 5 Rune Fragments."),
    ).toBeVisible();

    await expect(tile(inventory, "Runestone")).toHaveCount(0);
    await expect(inventory.locator("[data-details-panel]")).toHaveCount(0);
    await expect(tile(inventory, "Rune Fragment")).toContainText("x5");
    const after = await rows(testCharacter.id);
    expect(total(after, STONE)).toBe(0);
    expect(total(after, FRAGMENT)).toBe(5);
  });

  test("refuses clearly, changing neither item, when the Fragments would not fit", async ({
    page,
    testCharacter,
  }) => {
    // Eight of eight slots: a stack of two stones keeps its slot, so there is no room.
    await seed(testCharacter.id, [
      { itemId: STONE, quantity: 2 },
      ...Array.from({ length: 7 }, () => ({ itemId: SHALE, quantity: 10 })),
    ]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    await tile(inventory, "Runestone").click();
    await inventory.getByRole("button", { name: "Break Apart" }).click();
    await inventory
      .locator("[data-break-apart-confirmation]")
      .getByRole("button", { name: "Confirm break apart" })
      .click();
    await expect(inventory.getByText(/Not enough free Inventory slots/)).toBeVisible();
    await expect(inventory.getByText(/the Runestone is unchanged/)).toBeVisible();

    const after = await rows(testCharacter.id);
    expect(total(after, STONE)).toBe(2);
    expect(total(after, FRAGMENT)).toBe(0);
  });

  test("refuses a stale confirmation without converting anything", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [{ itemId: STONE, quantity: 2 }]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    await tile(inventory, "Runestone").click();
    await inventory.getByRole("button", { name: "Break Apart" }).click();
    // Another session changes the stack after the player confirmed against 2.
    await db
      .update(inventoryStacks)
      .set({ quantity: 3 })
      .where(eq(inventoryStacks.characterId, testCharacter.id));
    await inventory
      .locator("[data-break-apart-confirmation]")
      .getByRole("button", { name: "Confirm break apart" })
      .click();

    await expect(
      inventory.getByText("Inventory changed. Review the stack and try again."),
    ).toBeVisible();
    const after = await rows(testCharacter.id);
    expect(total(after, STONE)).toBe(3);
    expect(total(after, FRAGMENT)).toBe(0);
    await expect(tile(inventory, "Runestone")).toContainText("x3");
  });
});
