import {
  test,
  expect,
  openEquipmentTab,
  openTestCharacter,
  equipmentSlotTile,
  selectEquipmentSlot,
  WIDEST_COMPACT_VIEWPORT,
} from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { equippedItems, itemInstances, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { captureReviewScreenshot } from "./review-screenshot";

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

const PORTRAITS = [
  { name: "320 portrait", width: 320, height: 640 },
  { name: "390 portrait", width: 390, height: 844 },
];

/** First-play provisioning supplies only the starter container, so seed an equipped Cutter. */
async function equipStarterCutter(characterId: string) {
  const [cutter] = await db
    .insert(itemInstances)
    .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })
    .returning();
  await db.insert(equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: getEffectiveGameBalance().carrying.miningToolSuitSlotId,
    itemInstanceId: cutter!.id,
  });
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Equipment loadout grid (#364)", () => {
  for (const viewport of PORTRAITS) {
    test(`shows the tool and both containers in a compact two-column grid (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const equipment = await openEquipmentTab(page);
      const tool = equipmentSlotTile(equipment, "Mining tool");
      const first = equipmentSlotTile(equipment, "Container attachment 1");
      const second = equipmentSlotTile(equipment, "Container attachment 2");
      const toolBox = (await tool.boundingBox())!;
      const firstBox = (await first.boundingBox())!;
      const secondBox = (await second.boundingBox())!;
      // The tool spans the row; both containers sit side by side beneath it.
      expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width / 2);
      expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThan(2);
      expect(firstBox.y).toBeGreaterThan(toolBox.y + toolBox.height - 2);
      expect(toolBox.width).toBeGreaterThan(firstBox.width * 1.5);
      // Everything is in the first portrait viewport, with no details card yet.
      const viewportHeight = viewport.height;
      expect(secondBox.y + secondBox.height).toBeLessThan(viewportHeight);
      await expect(equipment.locator("[data-equipment-details]")).toHaveCount(0);
      await expect(second.getByRole("button")).toHaveAccessibleName(
        /^Container attachment 2: empty/,
      );
      await expect(second.locator("svg")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 390)
        await captureReviewScreenshot(page, "equipment-loadout-mobile.png");
    });
  }

  test("empty Container 2 lists the carried Scrap Box and equips into exactly that slot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.scrapBox });
    await page.reload();
    const equipment = await openEquipmentTab(page);
    const details = await selectEquipmentSlot(equipment, "Container attachment 2");
    await expect(details.getByRole("button", { name: /Scrap Box/ })).toBeVisible();
    await details.locator("[data-candidate]").click();
    await captureReviewScreenshot(page, "equipment-loadout-empty-slot-candidate.png");
    await details.getByRole("button", { name: "Equip in Container attachment 2" }).click();
    await expect(
      equipmentSlotTile(equipment, "Container attachment 2").getByRole("button"),
    ).toHaveAccessibleName("Container attachment 2: Scrap Box, equipped");
    // The first container was never touched, and the candidate left the list.
    await expect(
      equipmentSlotTile(equipment, "Container attachment 1").getByRole("button"),
    ).toHaveAccessibleName(/MYKEA/);
    await expect(details.locator("[data-candidate]")).toHaveCount(0);
    // Focus returned to the re-artworked slot tile rather than a removed control.
    await expect(
      equipmentSlotTile(equipment, "Container attachment 2").getByRole("button"),
    ).toBeFocused();
  });

  test("an occupied container offers replacements for only that slot", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.scrapBox });
    await page.reload();
    const equipment = await openEquipmentTab(page);
    const details = await selectEquipmentSlot(equipment, "Container attachment 1");
    await expect(details.getByRole("button", { name: "Unequip" })).toBeVisible();
    await details.locator("[data-candidate]").click();
    await expect(
      details.getByRole("button", { name: "Equip in Container attachment 1" }),
    ).toBeVisible();
    await expect(
      details.getByRole("button", { name: /Equip in Container attachment 2/ }),
    ).toHaveCount(0);
    // Switching slots replaces the single panel instead of stacking another.
    await selectEquipmentSlot(equipment, "Mining tool");
    await expect(equipment.locator("[data-equipment-details]")).toHaveCount(1);
    await expect(
      equipment.getByRole("region", { name: "Container attachment 1 details" }),
    ).toHaveCount(0);
    // Re-selecting the selected slot collapses its panel.
    await equipmentSlotTile(equipment, "Mining tool").getByRole("button").click();
    await expect(equipment.locator("[data-equipment-details]")).toHaveCount(0);
  });

  test("a blocked candidate stays selectable, shows every reason, and cannot equip", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    const balance = getEffectiveGameBalance();
    await equipStarterCutter(characterId);
    // Mining 1 cannot use the Loadsteel Cutter; the carried Cutter also pushes
    // mass over the limit once swapped, so more than one reason can apply.
    await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.loadsteelCutter });
    await db.insert(inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 1,
    });
    await page.reload();
    const equipment = await openEquipmentTab(page);
    const details = await selectEquipmentSlot(equipment, "Mining tool");
    const candidate = details.locator("[data-candidate]");
    await expect(candidate).toHaveAttribute("data-candidate-state", "blocked");
    await candidate.click();
    await expect(candidate).toHaveAttribute("aria-pressed", "true");
    await expect(details.locator("[data-equip-blocked-reason]").first()).toContainText(
      "Requires Mining 5 (current 1)",
    );
    await expect(details.getByRole("button", { name: "Equip in Mining tool" })).toBeDisabled();
    await captureReviewScreenshot(page, "equipment-loadout-blocked-candidate.png");
    // Equipment is unchanged.
    const rows = await db
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId));
    expect(rows.some((row) => row.suitSlotId === balance.carrying.miningToolSuitSlotId)).toBe(true);
  });

  test("the Mining tool's Power Cell controls live in its on-demand details", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    await equipStarterCutter(characterId);
    await db
      .insert(inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.powerCell, quantity: 1 });
    await page.reload();
    const equipment = await openEquipmentTab(page);
    await expect(equipment.getByRole("button", { name: "Load Power Cell" })).toHaveCount(0);
    const details = await selectEquipmentSlot(equipment, "Mining tool");
    await details.getByRole("button", { name: "Load Power Cell" }).click();
    await expect(details.getByText("Loaded · 10 / 10", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "equipment-loadout-tool-details.png");
  });

  test("lays the same grid out on desktop", async ({ page }) => {
    await page.setViewportSize(WIDEST_COMPACT_VIEWPORT);
    const equipment = await openEquipmentTab(page);
    await selectEquipmentSlot(equipment, "Container attachment 1");
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "equipment-loadout-desktop.png");
  });
});
