import { and, eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { db } from "@/db";
import {
  activeActions,
  characterMerchantDailyPurchases,
  characterMissions,
  characterRepairTargets,
  characterShips,
  characters,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { getLocalPlace } from "@/game/content/local-places";
import { LOCAL_MAP_LOCATION_IDS_BY_PLANET } from "@/game/content/locations";
import { expect, openMapSurface, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #375 — Stillreach Slice B, played end to end: the interplanetary Rivet leg
 * in both directions with its full takeoff, interplanetary chart and touchdown
 * cinematic over the approved 15:8 art, the physical landing with the ship in the
 * fungal ring on the approved 4:1 mark, and Last Leg Trading's automated terminal.
 *
 * A 260-second flight is not waited out: the recorded flight's own instants are
 * moved in the database to put it where each assertion needs it, exactly as a
 * returning player's elapsed time would. The server lands it; the browser never
 * does. Arithmetic, concurrency and the shared allowance are proven against
 * PostgreSQL in tests/integration/stillreach-flight.test.ts.
 */

const balance = getEffectiveGameBalance();
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const SHIP = "[data-ship-panel]";
const BOARD = "[data-ship-board]";
const NOTICE = "[data-ship-arrival-notice]";
const CINEMATIC = "[data-flight-cinematic]";
const OVERLAY = 'img[data-scene-layer="overlay"]';
const TERMINAL = "[data-last-leg-terminal]";
const FUEL_TERMINAL = LOCAL_PLACE_IDS.stillreachFuelTerminal;

async function seedPilot(
  characterId: string,
  options: { berth: string; fuel: number; credits?: number; thrustReported?: boolean },
) {
  const now = new Date();
  const reported = options.thrustReported !== false;
  await db.insert(characterMissions).values([
    {
      characterId,
      missionId: MISSION_IDS.thrustIssues,
      acceptedAt: now,
      completedAt: reported ? now : null,
    },
    ...(reported
      ? [{ characterId, missionId: MISSION_IDS.moveAlong, acceptedAt: now, completedAt: now }]
      : []),
  ]);
  for (const targetId of [
    REPAIR_TARGET_IDS.cargoHold,
    REPAIR_TARGET_IDS.landingGear,
    REPAIR_TARGET_IDS.propulsionSystem,
  ]) {
    const recipe = Object.values(balance.repairTargets).find(
      (entry) => entry.targetId === targetId,
    )!;
    await db.insert(characterRepairTargets).values({
      characterId,
      targetId,
      materials: Object.fromEntries(
        recipe.materials.map((material) => [material.itemId, material.quantity]),
      ),
      weldingProgress: recipe.repairIncrements,
      completedAt: now,
      updatedAt: now,
    });
  }
  await db
    .insert(characterShips)
    .values({ characterId, berthLocationId: options.berth, fuelUnits: options.fuel });
  await db
    .update(characters)
    .set({ currentLocationId: options.berth, credits: options.credits ?? 1000 })
    .where(eq(characters.id, characterId));
}

async function shipRow(characterId: string) {
  return (
    await db.select().from(characterShips).where(eq(characterShips.characterId, characterId))
  )[0]!;
}

/**
 * Put the recorded flight `elapsedMs` into its 260 seconds, as if that much time
 * had passed since launch. The action's cursor moves with it so a read resolves
 * from the same instant a real flight would.
 */
async function ageFlight(characterId: string, elapsedMs: number) {
  const startedAt = new Date(Date.now() - elapsedMs);
  const arrivesAt = new Date(startedAt.getTime() + 260_000);
  await db
    .update(characterShips)
    .set({ flightStartedAt: startedAt, flightArrivesAt: arrivesAt })
    .where(eq(characterShips.characterId, characterId));
  await db
    .update(activeActions)
    .set({ startedAt, resolvedThroughAt: startedAt })
    .where(eq(activeActions.characterId, characterId));
}

async function backdropSrc(page: Page) {
  return page.locator(`${CINEMATIC} img[data-scene-layer="background"]`).getAttribute("src");
}

/** Skatboll ringed on the left, Stillreach haloed on the right, in either direction. */
async function expectPlanetIdentities(page: Page) {
  const skatboll = page.locator('[data-flight-chart] [data-planet-body="skatboll"]');
  const stillreach = page.locator('[data-flight-chart] [data-planet-body="stillreach"]');
  await expect(skatboll.locator("[data-planet-ring]")).toHaveCount(2);
  await expect(skatboll.locator("[data-planet-halo]")).toHaveCount(0);
  await expect(stillreach.locator("[data-planet-halo]")).toHaveCount(1);
  await expect(stillreach.locator("[data-planet-ring]")).toHaveCount(0);
  // Draw order: the route and its trail over both worlds, the station dots over
  // the route, and the Rivet over everything.
  const order = await page.locator("[data-flight-chart] svg").evaluate((svg) => {
    const position = (selector: string) => {
      const element = svg.querySelector(selector);
      return element ? [...svg.querySelectorAll("*")].indexOf(element) : -1;
    };
    return {
      worlds: Math.max(
        position('[data-planet-body="skatboll"] [data-planet-surface]'),
        position('[data-planet-body="stillreach"] [data-planet-surface]'),
      ),
      route: position(".rs-flight-chart__route"),
      station: position("[data-flight-chart-station]"),
    };
  });
  expect(order.route).toBeGreaterThan(order.worlds);
  expect(order.station).toBeGreaterThan(order.route);
  const left = await skatboll.locator("[data-planet-surface]").boundingBox();
  const right = await stillreach.locator("[data-planet-surface]").boundingBox();
  expect(left!.x).toBeLessThan(right!.x);
}

/** Mark top-left and status top-right on one row, the name beneath both. */
async function expectTerminalHeaderRow(page: Page) {
  const terminal = page.locator(TERMINAL);
  const frame = (await terminal.boundingBox())!;
  const mark = (await terminal.locator(".rs-terminal__mark").boundingBox())!;
  const status = (await terminal.locator("[data-terminal-status]").boundingBox())!;
  const brand = (await terminal.locator(".rs-terminal__brand").boundingBox())!;
  expect(Math.abs(mark.y + mark.height / 2 - (status.y + status.height / 2))).toBeLessThan(8);
  expect(mark.x - frame.x).toBeLessThan(40);
  expect(frame.x + frame.width - (status.x + status.width)).toBeLessThan(40);
  expect(brand.y).toBeGreaterThanOrEqual(
    Math.max(mark.y + mark.height, status.y + status.height) - 1,
  );
  expect(status.height).toBeLessThan(40);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

/** The Rivet marker's chart position, read from its own transform (chart units). */
async function markerPoint(page: Page) {
  return page.locator("[data-flight-chart-marker]").evaluate((marker) => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(marker.style.transform);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
}

/** One planet's station marker, in chart units and on screen. */
async function stationPoint(page: Page, planetId: string) {
  const station = page.locator(`[data-flight-chart-station="${planetId}"]`);
  const chart = {
    x: Number(await station.getAttribute("cx")),
    y: Number(await station.getAttribute("cy")),
  };
  const box = (await station.boundingBox())!;
  return { chart, screen: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

/** The Rivet sits on a station marker, in chart units and visibly on screen. */
async function expectMarkerOnStation(page: Page, planetId: string) {
  const station = await stationPoint(page, planetId);
  await expect
    .poll(async () => {
      const marker = await markerPoint(page);
      return Math.hypot(marker.x - station.chart.x, marker.y - station.chart.y);
    })
    // The marker keeps flying while the page settles; a few chart units is the
    // span of the station dot itself (radius 4).
    .toBeLessThan(6);
  // On screen too: the miniature's centre is over the dot drawn on the disc.
  await expect
    .poll(async () => {
      const box = (await page.locator("[data-flight-chart-marker] image").boundingBox())!;
      return Math.hypot(
        box.x + box.width / 2 - station.screen.x,
        box.y + box.height / 2 - station.screen.y,
      );
    })
    .toBeLessThan(8);
}

async function markerX(page: Page) {
  return page
    .locator("[data-flight-chart-marker]")
    .evaluate((marker) => Number(/translate\(([-\d.]+)px/.exec(marker.style.transform)?.[1]));
}

test("flies Holo Hollow Landing to Stillreach: warning, takeoff, interplanetary chart, touchdown and the ship in the ring", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await seedPilot(characterId, { berth: LOCATION_IDS.holoHollowLanding, fuel: 200 });
  await openTestCharacter(page, characterId);

  // Before Launch: destination, one-way cost, the real tank, and a candid warning
  // that does not disable Launch.
  await page.locator(SHIP).locator(BOARD).click();
  const route = page.locator(
    `[data-ship-route="${SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation}"]`,
  );
  await expect(route).toContainText("Stillreach Landing Station");
  await expect(route.locator("[data-ship-route-cost]")).toHaveText("120 FU");
  await expect(route.locator("[data-ship-route-duration]")).toHaveText("4 min 20 s");
  await expect(route.locator("[data-ship-route-tank-now]")).toHaveText("200 / 300 FU");
  await expect(route.locator("[data-ship-route-tank-after]")).toHaveText("80 / 300 FU");
  await expect(route.locator("[data-ship-return-fuel-warning]")).toContainText(
    "You will land with 80 FU, less than the 120 FU the flight back needs.",
  );
  await expect(route.locator("[data-ship-launch]")).toBeEnabled();
  await route.locator("[data-ship-launch]").click();

  // Takeoff from Holo Hollow Landing's own approved 15:8 pad, never the Crash Site.
  const cinematic = page.locator(CINEMATIC);
  await expect(cinematic).toHaveAttribute("data-flight-phase", "takeoff", { timeout: 10_000 });
  await expect(cinematic.locator("[data-flight-cinematic-caption]")).toHaveText(
    "Takeoff · Holo Hollow Landing",
  );
  expect(await backdropSrc(page)).toMatch(/holo-hollow-landing-arrival/);
  await expect(cinematic.locator("img[data-flight-ship]")).toHaveCount(1);
  const row = await shipRow(characterId);
  expect(row.fuelUnits).toBe(80);
  expect(row.flightArrivesAt!.getTime() - row.flightStartedAt!.getTime()).toBe(260_000);

  // The chart: Skatboll to Stillreach, left to right, most of the flight.
  await expect(cinematic).toHaveAttribute("data-flight-phase", "travel", { timeout: 6_000 });
  const chart = cinematic.locator("[data-flight-chart]");
  await expect(chart).toContainText("SKATBOLL");
  await expect(chart).toContainText("STILLREACH");
  await expect(chart).toContainText("HOLO HOLLOW LANDING");
  await expect(chart).toContainText("STILLREACH LANDING STATION");
  await expect(chart).toContainText("SKATBOLL TO STILLREACH");
  await expect(chart).not.toContainText("CRASH SITE");
  await expectPlanetIdentities(page);
  // The Rivet sets off from the station marker on Skatboll's disc.
  await expectMarkerOnStation(page, "skatboll");
  await expectNoHorizontalOverflow(page);
  expect(await markerX(page)).toBeLessThan(300);
  await captureReviewScreenshot(page, "stillreach-flight-chart-outbound-mobile.png");

  // Minimize and reopen; the read-only utilities remain browsable meanwhile.
  await page.locator("[data-flight-minimize]").click();
  await expect(page.locator("[data-flight-minimized]")).toContainText(
    "In flight to Stillreach Landing Station",
  );
  await page.locator("[data-flight-reopen]").click();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");

  // Halfway, a reload resumes the chart further along; it never restarts takeoff.
  await ageFlight(characterId, 130_000);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expect.poll(() => markerX(page)).toBeGreaterThan(280);
  await expect(page.locator("[data-flight-progress]")).toContainText(/1[23]\d seconds remaining/);

  // In the chart's last seconds the Rivet arrives on Stillreach's marker.
  await ageFlight(characterId, 254_000);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expectMarkerOnStation(page, "stillreach");

  // Touchdown over the approved empty 15:8 Stillreach scene. Under reduced motion
  // the Rivet rests exactly on its approved Option B mark, with no fade or effects.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ageFlight(characterId, 258_000);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "landing");
  await expect(page.locator("[data-flight-cinematic-caption]")).toHaveText(
    "Touchdown · Stillreach Landing Station",
  );
  expect(await backdropSrc(page)).toMatch(/stillreach-landing-station-cinematic/);
  expect(
    await page
      .locator(".rs-flight-cinematic__ship")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await expect
    .poll(() =>
      page
        .locator("img[data-flight-ship]")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await captureReviewScreenshot(page, "stillreach-flight-touchdown-mobile.png");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Only the server lands it: then the Stillreach scene with the ship in the ring.
  await expect(page.locator(NOTICE)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(NOTICE)).toContainText("Stillreach Landing Station");
  await expect(page.locator(CINEMATIC)).toHaveCount(0);
  const scene = page.locator(`[data-location-scene="${LOCATION_IDS.stillreachLandingStation}"]`);
  await expect(scene.locator(OVERLAY)).toHaveCount(1);
  await expect(page.locator("[data-location-description]")).toContainText(
    "Your Rivet Utility Shuttle stands in the middle of the ring",
  );
  // The station shows the ship and a compact directory entry, never the machine.
  await expect(page.locator(TERMINAL)).toHaveCount(0);
  await expect(page.locator(`[data-local-place="${FUEL_TERMINAL}"]`)).toBeVisible();
  await captureReviewScreenshot(page, "stillreach-landing-berthed-mobile.png");
  expect((await shipRow(characterId)).berthLocationId).toBe(LOCATION_IDS.stillreachLandingStation);

  // A reload after landing shows the arrived world, never the cinematic again.
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveCount(0);
  await openMapSurface(page);
  await expect(page.locator("[data-map-location]")).toHaveCount(
    LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach.length,
  );
});

test("flies home from Stillreach: Stillreach takeoff, the chart right to left, Holo Hollow touchdown", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  await page.setViewportSize(DESKTOP);
  await seedPilot(characterId, { berth: LOCATION_IDS.stillreachLandingStation, fuel: 120 });
  await openTestCharacter(page, characterId);

  // The berthed 4:1 scene carries the Rivet on its approved mark.
  await expect(
    page
      .locator(`[data-location-scene="${LOCATION_IDS.stillreachLandingStation}"]`)
      .locator(OVERLAY),
  ).toHaveCount(1);
  await captureReviewScreenshot(page, "stillreach-landing-berthed-desktop.png");

  await page.locator(SHIP).locator(BOARD).click();
  const route = page.locator(
    `[data-ship-route="${SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding}"]`,
  );
  await expect(route.locator("[data-ship-route-tank-after]")).toHaveText("0 / 300 FU");
  await expect(route.locator("[data-ship-return-fuel-warning]")).toBeVisible();
  // Reduced motion for the takeoff frame: the Rivet still on its ring mark.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await route.locator("[data-ship-launch]").click();

  const cinematic = page.locator(CINEMATIC);
  await expect(cinematic).toHaveAttribute("data-flight-phase", "takeoff", { timeout: 10_000 });
  await expect(cinematic.locator("[data-flight-cinematic-caption]")).toHaveText(
    "Takeoff · Stillreach Landing Station",
  );
  expect(await backdropSrc(page)).toMatch(/stillreach-landing-station-cinematic/);
  await captureReviewScreenshot(page, "stillreach-flight-takeoff-desktop.png");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect((await shipRow(characterId)).fuelUnits).toBe(0);

  // The same leg, flown the other way: the marker heads from right to left.
  await ageFlight(characterId, 100_000);
  await page.setViewportSize(PHONE);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expect(page.locator("[data-flight-chart]")).toContainText("STILLREACH TO SKATBOLL");
  await expectPlanetIdentities(page);
  await expect.poll(() => markerX(page)).toBeGreaterThan(300);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "stillreach-flight-chart-home-mobile.png");

  // Reduced motion: a static chart, the countdown carries the flight. The worlds
  // are static art and keep their identities.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-flight-chart-marker]")).toHaveCount(0);
  await expectPlanetIdentities(page);
  // Static, the two stations still mark where the leg begins and ends.
  await expect(page.locator("[data-flight-chart-station]")).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // The same two points reversed: set off from Stillreach's marker...
  await ageFlight(characterId, 2_600);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expectMarkerOnStation(page, "stillreach");
  // ...and reach Skatboll's.
  await ageFlight(characterId, 254_000);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expectMarkerOnStation(page, "skatboll");
  await page.setViewportSize(DESKTOP);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-flight-progress]")).toContainText(/seconds? remaining/);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await ageFlight(characterId, 258_000);
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "landing");
  expect(await backdropSrc(page)).toMatch(/holo-hollow-landing-arrival/);
  await expect(page.locator("[data-flight-cinematic-caption]")).toHaveText(
    "Touchdown · Holo Hollow Landing",
  );

  // Home to the Landing, never the Crash Site, with no Move Along replay.
  await expect(page.locator(NOTICE)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(NOTICE)).not.toContainText("Move Along");
  await expect(
    page.locator(`[data-location-scene="${LOCATION_IDS.holoHollowLanding}"]`).locator(OVERLAY),
  ).toHaveCount(1);
  const row = await shipRow(characterId);
  expect(row.berthLocationId).toBe(LOCATION_IDS.holoHollowLanding);
  expect(row.fuelUnits).toBe(0);
  await openMapSurface(page);
  await expect(page.locator("[data-map-location]")).toHaveCount(
    LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll.length,
  );
});

test("Last Leg Trading's terminal is its own Local Place: directory, entry, Back, reload and the locked screen", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await seedPilot(characterId, {
    berth: LOCATION_IDS.stillreachLandingStation,
    fuel: 300,
    credits: 1000,
    thrustReported: false,
  });
  await openTestCharacter(page, characterId);
  const place = getLocalPlace(FUEL_TERMINAL)!;

  // The station: the Ship panel and a compact directory entry, no machine.
  const entry = page.locator(`[data-local-place="${FUEL_TERMINAL}"]`);
  await expect(entry).toContainText("Last Leg Trading — Automated Fuel Terminal");
  await expect(entry.locator("[data-local-place-enter]")).toBeVisible();
  await expect(page.locator(TERMINAL)).toHaveCount(0);
  // Boarding shows ship controls, never a terminal beside them.
  await page.locator(SHIP).locator(BOARD).click();
  await expect(page.locator("[data-ship-flight-controls]")).toBeVisible();
  await expect(page.locator(TERMINAL)).toHaveCount(0);

  // Enter: the place's own scene, the terminal alone, and no Ship panel.
  await entry.locator("[data-local-place-enter]").click();
  await expect(page).toHaveURL(new RegExp(`[?&]place=${FUEL_TERMINAL}`));
  await expect(page.locator(`[data-local-place-surface="${FUEL_TERMINAL}"]`)).toBeVisible();
  const background = page.getByTestId("location-scene").locator('[data-scene-layer="background"]');
  await expect(background).toHaveAttribute("alt", place.presentation.scene.alt);
  await expect(background).toHaveAttribute("src", /stillreach-fuel-terminal/);
  await expect(page.locator(SHIP)).toHaveCount(0);
  const terminal = page.locator(TERMINAL);
  await expect(terminal).toHaveAttribute("data-terminal-state", "locked");
  await expect(terminal.locator("[data-terminal-status]")).toHaveText("Access restricted");
  await expect(terminal.locator("[data-terminal-locked]")).toContainText(
    "Trading unlocks after you report the completed Thrust Issues repair to Wade",
  );
  await expect(terminal.locator("[data-terminal-commit]")).toHaveCount(0);
  // An unmanned outlet: nobody to talk to, and no NPC Trade row.
  await expect(page.locator("[data-npc-interaction]")).toHaveCount(0);
  await expectTerminalHeaderRow(page);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "stillreach-terminal-locked-mobile.png");

  // Reload keeps the place; browser Back returns to the station and its ship.
  await page.reload();
  await expect(page.locator(`[data-local-place-surface="${FUEL_TERMINAL}"]`)).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(page.locator(SHIP).locator(BOARD)).toBeVisible();
  await expect(page.locator(TERMINAL)).toHaveCount(0);

  // A stale or foreign place parameter falls back to the station, never a terminal.
  for (const stale of ["no_such_place", LOCAL_PLACE_IDS.lastLegTrading]) {
    await page.goto(`/play/${characterId}?place=${stale}`);
    await expect(page.locator(SHIP).locator(BOARD)).toBeVisible();
    await expect(page.locator(TERMINAL)).toHaveCount(0);
  }

  await db
    .update(characterMissions)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, MISSION_IDS.thrustIssues),
      ),
    );
  // A deep link opens the place directly.
  await page.goto(`/play/${characterId}?place=${FUEL_TERMINAL}`);
  await expect(terminal).toHaveAttribute("data-terminal-state", "online");
  await expect(terminal.locator("[data-terminal-status]")).toHaveText("Online");
  await expect(terminal.locator("[data-terminal-credits]")).toContainText("1000");
  await expectTerminalHeaderRow(page);

  const full = terminal.locator(`[data-terminal-row="${ITEM_IDS.fullSmallFuelCanister}"]`);
  await expect(full.locator("[data-terminal-unit-price]")).toHaveText("225 CR");
  await expect(full).toHaveAttribute("data-terminal-row", ITEM_IDS.fullSmallFuelCanister);
  await expect(full.locator("[data-terminal-daily-remaining]")).toHaveAttribute(
    "data-terminal-daily-remaining",
    "5",
  );
  await full.getByRole("button", { name: /Increase .* quantity/ }).click();
  await expect(full.locator("[data-terminal-total]")).toHaveText("450 CR");
  await full.locator("[data-terminal-commit]").click();
  await expect(terminal.locator("[data-terminal-feedback]")).toHaveText(
    "Dispensed 2 × Full Small Fuel Canister · charged 450 CR",
  );
  await expect(terminal.locator("[data-terminal-credits]")).toContainText("550");
  await expect(full.locator("[data-terminal-daily-remaining]")).toHaveAttribute(
    "data-terminal-daily-remaining",
    "3",
  );
  await expect(terminal.locator("[data-terminal-shared-limits]")).toContainText(
    "Last Leg Trading at Holo Hollow Landing",
  );
  await captureReviewScreenshot(page, "stillreach-terminal-mobile.png");
  await page.setViewportSize(DESKTOP);
  await expectTerminalHeaderRow(page);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "stillreach-terminal-desktop.png");
  await page.setViewportSize(PHONE);

  // The allowance is Last Leg Trading's: one ledger row for the business.
  const ledger = await db
    .select()
    .from(characterMerchantDailyPurchases)
    .where(eq(characterMerchantDailyPurchases.characterId, characterId));
  expect(ledger.map((entry) => [entry.merchantId, entry.quantityPurchased])).toEqual([
    ["last_leg_trading", 2],
  ]);

  // Selling: Oil Shale is bought, never sold, and selling back restores nothing.
  await terminal.locator('[data-terminal-mode="sell"]').click();
  await expect(
    terminal.locator(`[data-terminal-row="${ITEM_IDS.oilShale}"] [data-terminal-unit-price]`),
  ).toHaveText("6 CR");
  await full.locator("[data-terminal-commit]").click();
  await expect(terminal.locator("[data-terminal-feedback]")).toHaveText(
    "Received 1 × Full Small Fuel Canister · paid 160 CR",
  );
  await terminal.locator('[data-terminal-mode="buy"]').click();
  await expect(terminal.locator(`[data-terminal-row="${ITEM_IDS.oilShale}"]`)).toHaveCount(0);
  await expect(full.locator("[data-terminal-daily-remaining]")).toHaveAttribute(
    "data-terminal-daily-remaining",
    "3",
  );
});
