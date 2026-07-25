import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMiningState,
  characterStarterProvisioning,
  characterTravelState,
  inventoryStacks,
} from "@/db/rune-space";
import { LOCATION_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Travel E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openTravelFixture(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openTravelFixture(page);
  await Promise.all([
    db.delete(activeActions).where(eq(activeActions.characterId, characterId)),
    db.delete(characterTravelState).where(eq(characterTravelState.characterId, characterId)),
    db.delete(characterMiningState).where(eq(characterMiningState.characterId, characterId)),
    db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId)),
    db
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId)),
  ]);
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();
});

test("selecting a destination does not begin travel; confirmation is required", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  // Stationary at the Crash Site.
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/travel-desktop-stationary.png" });

  // Select the Processing Yard — Travel must NOT start yet.
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await expect(
    page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }),
  ).toBeVisible();
  await expect(page.getByText("Walking time: 24 seconds")).toBeVisible();
  // The map remains read-only: no IN TRANSIT yet.
  await expect(page.getByText("In transit", { exact: false })).toHaveCount(0);
  // Selecting again does not create a journey server-side.
  await expect(
    db.select().from(characterTravelState).where(eq(characterTravelState.characterId, characterId)),
  ).resolves.toEqual([]);

  await page.screenshot({ path: "test-results/travel-mobile-selected.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/travel-desktop-selected.png" });
});

test("the full journey walks, arrives, and returns between the two locations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  // Start Mining and resolve one controlled attempt.
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const twoAttemptsAgo = new Date(Date.now() - 12_100);
  await db
    .update(activeActions)
    .set({ startedAt: twoAttemptsAgo, resolvedThroughAt: twoAttemptsAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("1 successful", { exact: true })).toBeVisible();

  // Select the destination and confirm departure.
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await expect(page.getByText(/Departing resolves your completed Mining work/)).toBeVisible();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("In transit", { exact: false })).toBeVisible();
  // Mining stopped; completed work retained.
  await expect(page.getByText("1 successful", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveCount(0);

  await page.screenshot({ path: "test-results/travel-mobile-in-transit.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/travel-desktop-in-transit.png" });
  await page.setViewportSize({ width: 390, height: 844 });

  // Fast-forward the journey server-side, then refresh to resolve arrival.
  const departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await db
    .update(characterTravelState)
    .set({ startedAt: departPast })
    .where(eq(characterTravelState.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Arrived at the Processing Yard.
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.getByText(/Mining is only available at the Crash Site/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveCount(0);

  await page.screenshot({ path: "test-results/travel-mobile-arrived.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/travel-desktop-arrived.png" });
  await page.setViewportSize({ width: 390, height: 844 });

  // Return journey: select the Crash Site and walk back.
  await page
    .getByRole("button", { name: /Crash Site/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Walk to Crash Site/ })).toBeVisible();
  await page.getByRole("button", { name: /Walk to Crash Site/ }).click();
  await expect(page.getByText("In transit", { exact: false })).toBeVisible();

  const returnPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: returnPast, resolvedThroughAt: returnPast })
    .where(eq(activeActions.characterId, characterId));
  await db
    .update(characterTravelState)
    .set({ startedAt: returnPast })
    .where(eq(characterTravelState.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Back at the Crash Site, Mining is available again.
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
});

test("keyboard users can select and confirm a destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const yard = page.getByRole("button", { name: /Abandoned Processing Yard/ });
  await yard.focus();
  await expect(yard).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }),
  ).toBeVisible();
  await expect(yard).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(page.getByText("In transit", { exact: false })).toBeVisible();
});
