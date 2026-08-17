import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  characterMiningState,
  characterPowerCellDailyClaims,
  characterSkillXp,
  characterStarterProvisioning,
  characterTravelState,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { POWER_CELL_DAILY_ALLOTMENT } from "@/game/domain/power-annex";
import { expectElementsInsideHexes } from "./map-geometry";
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

/** Scroll the local map into the center of the viewport so neither hex is
 * hidden by the fixed bottom navigation. */
async function scrollMapIntoView(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Local map"]');
    if (el) el.scrollIntoView({ block: "center" });
  });
}

async function expectMapStatusPlatesInsideHex(page: import("@playwright/test").Page) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-status",
  );
  expect(geometry.labels.sort()).toEqual(["Daily cells", "Mining", "Refining"]);
  expect(geometry.allInside).toBe(true);
  expect(geometry.routeOverlaps).toEqual([]);
}

async function expectMapNameplatesInsideHex(page: import("@playwright/test").Page) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-nameplate",
  );
  expect(geometry.labels.sort()).toEqual(["Crash Site", "Power Annex", "Processing Yard"]);
  expect(geometry.allInside).toBe(true);
  expect(geometry.routeOverlaps).toEqual([]);
}

async function expectMapStateLabelsInsideHex(
  page: import("@playwright/test").Page,
  expectedLabels: readonly string[],
) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-state",
  );
  expect(geometry.labels.sort()).toEqual([...expectedLabels].sort());
  expect(geometry.allInside).toBe(true);
  expect(geometry.routeOverlaps).toEqual([]);
}

const STATIONARY_STATE_LABELS = ["You are here", "Reachable", "Reachable"] as const;
const SELECTED_STATE_LABELS = ["You are here", "Selected", "Reachable"] as const;
const IN_TRANSIT_STATE_LABELS = ["Origin", "Destination", "Reachable"] as const;

async function expectPowerAnnexRewardLayout(
  page: import("@playwright/test").Page,
  { claimed }: { claimed: boolean },
) {
  const left = page.locator("[data-power-annex-reward-left]");
  const tile = left.getByRole("article");
  const tileBox = await tile.boundingBox();
  const leftBox = await left.boundingBox();
  expect(tileBox).not.toBeNull();
  expect(leftBox).not.toBeNull();

  if (claimed) {
    await expect(left.getByRole("button")).toHaveCount(0);
    expect(Math.abs((leftBox?.height ?? 0) - (tileBox?.height ?? 0))).toBeLessThanOrEqual(2);
  } else {
    const claimButton = left.getByRole("button", { name: "Claim Power Cells" });
    const buttonBox = await claimButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    const tileCenter = (tileBox?.x ?? 0) + (tileBox?.width ?? 0) / 2;
    const buttonCenter = (buttonBox?.x ?? 0) + (buttonBox?.width ?? 0) / 2;
    expect(Math.abs(tileCenter - buttonCenter)).toBeLessThanOrEqual(2);
  }

  const infoBox = await page.locator("[data-power-annex-reward-info]").boundingBox();
  expect(infoBox).not.toBeNull();
  const buttonBox = claimed
    ? undefined
    : await left.getByRole("button", { name: "Claim Power Cells" }).boundingBox();
  const combinedBottom = claimed
    ? (tileBox?.y ?? 0) + (tileBox?.height ?? 0)
    : (buttonBox?.y ?? 0) + (buttonBox?.height ?? 0);
  const combinedCenter = ((tileBox?.y ?? 0) + combinedBottom) / 2;
  const infoCenter = (infoBox?.y ?? 0) + (infoBox?.height ?? 0) / 2;
  expect(Math.abs(combinedCenter - infoCenter)).toBeLessThanOrEqual(4);
}

async function expectMiningDashboardsVisible(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Success chance:", { exact: false })).toBeVisible();
  await expect(page.getByText("Mining progression", { exact: true })).toBeVisible();
  await expect(page.getByText("Cargo readout", { exact: true })).toBeVisible();
  await expect(page.getByText("This mining run", { exact: true })).toBeVisible();
}

