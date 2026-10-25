import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldStacks,
  characterPassengerJourneys,
  characterShips,
  characters,
  shipArrivalNotices,
} from "@/db/rune-space";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  PASSENGER_ROUTE_IDS,
  SHIP_ROUTE_IDS,
} from "@/game/config/foundations";
import { CABIN_ANNOUNCEMENT_POOL } from "@/game/content/cabin-announcements";
import {
  cabinAnnouncementSeed,
  selectCabinAnnouncementIndices,
} from "@/game/domain/cabin-announcements";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #404 — Milky Waymo, played end to end: the two check-in Local Places,
 * the blue-and-white kiosk through its locked, welcome, confirmation and
 * insufficient-funds screens, the confirmed booking, the shuttle's flight with
 * its cabin assistant, a reload mid-journey, the server landing, and DISEMBARK.
 *
 * A 180-second journey is not waited out: the recorded journey's own instants
 * are moved in the database to put it where each assertion needs it, exactly as
 * a returning player's elapsed time would. The server lands it; the browser
 * never does. Atomic charging, concurrency, offline landing and Rivet/cargo
 * preservation are proven against PostgreSQL in tests/integration/milky-waymo.test.ts.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const HOLO = LOCATION_IDS.holoHollowLanding;
const STILLREACH = LOCATION_IDS.stillreachLandingStation;
const HOLO_DESK = LOCAL_PLACE_IDS.milkyWaymoHoloHollowLanding;
const STILLREACH_DESK = LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation;
const KIOSK = "[data-milky-waymo-kiosk]";
const JOURNEY = "[data-passenger-journey]";
const CINEMATIC = "[data-flight-cinematic]";
const CABIN = "[data-cabin-assistant]";
const NOTICE = "[data-passenger-arrival-notice]";
const SHUTTLE = "milky-waymo-shuttle";

async function seedRider(
  characterId: string,
  options: { at: string; credits?: number; unlocked?: boolean; berth?: string },
) {
  const now = new Date();
  await db
    .insert(characterShips)
    .values({ characterId, berthLocationId: options.berth ?? options.at, fuelUnits: 180 });
  await db
    .update(characters)
    .set({ currentLocationId: options.at, credits: options.credits ?? 1_000 })
    .where(eq(characters.id, characterId));
  if (options.unlocked !== false) {
    // The Rivet's durable landing receipt at Stillreach, long since dismissed.
    await db.insert(shipArrivalNotices).values({
      characterId,
      routeId: SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
      destinationLocationId: STILLREACH,
      arrivedAt: new Date(now.getTime() - 3_600_000),
      acknowledgedAt: new Date(now.getTime() - 3_500_000),
    });
  }
  await db.insert(cargoHoldStacks).values([
    { characterId, itemId: ITEM_IDS.oilShale, quantity: 7 },
    { characterId, itemId: ITEM_IDS.fullSmallFuelCanister, quantity: 2 },
  ]);
}

/** Enter a check-in from the place directory; a reload that kept it open needs no second entry. */
async function enterDesk(page: Page, localPlaceId: string) {
  const directory = page.locator("[data-local-place-directory]");
  await expect(directory.or(page.locator(KIOSK))).toBeVisible();
  if (!(await page.locator(KIOSK).isVisible())) {
    await directory.locator(`[data-local-place="${localPlaceId}"]`).click();
  }
  await expect(page.locator(KIOSK)).toBeVisible();
}

async function characterRow(characterId: string) {
  return (await db.select().from(characters).where(eq(characters.id, characterId)))[0]!;
}

async function journeyRow(characterId: string) {
  return (
    await db
      .select()
      .from(characterPassengerJourneys)
      .where(eq(characterPassengerJourneys.characterId, characterId))
  )[0];
}

