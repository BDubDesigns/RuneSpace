import {
  test,
  expect,
  openEquipmentTab,
  openUtility,
  utilitySurface,
  openTestCharacter,
  WIDEST_COMPACT_VIEWPORT,
} from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { equippedItems, itemInstances, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { captureReviewScreenshot } from "./review-screenshot";

// The Inventory/Equipment surface is exercised on the primary Mining page at
// the same canonical portrait viewport used across the browser suite.
test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

test.describe("Inventory equip and compact selected visual", () => {
  test("falls back to the Inventory grid when equipping the only carried item leaves no occupied tile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    const balance = getEffectiveGameBalance();

    // beforeEach opens an isolated character. First-play provisioning supplies
    // the starter container only; the fixture does not seed a legacy Cutter.
    // Reset the item/equipment rows and explicitly establish the authoritative
    // state needed for the empty-carried-inventory fallback:
    //   - carried: exactly one Salvage Cutter (the only carried unique item),
    //   - equipped: one MYKEA container (required by the loadout rule), tool slot EMPTY,
    //   - no carried stacks, no other unique items.
    await db.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
    await db.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
    const container = (
      await db
        .insert(itemInstances)
        .values({ characterId, itemId: ITEM_IDS.mykeaSchleppraum8 })
        .returning()
    )[0]!;
    await db.insert(equippedItems).values({
      characterId,
      assignmentKind: "container",
      suitSlotId: balance.carrying.containerSuitSlotIds[0],
      itemInstanceId: container.id,
    });
    await db.insert(itemInstances).values({
      characterId,
      itemId: ITEM_IDS.salvageCutter,
      currentCharge: 0,
    });
    await page.reload();

    const inventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
    await page.getByRole("button", { name: "Inventory" }).click();
    await expect(inventoryDrawer).toBeVisible();

    // Exactly one carried unique Cutter tile; no stacks were seeded.
    await expect(inventoryDrawer.locator("button[aria-pressed]")).toHaveCount(1);
    const cutterTile = inventoryDrawer.locator("button[aria-pressed]").first();
    await cutterTile.click();

    // Details panel appears with the Equip action for the eligible Cutter.
    const detailsPanel = inventoryDrawer.locator("[data-details-panel]");
    await expect(detailsPanel).toBeVisible();
    await expect(detailsPanel.getByRole("button", { name: /Equip in Mining tool/ })).toBeVisible();

    // Frozen review screenshot: narrow portrait selected-item details (Issue #68).
    await captureReviewScreenshot(page, "inventory-equip-mobile-selected-cutter.png");

    // Compact selected visual: at the 390px portrait viewport the selected
    // artwork tile stays ~7rem (112px) wide instead of stretching across the
    // dossier. The visual renders as the <article> root of ItemVisual inside the
    // details panel.
    const dossierBox = await detailsPanel.boundingBox();
    expect(dossierBox).not.toBeNull();
    const tileBox = await detailsPanel.locator("article").first().boundingBox();
    expect(tileBox).not.toBeNull();
    expect(tileBox!.width).toBeGreaterThanOrEqual(80);
    expect(tileBox!.width).toBeLessThanOrEqual(140);
    expect(tileBox!.width).toBeLessThan(dossierBox!.width * 0.5);

    // Activate Equip. The command goes through the shared gate; the returned
    // authoritative state must immediately remove the Cutter from carried
    // Inventory.
    await detailsPanel.getByRole("button", { name: /Equip in Mining tool/ }).click();
    await expect(
      inventoryDrawer.getByText(/Equipped Salvage Cutter into Mining tool/),
    ).toBeVisible();

    // The equipped Cutter is no longer carried and there are no other carried
    // stacks or unique items, so NO occupied Inventory tile remains.
    await expect(detailsPanel.getByRole("button", { name: /Equip in/ })).toHaveCount(0);
    await expect(inventoryDrawer.locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(inventoryDrawer.locator("button[aria-pressed]")).toHaveCount(0);
    // The stale selected dossier is gone and the drawer stays open.
    await expect(detailsPanel).toHaveCount(0);
    await expect(inventoryDrawer).toBeVisible();

    // Focus lands on the Inventory grid container itself (the stable
    // programmatic fallback), NOT merely somewhere inside the dialog and NOT on
    // a removed element behind the modal.
    const grid = inventoryDrawer.locator('[aria-label$=" inventory slots"]');
    await expect(grid).toHaveAttribute("tabindex", "-1");
    await expect
      .poll(() => grid.evaluate((element) => document.activeElement === element))
      .toBe(true);

    // The drawer still contains the modal (focus was not lost to the page).
    await expect
      .poll(() => inventoryDrawer.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    // Equipment projection immediately shows a Salvage Cutter equipped without
    // a reload (the shared provider accepted the returned state). Close the
    // Inventory drawer first — the modal overlay would otherwise intercept the
    // footer Equipment button.
    await page.getByRole("button", { name: "Close inventory" }).click();
    await expect(inventoryDrawer).toBeHidden();
    const equipmentDrawer = await openEquipmentTab(page);
    await expect(equipmentDrawer).toBeVisible();
    // The Mining-tool slot section carries the equipped Salvage Cutter: the
    // "Equipped" badge confirms the slot is occupied and the section's content
    // contains the Cutter nameplate. toContainText checks text content and is
    // robust to the nameplate being below the drawer fold / truncation.
    const miningToolSection = equipmentDrawer.locator('section[aria-label="Mining tool"]');
    await expect(miningToolSection).toBeVisible();
    await expect(miningToolSection.getByText("Equipped", { exact: true })).toBeVisible();
    await expect(miningToolSection).toContainText("Salvage Cutter");

    // Frozen review screenshot: the Salvage Cutter Equip state, shown equipped
    // in the Mining-tool slot without a reload (Issue #68).
    await captureReviewScreenshot(page, "inventory-equip-mobile-equipped.png");
  });

  test("keeps the selected-stack visual compact on narrow portrait and does not overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    // Seed a single carried stack so a stack item can be selected in details.
    await db.insert(inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 5,
    });
    await page.reload();

    const inventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
    await page.getByRole("button", { name: "Inventory" }).click();
    await expect(inventoryDrawer).toBeVisible();
    await expect(inventoryDrawer.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();
    await inventoryDrawer.locator("button[aria-pressed]").first().click();

    const detailsPanel = inventoryDrawer.locator("[data-details-panel]");
    await expect(detailsPanel).toBeVisible();
    const dossierBox = await detailsPanel.boundingBox();
    expect(dossierBox).not.toBeNull();
    const tileBox = await detailsPanel.locator("article").first().boundingBox();
    expect(tileBox).not.toBeNull();
    expect(tileBox!.width).toBeGreaterThanOrEqual(80);
    expect(tileBox!.width).toBeLessThanOrEqual(140);
    expect(tileBox!.width).toBeLessThan(dossierBox!.width * 0.5);

    // No horizontal overflow at the canonical 390px viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    // Wider desktop layout preserves the compact side-by-side dossier and stays
    // overflow-free.
    await page.setViewportSize(WIDEST_COMPACT_VIEWPORT);
    const desktopDossierBox = await detailsPanel.boundingBox();
    expect(desktopDossierBox).not.toBeNull();
    const desktopTileBox = await detailsPanel.locator("article").first().boundingBox();
    expect(desktopTileBox).not.toBeNull();
    expect(desktopTileBox!.width).toBeLessThanOrEqual(140);
    // Explicitly assert there is no horizontal document overflow at the desktop
    // viewport either.
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBe(false);
  });

  test("moves focus to the selected item's details heading after a keyboard selection", async ({
    page,
  }) => {
    // The shared selectable-details contract (Inventory and Cargo Hold) reveals
    // the selected item's details and moves focus to its heading, so a keyboard
    // user reaches that item's actions instead of tabbing through the rest of
    // the grid. This asserts the destination Inventory has always relied on.
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    await db.insert(inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 5,
    });
    await page.reload();

    const inventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
    await page.getByRole("button", { name: "Inventory" }).click();
    await expect(inventoryDrawer).toBeVisible();

    const tile = inventoryDrawer.locator("button[aria-pressed]").first();
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(tile).toHaveAttribute("aria-pressed", "true");

    const detailsPanel = inventoryDrawer.locator("[data-details-panel]");
    await expect(detailsPanel).toBeVisible();
    const heading = detailsPanel.getByRole("heading", { name: "Item details" });
    await expect(heading).toHaveAttribute("tabindex", "-1");
    await expect
      .poll(() => heading.evaluate((element) => element === document.activeElement))
      .toBe(true);
  });

  const assignmentsOf = async (characterId: string) =>
    Object.fromEntries(
      (await db.select().from(equippedItems).where(eq(equippedItems.characterId, characterId))).map(
        (row) => [row.suitSlotId, row.itemInstanceId],
      ),
    );

  for (const viewport of [
    { name: "portrait", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 720 },
  ]) {
    test(`equips a carried Scrap Box directly into the empty Container 2 from Inventory (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const characterId = page.url().split("/").at(-1)!;
      const [first, second] = getEffectiveGameBalance().carrying.containerSuitSlotIds;
      const before = await assignmentsOf(characterId);
      expect(Object.keys(before)).toEqual([first]);
      const scrapBox = (
        await db
          .insert(itemInstances)
          .values({ characterId, itemId: ITEM_IDS.scrapBox })
          .returning()
      )[0]!;
      await page.reload();

      await openUtility(page, "inventory");
      const surface = utilitySurface(page, "Inventory");
      const tile = surface.locator("button[aria-pressed]").filter({ hasText: /Scrap Box/i });
      await tile.first().click();
      const detailsPanel = surface.locator("[data-details-panel]");
      await detailsPanel.getByRole("button", { name: "Equip in Container attachment 2" }).click();
      await expect(
        surface.getByText(/Equipped Scrap Box into Container attachment 2/),
      ).toBeVisible();

      // No reload: the Scrap Box left carried Inventory and now shows in Equipment.
      await expect(tile).toHaveCount(0);
      await expect(detailsPanel).toHaveCount(0);
      expect(await assignmentsOf(characterId)).toEqual({
        [first]: before[first],
        [second]: scrapBox.id,
      });
      await surface.getByRole("tab", { name: "Equipment", exact: true }).click();
      await expect(
        page
          .getByRole("region", { name: "Container attachment 2" })
          .getByText("Scrap Box", { exact: false })
          .first(),
      ).toBeVisible();
    });

    test(`routes to Equipment and hands focus over without replacing when both container slots are occupied (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const characterId = page.url().split("/").at(-1)!;
      const [, secondSlot] = getEffectiveGameBalance().carrying.containerSuitSlotIds;
      const second = (
        await db
          .insert(itemInstances)
          .values({ characterId, itemId: ITEM_IDS.mykeaSchleppraum8 })
          .returning()
      )[0]!;
      await db.insert(equippedItems).values({
        characterId,
        assignmentKind: "container",
        suitSlotId: secondSlot,
        itemInstanceId: second.id,
      });
      await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.scrapBox });
      await page.reload();
      const before = await assignmentsOf(characterId);
      expect(Object.keys(before)).toHaveLength(2);

      await openUtility(page, "inventory");
      const surface = utilitySurface(page, "Inventory");
      const tile = surface.locator("button[aria-pressed]").filter({ hasText: /Scrap Box/i });
      await tile.first().click();
      const detailsPanel = surface.locator("[data-details-panel]");
      await expect(detailsPanel.getByRole("button", { name: "Equip", exact: true })).toBeDisabled();
      await expect(
        detailsPanel.getByText(/Choose which one to replace in Equipment/),
      ).toBeVisible();

      // Keyboard activation: the activated button unmounts with the Inventory
      // tab, so focus must land on an intentional control in the new panel.
      const manage = detailsPanel.getByRole("button", { name: "Manage Equipment" });
      await manage.focus();
      await page.keyboard.press("Enter");
      const equipmentTab = page.getByRole("tab", { name: "Equipment", exact: true });
      await expect(equipmentTab).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() => equipmentTab.evaluate((element) => element === document.activeElement))
        .toBe(true);

      // Nothing was replaced, and the Scrap Box is still carried.
      expect(await assignmentsOf(characterId)).toEqual(before);
      await page.locator('[data-inventory-tab="inventory"]').click();
      await expect(tile).toHaveCount(1);
    });
  }
});
