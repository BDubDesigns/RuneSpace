import { expect, test, openTestCharacter } from "./fixtures";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterScavengeReveals,
  characterTravelState,
  inventoryStacks,
} from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { POWER_CELL_DAILY_ALLOTMENT } from "@/game/domain/power-annex";
import { seedLegacyStarterCutter } from "./legacy-starter";
import { expectElementsInsideHexes } from "./map-geometry";
import { captureReviewScreenshot } from "./review-screenshot";

/** Scroll the local map into the center of the viewport so neither hex is
 * hidden by the fixed bottom navigation. */
async function scrollMapIntoView(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Local map"]');
    if (el) el.scrollIntoView({ block: "center" });
  });
}

async function expectMapScrollAffordances(
  page: import("@playwright/test").Page,
  directions: readonly string[],
) {
  const markers = page.locator("[data-map-scroll-affordance]");
  const expected = [...directions].sort();
  await expect
    .poll(
      async () =>
        (
          await markers.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-map-scroll-affordance")),
          )
        ).sort(),
      { message: "map scroll affordances to reflect the latest native scroll metrics" },
    )
    .toEqual(expected);
}

async function expectMapStatusPlatesInsideHex(page: import("@playwright/test").Page) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-status",
  );
  expect(geometry.labels.sort()).toEqual(["Daily cells", "Mining", "Refining"]);
  await expect(page.locator('[data-map-location="crash_site"] [data-map-status]')).toHaveCount(0);
  await expect(
    page.locator('[data-map-location="the_long_scramble"] [data-map-status]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-map-location="the_jag"] [data-map-status]')).toHaveText(
    "Mining",
  );
  await expect(
    page.locator('[data-map-location="abandoned_processing_yard"] [data-map-status]'),
  ).toHaveText("Refining");
  await expect(
    page.locator('[data-map-location="dewhat_emergency_power_annex"] [data-map-status]'),
  ).toHaveText("Daily cells");
  expect(geometry.allInside).toBe(true);
  expect(geometry.routeOverlaps).toEqual([]);
}

async function expectMapNameplatesInsideHex(page: import("@playwright/test").Page) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-nameplate",
  );
  expect(geometry.labels.sort()).toEqual([
    "Crash Site",
    "Long Scramble",
    "Power Annex",
    "Processing Yard",
    "The Jag",
  ]);
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

const STATIONARY_STATE_LABELS = [
  "You are here",
  "Reachable",
  "Reachable",
  "Reachable",
  "Visible",
] as const;
const SELECTED_STATE_LABELS = [
  "You are here",
  "Selected",
  "Reachable",
  "Reachable",
  "Visible",
] as const;
const IN_TRANSIT_STATE_LABELS = [
  "Origin",
  "Destination",
  "Reachable",
  "Reachable",
  "Visible",
] as const;

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

async function expectNoMiningDashboards(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop Mining" })).toHaveCount(0);
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

async function openScavengeOpportunity(
  page: import("@playwright/test").Page,
  characterId: string,
  options: { opportunityStartTick?: number; travelAgeMs?: number } = {},
) {
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("Journey progress")).toBeVisible();

  // Put the authoritative travel clock just inside the approved tick-3 window
  // so the browser test does not wait on wall-clock travel.
  const travelStartedAt = new Date(Date.now() - (options.travelAgeMs ?? 1_850));
  await db
    .update(activeActions)
    .set({ startedAt: travelStartedAt, resolvedThroughAt: travelStartedAt })
    .where(eq(activeActions.characterId, characterId));
  await db
    .update(characterTravelState)
    .set({ scavengeOpportunityStartTick: options.opportunityStartTick ?? 3 })
    .where(eq(characterTravelState.characterId, characterId));
  await page.reload();

  const opportunity = page.locator('[data-scavenge-state="available"]');
  await expect(opportunity).toBeVisible();
  return opportunity;
}

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
  await expect(page.getByText("World map")).toBeVisible();
});

test("selecting a destination does not begin travel; confirmation is required", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;

  // Stationary at the Crash Site (no Mining here after issue #83 — Mining is at The Jag).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("You are here", { exact: false }).first()).toBeVisible();
  await expectNoMiningDashboards(page);
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, STATIONARY_STATE_LABELS);
  await captureReviewScreenshot(page, "travel-mobile-stationary.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, STATIONARY_STATE_LABELS);
  await captureReviewScreenshot(page, "travel-desktop-stationary.png");

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
  await captureReviewScreenshot(page, "travel-mobile-selected.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, SELECTED_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await captureReviewScreenshot(page, "travel-desktop-selected.png");
});

