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
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
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
  await expect(page.locator(TERMINAL)).toHaveAttribute("data-terminal-state", "online");
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
  await page.reload();
  await expect(page.locator(CINEMATIC)).toHaveAttribute("data-flight-phase", "travel");
  await expect(page.locator("[data-flight-chart]")).toContainText("STILLREACH TO SKATBOLL");
  await expect.poll(() => markerX(page)).toBeGreaterThan(300);

  // Reduced motion: a static chart, the countdown carries the flight.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-flight-chart-marker]")).toHaveCount(0);
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

test("Last Leg Trading's terminal: locked until Thrust Issues is turned in, then the shared counter", async ({
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

  const terminal = page.locator(TERMINAL);
  await expect(terminal).toHaveAttribute("data-terminal-state", "locked");
  await expect(terminal.locator("[data-terminal-locked]")).toContainText(
    "Trading unlocks after you report the completed Thrust Issues repair to Wade",
  );
  await expect(terminal.locator("[data-terminal-commit]")).toHaveCount(0);

  await db
    .update(characterMissions)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, MISSION_IDS.thrustIssues),
      ),
    );
  await page.reload();
  await expect(terminal).toHaveAttribute("data-terminal-state", "online");
  await expect(terminal.locator("[data-terminal-credits]")).toContainText("1000");

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
