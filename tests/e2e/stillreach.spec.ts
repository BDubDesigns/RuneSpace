import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters } from "@/db/rune-space";
import { LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { LOCAL_MAP_LOCATION_IDS_BY_PLANET, getLocation } from "@/game/content/locations";
import { teleportCharacterAsAdmin } from "@/server/admin-command-seams";
import { expect, openMapSurface, openTestCharacter, test } from "./fixtures";
import { expectElementsInsideHexes } from "./map-geometry";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Stillreach Slice A (#373): the eight-hex planet map, ordinary walking and the
 * eight scenes, for a character placed there by the real admin teleport command.
 * Nothing in ordinary play leads to Stillreach, so this is the only way in.
 */

const STILLREACH_IDS = LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach;
const SKATBOLL_IDS = LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll;
const ADMIN = "e2e-stillreach-admin";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function adminPlace(characterId: string, locationId: string) {
  const result = await teleportCharacterAsAdmin(ADMIN, characterId, locationId);
  expect(["teleported", "no_change"]).toContain(result.outcome.kind);
}

/** Make the walk that just began arrive: age its action past the 24-second leg. */
async function finishWalk(characterId: string) {
  const past = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: past, resolvedThroughAt: past })
    .where(eq(activeActions.characterId, characterId));
}

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("an admin-placed Stillreach character sees exactly the eight hexes and seven routes, nothing from Skatboll", async ({
  page,
  testCharacter,
}) => {
  await adminPlace(testCharacter.id, LOCATION_IDS.stillreachLandingStation);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  const hexes = page.locator("[data-map-location]");
  await expect(hexes).toHaveCount(STILLREACH_IDS.length);
  for (const id of STILLREACH_IDS) {
    await expect(page.locator(`[data-map-location="${id}"]`)).toHaveCount(1);
  }
  for (const id of SKATBOLL_IDS) {
    await expect(page.locator(`[data-map-location="${id}"]`)).toHaveCount(0);
  }
  // The canvas draws one line per authored undirected edge: seven.
  await expect(page.locator("[data-map-scroll-viewport] svg line")).toHaveCount(7);

  // Standing at the Landing Station; the other seven are visible but only the
  // Track is a leg away, and each hex has its approved identifier and no status.
  await expect(
    page.locator(`[data-map-location="${LOCATION_IDS.stillreachLandingStation}"]`),
  ).toHaveAttribute("aria-current", "true");
  // The Quarry (#379), Dry Seam (#380), and Harmonic Workings (#383) are mines.
  await expect(page.locator("[data-map-status]")).toHaveCount(3);
  for (const mine of [
    LOCATION_IDS.prospectingQuarry,
    LOCATION_IDS.theDrySeam,
    LOCATION_IDS.harmonicWorkings,
  ]) {
    await expect(
      page.locator(`[data-map-location="${mine}"]`).locator("[data-map-status]"),
    ).toHaveText("Mining");
  }
  for (const id of STILLREACH_IDS) {
    const asset = getLocation(id)!.presentation.mapIconKey.replaceAll("_", "-");
    const image = page.locator(`svg image[href="/map-icons/${asset}.webp"]`);
    await expect(image).toHaveCount(1);
    const response = await page.request.get((await image.getAttribute("href")) as string);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }
  // No mission, turn-in or fake-activity cues on a world with none.
  await expect(page.locator("[data-map-mission], [data-map-turn-in]")).toHaveCount(0);

  await expectNoPageOverflow(page);
  await captureReviewScreenshot(page, "stillreach-map-mobile.png");

  await page.setViewportSize(DESKTOP);
  await expect(hexes).toHaveCount(STILLREACH_IDS.length);
  await expectNoPageOverflow(page);
  await captureReviewScreenshot(page, "stillreach-map-desktop.png");
});

test("only the Track is walkable from the Landing Station, and every other hex says why", async ({
  page,
  testCharacter,
}) => {
  await adminPlace(testCharacter.id, LOCATION_IDS.stillreachLandingStation);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  await page.getByRole("button", { name: /Windward Track/ }).click();
  await expect(page.getByRole("button", { name: /Walk to Windward Track/ })).toBeVisible();
  await expect(page.locator("[data-map-destination-meta]")).toContainText("24 sec walk");
  // Travel-only: no activity status on the destination.
  await expect(page.locator("[data-map-destination-meta]")).not.toContainText(
    /Mining|Refining|Daily cells/,
  );

  // Two legs out is not an authored edge, whatever the grid looks like.
  for (const name of [/Hilltop Workshop/, /Prospecting Quarry/, /The Dry Seam/]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name: /^Walk to / })).toHaveCount(0);
    await expect(page.locator("[data-map-destination-panel]")).toContainText("No route from here");
  }
});