test("directional map affordances follow native scroll truth", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const viewport = page.locator("[data-map-scroll-viewport]");
  await expect(viewport).toBeVisible();

  const initialMetrics = await viewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(initialMetrics.scrollWidth).toBeGreaterThan(initialMetrics.clientWidth);
  await expectMapScrollAffordances(page, ["right"]);
  await expect(page.locator('[data-map-scroll-affordance="left"]')).toHaveCount(0);

  // The edge layer is decorative only; native scrolling still changes the
  // viewport and the opposite marker appears at the new edge.
  await expect(page.locator("[data-map-scroll-affordance-layer]")).toHaveCSS(
    "pointer-events",
    "none",
  );
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expectMapScrollAffordances(page, ["left"]);

  // A wide viewport fits the current five-location map, so neither horizontal
  // direction is advertised after the responsive resize.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectMapScrollAffordances(page, []);

  // Return to the narrow viewport and grow the map canvas. ResizeObserver must
  // notice the content-size change even though no scroll event fires.
  await page.setViewportSize({ width: 390, height: 844 });
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    const canvas = element.firstElementChild;
    if (!(canvas instanceof HTMLElement)) throw new Error("Missing local map canvas");
    canvas.style.width = "800px";
  });
  await expectMapScrollAffordances(page, ["left", "right"]);

  // Exercise the same axis-agnostic layer with synthetic future vertical map
  // growth, then confirm the top marker replaces the bottom marker at max scroll.
  await viewport.evaluate((element) => {
    element.style.height = "160px";
    const canvas = element.firstElementChild;
    if (!(canvas instanceof HTMLElement)) throw new Error("Missing local map canvas");
    canvas.style.height = "500px";
  });
  await expectMapScrollAffordances(page, ["left", "right", "bottom"]);
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expectMapScrollAffordances(page, ["left", "right", "top"]);

  // Reduced motion changes only the decoration, not the truth of the visible
  // directions, and removes the breathing animation entirely.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectMapScrollAffordances(page, ["left", "right", "top"]);
  await expect(page.locator('[data-map-scroll-affordance="top"]')).toHaveCSS(
    "animation-name",
    "none",
  );

  // A real hex remains activatable while the markers are present.
  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  await page
    .getByRole("button", { name: /Crash Site/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("automatically reconciles arrival without refresh or reload", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
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
  await page.goto(`/play/${characterId}`);
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

  // Stationary at the Crash Site — screenshot. Mining is at The Jag after issue #83,
  // so go via Long Scramble -> Jag, mine there, then return via Yard for the classic
  // Crash <-> Yard journey proof.
  await page.setViewportSize({ width: 390, height: 844 });

  // Reach The Jag and mine once.
  await page.getByRole("button", { name: /The Long Scramble/ }).click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  let departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByRole("button", { name: /The Long Scramble/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: /The Jag/ }).click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByRole("button", { name: /The Jag/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await seedLegacyStarterCutter(characterId);
  await page.reload();
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

  // Return to Crash Site via Long Scramble.
  await page.getByRole("button", { name: /The Long Scramble/ }).click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByRole("button", { name: /The Long Scramble/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: /Crash Site/ }).click();
  await page.getByRole("button", { name: /Walk to Crash Site/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  departPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );

  // From Crash Site, verify the walk to Yard still works (proving the
  // original triangle remains intact after the Scramble/Jag branch).
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await expect(page.getByText(/Walking time: 24 seconds/)).toBeVisible();
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
    page.getByText(
      "The active work stopped before departure. No new activity can begin until you arrive.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You are walking between locations. The active work stopped before departure, and no new activity can begin until you arrive. Use the world map below to follow your journey.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/paused/i)).toHaveCount(0);
  await expectNoMiningDashboards(page);
  await expectRouteProgressStartsAt(page, LOCATION_IDS.crashSite);
  // Hybrid chassis rivets (data-map-rivet) are intentional and exempt; no other circles must appear during transit.
  await expect(
    page.locator('[aria-label="Local map"] svg circle:not([data-map-rivet])'),
  ).toHaveCount(0);
  await expect(page.locator('[aria-label="Local map"] svg circle[data-map-rivet]')).toHaveCount(30);

  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, IN_TRANSIT_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await captureReviewScreenshot(page, "travel-mobile-in-transit.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await expectMapNameplatesInsideHex(page);
  await expectMapStateLabelsInsideHex(page, IN_TRANSIT_STATE_LABELS);
  await expectMapStatusPlatesInsideHex(page);
  await captureReviewScreenshot(page, "travel-desktop-in-transit.png");
  await page.setViewportSize({ width: 390, height: 844 });

  // Fast-forward the journey server-side, then refresh to resolve arrival.
  let yardDepartPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: yardDepartPast, resolvedThroughAt: yardDepartPast })
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
  await captureReviewScreenshot(page, "travel-mobile-arrived.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollMapIntoView(page);
  await captureReviewScreenshot(page, "travel-desktop-arrived.png");
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
  await expect(page.locator('[aria-label="Local map"] svg circle[data-map-rivet]')).toHaveCount(30);

  const returnPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: returnPast, resolvedThroughAt: returnPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();

  // Back at the Crash Site — Mining is at The Jag (issue #83), so verify no
  // Mining dashboards here, then walk via Scramble -> Jag to prove Mining again.
  await expect(page.getByRole("button", { name: /Crash Site/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expectNoMiningDashboards(page);
  await page.getByRole("button", { name: /The Long Scramble/ }).click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  let jagDepartPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: jagDepartPast, resolvedThroughAt: jagDepartPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await page.getByRole("button", { name: /The Jag/ }).click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  jagDepartPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: jagDepartPast, resolvedThroughAt: jagDepartPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
  await expect(page.getByRole("button", { name: /The Jag/ }).first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expectMiningDashboardsVisible(page);
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

test("Scavenge presents the committed outcome on a readable weighted reel", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  const labels = [
    "Zilch",
    "Nothing Burger",
    "Nada",
    "Whammy!",
    "Ferrite Shale x1",
    "Ferrite Shale x2",
    "Ferrite Shale x3",
    "Power Cell x1",
    "Power Cell x2",
    "Refined Ferrite x1",
    "Refined Ferrite x2",
  ];

  await page.setViewportSize({ width: 390, height: 844 });
  const opportunity = await openScavengeOpportunity(page, characterId);
  const journeyProgress = page.locator("[data-travel-progress]");
  const scavengeBox = await opportunity.boundingBox();
  const journeyBox = await journeyProgress.boundingBox();
  expect(scavengeBox).not.toBeNull();
  expect(journeyBox).not.toBeNull();
  expect(scavengeBox!.y).toBeLessThan(journeyBox!.y);
  await opportunity.getByRole("button", { name: "SCAVENGE NOW" }).click();
  await expect(page.locator("[data-scavenge-reel]")).toBeVisible();
  const startReel = page.getByRole("button", { name: "START REEL" });
  await expect(startReel).toBeVisible();
  await expect(startReel).toBeFocused();
  await expect(page.locator("[data-scavenge-reel-panel]")).toHaveCount(77);
  for (const label of labels) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(7);
  }

  await page.evaluate(() => {
    const outside = document.querySelector<HTMLElement>(
      '[aria-label="Primary"] a, [aria-label="Primary"] button',
    );
    if (!outside) throw new Error("Expected a focusable control outside the Scavenge Drawer");
    outside.focus();
  });
  await expect(startReel).toBeFocused();

  const mobileReel = page.locator("[data-scavenge-reel]");
  const mobileLayout = await mobileReel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);
  expect(mobileLayout.clientHeight).toBeGreaterThanOrEqual(300);
  await captureReviewScreenshot(page, "scavenge-reel-mobile.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("[data-scavenge-reel]")).toBeVisible();
  const desktopReel = await page.locator("[data-scavenge-reel]").boundingBox();
  expect(desktopReel?.width ?? 0).toBeLessThanOrEqual(352);
  await captureReviewScreenshot(page, "scavenge-reel-desktop.png");

  await page.getByRole("button", { name: "START REEL" }).click();
  await expect(page.getByRole("button", { name: "Reeling…" })).toBeVisible();
  await expect(page.locator("[data-scavenge-result]")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "DONE", exact: true })).toBeFocused();
});

test("Scavenge explains when every possible reward needs an open inventory slot", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await openScavengeOpportunity(page, characterId);
  await db.insert(inventoryStacks).values(
    Array.from({ length: 8 }, () => ({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 1,
    })),
  );
  const travelStartedAt = new Date(Date.now() - 1_850);
  await db
    .update(activeActions)
    .set({ startedAt: travelStartedAt, resolvedThroughAt: travelStartedAt })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();

  const available = page.locator('[data-scavenge-state="available"]');
  await expect(available).toBeVisible();
  await expect(
    available.getByRole("button", { name: "NEED AN OPEN INVENTORY SLOT" }),
  ).toBeDisabled();
  await expect(available).toContainText("Every possible find needs an available inventory slot.");
});

test("Scavenge Skip reveal bypasses animation and the reel preference remains reversible", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  const opportunity = await openScavengeOpportunity(page, characterId);
  await opportunity.getByRole("button", { name: "SCAVENGE NOW" }).click();
  await expect(page.getByRole("button", { name: "Skip reveal" })).toBeVisible();
  await page.getByRole("button", { name: "Skip reveal" }).click();
  await expect(page.locator("[data-scavenge-result]")).toBeVisible();
  await expect(page.getByRole("button", { name: "START REEL" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DONE", exact: true })).toBeFocused();

  const preference = page.getByRole("checkbox", {
    name: "Auto-skip reel spin next time (Scavenge stays available)",
  });
  await expect(preference).not.toBeChecked();
  await preference.check();
  await expect(preference).toBeChecked();
  await preference.uncheck();
  await expect(preference).not.toBeChecked();
  await page.getByRole("button", { name: "DONE", exact: true }).click();
  await expect(page.locator('[data-scavenge-state="claimed"]')).toContainText(
    "Reward claimed for this Travel leg.",
  );
});

test("reduced motion bypasses the Scavenge reel without changing the reveal", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const opportunity = await openScavengeOpportunity(page, characterId);
  await opportunity.getByRole("button", { name: "SCAVENGE NOW" }).click();
  await expect(page.locator("[data-scavenge-result]")).toBeVisible();
  await expect(page.getByRole("button", { name: "DONE", exact: true })).toBeVisible();
  await expect(page.locator("[data-scavenge-reel]")).toHaveCount(0);
});

test("arrival does not destroy a committed Scavenge reveal", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  const opportunity = await openScavengeOpportunity(page, characterId);
  await opportunity.getByRole("button", { name: "SCAVENGE NOW" }).click();
  await expect(page.locator("[data-scavenge-reel]")).toBeVisible();

  const arrivedPast = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: arrivedPast, resolvedThroughAt: arrivedPast })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();

  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-scavenge-reel]")).toBeVisible();
  await page.getByRole("button", { name: "START REEL" }).click();
  await expect(page.locator("[data-scavenge-result]")).toBeVisible({ timeout: 8_000 });
});

test("Travel arrival reconciliation preserves a Scavenge reel already in motion", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  const opportunity = await openScavengeOpportunity(page, characterId, {
    opportunityStartTick: 30,
    travelAgeMs: 19_000,
  });
  await page.evaluate(() => {
    Math.random = () => 0.999_999;
  });
  await opportunity.getByRole("button", { name: "SCAVENGE NOW" }).click();
  await expect(page.locator("[data-scavenge-reel]")).toBeVisible();

  const reveal = await db
    .select({ outcomeId: characterScavengeReveals.outcomeId })
    .from(characterScavengeReveals)
    .where(eq(characterScavengeReveals.characterId, characterId))
    .limit(1);
  expect(reveal[0]?.outcomeId).toBeTruthy();

  await page.getByRole("button", { name: "START REEL" }).click();
  await expect(page.getByRole("button", { name: "Reeling…" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true", { timeout: 8_000 });
  // Arrival reconciliation must not tear the reveal down nor reset it to
  // pending: the committed reveal survives in whatever stage arrival landed
  // (a mid-spin reel or the already-revealed result) and always reaches the
  // authoritative committed outcome. These two assertions are race-free with
  // the reel's deterministic ~5.7s spin, so they do not falsely fail when the
  // spin legitimately completes before the arrival refresh resolves (the
  // prior strict "reel still visible after arrival" check raced two
  // independent wall-clock timers — the client spin vs the boundary refresh —
  // which the scavenge-window geometry leaves only ~1-2s of tolerance for).
  await expect(page.locator("[data-scavenge-reveal]")).toBeVisible();
  await expect(page.locator("[data-scavenge-result]")).toHaveAttribute(
    "data-scavenge-result",
    reveal[0]!.outcomeId,
    { timeout: 8_000 },
  );
  await expect(page.getByRole("button", { name: "DONE", exact: true })).toBeFocused();
});

test("travels to the Power Annex and claims independently by Pacific reset date", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
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
  await captureReviewScreenshot(page, "power-annex-mobile-available.png");
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
  await captureReviewScreenshot(page, "power-annex-mobile-claimed.png");

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
    await captureReviewScreenshot(page, "power-annex-desktop-available.png");
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
  await captureReviewScreenshot(page, "power-annex-desktop-available.png");
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
  await captureReviewScreenshot(page, "power-annex-desktop-claimed.png");
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.getByLabel("5 Power Cell", { exact: true })).toHaveCount(2);
});

test("a capacity refusal keeps the Power Annex allotment available", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
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