async function expectMiningDashboardsHidden(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop Mining" })).toHaveCount(0);
  await expect(page.getByText("Mining attempt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Latest attempt:", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Mining progression", { exact: true })).toHaveCount(0);
  await expect(page.getByText("This mining run", { exact: true })).toHaveCount(0);
}

async function expectRouteProgressStartsAt(
  page: import("@playwright/test").Page,
  originLocationId: string,
) {
  const map = page.locator('[aria-label="Local map"]');
  // The first static line is the original Crash Site ↔ Processing Yard route;
  // the helper is intentionally scoped to the existing two-location journey.
  const staticRoute = map.locator("line:not([data-route-progress])").first();
  const progressRoute = map.locator("line[data-route-progress]");
  await expect(progressRoute).toHaveAttribute("data-route-start-location", originLocationId);
  await expect(progressRoute).toHaveAttribute(
    "data-route-end-location",
    originLocationId === LOCATION_IDS.crashSite
      ? LOCATION_IDS.abandonedProcessingYard
      : LOCATION_IDS.crashSite,
  );
  const expectedStart =
    originLocationId === LOCATION_IDS.crashSite
      ? await staticRoute.getAttribute("x1")
      : await staticRoute.getAttribute("x2");
  const actualStart = await progressRoute.getAttribute("x1");
  expect(actualStart).toBe(expectedStart);
  await page.waitForTimeout(300);
  const progressEnd = Number(await progressRoute.getAttribute("x2"));
  expect(progressEnd).not.toBe(Number(actualStart));
  if (originLocationId === LOCATION_IDS.crashSite) {
    expect(progressEnd).toBeGreaterThan(Number(actualStart));
  } else {
    expect(progressEnd).toBeLessThan(Number(actualStart));
  }
}

async function setPowerAnnexClock(instant: string) {
  const clockPath = process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE;
  if (clockPath) await writeFile(clockPath, instant, "utf8");
}

async function arriveAtPowerAnnex(page: import("@playwright/test").Page, characterId: string) {
  const annex = page.getByRole("button", { name: /DeWhat\? Emergency Power Annex/ }).first();
  await expect(annex).toBeVisible();
  await annex.click();
  await expect(
    page.getByRole("button", { name: /Walk to DeWhat\? Emergency Power Annex/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Walk to DeWhat\? Emergency Power Annex/ }).click();
  await expect(page.getByText("Journey progress")).toBeVisible();

  const arrivedPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: arrivedPast, resolvedThroughAt: arrivedPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(
    page.getByRole("button", { name: /DeWhat\? Emergency Power Annex/ }).first(),
  ).toHaveAttribute("aria-current", "true");
}

test.beforeEach(async ({ page }) => {
  const characterId = await openTravelFixture(page);
  await db.transaction(async (transaction) => {
    // Clear all mutable gameplay rows to ensure per-test isolation.
    await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
    await transaction
      .delete(characterTravelState)
      .where(eq(characterTravelState.characterId, characterId));
    await transaction
      .delete(characterMiningState)
      .where(eq(characterMiningState.characterId, characterId));
    await transaction
      .delete(characterPowerCellDailyClaims)
      .where(eq(characterPowerCellDailyClaims.characterId, characterId));
    await transaction.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
    // `equipped_items` has a composite foreign key to item instances.
    await transaction.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
    await transaction.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
    await transaction.delete(characterSkillXp).where(eq(characterSkillXp.characterId, characterId));
    await transaction
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId));
    // Reset character location to the authoritative start.
    await transaction
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId));
  });
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();
});

test("selecting a destination does not begin travel; confirmation is required", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;

  // Stationary at the Crash Site.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();
  await expectMiningDashboardsVisible(page);
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await scrollMapIntoView(page);
  await expectMapStatusPlatesInsideHex(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, STATIONARY_STATE_LABELS);
  await page.screenshot({ path: "test-results/travel-mobile-stationary.png" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapStatusPlatesInsideHex(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, STATIONARY_STATE_LABELS);
  await page.screenshot({ path: "test-results/travel-desktop-stationary.png" });

  await page.setViewportSize({ width: 390, height: 844 });

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

  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, SELECTED_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/travel-mobile-selected.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, SELECTED_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/travel-desktop-selected.png" });
});

test("automatically reconciles arrival without refresh or reload", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  await page.goto("/characters");
  const boundaryStart = new Date(Date.now() - 23_400);
  await db.insert(activeActions).values({
    characterId,
    actionId: ACTION_IDS.travel,
    startedAt: boundaryStart,
    resolvedThroughAt: boundaryStart,
  });
  await db.insert(characterTravelState).values({
    characterId,
    originLocationId: LOCATION_IDS.crashSite,
    destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
  });
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);

  await expect(page.getByText("Journey progress")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true", { timeout: 10_000 });
  await expect(
    db.select().from(activeActions).where(eq(activeActions.characterId, characterId)),
  ).resolves.toEqual([]);
  await expect(
    db.select().from(characterTravelState).where(eq(characterTravelState.characterId, characterId)),
  ).resolves.toEqual([]);
});

