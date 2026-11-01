import type { Locator, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryStacks, itemInstances } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, openUtility, test, utilitySurface } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Destroy for carried unique items (#456) in a real browser. The integration
 * suite owns the rules, the Cutter guard and the races; this covers what only a
 * rendered page can: the action on a carried unique's Item Details, the inline
 * permanent-destruction confirmation, KEEP ITEM changing nothing, the announced
 * result, focus returning to the grid, a stale confirmation, the last-Cutter
 * refusal, ordinary stack Drop staying intact, and the phone and desktop layouts.
 */

const VIEWPORTS = [
  { name: "phone", size: { width: 390, height: 844 } },
  { name: "desktop", size: { width: 1440, height: 900 } },
] as const;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewport; runs once");
});

async function openInventory(page: Page): Promise<Locator> {
  await openUtility(page, "inventory");
  const inventory = utilitySurface(page, "Inventory");
  await expect(inventory).toBeVisible();
  return inventory;
}

const tileFor = (inventory: Locator, name: string) =>
  inventory.getByRole("button", { name: new RegExp(name) }).first();

const instancesOf = (characterId: string, itemId: string) =>
  db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId))
    .then((rows) => rows.filter((row) => row.itemId === itemId));

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} layout`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport.size);
    });

    test("a spare unique asks first, KEEP ITEM changes nothing, then it is destroyed and announced", async ({
      page,
      testCharacter,
    }) => {
      const id = testCharacter.id;
      await db.insert(itemInstances).values({ characterId: id, itemId: ITEM_IDS.scrapBox });
      // Something that survives, for focus to land on.
      await db
        .insert(inventoryStacks)
        .values({ characterId: id, itemId: ITEM_IDS.slag, quantity: 2 });
      await openTestCharacter(page, id);
      const inventory = await openInventory(page);
      await tileFor(inventory, "Scrap Box").click();

      const start = inventory.locator("[data-unique-destroy-start]");
      await expect(start).toHaveText("Destroy");
      // Unique items are never given the stack Drop, and the old refusal is gone.
      await expect(inventory.getByRole("button", { name: /^Drop/ })).toHaveCount(0);
      await expect(inventory.getByText("cannot be dropped")).toHaveCount(0);
      await start.click();

      const confirmation = inventory.locator("[data-unique-destroy-confirmation]");
      await expect(confirmation).toContainText("Destroy Scrap Box?");
      await expect(confirmation).toContainText("permanently destroys");
      await expect(confirmation).toContainText("cannot be recovered");
      await expect(confirmation.getByRole("button", { name: "KEEP ITEM" })).toBeFocused();
      await captureReviewScreenshot(page, `unique-item-destroy-${viewport.name}.png`);

      // Keep: nothing changes, and focus returns to the action that opened it.
      await confirmation.getByRole("button", { name: "KEEP ITEM" }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(start).toBeFocused();
      expect(await instancesOf(id, ITEM_IDS.scrapBox)).toHaveLength(1);

      await start.click();
      await confirmation.getByRole("button", { name: "DESTROY ITEM" }).click();
      await expect(inventory.getByRole("status")).toHaveText("Scrap Box destroyed permanently.");
      await expect(tileFor(inventory, "Scrap Box")).toHaveCount(0);
      await expect(inventory.locator("[data-unique-destroy]")).toHaveCount(0);
      await expect(page.locator("body")).not.toBeFocused();
      await expect(inventory.locator("button[aria-pressed]").first()).toBeFocused();
      expect(await instancesOf(id, ITEM_IDS.scrapBox)).toHaveLength(0);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("refusals and stale state", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0].size);
  });

  test("the last usable Mining Cutter is refused with a reason and stays", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await db.insert(itemInstances).values({ characterId: id, itemId: ITEM_IDS.salvageCutter });
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Salvage Cutter").click();
    await inventory.locator("[data-unique-destroy-start]").click();
    await inventory
      .locator("[data-unique-destroy-confirmation]")
      .getByRole("button", { name: "DESTROY ITEM" })
      .click();
    await expect(inventory.getByRole("alert").or(inventory.getByText(/last usable/))).toContainText(
      "last usable Mining Cutter",
    );
    await expect(tileFor(inventory, "Salvage Cutter")).toHaveCount(1);
    expect(await instancesOf(id, ITEM_IDS.salvageCutter)).toHaveLength(1);
  });

  test("a confirmation for an item that is already gone is refused cleanly", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    const [box] = await db
      .insert(itemInstances)
      .values({ characterId: id, itemId: ITEM_IDS.scrapBox })
      .returning();
    await db.insert(itemInstances).values({ characterId: id, itemId: ITEM_IDS.freightHarness });
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Scrap Box").click();
    await inventory.locator("[data-unique-destroy-start]").click();
    const confirmation = inventory.locator("[data-unique-destroy-confirmation]");
    await expect(confirmation).toBeVisible();

    // Another tab destroys it first.
    await db.delete(itemInstances).where(eq(itemInstances.id, box!.id));
    await confirmation.getByRole("button", { name: "DESTROY ITEM" }).click();

    await expect(
      inventory.getByText(/no longer in your Inventory|Inventory changed/),
    ).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    // The unrelated unique item is untouched.
    expect(await instancesOf(id, ITEM_IDS.freightHarness)).toHaveLength(1);
  });

  test("ordinary stack Drop is unchanged and offers no Destroy", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await db
      .insert(inventoryStacks)
      .values({ characterId: id, itemId: ITEM_IDS.slag, quantity: 3 });
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Slag").click();
    await expect(inventory.locator('[data-drop-action="one"]')).toBeVisible();
    await expect(inventory.locator('[data-drop-action="stack"]')).toBeVisible();
    await expect(inventory.locator("[data-unique-destroy]")).toHaveCount(0);
    await inventory.locator('[data-drop-action="one"]').click();
    await expect(inventory.locator("[data-drop-confirmation]")).toContainText(
      "permanently destroyed in the current development build",
    );
  });
});
