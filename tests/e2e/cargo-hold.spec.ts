import { expect, test, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { captureReviewScreenshot } from "./review-screenshot";

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

test("repairs the Cargo Hold, hard-stops Welding, and transfers occupied storage on mobile and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 15 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 6 },
  ]);
  await page.reload();

  const cargoPanel = page.locator("[data-cargo-hold]");
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
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("0 / 6");
  await expect(cargoPanel).toContainText("LOCKED until both material requirements are complete");
  await captureReviewScreenshot(page, "cargo-mobile-repair.png");

  await cargoPanel.getByRole("button", { name: "CONTRIBUTE MATERIALS" }).click();
  const confirmation = page.locator("[data-cargo-confirmation]");
  await expect(confirmation).toContainText("Refined Ferrite ×15");
  await expect(confirmation).toContainText("Slag ×6");
  await expect(confirmation).toContainText("cannot be recovered");
  await confirmation.getByRole("button", { name: "COMMIT MATERIALS" }).click();
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("15 / 15");
  await expect(cargoPanel.locator("[data-cargo-repair-materials]")).toContainText("6 / 6");
  await expect(cargoPanel.getByRole("button", { name: "START WELDING" })).toBeVisible();

  await cargoPanel.getByRole("button", { name: "START WELDING" }).click();
  await expect(cargoPanel.getByRole("button", { name: "STOP WELDING" })).toBeVisible();
  await expect(cargoPanel).toContainText("0 / 12 completed increments");
  await expect(cargoPanel).toContainText("Current welding pass");

  const completedAgo = new Date(Date.now() - 12 * 5 * 600 - 100);
  await db
    .update(activeActions)
    .set({ startedAt: completedAgo, resolvedThroughAt: completedAgo })
    .where(eq(activeActions.characterId, characterId));
  // The mounted play boundary reconciles due work without a reload. This
  // proves the completion transition is authoritative and immediate in the
  // existing action-state presentation.
  await expect(restoredStatus).toBeVisible({ timeout: 10_000 });
  await expect(restoredStatus).toContainText("CARGO HOLD RESTORED");
  await expect(completionAnnouncement).toHaveText("CARGO HOLD RESTORED");
  await expect(restoredStatus).toContainText("0 / 32 SLOTS OCCUPIED");
  await expect(cargoPanel.getByRole("button", { name: "OPEN CARGO HOLD" })).toBeVisible();
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