/** Put the recorded journey `elapsedMs` into its 180 seconds, as if that much time had passed. */
async function ageJourney(characterId: string, elapsedMs: number) {
  const startedAt = new Date(Date.now() - elapsedMs);
  const arrivesAt = new Date(startedAt.getTime() + 180_000);
  await db
    .update(characterPassengerJourneys)
    .set({ startedAt, arrivesAt })
    .where(eq(characterPassengerJourneys.characterId, characterId));
  await db
    .update(activeActions)
    .set({ startedAt, resolvedThroughAt: startedAt })
    .where(eq(activeActions.characterId, characterId));
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

/** The full text the cabin assistant is saying now, read from its live region. */
async function cabinLine(page: Page) {
  return (await page.locator(`${CABIN} [data-typewriter-full]`).textContent())?.trim() ?? "";
}

test("books and rides Skatboll to Stillreach: kiosk, confirmation, shuttle, cabin assistant, reload, landing, disembark", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(150_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO, credits: 1_000 });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);

  // The Local Place is on the pad's directory, and entering it is the only way to the kiosk.
  await expect(page.locator(KIOSK)).toHaveCount(0);
  const card = page.locator(`[data-local-place="${HOLO_DESK}"]`);
  await expect(card).toContainText("Milky Waymo — Holo Hollow Landing");
  await card.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-place-card-skatboll-mobile.png");
  await enterDesk(page, HOLO_DESK);
  const kiosk = page.locator(KIOSK);
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "welcome");
  await expect(kiosk.locator("[data-kiosk-status]")).toHaveText("AUTOMATED SERVICE ONLINE");
  await expect(kiosk.getByRole("img", { name: "Milky Waymo" })).toBeVisible();
  await expect(kiosk).toContainText("Interplanetary Passenger Services");

  // Only the welcome line types itself; everything functional is there at once.
  const welcome = kiosk.locator("[data-kiosk-welcome] [data-typewriter-complete]");
  await expect(kiosk.locator("[data-kiosk-fare]")).toHaveText("200 CR");
  await expect(kiosk.locator("[data-kiosk-duration]")).toHaveText("3 minutes");
  await expect(kiosk.locator("[data-kiosk-credits]")).toHaveText("1,000 CR");
  await expect(kiosk.locator("[data-kiosk-destination]")).toHaveText("Stillreach Landing Station");
  await expect(kiosk.locator("[data-kiosk-belongings]")).toHaveText(
    "Your carried belongings and equipment travel with you. Your personal ship and its cargo remain where you left them.",
  );
  await expect(kiosk.locator("[data-kiosk-book]")).toHaveText("BOOK PASSAGE — 200 CR");
  await expect(welcome).toHaveAttribute("data-typewriter-complete", "true", { timeout: 10_000 });
  await expect(welcome.locator("[data-typewriter-full]")).toHaveText(
    "Welcome to Milky Waymo! Getting you from here to there, without all that flying yourself nonsense.",
  );
  await expect(welcome.locator(".rs-dialogue-cursor")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-welcome-mobile.png");

  // BOOK PASSAGE only opens the confirmation. Nothing is charged by looking.
  await kiosk.locator("[data-kiosk-book]").click();
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "confirm");
  await expect(kiosk.getByRole("heading", { name: "READY FOR TAKEOFF?" })).toBeFocused();
  await expect(kiosk).toContainText(
    "Excellent choice! Milky Waymo is delighted to provide you with the transportation you have selected.",
  );
  await expect(kiosk.locator("[data-kiosk-warning]")).toHaveText(
    "Once your shuttle departs, the journey cannot be cancelled.",
  );
  await expect(kiosk.locator("[data-kiosk-belongings]")).toHaveText(
    "Your ship and its cargo will remain at their current location. Your carried belongings will accompany you.",
  );
  await expect(kiosk.locator("[data-kiosk-board]")).toHaveText("CONFIRM & BOARD — 200 CR");
  expect((await characterRow(characterId)).credits).toBe(1_000);
  expect(await journeyRow(characterId)).toBeUndefined();
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-confirm-mobile.png");

  // NOT YET goes back with nothing charged, and the welcome line is already whole.
  await kiosk.locator("[data-kiosk-not-yet]").click();
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "welcome");
  await expect(kiosk.locator("[data-kiosk-welcome] [data-typewriter-complete]")).toHaveAttribute(
    "data-typewriter-complete",
    "true",
  );
  expect((await characterRow(characterId)).credits).toBe(1_000);

  await kiosk.locator("[data-kiosk-book]").click();
  await kiosk.locator("[data-kiosk-board]").click();

  // The one confirmed command charged exactly once and recorded the journey.
  const journey = page.locator(JOURNEY);
  await expect(journey).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(KIOSK)).toHaveCount(0);
  expect((await characterRow(characterId)).credits).toBe(800);
  const row = (await journeyRow(characterId))!;
  expect(row.routeId).toBe(PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation);
  expect(row.fareCredits).toBe(200);
  expect(row.arrivesAt.getTime() - row.startedAt.getTime()).toBe(180_000);
  // Nobody has moved and the Rivet is where it was.
  expect((await characterRow(characterId)).currentLocationId).toBe(HOLO);

  // The flight is the shared cinematic, with the Milky Waymo shuttle in the Rivet's place.
  const cinematic = page.locator(CINEMATIC);
  await expect(cinematic).toHaveAttribute("data-flight-phase", "takeoff", { timeout: 10_000 });
  await expect(cinematic.locator("img[data-flight-ship]")).toHaveAttribute(
    "src",
    new RegExp(SHUTTLE),
  );
  await expect(cinematic.locator("img[data-flight-ship]")).not.toHaveAttribute("src", /rivet/);
  await expect(cinematic).toHaveAttribute("data-flight-phase", "travel", { timeout: 6_000 });
  await expect(cinematic.locator("[data-flight-chart-marker] image")).toHaveAttribute(
    "href",
    new RegExp(SHUTTLE),
  );
  await expect(cinematic).toContainText("SKATBOLL");
  await expect(cinematic).toContainText("STILLREACH");

  // The cabin assistant sits under the chart, noninteractive, with the fixed greeting.
  const cabin = page.locator(CABIN);
  await expect(cabin.locator("[data-cabin-title]")).toHaveText("Milky Waymo — Cabin Assistant");
  await expect(cabin).toHaveAttribute("data-cabin-phase", "departure");
  expect(await cabinLine(page)).toBe(
    "Welcome aboard Milky Waymo! Please sit back, relax, and enjoy your journey. Your pilot is fully automated, thoroughly tested, and legally considered a transportation professional.",
  );
  await expect(cabin.locator("button, a, input")).toHaveCount(0);
  const chartBox = (await cinematic.boundingBox())!;
  const cabinBox = (await cabin.boundingBox())!;
  expect(cabinBox.y).toBeGreaterThan(chartBox.y + chartBox.height - 1);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "milky-waymo-journey-mobile.png");

  // A reload at 01:35 resumes on that moment's line, in full at once, never the greeting.
  await ageJourney(characterId, 95_000);
  await page.reload();
  await expect(page.locator(CABIN)).toHaveAttribute("data-cabin-phase", "in_flight");
  const resumed = await cabinLine(page);
  expect(CABIN_ANNOUNCEMENT_POOL).toContain(resumed);
  await expect(page.locator(`${CABIN} [data-typewriter-complete]`)).toHaveAttribute(
    "data-typewriter-complete",
    "true",
  );
  await expect(page.locator(`${CABIN} .rs-dialogue-cursor`)).toHaveCount(0);
  await expect(page.locator(`${CABIN} [data-typewriter-visible]`)).toHaveText(resumed);
  await expect(page.locator("[data-passenger-progress]")).toContainText(/\d+ seconds remaining/);
  // The same journey and the same time always say the same line: reload again.
  await page.reload();
  expect(await cabinLine(page)).toBe(resumed);

  // While the shuttle is under way nothing else can begin, and it is not cancellable.
  await expect(page.getByRole("button", { name: /cancel/i })).toHaveCount(0);
  await expect(page.locator(CINEMATIC)).toBeVisible();

  // Past the scheduled arrival the server lands it: the character, and only the character, moves.
  await ageJourney(characterId, 181_000);
  await page.reload();
  const notice = page.locator(NOTICE);
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(JOURNEY)).toHaveCount(0);
  await expect(notice).toContainText(
    "Congratulations! You have successfully arrived at Stillreach Landing Station. Please collect your belongings and exit the vehicle. Milky Waymo appreciates your business and looks forward to charging you again.",
  );
  await expect(notice.locator("[data-passenger-disembark]")).toHaveText("DISEMBARK");
  const arrived = await characterRow(characterId);
  expect(arrived.currentLocationId).toBe(STILLREACH);
  expect(arrived.credits).toBe(800);
  const ship = (
    await db.select().from(characterShips).where(eq(characterShips.characterId, characterId))
  )[0]!;
  expect(ship).toMatchObject({ berthLocationId: HOLO, fuelUnits: 180, flightRouteId: null });
  const cargo = await db
    .select({ itemId: cargoHoldStacks.itemId, quantity: cargoHoldStacks.quantity })
    .from(cargoHoldStacks)
    .where(eq(cargoHoldStacks.characterId, characterId));
  expect(cargo.sort((a, b) => a.itemId.localeCompare(b.itemId))).toEqual(
    [
      { itemId: ITEM_IDS.oilShale, quantity: 7 },
      { itemId: ITEM_IDS.fullSmallFuelCanister, quantity: 2 },
    ].sort((a, b) => a.itemId.localeCompare(b.itemId)),
  );
  await captureReviewScreenshot(page, "milky-waymo-arrival-mobile.png");

  // The notice outlives a reload; DISEMBARK only dismisses it.
  await page.reload();
  await expect(page.locator(NOTICE)).toBeVisible();
  await page.locator(NOTICE).locator("[data-passenger-disembark]").click();
  await expect(page.locator(NOTICE)).toHaveCount(0);
  expect((await characterRow(characterId)).currentLocationId).toBe(STILLREACH);
  await page.reload();
  await expect(page.locator(NOTICE)).toHaveCount(0);
  // Stillreach's own desk now sells the way home, for the same fare.
  await enterDesk(page, STILLREACH_DESK);
  await expect(page.locator(`${KIOSK} [data-kiosk-destination]`)).toHaveText("Holo Hollow Landing");
  await expect(page.locator(`${KIOSK} [data-kiosk-credits]`)).toHaveText("800 CR");
});

