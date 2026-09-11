import { expect, test, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
  characterCargoHoldRepair,
  characterMissions,
  characters,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { captureReviewScreenshot } from "./review-screenshot";

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

test("keeps damaged Cargo Hold locked and transfers completed storage on mobile and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  const balance = getEffectiveGameBalance();

  const cargoPanel = page.locator("[data-cargo-hold]");
  const selection = cargoPanel.locator("[data-cargo-selection]");
  const lockedStatus = cargoPanel.locator('[data-cargo-hold-status="locked"]');
  const restoredStatus = cargoPanel.locator('[data-cargo-hold-status="restored"]');
  const operationalStatus = cargoPanel.locator('[data-cargo-hold-status="operational"]');
  const completionAnnouncement = cargoPanel.locator("[data-cargo-hold-announcement]");
  const expectSteadyState = async (occupancy = "0 / 32") => {
    await expect(restoredStatus).toHaveCount(0);
    await expect(operationalStatus).toBeVisible();
    await expect(cargoPanel.getByRole("heading", { name: "CARGO HOLD", exact: true })).toHaveCount(
      1,
    );
    await expect(cargoPanel.getByText("OPERATIONAL", { exact: true })).toHaveCount(1);
    await expect(operationalStatus).toContainText(`${occupancy} SLOTS OCCUPIED`);
    await expect(operationalStatus.getByRole("button", { name: "OPEN CARGO HOLD" })).toBeVisible();
    await expect(completionAnnouncement).toHaveText("");
  };
  await expect(cargoPanel).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({
      hasText:
        "Your wrecked ship lies half-sunk in mud and scrap, with only a few systems still worth salvaging.",
    }),
  ).toBeVisible();
  await expect(lockedStatus).toBeVisible();
  await expect(
    cargoPanel.getByRole("heading", { name: "Damaged Cargo Hold", exact: true }),
  ).toBeVisible();
  await expect(cargoPanel).toContainText(
    "The Cargo Hold is buckled from the crash and still inaccessible.",
  );
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toHaveCount(0);
  await expect(cargoPanel).not.toContainText("Refined Ferrite");
  await expect(cargoPanel).not.toContainText("Slag");
  await expect(cargoPanel).not.toContainText("Welding");
  await expect(cargoPanel).not.toContainText("CONTRIBUTE MATERIALS");
  await expect(cargoPanel).not.toContainText("START WELDING");
  await captureReviewScreenshot(page, "cargo-mobile-locked.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await db.insert(characterMissions).values({
    characterId,
    missionId: MISSION_IDS.holdItTogether,
    acceptedAt: new Date(),
  });
  await db.insert(inventoryStacks).values([
    {
      characterId,
      itemId: ITEM_IDS.refinedFerrite,
      quantity: balance.cargoHold.refinedFerriteRequired,
    },
    { characterId, itemId: ITEM_IDS.slag, quantity: balance.cargoHold.slagRequired },
  ]);
  await page.reload();
  await expect(lockedStatus).toHaveCount(0);
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 6");
  // Mission guidance: Hold It Together is active with materials still needed,
  // so CONTRIBUTE MATERIALS carries the generic green treatment.
  await expect(cargoPanel.getByRole("button", { name: "CONTRIBUTE MATERIALS" })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  await cargoPanel.getByRole("button", { name: "CONTRIBUTE MATERIALS" }).click();
  const confirmation = page.locator("[data-cargo-confirmation]");
  await expect(confirmation).toContainText("Refined Ferrite ×15");
  await expect(confirmation).toContainText("Slag ×6");
  await confirmation.getByRole("button", { name: "COMMIT MATERIALS" }).click();
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("15 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("6 / 6");
  // Materials complete and Welding idle: START WELDING is now the guided affordance.
  await expect(cargoPanel.getByRole("button", { name: "START WELDING" })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  await expect(cargoPanel.getByRole("button", { name: "START WELDING" })).toBeVisible();
  await cargoPanel.getByRole("button", { name: "START WELDING" }).click();
  await expect(cargoPanel.getByRole("button", { name: "STOP WELDING" })).toBeVisible();
  // Active Welding never advances the mission: STOP WELDING carries no green guidance.
  await expect(cargoPanel.getByRole("button", { name: "STOP WELDING" })).not.toHaveAttribute(
    "data-mission-guidance",
  );

  const completedAgo = new Date(
    Date.now() -
      balance.welding.repairIncrements * balance.welding.attemptDurationTicks * 600 -
      100,
  );
  await db
    .update(activeActions)
    .set({ startedAt: completedAgo, resolvedThroughAt: completedAgo })
    .where(eq(activeActions.characterId, characterId));
  await captureReviewScreenshot(page, "cargo-mobile-restored.png");

  await expect(restoredStatus).toBeVisible({ timeout: 10_000 });
  await expectSteadyState();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await expect(cargoPanel.locator("[data-cargo-storage]")).toBeVisible();
  await expect(cargoPanel.getByRole("button", { name: "CLOSE CARGO HOLD" })).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText(
    "No occupied Cargo Hold items",
  );

  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 3,
  });
  await page.reload();
  await expectSteadyState();
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  // No per-item transfer button is visible until a tile is selected.
  await expect(cargoPanel.getByRole("button", { name: "DEPOSIT STACK" })).toHaveCount(0);
  await expect(cargoPanel.getByRole("button", { name: "DEPOSIT 1" })).toHaveCount(0);
  await expect(selection).toHaveCount(0);
  const carriedSection = cargoPanel.locator("[data-cargo-mode='carried']");
  await carriedSection.getByRole("button", { name: /Ferrite Shale/ }).click();
  await expect(selection).toBeVisible();
  await expect(selection.getByRole("button", { name: "DEPOSIT 1" })).toBeVisible();
  await selection.getByRole("button", { name: "DEPOSIT STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("Ferrite Shale");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("1 / 32");
  // Fully deposited: the selection reconciles away and its action area closes.
  await expect(selection).toHaveCount(0);
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toContainText(
    "No occupied carried items.",
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toBeVisible();
  await captureReviewScreenshot(page, "cargo-desktop-storage.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(characters.id, characterId));
  await page.reload();
  await expect(page.locator("[data-cargo-hold]")).toHaveCount(0);

  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.crashSite })
    .where(eq(characters.id, characterId));
  await page.reload();
  await expect(cargoPanel).toBeVisible();
  await expectSteadyState("1 / 32");
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("Ferrite Shale");
  await expect(cargoPanel.getByRole("button", { name: "WITHDRAW STACK" })).toHaveCount(0);
  const cargoSection = cargoPanel.locator("[data-cargo-mode='cargo']");
  await cargoSection.getByRole("button", { name: /Ferrite Shale/ }).click();
  await expect(selection).toBeVisible();
  await expect(selection.getByRole("button", { name: "WITHDRAW 1" })).toBeVisible();
  await selection.getByRole("button", { name: "WITHDRAW STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toContainText("Ferrite Shale");
  await expect(selection).toHaveCount(0);
});

test("keeps a previously repaired Cargo Hold usable without mission state", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  const balance = getEffectiveGameBalance();
  await db
    .update(characterCargoHoldRepair)
    .set({
      refinedFerriteContributed: balance.cargoHold.refinedFerriteRequired,
      slagContributed: balance.cargoHold.slagRequired,
      weldingProgress: balance.welding.repairIncrements,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(characterCargoHoldRepair.characterId, characterId));
  await page.reload();

  const cargoPanel = page.locator("[data-cargo-hold]");
  await expect(cargoPanel.locator('[data-cargo-hold-status="locked"]')).toHaveCount(0);
  await expect(cargoPanel.locator('[data-cargo-hold-status="operational"]')).toBeVisible();
  await expect(cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" })).toBeVisible();
});

test("renders a dense Cargo Hold as a compact selectable grid (Issue #151)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  const balance = getEffectiveGameBalance();

  await db
    .update(characterCargoHoldRepair)
    .set({
      refinedFerriteContributed: balance.cargoHold.refinedFerriteRequired,
      slagContributed: balance.cargoHold.slagRequired,
      weldingProgress: balance.welding.repairIncrements,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(characterCargoHoldRepair.characterId, characterId));

  // Narrow authoritative fixture: seed a dense, mixed stack/unique occupied
  // Cargo Hold directly rather than reconstructing mining/refining/Welding
  // progression solely to populate it.
  await db.insert(cargoHoldStacks).values([
    { characterId, itemId: ITEM_IDS.ferriteShale, quantity: 4 },
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 2 },
    { characterId, itemId: ITEM_IDS.powerCell, quantity: 1 },
  ]);
  const cargoUniqueInstances = await db
    .insert(itemInstances)
    .values([
      { characterId, itemId: ITEM_IDS.mykeaSchleppraum8 },
      { characterId, itemId: ITEM_IDS.mykeaSchleppraum8 },
      { characterId, itemId: ITEM_IDS.mykeaSchleppraum8 },
      { characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 },
      { characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 },
    ])
    .returning();
  await db
    .insert(cargoHoldItemInstances)
    .values(cargoUniqueInstances.map((instance) => ({ characterId, itemInstanceId: instance.id })));

  // A carried stack and a carried unique item exercise the Deposit side and
  // moving the selection between the two areas.
  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 2,
  });
  await db.insert(itemInstances).values({
    characterId,
    itemId: ITEM_IDS.salvageCutter,
    currentCharge: 0,
  });

  await page.reload();
  const cargoPanel = page.locator("[data-cargo-hold]");
  const selection = cargoPanel.locator("[data-cargo-selection]");
  await expect(cargoPanel.locator('[data-cargo-hold-status="operational"]')).toBeVisible();
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  const cargoSection = cargoPanel.locator("[data-cargo-mode='cargo']");
  const carriedSection = cargoPanel.locator("[data-cargo-mode='carried']");

  // Mobile portrait: switch to the CARGO tab to view the dense grid.
  await cargoPanel.getByRole("tab", { name: /^CARGO/ }).click();
  await expect(cargoSection).toBeVisible();

  // Nine occupied Cargo Hold entries (4 stacks + 5 unique instances) render as
  // a compact tile grid, never as one large row per item.
  await expect(cargoSection).toContainText("9 / 32");
  await expect(cargoSection.locator("button[aria-pressed]")).toHaveCount(9);
  await expect(selection).toHaveCount(0);
  // No per-item Withdraw/Deposit button is visible anywhere until a tile is
  // selected.
  await expect(page.getByRole("button", { name: /WITHDRAW/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /DEPOSIT/ })).toHaveCount(0);
  await captureReviewScreenshot(page, "cargo-mobile-dense-grid.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Keyboard selection: focusing and activating a Cargo stack tile exposes
  // its existing Withdraw actions.
  const cargoFerriteTile = cargoSection.getByRole("button", { name: /Ferrite Shale/ });
  await cargoFerriteTile.focus();
  await page.keyboard.press("Enter");
  await expect(cargoFerriteTile).toHaveAttribute("aria-pressed", "true");
  await expect(selection).toBeVisible();
  // Shared selectable-details contract: an explicit selection moves focus to
  // the selected item's action-area heading, so a keyboard user reaches the
  // Withdraw controls immediately instead of tabbing through the rest of a
  // dense grid (the same reveal the Inventory drawer performs).
  const selectionHeading = selection.locator("[data-cargo-selection-heading]");
  await expect(selectionHeading).toHaveAttribute("tabindex", "-1");
  await expect
    .poll(() => selectionHeading.evaluate((element) => element === document.activeElement))
    .toBe(true);
  await expect(selection).toContainText("Ferrite Shale");
  await expect(selection.getByRole("button", { name: "WITHDRAW 1" })).toBeVisible();
  await expect(selection.getByRole("button", { name: "WITHDRAW STACK" })).toBeVisible();
  await expect(selection.getByRole("button", { name: /DEPOSIT/ })).toHaveCount(0);
  await captureReviewScreenshot(page, "cargo-mobile-selected.png");

  // Selecting a different Cargo unique tile moves the contextual action state
  // to it and clears the prior tile's pressed state.
  const mykeaTile = cargoSection.getByRole("button", { name: "MYKEA SCHLEPPRAUM-8" }).first();
  await mykeaTile.click();
  await expect(cargoFerriteTile).toHaveAttribute("aria-pressed", "false");
  await expect(mykeaTile).toHaveAttribute("aria-pressed", "true");
  await expect(selection).toContainText("MYKEA SCHLEPPRAUM-8");
  await expect(selection.getByRole("button", { name: "WITHDRAW ITEM" })).toBeVisible();

  // Widen to desktop, where Carried and Cargo render side by side without the
  // mobile tab switcher, to exercise moving the selection across areas.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(carriedSection).toBeVisible();
  await expect(cargoSection).toBeVisible();

  // Selecting a carried stack moves the selection across areas and exposes
  // Deposit actions instead.
  const carriedFerriteTile = carriedSection.getByRole("button", { name: /Ferrite Shale/ });
  await carriedFerriteTile.click();
  await expect(mykeaTile).toHaveAttribute("aria-pressed", "false");
  await expect(selection).toContainText("Ferrite Shale");
  await expect(selection.getByRole("button", { name: "DEPOSIT 1" })).toBeVisible();
  await expect(selection.getByRole("button", { name: "DEPOSIT STACK" })).toBeVisible();

  // The carried unique Salvage Cutter is the other occupied carried tile;
  // it survives this transfer, so it is the focus-restoration target.
  const carriedCutterTile = carriedSection.getByRole("button", { name: "Salvage Cutter" });

  // Depositing the full carried stack merges into the existing Cargo Ferrite
  // Shale stack (occupied Cargo entry count is unchanged); the vacated
  // selection reconciles away and focus returns to the surviving occupied
  // Carried tile rather than being dropped to the document body.
  await selection.getByRole("button", { name: "DEPOSIT STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(selection).toHaveCount(0);
  await expect(cargoSection).toContainText("9 / 32");
  await expect(cargoSection.getByRole("button", { name: "6 Ferrite Shale" })).toBeVisible();
  await expect(carriedCutterTile).toBeVisible();
  await expect
    .poll(() => carriedCutterTile.evaluate((element) => element === document.activeElement))
    .toBe(true);

  // Selecting and depositing the last carried unique item exercises the
  // unique-item Deposit path; once Carried is fully vacated, focus falls back
  // to the Carried section root (the empty state renders no tile at all)
  // instead of being dropped.
  await carriedCutterTile.click();
  await expect(selection.getByRole("button", { name: "DEPOSIT ITEM" })).toBeVisible();
  await selection.getByRole("button", { name: "DEPOSIT ITEM" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(selection).toHaveCount(0);
  await expect(cargoSection).toContainText("10 / 32");
  await expect(cargoSection.locator("button[aria-pressed]")).toHaveCount(10);
  await expect(carriedSection).toContainText("No occupied carried items.");
  await expect
    .poll(() => carriedSection.evaluate((element) => element === document.activeElement))
    .toBe(true);
});