test("the full journey walks, arrives, and returns between the original locations", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;

  // Stationary at the Crash Site — screenshot.
  await page.setViewportSize({ width: 390, height: 844 });

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
  await expect(page.getByText("Latest attempt:", { exact: false })).toBeVisible();

  // Select the destination and confirm departure.
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await expect(page.getByText(/Departing resolves your completed Mining work/)).toBeVisible();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  // The authoritative state is applied immediately — verify the transit UI.
  await expect(page.getByText("Journey progress")).toBeVisible();
  // The header banner no longer repeats the transit subtitle; the main activity
  // panel exposes the in-transit heading instead (Issue #52 sizing decision).
  await expect(page.getByRole("banner").getByText(/In transit/)).toHaveCount(0);
  await expect(
    page.getByRole("main").getByText("In transit", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Mining stopped before departure. No new activity can begin until you arrive."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You are walking between locations. Mining stopped before departure, and no new activity can begin until you arrive. Use the world map below to follow your journey.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/paused/i)).toHaveCount(0);
  await expectMiningDashboardsHidden(page);
  await expectRouteProgressStartsAt(page, LOCATION_IDS.crashSite);
  // Hybrid chassis rivets (data-map-rivet) are intentional and exempt; no other circles must appear during transit.
  await expect(
    page.locator('[aria-label="Local map"] svg circle:not([data-map-rivet])'),
  ).toHaveCount(0);
  await expect(page.locator('[aria-label="Local map"] svg circle[data-map-rivet]')).toHaveCount(18);

  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, IN_TRANSIT_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/travel-mobile-in-transit.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, IN_TRANSIT_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/travel-desktop-in-transit.png" });
  await page.setViewportSize({ width: 390, height: 844 });

  // Fast-forward the journey server-side, then refresh to resolve arrival.
  const departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();

  // Arrived at the Processing Yard.
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true");
  // Refining is available at the Yard (issue #81): the activity panel shows
  // the Refining console, not the old "offline" message.
  await expect(page.getByRole("button", { name: "Start Refining" })).toBeVisible();
  await expect(page.getByText("Refining progression", { exact: true })).toBeVisible();
  await expect(page.getByText("Cargo readout", { exact: true })).toBeVisible();
  await expect(page.getByText("This refining run", { exact: true })).toBeVisible();
  await expectMiningDashboardsHidden(page);
  await expect(page.getByText(/Metallurgy progression/i)).toHaveCount(0);

  await scrollMapIntoView(page);
  await page.screenshot({ path: "test-results/travel-mobile-arrived.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await page.screenshot({ path: "test-results/travel-desktop-arrived.png" });
  await page.setViewportSize({ width: 390, height: 844 });

  // Return journey: select the Crash Site and walk back.
  await page
    .getByRole("button", { name: /Crash Site/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Walk to Crash Site/ })).toBeVisible();
  await page.getByRole("button", { name: /Walk to Crash Site/ }).click();
  await expect(page.getByText("Journey progress")).toBeVisible();
  await expectMiningDashboardsHidden(page);
  await expectRouteProgressStartsAt(page, LOCATION_IDS.abandonedProcessingYard);
  await expect(
    page.locator('[aria-label="Local map"] svg circle:not([data-map-rivet])'),
  ).toHaveCount(0);
  await expect(page.locator('[aria-label="Local map"] svg circle[data-map-rivet]')).toHaveCount(18);

  const returnPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: returnPast, resolvedThroughAt: returnPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();

  // Back at the Crash Site, Mining is available again.
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expectMiningDashboardsVisible(page);
  await expect(page.getByText("Latest attempt:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
});

test("keyboard users can select and confirm a destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  // 1. Focus the reachable destination hex.
  const yard = page.getByRole("button", { name: /Abandoned Processing Yard/ }).first();
  await yard.focus();
  await expect(yard).toBeFocused();

  // 2. Activate it using Enter.
  await page.keyboard.press("Enter");

  // 3. Assert selected state on the hex cell (before the Walk button
  //    introduces a second match for the same name pattern).
  await expect(yard).toHaveAttribute("aria-pressed", "true");

  // 4. Verify no Travel row has started.
  await expect(
    db.select().from(characterTravelState).where(eq(characterTravelState.characterId, characterId)),
  ).resolves.toEqual([]);

  // 5. Verify the confirmation control appears.
  const confirmButton = page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ });
  await expect(confirmButton).toBeVisible();

  // 6-7. Focus and activate the confirmation control with a second Enter.
  await confirmButton.focus();
  await page.keyboard.press("Enter");

  // 8. Verify IN TRANSIT appears immediately from the server-returned state.
  await expect(page.getByText("Journey progress")).toBeVisible();
});

test("reduced-motion presentation retains equivalent travel information", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Emulate prefers-reduced-motion.
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Stationary state must show current location.
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();

  // Select the Processing Yard — details visible without animation.
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await expect(page.getByText("Walking time: 24 seconds")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }),
  ).toBeVisible();

  // Confirm and verify in-transit status is announced.
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("Journey progress")).toBeVisible();
  // The aria-live region announces progress without animation dependency.
  await expect(page.getByText(/seconds remaining/)).toBeVisible();
});

