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
      const cellBox = (await equipment
        .locator('[data-equipment-slot="utility:power_cell"]')
        .boundingBox())!;
      const glovesBox = (await equipment
        .locator('[data-equipment-slot="placeholder:gloves"]')
        .boundingBox())!;
      const bootsBox = (await equipment
        .locator('[data-equipment-slot="placeholder:boots"]')
        .boundingBox())!;
      const firstBox = (await first.boundingBox())!;
      const secondBox = (await second.boundingBox())!;
      // Three rows of two equal columns: tool | cell, gloves | boots, C1 | C2.
      const pairs = [
        [toolBox, cellBox],
        [glovesBox, bootsBox],
        [firstBox, secondBox],
      ] as const;
      for (const [left, right] of pairs) {
        expect(right.x).toBeGreaterThan(left.x + left.width / 2);
        expect(Math.abs(right.y - left.y)).toBeLessThan(2);
        expect(Math.abs(right.width - left.width)).toBeLessThan(2);
      }
      // The Mining tool is a half-width tile, never stretched across the grid.
      expect(toolBox.width).toBeLessThan(viewport.width * 0.6);
      expect(glovesBox.y).toBeGreaterThan(toolBox.y + toolBox.height - 2);
      expect(firstBox.y).toBeGreaterThan(glovesBox.y + glovesBox.height - 2);
      // Everything is in the first portrait viewport, with no details card yet.
      const viewportHeight = viewport.height;
      // At 390x844 all three rows fit; at 320x640 the Drawer scrolls them instead.
      if (viewportHeight >= 800)
        expect(secondBox.y + secondBox.height).toBeLessThan(viewportHeight);
      // Gloves and Boots are labelled visual placeholders, not live slots.
      for (const name of ["Gloves", "Boots"]) {
        await expect(
          equipment.getByRole("button", { name: `${name}: coming soon, not yet equippable` }),
        ).toBeVisible();
      }
      await expect(equipment.locator("[data-equipment-details]")).toHaveCount(0);
      await expect(second.getByRole("button")).toHaveAccessibleName(/^Container 2: empty/);
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
    const scrapBoxRow = details.getByRole("button", { name: /Scrap Box/ });
    await expect(scrapBoxRow).toBeVisible();
    // Candidate rows carry a small real-artwork thumbnail.
    const thumbnail = scrapBoxRow.locator("[data-candidate-thumbnail]");
    await expect(thumbnail).toBeVisible();
    const thumbBox = (await thumbnail.boundingBox())!;
    expect(thumbBox.width).toBeGreaterThanOrEqual(56);
    expect(thumbBox.width).toBeLessThanOrEqual(64);
    await expect(thumbnail.locator("img")).toHaveCount(1);
    await details.locator("[data-candidate]").click();
    await captureReviewScreenshot(page, "equipment-loadout-empty-slot-candidate.png");
    await details.getByRole("button", { name: "Equip in Container attachment 2" }).click();
    await expect(
      equipmentSlotTile(equipment, "Container attachment 2").getByRole("button"),
    ).toHaveAccessibleName("Container 2: Scrap Box, equipped");
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
    // A blocked candidate keeps its thumbnail too.
    await expect(candidate.locator("[data-candidate-thumbnail] img")).toHaveCount(1);
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

  test("the Power Cell utility loads from the smallest stack and the tool details agree", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    await equipStarterCutter(characterId);
    const [large, small] = await db
      .insert(inventoryStacks)
      .values([
        { characterId, itemId: ITEM_IDS.powerCell, quantity: 5 },
        { characterId, itemId: ITEM_IDS.powerCell, quantity: 2 },
      ])
      .returning();
    await page.reload();
    const equipment = await openEquipmentTab(page);
    const utility = equipment.locator("[data-power-cell-utility]");
    await expect(utility).toHaveAttribute("data-power-cell-utility", "ready");
    await expect(utility).toContainText("Charge 0 / 10");
    // Total loose cells across every stack.
    await expect(utility).toContainText("7 carried");
    // Real Power Cell artwork, and no stack-fill/capacity bar.
    await expect(utility.locator("img")).toHaveCount(1);
    await expect(utility.getByRole("progressbar")).toHaveCount(0);
    await utility.getByRole("button", { name: "Load Power Cell" }).click();
    await expect(utility).toHaveAttribute("data-power-cell-utility", "charged");
    await expect(utility).toContainText("Charge 10 / 10");
    await expect(utility).toContainText("6 carried");
    await expect(utility.getByRole("button")).toHaveCount(0);
    // The server consumed from the lowest-quantity stack, not the larger one.
    const quantities = Object.fromEntries(
      (
        await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId))
      ).map((row) => [row.id, row.quantity]),
    );
    expect(quantities[small!.id]).toBe(1);
    expect(quantities[large!.id]).toBe(5);
    // The tool's own on-demand details remain and agree.
    const details = await selectEquipmentSlot(equipment, "Mining tool");
    await expect(details.getByText("Loaded · 10 / 10", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "equipment-loadout-tool-details.png");
  });

  test("the Power Cell utility explains when there is no tool or no loose cells", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const equipment = await openEquipmentTab(page);
    const utility = equipment.locator("[data-power-cell-utility]");
    await expect(utility).toHaveAttribute("data-power-cell-utility", "no_tool");
    await expect(utility).toContainText("Unavailable · no Mining tool equipped");
    await expect(utility.getByRole("button")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("Gloves and Boots are informational placeholders that offer no equip actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const equipment = await openEquipmentTab(page);
    await equipment.getByRole("button", { name: /^Gloves: coming soon/ }).click();
    const details = equipment.getByRole("region", { name: "Gloves details" });
    await expect(details).toContainText("Coming soon");
    await expect(details.getByRole("button")).toHaveCount(0);
    await expect(details.locator("[data-candidate]")).toHaveCount(0);
  });

  test("lays the same grid out on desktop", async ({ page }) => {
    await page.setViewportSize(WIDEST_COMPACT_VIEWPORT);
    const equipment = await openEquipmentTab(page);
    await selectEquipmentSlot(equipment, "Container attachment 1");
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "equipment-loadout-desktop.png");
  });
});