test("walks Landing → Track → Workshop → The Low Hum, persisting through reloads, and turns back", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(60_000);
  const characterId = testCharacter.id;
  await adminPlace(characterId, LOCATION_IDS.stillreachLandingStation);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await openMapSurface(page);

  for (const [name, id] of [
    ["Windward Track", LOCATION_IDS.windwardTrack],
    ["Hilltop Workshop", LOCATION_IDS.hilltopWorkshop],
    ["The Low Hum", LOCATION_IDS.theLowHum],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: new RegExp(`Walk to ${name}`) }).click();
    await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
    await finishWalk(characterId);
    await page.reload();
    await openMapSurface(page);
    await expect(page.locator(`[data-map-location="${id}"]`)).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Still the Stillreach map after every arrival.
    await expect(page.locator("[data-map-location]")).toHaveCount(STILLREACH_IDS.length);
  }
  const [row] = await db.select().from(characters).where(eq(characters.id, characterId));
  expect(row?.currentLocationId).toBe(LOCATION_IDS.theLowHum);

  // The Low Hum is a dead end: its one edge leads back to the Workshop.
  await page.getByRole("button", { name: /Hilltop Workshop/ }).click();
  await page.getByRole("button", { name: /Walk to Hilltop Workshop/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /Turn Back/ })
    .first()
    .click();
  await expect(page.getByText("In transit", { exact: true })).toHaveCount(0);
  await page.reload();
  await openMapSurface(page);
  await expect(page.locator(`[data-map-location="${LOCATION_IDS.theLowHum}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("each Stillreach scene renders its own panorama with no activity, status or ship", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  for (const viewport of [PHONE, DESKTOP]) {
    await page.setViewportSize(viewport);
    for (const id of STILLREACH_IDS) {
      const location = getLocation(id)!;
      await adminPlace(testCharacter.id, id);
      await openTestCharacter(page, testCharacter.id);

      const scene = page.getByTestId("location-scene");
      await expect(scene).toHaveAttribute("data-location-scene", id);
      await expect(page.getByRole("heading", { name: location.displayName })).toBeVisible();
      const background = scene.locator('[data-scene-layer="background"]');
      await expect(background).toHaveAttribute("alt", location.presentation.scene.alt);
      // The one committed panorama decodes, and no overlay (ship) is composed on it.
      await expect
        .poll(() => background.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await expect(scene.locator('[data-scene-layer="overlay"]')).toHaveCount(0);

      // Nothing operable: no work controls, no merchant, no ship, no stash. The
      // Landing Station's two Local Places are Last Leg Trading (#375) and
      // Refiner-To-Go (#381), listed in its directory; their controls live inside.
      // Except the Quarry (#379), Dry Seam (#380), and Harmonic Workings (#383),
      // which each expose the shared Mining controls.
      const hasMining =
        id === LOCATION_IDS.prospectingQuarry ||
        id === LOCATION_IDS.theDrySeam ||
        id === LOCATION_IDS.harmonicWorkings;
      await expect(page.getByRole("button", { name: /^(Start|Stop) / })).toHaveCount(
        hasMining ? 1 : 0,
      );
      await expect(page.locator("[data-ship-berth]")).toHaveCount(0);
      await expect(page.locator("[data-last-leg-terminal]")).toHaveCount(0);
      const places = page.locator("[data-local-place]");
      if (id === LOCATION_IDS.stillreachLandingStation) {
        await expect(places).toHaveCount(2);
        await expect(
          page.locator(`[data-local-place="${LOCAL_PLACE_IDS.stillreachFuelTerminal}"]`),
        ).toHaveCount(1);
        await expect(
          page.locator(`[data-local-place="${LOCAL_PLACE_IDS.stillreachRefinerToGo}"]`),
        ).toHaveCount(1);
      } else {
        await expect(places).toHaveCount(0);
      }
      await expectNoPageOverflow(page);
      if (viewport === PHONE && id === LOCATION_IDS.stillreachLandingStation) {
        await captureReviewScreenshot(page, "stillreach-landing-mobile.png");
      }
    }
  }
});

test("Skatboll's map is untouched and shows no way to Stillreach", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  await expect(page.locator("[data-map-location]")).toHaveCount(SKATBOLL_IDS.length);
  for (const id of STILLREACH_IDS) {
    await expect(page.locator(`[data-map-location="${id}"]`)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /Stillreach/ })).toHaveCount(0);
  const geometry = await expectElementsInsideHexes(
    page.locator("[data-map-scroll-viewport]"),
    "data-map-nameplate",
  );
  expect(geometry.allInside).toBe(true);
});

test("the admin teleport returns a Stillreach character to Skatboll's map", async ({
  page,
  testCharacter,
}) => {
  await adminPlace(testCharacter.id, LOCATION_IDS.theSurveyLine);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);
  await expect(page.locator("[data-map-location]")).toHaveCount(STILLREACH_IDS.length);

  await adminPlace(testCharacter.id, LOCATION_IDS.crashSite);
  await page.reload();
  await openMapSurface(page);
  await expect(page.locator("[data-map-location]")).toHaveCount(SKATBOLL_IDS.length);
  await expect(page.locator(`[data-map-location="${LOCATION_IDS.crashSite}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );
});