test("travels to the Power Annex and claims independently by Pacific reset date", async ({
  page,
}) => {
  const characterId = await openTravelFixture(page);
  const controlledClock = Boolean(process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE);
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveAtPowerAnnex(page, characterId);

  await setPowerAnnexClock("2026-01-02T07:59:59.000Z");
  await page.reload();
  await expect(page.getByRole("button", { name: "Claim Power Cells" })).toBeVisible();
  const availableTile = page.getByRole("article", { name: "5 Power Cells available to claim" });
  await expect(availableTile.getByText("x5", { exact: true })).toBeVisible();
  await expect(availableTile.locator("img")).not.toHaveClass(/grayscale/);
  const availableTileBox = await availableTile.boundingBox();
  expect(availableTileBox?.width ?? 0).toBeLessThan(200);
  await expectPowerAnnexRewardLayout(page, { claimed: false });
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/power-annex-mobile-available.png" });
  await page.getByRole("button", { name: "Claim Power Cells" }).click();
  await expect(
    page.getByText(/Today's emergency allotment claimed: 5 Power Cells awarded/),
  ).toBeVisible();
  await expect(page.getByText(/Today's allotment claimed/)).toBeVisible();
  const claimedTile = page.getByRole("article", {
    name: /0 Power Cells currently available/,
  });
  await expect(claimedTile.getByText("x0", { exact: true })).toBeVisible();
  await expect(claimedTile.locator("img")).toHaveClass(/grayscale/);
  await expect(
    page.getByText(
      new RegExp(`Today's ${POWER_CELL_DAILY_ALLOTMENT}-cell allotment has already been claimed`),
    ),
  ).toBeVisible();
  await expectPowerAnnexRewardLayout(page, { claimed: true });
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/power-annex-mobile-claimed.png" });

  await page.getByRole("button", { name: /Inventory/ }).click();
  const claimedCell = page.getByLabel("5 Power Cell", { exact: true });
  await expect(claimedCell).toBeVisible();
  await expect(claimedCell.locator("img")).toHaveAttribute("src", /power-cell/);
  await page.getByRole("button", { name: "Close inventory" }).click();
  await page.reload();
  await expect(page.getByText(/Today's allotment claimed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim Power Cells" })).toHaveCount(0);

  if (!controlledClock) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectPowerAnnexRewardLayout(page, { claimed: true });
    await expectMapStatusPlatesInsideHex(page);
    await page.screenshot({ path: "test-results/power-annex-desktop-available.png" });
    return;
  }

  await setPowerAnnexClock("2026-01-02T08:00:00.000Z");
  await page.reload();
  await expect(page.getByRole("button", { name: "Claim Power Cells" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "5 Power Cells available to claim" }).getByText("x5", {
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectPowerAnnexRewardLayout(page, { claimed: false });
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/power-annex-desktop-available.png" });
  await page.getByRole("button", { name: "Claim Power Cells" }).click();
  await expect(
    page.getByText(/Today's emergency allotment claimed: 5 Power Cells awarded/),
  ).toBeVisible();
  const desktopClaimedTile = page.getByRole("article", {
    name: /0 Power Cells currently available/,
  });
  await expect(desktopClaimedTile.getByText("x0", { exact: true })).toBeVisible();
  await expect(desktopClaimedTile.locator("img")).toHaveClass(/grayscale/);
  await expectPowerAnnexRewardLayout(page, { claimed: true });
  await expectMapStatusPlatesInsideHex(page);
  await page.screenshot({ path: "test-results/power-annex-desktop-claimed.png" });
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.getByLabel("5 Power Cell", { exact: true })).toHaveCount(2);
});

test("a capacity refusal keeps the Power Annex allotment available", async ({ page }) => {
  const characterId = await openTravelFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveAtPowerAnnex(page, characterId);

  await db.insert(inventoryStacks).values(
    Array.from({ length: 8 }, (_, index) => ({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: index + 1,
    })),
  );
  await page.reload();

  const availableTile = page.getByRole("article", { name: "5 Power Cells available to claim" });
  await expect(availableTile.getByText("x5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim Power Cells" })).toBeVisible();
  await page.getByRole("button", { name: "Claim Power Cells" }).click();
  await expect(page.getByText(/full five-cell allotment will not fit/)).toBeVisible();
  await expect(availableTile.getByText("x5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim Power Cells" })).toBeVisible();
});
