import { expect, test, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characterCargoHoldRepair, characters, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
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
  await expect(lockedStatus).toBeVisible();
  await expect(
    cargoPanel.getByRole("heading", { name: "Damaged Cargo Hold", exact: true }),
  ).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toHaveCount(0);
  await expect(cargoPanel).not.toContainText("Refined Ferrite");
  await expect(cargoPanel).not.toContainText("Slag");
  await expect(cargoPanel).not.toContainText("Welding");
  await expect(cargoPanel).not.toContainText("CONTRIBUTE MATERIALS");
  await expect(cargoPanel).not.toContainText("START WELDING");
  await captureReviewScreenshot(page, "cargo-mobile-locked.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

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
  await captureReviewScreenshot(page, "cargo-mobile-restored.png");

  await expectSteadyState();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await expect(cargoPanel.locator("[data-cargo-storage]")).toBeVisible();
  await expect(cargoPanel.getByRole("button", { name: "CLOSE CARGO HOLD" })).toBeVisible();
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText(
    "No occupied Cargo Hold items",
  );

  const carriedStack = (
    await db
      .insert(inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 })
      .returning()
  )[0]!;
  await page.reload();
  await expectSteadyState();
  await cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" }).click();
  await cargoPanel.getByRole("button", { name: "DEPOSIT STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("Ferrite Shale");
  await expect(cargoPanel.locator("[data-cargo-mode='cargo']")).toContainText("1 / 32");
  await expect(cargoPanel.locator(`[data-cargo-entry='${carriedStack.id}']`)).toHaveCount(0);

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
  await cargoPanel.getByRole("button", { name: "WITHDRAW STACK" }).click();
  await expect(cargoPanel).toContainText("Cargo Hold transfer complete.");
  await expect(cargoPanel.locator("[data-cargo-mode='carried']")).toContainText("Ferrite Shale");
});