test("shows the announcement on the clock: the greeting, five drawn lines and the sign-off, under reduced motion", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await enterDesk(page, HOLO_DESK);
  await page.locator("[data-kiosk-book]").click();
  await page.locator("[data-kiosk-board]").click();
  await expect(page.locator(JOURNEY)).toBeVisible({ timeout: 15_000 });

  // Reduced motion: the greeting is whole at once, no typing and no cursor, and the
  // chart rests without a moving marker.
  await expect(page.locator(`${CABIN} [data-typewriter-visible]`)).toHaveText(
    /Welcome aboard Milky Waymo!.*transportation professional\.$/,
  );
  await expect(page.locator(`${CABIN} .rs-dialogue-cursor`)).toHaveCount(0);
  await expect(page.locator("[data-flight-chart-marker]")).toHaveCount(0);

  // Walk the clock through every slot: each is the line the journey's own recorded
  // start draws for that slot, from the pool, and the draw never repeats within a flight.
  async function expectSlotLine(elapsedSeconds: number, slot: number) {
    await ageJourney(characterId, elapsedSeconds * 1_000);
    const row = (await journeyRow(characterId))!;
    const indices = selectCabinAnnouncementIndices(
      cabinAnnouncementSeed({ routeId: row.routeId, startedAt: row.startedAt.toISOString() }),
    );
    expect(new Set(indices).size).toBe(5);
    await page.reload();
    await expect(page.locator(CABIN)).toHaveAttribute("data-cabin-phase", "in_flight");
    const line = await cabinLine(page);
    expect(line).toBe(CABIN_ANNOUNCEMENT_POOL[indices[slot - 1] as number]);
    return line;
  }
  for (const [seconds, slot] of [
    [31, 1],
    [61, 2],
    [91, 3],
    [121, 4],
    [151, 5],
  ] as const) {
    await expectSlotLine(seconds, slot);
  }

  // Just before arrival the last line still stands; the sign-off arrives with the landing.
  await expectSlotLine(178, 5);
  await ageJourney(characterId, 181_000);
  await page.reload();
  await expect(page.locator(NOTICE)).toBeVisible({ timeout: 30_000 });
});

