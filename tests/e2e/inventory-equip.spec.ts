import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
  characters,
  characterCargoHoldRepair,
  characterMiningState,
  characterStarterProvisioning,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error(
      "Inventory equip E2E fixtures require a disposable localhost PostgreSQL database",
    );
  }
});

test.use({ storageState: miningStorageStatePath });

// The Inventory/Equipment surface is exercised on the primary Mining page at
// the same canonical portrait viewport used across the browser suite.
async function openPlayPage(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openPlayPage(page);
  await Promise.all([
    db.delete(activeActions).where(eq(activeActions.characterId, characterId)),
    db.delete(cargoHoldItemInstances).where(eq(cargoHoldItemInstances.characterId, characterId)),
    db.delete(cargoHoldStacks).where(eq(cargoHoldStacks.characterId, characterId)),
    db
      .delete(characterCargoHoldRepair)
      .where(eq(characterCargoHoldRepair.characterId, characterId)),
    db.delete(characterMiningState).where(eq(characterMiningState.characterId, characterId)),
    db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId)),
    db
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId)),
    db
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId)),
  ]);
  await db.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
  await db.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
  await page.reload();
});

test.describe("Inventory equip and compact selected visual", () => {
  test("falls back to the Inventory grid when equipping the only carried item leaves no occupied tile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;
    const balance = getEffectiveGameBalance();

    // before() auto-provisions an equipped Cutter + starter container and
    // leaves the starter-provisioning marker present. To exercise the
    // empty-carried-inventory fallback we need a carried Salvage Cutter with an
    // EMPTY Mining-tool slot and no other carried items. Because the starter
    // marker already exists, `getMiningGameplayState` will NOT auto-equip a new
    // Cutter on reload, so the state we seed below is authoritative and stable:
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
    await page.screenshot({ path: "test-results/inventory-equip-mobile-selected-cutter.png" });

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
    await page.getByRole("button", { name: "Equipment" }).click();
    const equipmentDrawer = page.getByRole("dialog", { name: "Equipment" });
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
    await page.screenshot({ path: "test-results/inventory-equip-mobile-equipped.png" });
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
    await page.setViewportSize({ width: 1440, height: 900 });
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

  test("exposes no Equip action in Inventory details for an ineligible carried unique item", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const characterId = page.url().split("/").at(-1)!;

    // before() auto-provisions an equipped Cutter + one container (marker
    // present). Add a spare carried MYKEA container: it is a unique item that
    // is eligible for a CONTAINER slot, but Issue #68 scopes Inventory Equip to
    // the authoritative Mining-tool slot only, so its details must expose NO
    // Equip action. Keep the marker present so the loadout is not re-provisioned.
    await db.insert(itemInstances).values({
      characterId,
      itemId: ITEM_IDS.mykeaSchleppraum8,
    });
    await page.reload();

    const inventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
    await page.getByRole("button", { name: "Inventory" }).click();
    await expect(inventoryDrawer).toBeVisible();

    // Select the carried spare MYKEA (a unique item tile). The equipped Cutter
    // is not carried; the spare MYKEA is the additional carried unique.
    const spareTile = inventoryDrawer
      .locator("button[aria-pressed]")
      .filter({ hasText: "MYKEA SCHLEPPRAUM-8" })
      .first();
    await expect(spareTile).toBeVisible();
    await spareTile.click();

    const detailsPanel = inventoryDrawer.locator("[data-details-panel]");
    await expect(detailsPanel).toBeVisible();
    await expect(
      detailsPanel.getByText("MYKEA SCHLEPPRAUM-8", { exact: true }).first(),
    ).toBeVisible();

    // A carried container is ineligible for the Mining-tool equip action this
    // feature adds, so NO Equip control may appear in its Inventory details.
    await expect(detailsPanel.getByRole("button", { name: /Equip in/ })).toHaveCount(0);
  });
});