test("types a new announcement as it begins, and keeps the sign-off whole once landed", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await enterDesk(page, HOLO_DESK);
  await page.locator("[data-kiosk-book]").click();
  await page.locator("[data-kiosk-board]").click();
  await expect(page.locator(JOURNEY)).toBeVisible({ timeout: 15_000 });

  // A fresh booking's greeting types itself automatically, character by character, with
  // the blinking cursor, and a screen reader is given the whole line from the start.
  const visible = page.locator(`${CABIN} [data-typewriter-visible]`);
  const full = page.locator(`${CABIN} [data-typewriter-full]`);
  await expect(full).toHaveText(/^Welcome aboard Milky Waymo!/);
  const early = (await visible.textContent()) ?? "";
  expect(early.length).toBeLessThan((await full.textContent())!.length);
  await expect(page.locator(`${CABIN} .rs-dialogue-cursor`)).toHaveText("_");
  await expect(visible).toHaveAttribute("aria-hidden", "true");
  await expect(full).toHaveAttribute("aria-live", "polite");
  await expect(page.locator(`${CABIN} [data-typewriter-complete]`)).toHaveAttribute(
    "data-typewriter-complete",
    "true",
    { timeout: 15_000 },
  );
  await expect(page.locator(`${CABIN} .rs-dialogue-cursor`)).toHaveCount(0);
  await expect(visible).toHaveText((await full.textContent())!);
});

test("books the way home from Stillreach on a desktop and refuses a short balance without charging", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  // The Rivet stays at Skatboll; the rider is at Stillreach with 150 CR.
  await seedRider(characterId, { at: STILLREACH, berth: HOLO, credits: 150 });
  await page.setViewportSize(DESKTOP);
  await openTestCharacter(page, characterId);
  const card = page.locator(`[data-local-place="${STILLREACH_DESK}"]`);
  await expect(card).toContainText("Milky Waymo — Stillreach Landing Station");
  await card.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-place-card-stillreach-desktop.png");
  await enterDesk(page, STILLREACH_DESK);
  const kiosk = page.locator(KIOSK);
  await expect(kiosk.locator("[data-kiosk-destination]")).toHaveText("Holo Hollow Landing");
  await expect(kiosk.locator("[data-kiosk-credits]")).toHaveText("150 CR");
  await expectNoHorizontalOverflow(page);
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-welcome-desktop.png");

  // Booking is not disabled: the machine says so itself, and nothing is charged.
  await kiosk.locator("[data-kiosk-book]").click();
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "insufficient");
  await expect(kiosk.getByRole("heading", { name: "INSUFFICIENT FUNDS" })).toBeFocused();
  await expect(kiosk).toContainText(
    "Unfortunately, your available balance is insufficient. Please come back when you have rectified your financial troubles.",
  );
  await expect(kiosk).toContainText("One-way passage costs 200 CR.");
  await expect(kiosk.locator("[data-kiosk-board]")).toHaveCount(0);
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-insufficient-desktop.png");
  await page.setViewportSize(PHONE);
  await expectNoHorizontalOverflow(page);
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-insufficient-mobile.png");
  await page.setViewportSize(DESKTOP);
  await kiosk.locator("[data-kiosk-return]").click();
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "welcome");
  expect((await characterRow(characterId)).credits).toBe(150);
  expect(await journeyRow(characterId)).toBeUndefined();

  // Funded in the meantime, the stale screen's confirmation is judged by the server.
  await db.update(characters).set({ credits: 500 }).where(eq(characters.id, characterId));
  await page.reload();
  await enterDesk(page, STILLREACH_DESK);
  await kiosk.locator("[data-kiosk-book]").click();
  await kiosk.locator("[data-kiosk-board]").click();
  await expect(page.locator(JOURNEY)).toBeVisible({ timeout: 15_000 });
  const row = (await journeyRow(characterId))!;
  expect(row.routeId).toBe(PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding);
  expect((await characterRow(characterId)).credits).toBe(300);
  await captureReviewScreenshot(page, "milky-waymo-journey-desktop.png");

  // Landing at Skatboll leaves the parked Rivet exactly where it was.
  await ageJourney(characterId, 181_000);
  await page.reload();
  await expect(page.locator(NOTICE)).toContainText("Holo Hollow Landing", { timeout: 30_000 });
  expect((await characterRow(characterId)).currentLocationId).toBe(HOLO);
  const ship = (
    await db.select().from(characterShips).where(eq(characterShips.characterId, characterId))
  )[0]!;
  expect(ship.berthLocationId).toBe(HOLO);
});

test("is visible but unavailable before the first Rivet arrival at Stillreach", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO, unlocked: false });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await enterDesk(page, HOLO_DESK);
  const kiosk = page.locator(KIOSK);
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "locked");
  await expect(kiosk.getByRole("heading", { name: "SERVICE NOT YET AVAILABLE" })).toBeVisible();
  await expect(kiosk).toContainText(
    "Milky Waymo looks forward to serving you! Passenger service becomes available after your first successful interplanetary flight aboard your own ship.",
  );
  await expect(kiosk.locator("[data-kiosk-book]")).toHaveCount(0);
  await expect(kiosk.locator("[data-kiosk-board]")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await kiosk.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "milky-waymo-kiosk-locked-mobile.png");
  expect((await characterRow(characterId)).credits).toBe(1_000);
  expect(await journeyRow(characterId)).toBeUndefined();
});

test("keeps the kiosk keyboard- and screen-reader-operable", async ({ page, testCharacter }) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await enterDesk(page, HOLO_DESK);
  const kiosk = page.locator(KIOSK);
  // A labelled region whose heading is the brand; every control is a real button.
  await expect(kiosk).toHaveAccessibleName("Milky Waymo");
  const book = kiosk.locator("[data-kiosk-book]");
  await book.focus();
  await expect(book).toBeFocused();
  const target = (await book.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "confirm");
  await page.keyboard.press("Tab");
  await expect(kiosk.locator("[data-kiosk-not-yet]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(kiosk.locator("[data-kiosk-board]")).toBeFocused();
  // The focus ring is drawn on the blue screen, not left to the browser default.
  expect(
    await kiosk
      .locator("[data-kiosk-board]")
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(kiosk).toHaveAttribute("data-kiosk-screen", "welcome");
});

test("charges nothing and starts no journey on a forged or stale confirmation", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  await seedRider(characterId, { at: HOLO });
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await enterDesk(page, HOLO_DESK);
  const kiosk = page.locator(KIOSK);
  await kiosk.locator("[data-kiosk-book]").click();
  // The character is moved away behind the screen's back, so the confirmation is stale.
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.holoHollow })
    .where(eq(characters.id, characterId));
  await kiosk.locator("[data-kiosk-board]").click();
  // The server refuses it from where the character really stands, and the place the
  // screen belonged to is simply no longer around them.
  await expect(page.locator(KIOSK)).toHaveCount(0);
  expect((await characterRow(characterId)).credits).toBe(1_000);
  expect(await journeyRow(characterId)).toBeUndefined();
  expect(
    await db.select().from(activeActions).where(eq(activeActions.characterId, characterId)),
  ).toEqual([]);
});
