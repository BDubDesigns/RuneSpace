import type { Locator, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characters,
  characterTheatreBuffs,
  characterTheatreLatestTickets,
  characterTheatreReceipts,
} from "@/db/rune-space";
import {
  LOCATION_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_PRE_ROLL_AD_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
} from "@/game/config/foundations";
import {
  getTheatreFilm,
  getTheatreScreen,
  PRE_ROLL_DURATION_MS,
  THEATRE_COPY,
  THEATRE_PRE_ROLL_SLOTS,
} from "@/game/content/theatre";
import { showingAt } from "@/game/domain/theatre";
import {
  expect,
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";
import { playDialogueToText } from "./dialogue-steps";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * The Holo Drive-In's player-facing theatre (#491, slice 4): The Big Screen on the location panel,
 * ticket purchase with its before/after confirmation, the persisted buff balances, Tamsyn's
 * "What's showing?", and the film viewer with its unskippable pre-roll, both approved films,
 * fullscreen and eligibility.
 *
 * The server owns the schedule and reads the real clock, so a spec cannot move it. Tests that
 * depend on what is showing now first wait out the last 90 seconds of the hour and read the film
 * from the same schedule rule the server uses; tests of the viewer seed a ticket row directly, so
 * either film is reachable whatever hour it is. The pre-rolls are the three real 15-second
 * commercials. Every test but one runs the page's animation clock at 6x through the browser's own
 * DevTools protocol (`speedUpAnimations`), so a commercial, and a 1:43 film, play through in a few
 * seconds with no sleeps and no test seam in the app; one test runs at real speed and measures
 * that a pre-roll takes its designed 15 seconds.
 */

const DRIVE_IN = LOCATION_IDS.holoDriveIn;
const HOUR = 60 * 60 * 1000;
const PHONE = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };
const MINES = THEATRE_FILM_IDS.thatMinesMine;
const WELD = THEATRE_FILM_IDS.rareOrWeldDone;
const FILM_TIER = THEATRE_TICKET_TIER_IDS.film;
const COMBO_TIER = THEATRE_TICKET_TIER_IDS.concessions;
const screen = getTheatreScreen(THEATRE_SCREEN_IDS.main)!;
const SLOTS = THEATRE_PRE_ROLL_SLOTS;
const SLOT_FILMS = SLOTS.map((slot) => slot.filmId!);
/** Where `Math.random` lands in each slot of the draw: thirds of the unit interval. */
const DRAW = { dewhat: 0.1, skatboll: 0.5, fedhex: 0.9 } as const;

const skillOf = (filmId: string) => getTheatreFilm(filmId)!.skillId;
const titleOf = (filmId: string) => getTheatreFilm(filmId)!.title;

/** The showing the server has on right now, by the same rule it uses. */
function showingNow() {
  return showingAt(screen, Date.now());
}

/** Wait out the last 90 seconds of the hour so a test never straddles a changeover. */
async function awayFromHourBoundary() {
  // Only a test that starts in the last 90 seconds of an hour has anything to wait for, and it
  // may wait up to 90 s, which is longer than a test's own timeout, so extend that first.
  if (HOUR - (Date.now() % HOUR) <= 90_000) test.setTimeout(test.info().timeout + 120_000);
  await expect
    .poll(() => HOUR - (Date.now() % HOUR), {
      message: "waiting out the end of the hour",
      intervals: [1_000],
      timeout: 120_000,
    })
    .toBeGreaterThan(90_000);
}

async function standAt(characterId: string, locationId: string, credits = 500) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId, credits })
    .where(eq(characters.id, characterId));
}

async function setBuff(characterId: string, filmId: string, remaining: number) {
  await db.insert(characterTheatreBuffs).values({
    characterId,
    skillId: skillOf(filmId),
    remainingCharges: remaining,
    updatedAt: new Date(),
  });
}

/**
 * A ticket bought in the past, as a row: its receipt, the replay entitlement pointing at it and
 * the buff balance it left. `current` makes it the showing on now, otherwise it is two days old.
 */
async function seedTicket(
  characterId: string,
  filmId: string,
  options: { current?: boolean; tierId?: string; remaining?: number } = {},
) {
  const tierId = options.tierId ?? FILM_TIER;
  const capacity = tierId === COMBO_TIER ? 50 : 20;
  let startsAtMs: number;
  if (options.current) {
    startsAtMs = showingNow().startsAtMs;
  } else {
    // Two days back, on an hour that shows this film (the rotation alternates by hour).
    const wanted = screen.rotation.indexOf(filmId as (typeof screen.rotation)[number]);
    startsAtMs = Math.floor((Date.now() - 48 * HOUR) / HOUR) * HOUR;
    if (Math.abs(Math.floor(startsAtMs / HOUR) % screen.rotation.length) !== wanted) {
      startsAtMs += HOUR;
    }
  }
  const past = showingAt(screen, startsAtMs);
  expect(past.filmId).toBe(filmId);
  const [receipt] = await db
    .insert(characterTheatreReceipts)
    .values({
      characterId,
      filmId,
      showtimeId: past.showtimeId,
      screenId: past.screenId,
      showingId: past.showingId,
      tierId,
      skillId: skillOf(filmId),
      creditsPaid: capacity,
      tierCapacity: capacity,
      chargesBefore: 0,
      chargesAfter: capacity,
      purchasedAt: new Date(startsAtMs + 60_000),
    })
    .returning({ id: characterTheatreReceipts.id });
  await db.insert(characterTheatreLatestTickets).values({
    characterId,
    receiptId: receipt!.id,
    filmId,
    showtimeId: past.showtimeId,
    updatedAt: new Date(),
  });
  await db
    .insert(characterTheatreBuffs)
    .values({
      characterId,
      skillId: skillOf(filmId),
      remainingCharges: options.remaining ?? capacity,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function ledger(characterId: string) {
  const [row] = await db
    .select({ credits: characters.credits })
    .from(characters)
    .where(eq(characters.id, characterId));
  const receipts = await db
    .select()
    .from(characterTheatreReceipts)
    .where(eq(characterTheatreReceipts.characterId, characterId));
  const pointers = await db
    .select()
    .from(characterTheatreLatestTickets)
    .where(eq(characterTheatreLatestTickets.characterId, characterId));
  const buffs = await db
    .select()
    .from(characterTheatreBuffs)
    .where(eq(characterTheatreBuffs.characterId, characterId));
  return {
    credits: row!.credits,
    receiptCount: receipts.length,
    pointers: pointers.map((pointer) => pointer.receiptId),
    buffs: Object.fromEntries(buffs.map((buff) => [buff.skillId, buff.remainingCharges])),
  };
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Queue the next values `Math.random` returns, so a pre-roll draw is chosen by the test. */
async function stubRandom(page: Page) {
  await page.addInitScript(() => {
    const real = Math.random.bind(Math);
    const queue: number[] = [];
    (window as unknown as { __rsRandomQueue: number[] }).__rsRandomQueue = queue;
    Math.random = () => (queue.length > 0 ? queue.shift()! : real());
  });
}
async function queueRandom(page: Page, ...values: number[]) {
  await page.evaluate((next) => {
    (window as unknown as { __rsRandomQueue: number[] }).__rsRandomQueue.push(...next);
  }, values);
}

const panel = (page: Page) => page.locator("[data-theatre-panel]");
const viewer = (page: Page) => page.getByRole("dialog");

const sped = new WeakSet<Page>();
/**
 * Run the page's animation timeline at `rate`x through Chromium's DevTools protocol. The studio's
 * player is driven by Web Animations, so a 15-second commercial and a 1:43 film play through in
 * seconds, and the viewer's progress (read from the player's own clock) stays honest. The app has
 * no test seam: this changes only the browser's clock.
 */
async function speedUpAnimations(page: Page, rate = 6) {
  if (sped.has(page)) return;
  sped.add(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
}

async function openViewer(page: Page, name: string, { fast = true } = {}) {
  if (fast) await speedUpAnimations(page);
  await panel(page).getByRole("button", { name, exact: true }).click();
  const dialog = viewer(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function waitForPhase(dialog: Locator, phase: string, timeout = 20_000) {
  await expect(dialog).toHaveAttribute("data-phase", phase, { timeout });
}

/** Open the viewer and ride the pre-roll commercial into the film. */
async function watchToFilm(page: Page, name: string) {
  const dialog = await openViewer(page, name);
  await waitForPhase(dialog, "film");
  await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "playing");
  return dialog;
}

async function seek(dialog: Locator, permille: number) {
  await dialog.getByRole("slider", { name: "Seek" }).evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, permille);
}

async function expectViewerFits(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!;
  const picture = (await dialog.locator("[data-theatre-screen]").boundingBox())!;
  expect(picture.width / picture.height).toBeGreaterThan(1.76);
  expect(picture.width / picture.height).toBeLessThan(1.79);
  expect(picture.x).toBeGreaterThanOrEqual(-1);
  expect(picture.x + picture.width).toBeLessThanOrEqual(viewport.width + 1);
  const controls = (await dialog.locator("[data-theatre-controls]").boundingBox())!;
  expect(controls.y).toBeGreaterThanOrEqual(picture.y + picture.height - 1);
  expect(controls.y + controls.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(picture.y).toBeGreaterThanOrEqual(-1);
  await expectNoPageOverflow(page);
}

// ----------------------------------------------------------------------------------------------
// The Big Screen
// ----------------------------------------------------------------------------------------------

for (const viewport of [
  { name: "phone", ...PHONE },
  { name: "desktop", ...DESKTOP },
]) {
  test(`shows The Big Screen with the programme, countdown, bonuses and both tickets, on a ${viewport.name}`, async ({
    page,
    testCharacter,
  }) => {
    await awayFromHourBoundary();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await standAt(testCharacter.id, DRIVE_IN, 120);
    await openTestCharacter(page, testCharacter.id);

    const now = showingNow();
    const next = showingAt(screen, now.endsAtMs);
    const big = panel(page);
    await expect(big.getByRole("heading", { name: "The Big Screen" })).toBeVisible();
    await expect(big.locator("[data-now-showing]")).toContainText("Now Showing");
    await expect(big.locator("[data-now-showing]")).toContainText(titleOf(now.filmId));
    await expect(big.locator("[data-up-next]")).toContainText("Up Next");
    await expect(big.locator("[data-up-next]")).toContainText(titleOf(next.filmId));
    expect(now.filmId).not.toBe(next.filmId);

    // The countdown runs on the server's clock to the end of this showing.
    const remaining = await big.locator("[data-theatre-countdown]").innerText();
    const match = /^Next showing in (\d+):(\d\d)$/.exec(remaining.trim());
    expect(match, remaining).not.toBeNull();
    const shownMs = (Number(match![1]) * 60 + Number(match![2])) * 1000;
    const trueMs = now.endsAtMs - Date.now();
    expect(Math.abs(shownMs - trueMs)).toBeLessThan(4_000);

    // Bonuses start at zero for both skills; the two tickets use the approved labels.
    await expect(big.locator(`[data-theatre-buff="${SKILL_IDS.mining}"]`)).toContainText(
      "Mining bonus attempts",
    );
    await expect(big.locator(`[data-theatre-buff="${SKILL_IDS.mining}"] dd`)).toHaveText("0");
    await expect(big.locator(`[data-theatre-buff="${SKILL_IDS.welding}"] dd`)).toHaveText("0");
    const film = big.locator(`[data-ticket-tier="${FILM_TIER}"]`);
    const combo = big.locator(`[data-ticket-tier="${COMBO_TIER}"]`);
    await expect(film).toContainText("Film Ticket: 20 Credits");
    await expect(film).toContainText("20 bonus attempts");
    await expect(combo).toContainText("Ticket + Concessions: 50 Credits");
    await expect(combo).toContainText("50 bonus attempts");
    await expect(big.locator("[data-theatre-credits]")).toHaveText("120 Credits");
    await expect(big.locator("[data-theatre-explanation]")).toHaveText(
      THEATRE_COPY.ticketExplanation,
    );
    // No ticket, no viewer entry; and nothing was charged by looking.
    await expect(big.getByRole("button", { name: /Watch Film|Replay Last Film/ })).toHaveCount(0);
    expect((await ledger(testCharacter.id)).receiptCount).toBe(0);
    await expectNoPageOverflow(page);
    if (viewport.name === "phone")
      await captureReviewScreenshot(page, "holo-drive-in-big-screen-mobile.png");
  });
}

test("is nowhere else: the Big Screen needs a character standing at the Drive-In", async ({
  page,
  testCharacter,
}) => {
  await standAt(testCharacter.id, LOCATION_IDS.holoHollow);
  await openTestCharacter(page, testCharacter.id);
  await expect(page.locator("[data-theatre-panel]")).toHaveCount(0);
});

// ----------------------------------------------------------------------------------------------
// Buying a ticket
// ----------------------------------------------------------------------------------------------

test("buys a Film Ticket after a confirmation that shows the Credits and bonus before and after", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 100);
  await openTestCharacter(page, testCharacter.id);

  const now = showingNow();
  const skill = skillOf(now.filmId);
  const skillName = skill === SKILL_IDS.mining ? "Mining" : "Welding";
  const big = panel(page);
  await big
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();

  const confirmation = big.locator("[data-ticket-confirmation]");
  await expect(confirmation).toContainText(`Film Ticket: 20 Credits for ${titleOf(now.filmId)}`);
  await expect(confirmation.locator("[data-ticket-credits]")).toHaveText("Credits: 100 to 80.");
  await expect(confirmation.locator("[data-ticket-buff]")).toHaveText(
    `${skillName} bonus attempts: 0 to 20.`,
  );
  // A fresh buff has nothing to warn about. Nothing is charged until Confirm.
  await expect(confirmation.locator("[data-ticket-warning]")).toHaveCount(0);
  expect((await ledger(testCharacter.id)).credits).toBe(100);
  await captureReviewScreenshot(page, "holo-drive-in-ticket-confirmation-mobile.png");

  // Cancel changes nothing; choosing again and confirming buys the ticket exactly once.
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await big
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await big.getByRole("button", { name: "Confirm purchase" }).click();

  await expect(big.locator("[data-theatre-held]")).toContainText(
    "You have a ticket for this showing: Film Ticket: 20 Credits.",
  );
  await expect(big.locator(`[data-theatre-buff="${skill}"] dd`)).toHaveText("20");
  await expect(big.locator("[data-theatre-credits]")).toHaveCount(0);
  await expect(big.locator("[data-ticket-tier]")).toHaveCount(0);
  await expect(big).toContainText(`${skillName} bonus attempts: 0 to 20.`);
  // The entry to the film is now there, for the showing on now.
  await expect(big.getByRole("button", { name: "Watch Film", exact: true })).toBeVisible();
  const after = await ledger(testCharacter.id);
  expect(after).toMatchObject({ credits: 80, receiptCount: 1, buffs: { [skill]: 20 } });
  expect(after.pointers).toHaveLength(1);

  // A reload shows the same, from the server.
  await page.reload();
  await expect(panel(page).locator("[data-theatre-held]")).toBeVisible();
  await expect(panel(page).locator(`[data-theatre-buff="${skill}"] dd`)).toHaveText("20");
  await expect(panel(page).getByRole("button", { name: "Watch Film", exact: true })).toBeVisible();
  expect((await ledger(testCharacter.id)).credits).toBe(80);
});

for (const scenario of [
  {
    name: "tops a partly used bonus up to the ticket's size and says so",
    tier: FILM_TIER,
    remaining: 5,
    outcome: "tops_up",
    warning:
      /You already have 5 \w+ bonus attempts\. This ticket raises your bonus to 20, adding 15 rather than 20/,
    summary: / bonus attempts: 5 to 20\.$/,
    after: 20,
    price: 20,
  },
  {
    name: "says plainly that a ticket adds zero attempts when the bonus already covers it",
    tier: FILM_TIER,
    remaining: 30,
    outcome: "adds_none",
    warning:
      /You already have 30 \w+ bonus attempts\. This ticket adds none, so your bonus stays at 30/,
    summary: / bonus attempts: 30 to 30\.$/,
    after: 30,
    price: 20,
  },
  {
    name: "says the 50-Credit combo only tops up to 50 rather than adding 50",
    tier: COMBO_TIER,
    remaining: 30,
    outcome: "tops_up",
    warning: /adding 20 rather than 50/,
    summary: / bonus attempts: 30 to 50\.$/,
    after: 50,
    price: 50,
  },
] as const) {
  test(`${scenario.name}`, async ({ page, testCharacter }) => {
    await awayFromHourBoundary();
    await page.setViewportSize(PHONE);
    await standAt(testCharacter.id, DRIVE_IN, 200);
    const now = showingNow();
    const skill = skillOf(now.filmId);
    await setBuff(testCharacter.id, now.filmId, scenario.remaining);
    await openTestCharacter(page, testCharacter.id);

    const big = panel(page);
    await expect(big.locator(`[data-theatre-buff="${skill}"] dd`)).toHaveText(
      String(scenario.remaining),
    );
    await big
      .locator(`[data-ticket-tier="${scenario.tier}"]`)
      .getByRole("button", { name: "Choose" })
      .click();
    const confirmation = big.locator("[data-ticket-confirmation]");
    // The warning is shown BEFORE anything is charged, and never calls the player ineligible.
    await expect(confirmation.locator(`[data-ticket-warning="${scenario.outcome}"]`)).toHaveText(
      scenario.warning,
    );
    await expect(confirmation.locator("[data-ticket-buff]")).toHaveText(scenario.summary);
    await expect(confirmation).not.toContainText(/ineligible|cannot buy|not allowed/i);
    expect((await ledger(testCharacter.id)).credits).toBe(200);

    await confirmation.getByRole("button", { name: "Confirm purchase" }).click();
    await expect(big.locator("[data-theatre-held]")).toBeVisible();
    await expect(big.locator(`[data-theatre-buff="${skill}"] dd`)).toHaveText(
      String(scenario.after),
    );
    const after = await ledger(testCharacter.id);
    expect(after.credits).toBe(200 - scenario.price);
    expect(after.buffs[skill]).toBe(scenario.after);
    expect(after.receiptCount).toBe(1);
  });
}

test("keeps the other skill's bonus separate: a ticket changes only its own film's skill", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 200);
  const now = showingNow();
  const otherFilm = now.filmId === MINES ? WELD : MINES;
  await setBuff(testCharacter.id, otherFilm, 12);
  await openTestCharacter(page, testCharacter.id);
  const big = panel(page);
  await expect(big.locator(`[data-theatre-buff="${skillOf(otherFilm)}"] dd`)).toHaveText("12");
  await big
    .locator(`[data-ticket-tier="${COMBO_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  // The other skill's 12 attempts are not a reason for a warning about this film's bonus.
  await expect(big.locator("[data-ticket-warning]")).toHaveCount(0);
  await big.getByRole("button", { name: "Confirm purchase" }).click();
  await expect(big.locator("[data-theatre-held]")).toBeVisible();
  await expect(big.locator(`[data-theatre-buff="${skillOf(now.filmId)}"] dd`)).toHaveText("50");
  await expect(big.locator(`[data-theatre-buff="${skillOf(otherFilm)}"] dd`)).toHaveText("12");
});

test("will not sell what the player cannot afford", async ({ page, testCharacter }) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 30);
  await openTestCharacter(page, testCharacter.id);
  const big = panel(page);
  await expect(
    big.locator(`[data-ticket-tier="${FILM_TIER}"]`).getByRole("button", { name: "Choose" }),
  ).toBeEnabled();
  const combo = big.locator(`[data-ticket-tier="${COMBO_TIER}"]`);
  await expect(combo.getByRole("button", { name: "Choose" })).toBeDisabled();
  await expect(combo).toContainText("Not enough Credits.");

  await standAt(testCharacter.id, DRIVE_IN, 10);
  await page.reload();
  for (const tier of [FILM_TIER, COMBO_TIER]) {
    await expect(
      panel(page).locator(`[data-ticket-tier="${tier}"]`).getByRole("button", { name: "Choose" }),
    ).toBeDisabled();
  }
  expect((await ledger(testCharacter.id)).receiptCount).toBe(0);
});

test("charges once when a second tab buys the same showing, and recognises the first tab's ticket", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 100);
  await openTestCharacter(page, testCharacter.id);
  const second = await page.context().newPage();
  await second.setViewportSize(PHONE);
  await openTestCharacter(second, testCharacter.id);

  // Both tabs choose the same ticket while neither holds one.
  for (const tab of [page, second]) {
    await panel(tab)
      .locator(`[data-ticket-tier="${FILM_TIER}"]`)
      .getByRole("button", { name: "Choose" })
      .click();
  }
  await panel(page).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(panel(page).locator("[data-theatre-held]")).toBeVisible();

  // The second tab's stale confirmation finds the first one's receipt: no second charge, no error.
  await panel(second).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(second.getByText("You already have this ticket")).toBeVisible();
  await expect(panel(second).locator("[data-theatre-held]")).toBeVisible();
  const after = await ledger(testCharacter.id);
  expect(after).toMatchObject({ credits: 80, receiptCount: 1 });
  await second.close();
});

test("refuses a different tier for a showing the player already holds, and charges nothing more", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 100);
  await openTestCharacter(page, testCharacter.id);
  const second = await page.context().newPage();
  await second.setViewportSize(PHONE);
  await openTestCharacter(second, testCharacter.id);

  await panel(second)
    .locator(`[data-ticket-tier="${COMBO_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await panel(page)
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await panel(page).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(panel(page).locator("[data-theatre-held]")).toBeVisible();

  await panel(second).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(panel(second).getByRole("alert")).toHaveText(
    "You already have a ticket for this showing.",
  );
  await expect(panel(second).locator("[data-theatre-held]")).toContainText(
    "Film Ticket: 20 Credits",
  );
  expect(await ledger(testCharacter.id)).toMatchObject({ credits: 80, receiptCount: 1 });
  await second.close();
});

test("refuses a showing that has turned over and sells nothing", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN, 100);
  await openTestCharacter(page, testCharacter.id);
  const now = showingNow();
  // The player confirms a showing the server has already moved past: rewrite the request to name
  // the previous hour's showing, which is what a stale page sends right after a changeover.
  const previous = showingAt(screen, now.startsAtMs - 1);
  await page.route("**/play/**", async (route) => {
    const request = route.request();
    const body = request.postData();
    if (request.method() === "POST" && body?.includes(now.showingId)) {
      await route.continue({ postData: body.replace(now.showingId, previous.showingId) });
    } else {
      await route.fallback();
    }
  });
  await panel(page)
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await panel(page).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(
    "That showing has ended. Check what is on now.",
  );
  expect(await ledger(testCharacter.id)).toMatchObject({
    credits: 100,
    receiptCount: 0,
    buffs: {},
  });
  // The page is still usable: the real showing can be bought once the stale request is gone.
  await page.unroute("**/play/**");
  await panel(page)
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await panel(page).getByRole("button", { name: "Confirm purchase" }).click();
  await expect(panel(page).locator("[data-theatre-held]")).toBeVisible();
  expect((await ledger(testCharacter.id)).receiptCount).toBe(1);
});

test("keeps the bonus and the replay entitlement across a later showing, and a new ticket needs a new showing", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  // A ticket bought for a showing two days ago: the bonus persists, it is a replay today, and
  // today's showing is a different one that can be bought.
  await standAt(testCharacter.id, DRIVE_IN, 100);
  const now = showingNow();
  await seedTicket(testCharacter.id, now.filmId, { remaining: 14 });
  await openTestCharacter(page, testCharacter.id);
  const big = panel(page);
  await expect(big.locator(`[data-theatre-buff="${skillOf(now.filmId)}"] dd`)).toHaveText("14");
  await expect(big.locator("[data-theatre-held]")).toHaveCount(0);
  await expect(big.getByRole("button", { name: "Replay Last Film", exact: true })).toBeVisible();
  await expect(big.getByRole("button", { name: "Watch Film", exact: true })).toHaveCount(0);
  await big
    .locator(`[data-ticket-tier="${FILM_TIER}"]`)
    .getByRole("button", { name: "Choose" })
    .click();
  await expect(big.locator('[data-ticket-warning="tops_up"]')).toContainText("You already have 14");
});

// ----------------------------------------------------------------------------------------------
// Tamsyn
// ----------------------------------------------------------------------------------------------

test("Tamsyn's What's showing? opens with the film on now and closes with the shared ticket lines", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await openTestCharacter(page, testCharacter.id);
  const now = showingNow();

  const conversation = await openNpcConversation(page, "Tamsyn Suzara");
  const topics = conversation.getByRole("button", {
    name: /What's showing\?|Tell me about the projector|Why keep this place open\?/,
  });
  await expect(topics).toHaveText([
    /What's showing\?/,
    /Tell me about the projector/,
    /Why keep this place open\?/,
  ]);
  await openConversationEntry(conversation, /What's showing\?/);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  const beats =
    now.filmId === MINES
      ? [
          /Right now we've got That Mines Mine! on the screen/,
          /Some of the rocks give better performances than the actors/,
          /It's a good one for miners, too/,
        ]
      : [
          /Tonight's feature is Rare or Weld Done\?/,
          /At least the welding looks convincing/,
          /And it's good for your own welding!/,
        ];
  const faces = ["welcoming", "amused", "welcoming"];
  for (const [index, beat] of beats.entries()) {
    await playDialogueToText(conversation, beat);
    await expect(portrait).toHaveAttribute(
      "src",
      new RegExp(`tamsyn-suzara-${faces[index]}\\.png`),
    );
  }
  await playDialogueToText(conversation, /Tickets are 20 Credits, or 50 with concessions/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-neutral\.png/);
  await playDialogueToText(conversation, /the bonus comes with your ticket/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-welcoming\.png/);
  await captureReviewScreenshot(page, "tamsyn-whats-showing-mobile.png");
});

// ----------------------------------------------------------------------------------------------
// The viewer
// ----------------------------------------------------------------------------------------------

for (const filmId of [MINES, WELD]) {
  test(`plays ${titleOf(filmId)} after one unskippable pre-roll, with the player's controls only`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(PHONE);
    await standAt(testCharacter.id, DRIVE_IN);
    await seedTicket(testCharacter.id, filmId);
    const before = await ledger(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);

    const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
    await expect(dialog).toHaveAccessibleName(/Holo Drive-In/);
    // The pre-roll: one of the three real commercials, playing in its own player, an honest
    // progress bar, and nothing that could skip or seek: only Scene descriptions, Fullscreen and Close.
    await waitForPhase(dialog, "pre_roll");
    await expect(dialog.locator("[data-theatre-ad-host] .mm-player")).toHaveCount(1);
    // One synchronous read of everything on screen, so the pre-roll cannot end between two
    // assertions on a slow runner.
    const seen = await dialog.evaluate((root) => {
      const host = root.querySelector("[data-theatre-ad-host]");
      const buttons = Array.from(root.querySelectorAll("button")).map((button) =>
        (button.textContent ?? "").trim(),
      );
      return {
        phase: root.getAttribute("data-phase"),
        film: host?.getAttribute("data-pre-roll-film") ?? null,
        slot: host?.getAttribute("data-pre-roll-slot") ?? null,
        title: host?.querySelector(".mm-stage")?.getAttribute("aria-label") ?? null,
        players: host?.querySelectorAll(".mm-player").length ?? 0,
        // Not a stand-in card of any kind: a real animated picture.
        standIn: root.textContent?.includes("Stand-in") ?? false,
        inert: host?.hasAttribute("inert") ?? false,
        bar: root.querySelectorAll('[role="progressbar"][aria-label="Commercial break progress"]')
          .length,
        // The viewer's own controls only: the studio's hidden player keeps an inert range input.
        sliders: root.querySelectorAll('[data-theatre-controls] input[type="range"]').length,
        filmControls: buttons.filter((name) => /^(Play|Pause|Restart|Replay)$/.test(name)).length,
        close: buttons.includes("Close"),
        fullscreen: buttons.includes("Fullscreen"),
        descriptions: buttons.includes("Scene descriptions"),
      };
    });
    expect(seen).toMatchObject({
      phase: "pre_roll",
      players: 1,
      standIn: false,
      inert: true,
      bar: 1,
      sliders: 0,
      filmControls: 0,
      close: true,
      fullscreen: true,
      descriptions: true,
    });
    expect(SLOT_FILMS).toContain(seen.film);
    expect(SLOTS.map((slot) => slot.title)).toContain(seen.title);
    await captureReviewScreenshot(page, "holo-drive-in-pre-roll-mobile.png");

    // The film starts by itself when the pre-roll completes.
    await waitForPhase(dialog, "film");
    const player = dialog.locator(".mm-player");
    await expect(player).toHaveAttribute("data-state", "playing");
    await expect(dialog.locator("[data-theatre-film-host]")).toBeVisible();
    // Only the player's picture: none of the studio's own controls or chapter shortcuts, and no
    // closed-caption control for a silent film.
    await expect(dialog.locator(".mm-controls")).toBeHidden();
    await expect(dialog.locator(".mm-big")).toBeHidden();
    await expect(
      dialog.getByRole("button", { name: /captions|^cc$|chapter|skip to end/i }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(dialog.getByRole("slider", { name: "Seek" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Restart", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Scene descriptions" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expectViewerFits(page, dialog);
    await captureReviewScreenshot(page, `holo-drive-in-${filmId}-mobile.png`);

    // Pause, then movie-only seek moves the film and never the pre-roll.
    await dialog.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(player).toHaveAttribute("data-state", "paused");
    await seek(dialog, 500);
    await expect(dialog.locator("[data-theatre-clock]")).toHaveText(
      /^(?!0:00 )\d:\d\d \/ \d:\d\d$/,
    );
    await dialog.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player).toHaveAttribute("data-state", "playing");

    // Close from the film: the viewer is gone, nothing was charged, granted or discarded.
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(viewer(page)).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: THEATRE_COPY.replayLastFilm }),
    ).toBeFocused();
    expect(await ledger(testCharacter.id)).toEqual(before);
  });
}

test("ends on Replay and Close, and Replay asks again, draws a fresh pre-roll and never refills", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES, { remaining: 7 });
  const before = await ledger(testCharacter.id);
  await stubRandom(page);
  await openTestCharacter(page, testCharacter.id);

  await queueRandom(page, DRAW.dewhat);
  const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
  await waitForPhase(dialog, "pre_roll");
  await expect(dialog.locator("[data-theatre-ad-host]")).toHaveAttribute(
    "data-pre-roll-slot",
    THEATRE_PRE_ROLL_AD_IDS.deWhat,
  );
  await waitForPhase(dialog, "film");
  // Jump to the last frame: the film ends and offers Replay or Close.
  await seek(dialog, 1000);
  await waitForPhase(dialog, "ended");
  await expect(
    dialog.locator("[data-theatre-ended]").getByRole("button", { name: "Replay" }),
  ).toBeVisible();
  await expect(
    dialog.locator("[data-theatre-ended]").getByRole("button", { name: "Close" }),
  ).toBeVisible();

  // Replay: a fresh pre-roll, drawn independently (a different slot here), then the film again.
  await queueRandom(page, DRAW.skatboll);
  await dialog.locator("[data-theatre-ended]").getByRole("button", { name: "Replay" }).click();
  await waitForPhase(dialog, "pre_roll");
  await expect(dialog.locator("[data-theatre-ad-host]")).toHaveAttribute(
    "data-pre-roll-slot",
    THEATRE_PRE_ROLL_AD_IDS.visitSkatboll,
  );
  await waitForPhase(dialog, "film");
  await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "playing");

  // Restart mid-film: asks again and draws again; consecutive repeats are allowed.
  await queueRandom(page, DRAW.skatboll);
  await dialog.getByRole("button", { name: "Restart", exact: true }).click();
  await waitForPhase(dialog, "pre_roll");
  await expect(dialog.locator("[data-theatre-ad-host]")).toHaveAttribute(
    "data-pre-roll-slot",
    THEATRE_PRE_ROLL_AD_IDS.visitSkatboll,
  );
  // The pre-roll cannot be skipped by tapping the picture, pressing keys or seeking.
  await dialog.locator("[data-theatre-screen]").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("End");
  await expect(dialog).toHaveAttribute("data-phase", "pre_roll");
  await waitForPhase(dialog, "film");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // Reopening starts a new viewing too (another draw), and nothing was ever refilled or charged.
  await queueRandom(page, DRAW.fedhex);
  const reopened = await openViewer(page, THEATRE_COPY.replayLastFilm);
  await waitForPhase(reopened, "pre_roll");
  await expect(reopened.locator("[data-theatre-ad-host]")).toHaveAttribute(
    "data-pre-roll-slot",
    THEATRE_PRE_ROLL_AD_IDS.fedhex,
  );
  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  expect(await ledger(testCharacter.id)).toEqual(before);
});

for (const [name, draw] of [
  ["DeWHAT?", DRAW.dewhat],
  ["Visit Skatboll!", DRAW.skatboll],
  ["FedHex", DRAW.fedhex],
] as const) {
  test(`plays the ${name} commercial when it is drawn: a real animated spot, then the film`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(PHONE);
    await standAt(testCharacter.id, DRIVE_IN);
    await seedTicket(testCharacter.id, MINES);
    const before = await ledger(testCharacter.id);
    await stubRandom(page);
    await openTestCharacter(page, testCharacter.id);

    await queueRandom(page, draw);
    const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
    const ad = dialog.locator("[data-theatre-ad-host]");
    // Its own studio film is on screen, drawn as animated SVG (not a card) and moving.
    await expect(ad.locator(`.mm-stage[aria-label="${name}"]`)).toBeVisible();
    await expect(ad.locator(".mm-svg")).toBeVisible();
    await expect(ad.locator(".mm-player")).toHaveAttribute("data-state", "playing");
    // Its progress is the commercial's own clock: it climbs while it plays.
    const bar = dialog.getByRole("progressbar", { name: "Commercial break progress" });
    const first = Number(await bar.getAttribute("aria-valuenow"));
    await expect
      .poll(async () => Number(await bar.getAttribute("aria-valuenow")), { intervals: [100] })
      .toBeGreaterThan(first);

    // Only its natural end hands over to the film, and the commercial's player is torn down.
    await waitForPhase(dialog, "film");
    await expect(ad.locator(".mm-player")).toHaveCount(0);
    await expect(dialog.locator("[data-theatre-film-host] .mm-player")).toHaveAttribute(
      "data-state",
      "playing",
    );
    expect(await ledger(testCharacter.id)).toEqual(before);
  });
}

test("runs each commercial's full designed length in real time with an honest, monotonic progress bar", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES);
  await stubRandom(page);
  await openTestCharacter(page, testCharacter.id);
  await queueRandom(page, DRAW.fedhex);
  // Sample the bar in the page, from before the viewer opens until it is gone.
  await page.evaluate(() => {
    const samples: Array<[number, number]> = [];
    (window as unknown as { __rsBar: typeof samples }).__rsBar = samples;
    window.setInterval(() => {
      const bar = document.querySelector('[role="progressbar"]');
      if (bar) samples.push([performance.now(), Number(bar.getAttribute("aria-valuenow"))]);
    }, 150);
  });

  const clickedAt = Date.now();
  const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm, { fast: false });
  await waitForPhase(dialog, "pre_roll");
  // The whole pre-roll layout is on screen and fits while the commercial plays at real speed.
  await expect(dialog.locator("[data-theatre-ad-host] .mm-player")).toBeVisible();
  await expectViewerFits(page, dialog);
  await captureReviewScreenshot(page, "holo-drive-in-commercial-mobile.png");
  await waitForPhase(dialog, "film", 40_000);
  const elapsed = Date.now() - clickedAt;
  // Exactly the designed 15 seconds of commercial, plus only the server check and the load.
  expect(elapsed).toBeGreaterThan(PRE_ROLL_DURATION_MS - 300);
  expect(elapsed).toBeLessThan(PRE_ROLL_DURATION_MS + 4_500);

  const samples = await page.evaluate(
    () => (window as unknown as { __rsBar: Array<[number, number]> }).__rsBar,
  );
  const values = samples.map(([, value]) => value);
  expect(values.length).toBeGreaterThan(40);
  // Never goes backwards, and ends where it should.
  for (let i = 1; i < values.length; i += 1)
    expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  expect(values.at(-1)!).toBeGreaterThanOrEqual(90);
  // It is linear in real time: half way takes about half of the 15 seconds.
  const started = samples.find(([, value]) => value >= 1)!;
  const half = samples.find(([, value]) => value >= 50)!;
  const done = samples.at(-1)!;
  expect(half[0] - started[0]).toBeGreaterThan(6_000);
  expect(half[0] - started[0]).toBeLessThan(9_000);
  expect(done[0] - started[0]).toBeGreaterThan(13_000);
  expect(done[0] - started[0]).toBeLessThan(16_500);
});

test("can be closed in the middle of a commercial without touching the ticket or the bonus", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, WELD, { remaining: 9 });
  const before = await ledger(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
  await expect(dialog.locator("[data-theatre-ad-host] .mm-player")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  // The commercial's player and the film's are both gone, and the entry still works.
  await expect(page.locator(".mm-player")).toHaveCount(0);
  expect(await ledger(testCharacter.id)).toEqual(before);
  await watchToFilm(page, THEATRE_COPY.replayLastFilm);
});

test("shows a commercial's scene descriptions on request, keeps the choice into the film, and follows reduced motion", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubRandom(page);
  await openTestCharacter(page, testCharacter.id);
  await queueRandom(page, DRAW.dewhat);
  const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
  const ad = dialog.locator("[data-theatre-ad-host]");
  // Reduced motion reaches the commercial: the studio's calm mode is on for its player.
  await expect(ad.locator(".mm-stage.is-reduced")).toHaveCount(1);
  const caption = ad.locator(".mm-caption");
  await expect(caption).toBeHidden();
  const toggle = dialog.getByRole("button", { name: "Scene descriptions" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toBeVisible();
  await expect(caption).not.toBeEmpty();
  // No closed-caption control: the spots are silent.
  await expect(dialog.getByRole("button", { name: /^(cc|captions?)$/i })).toHaveCount(0);
  await captureReviewScreenshot(page, "holo-drive-in-commercial-reduced-motion-mobile.png");
  // The choice carries into the film.
  await waitForPhase(dialog, "film");
  await expect(dialog.getByRole("button", { name: "Scene descriptions" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.locator("[data-theatre-film-host] .mm-caption")).toBeVisible();
});

test("closes from any phase: during the check, the pre-roll, the film and the end card", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, WELD);
  const before = await ledger(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  for (const phase of ["pre_roll", "film", "ended"]) {
    const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
    await waitForPhase(dialog, phase === "ended" ? "film" : phase);
    if (phase === "ended") {
      await seek(dialog, 1000);
      await waitForPhase(dialog, "ended");
    }
    await page.keyboard.press("Escape");
    await expect(viewer(page)).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: THEATRE_COPY.replayLastFilm }),
    ).toBeFocused();
  }
  expect(await ledger(testCharacter.id)).toEqual(before);
});

test("labels the entry Watch Film for the showing on now and Replay Last Film for an older ticket", async ({
  page,
  testCharacter,
}) => {
  await awayFromHourBoundary();
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  const now = showingNow();
  await seedTicket(testCharacter.id, now.filmId, { current: true });
  await openTestCharacter(page, testCharacter.id);
  await expect(panel(page).locator("[data-theatre-held]")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Watch Film", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Replay Last Film" })).toHaveCount(0);
});

test("offers Scene descriptions, accurately named, and never a closed-caption control", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES);
  await openTestCharacter(page, testCharacter.id);
  const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
  const caption = dialog.locator(".mm-caption");
  await expect(caption).toBeHidden();
  const toggle = dialog.getByRole("button", { name: "Scene descriptions" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toBeVisible();
  await expect(caption).not.toBeEmpty();
  await toggle.click();
  await expect(caption).toBeHidden();
  await expect(dialog.getByText(/closed caption/i)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^(cc|captions?)$/i })).toHaveCount(0);
});

test("follows the OS reduced-motion setting and keeps the story readable", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, WELD);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTestCharacter(page, testCharacter.id);
  const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
  await expect(dialog.locator(".mm-stage.is-reduced")).toHaveCount(1);
  // The film still plays and its scene descriptions still carry the content.
  await dialog.getByRole("button", { name: "Scene descriptions" }).click();
  await expect(dialog.locator(".mm-caption")).not.toBeEmpty();
  await captureReviewScreenshot(page, "holo-drive-in-reduced-motion-mobile.png");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const again = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
  await expect(again.locator(".mm-stage.is-reduced")).toHaveCount(0);
});

for (const layout of [
  { name: "phone portrait", ...PHONE },
  { name: "phone landscape", ...PHONE_LANDSCAPE },
  { name: "desktop", ...DESKTOP },
]) {
  test(`fits the screen as 16:9 with its controls on a ${layout.name}`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await standAt(testCharacter.id, DRIVE_IN);
    await seedTicket(testCharacter.id, MINES);
    await openTestCharacter(page, testCharacter.id);
    const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
    await expectViewerFits(page, dialog);
    if (layout.name === "desktop")
      await captureReviewScreenshot(page, "holo-drive-in-viewer-desktop.png");
    if (layout.name === "phone landscape") {
      await captureReviewScreenshot(page, "holo-drive-in-viewer-landscape.png");
    }
  });
}

test.describe("fullscreen", () => {
  test("enters and leaves without losing the film's place or touching the ticket", async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(PHONE_LANDSCAPE);
    await standAt(testCharacter.id, DRIVE_IN);
    await seedTicket(testCharacter.id, MINES, { remaining: 11 });
    const before = await ledger(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
    await dialog.getByRole("button", { name: "Pause", exact: true }).click();
    await seek(dialog, 400);
    const clock = dialog.locator("[data-theatre-clock]");
    const placed = await clock.innerText();

    await dialog.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect(dialog).not.toHaveAttribute("data-fullscreen", "none");
    // The same picture, paused at the same moment: no rebuild, no restart, no new pre-roll.
    await expect(dialog).toHaveAttribute("data-phase", "film");
    await expect(clock).toHaveText(placed);
    await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "paused");
    await expectViewerFits(page, dialog);

    await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect(dialog).toHaveAttribute("data-fullscreen", "none");
    await expect(clock).toHaveText(placed);
    await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "paused");
    await dialog.getByRole("button", { name: "Play", exact: true }).click();
    await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "playing");
    expect(await ledger(testCharacter.id)).toEqual(before);
  });

  test.describe("where native fullscreen is unavailable", () => {
    test("expands the same viewer to the whole screen and Escape steps back before it closes", async ({
      page,
      testCharacter,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", {
          value: undefined,
          configurable: true,
        });
      });
      await page.setViewportSize(PHONE_LANDSCAPE);
      await standAt(testCharacter.id, DRIVE_IN);
      await seedTicket(testCharacter.id, MINES);
      await openTestCharacter(page, testCharacter.id);
      const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
      await dialog.getByRole("button", { name: "Pause", exact: true }).click();
      await seek(dialog, 300);
      const clock = dialog.locator("[data-theatre-clock]");
      const placed = await clock.innerText();

      await dialog.getByRole("button", { name: "Fullscreen", exact: true }).click();
      await expect(dialog).toHaveAttribute("data-fullscreen", "expanded");
      const box = (await dialog.boundingBox())!;
      expect(box).toMatchObject({
        x: 0,
        y: 0,
        width: PHONE_LANDSCAPE.width,
        height: PHONE_LANDSCAPE.height,
      });
      await expect(clock).toHaveText(placed);
      await expectViewerFits(page, dialog);

      // Escape leaves the expanded view first; the viewer and the film stay.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveAttribute("data-fullscreen", "none");
      await expect(viewer(page)).toBeVisible();
      await expect(clock).toHaveText(placed);
      // A second Escape closes it.
      await page.keyboard.press("Escape");
      await expect(viewer(page)).toHaveCount(0);
    });
  });

  test.describe("on a portrait phone", () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

    test("suggests turning the phone sideways once, dismissibly, and never blocks playback", async ({
      page,
      testCharacter,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", {
          value: undefined,
          configurable: true,
        });
      });
      await standAt(testCharacter.id, DRIVE_IN);
      await seedTicket(testCharacter.id, MINES);
      await openTestCharacter(page, testCharacter.id);
      const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
      const suggestion = dialog.locator("[data-landscape-suggestion]");
      await expect(suggestion).toHaveCount(0);

      await dialog.getByRole("button", { name: "Fullscreen", exact: true }).click();
      await expect(suggestion).toBeVisible();
      await expect(suggestion).toContainText("turn your phone sideways");
      await captureReviewScreenshot(page, "holo-drive-in-rotate-suggestion-mobile.png");
      // Playback and the controls are untouched while it is up.
      await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "playing");
      await dialog.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(dialog.locator(".mm-player")).toHaveAttribute("data-state", "paused");
      // Dismissible, and not offered again in this session.
      await suggestion.getByRole("button", { name: "Dismiss" }).click();
      await expect(suggestion).toHaveCount(0);
      await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
      await dialog.getByRole("button", { name: "Fullscreen", exact: true }).click();
      await expect(dialog).toHaveAttribute("data-fullscreen", "expanded");
      await expect(suggestion).toHaveCount(0);
    });
  });

  test.describe("on a landscape phone", () => {
    test.use({ viewport: PHONE_LANDSCAPE, isMobile: true, hasTouch: true });

    test("has nothing to suggest", async ({ page, testCharacter }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", {
          value: undefined,
          configurable: true,
        });
      });
      await standAt(testCharacter.id, DRIVE_IN);
      await seedTicket(testCharacter.id, MINES);
      await openTestCharacter(page, testCharacter.id);
      const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);
      await dialog.getByRole("button", { name: "Fullscreen", exact: true }).click();
      await expect(dialog).toHaveAttribute("data-fullscreen", "expanded");
      await expect(dialog.locator("[data-landscape-suggestion]")).toHaveCount(0);
    });
  });
});

// ----------------------------------------------------------------------------------------------
// Eligibility
// ----------------------------------------------------------------------------------------------

test("keeps the entitlement while away, plays it only at the Drive-In, and closes a viewer the character walked away from", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES, { remaining: 9 });
  await openTestCharacter(page, testCharacter.id);
  const dialog = await watchToFilm(page, THEATRE_COPY.replayLastFilm);

  // Concurrent travel (another tab, say) moves the character while the viewer is open. The next
  // start the viewer makes is refused by the server, and the Big Screen goes with the Drive-In.
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.holoHollow })
    .where(eq(characters.id, testCharacter.id));
  await dialog.getByRole("button", { name: "Restart", exact: true }).click();
  // The player is told why, in the viewer, before anything else changes.
  await expect(dialog.getByRole("alert")).toHaveText("Films are shown at the Holo Drive-In.");
  await expect(dialog.getByRole("slider")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  // Closing reconciles the page with the server: the Big Screen goes with the Drive-In.
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.locator("[data-theatre-panel]")).toHaveCount(0);

  // Nothing was lost: the receipt, the replay pointer and the bonus are all still there...
  const away = await ledger(testCharacter.id);
  expect(away).toMatchObject({ receiptCount: 1, buffs: { [SKILL_IDS.mining]: 9 } });
  expect(away.pointers).toHaveLength(1);
  // ...but a reload anywhere else offers no film...
  await page.reload();
  await expect(page.locator("[data-theatre-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Replay Last Film|Watch Film/ })).toHaveCount(0);

  // ...and back at the Drive-In the same ticket plays again with nothing re-bought.
  await db
    .update(characters)
    .set({ currentLocationId: DRIVE_IN })
    .where(eq(characters.id, testCharacter.id));
  await page.reload();
  await watchToFilm(page, THEATRE_COPY.replayLastFilm);
  expect(await ledger(testCharacter.id)).toEqual(away);
});

test("shows the server's refusal on screen when it will not start a viewing", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await seedTicket(testCharacter.id, MINES);
  await openTestCharacter(page, testCharacter.id);
  // The ticket is deleted behind the page's back (a stale page): the server refuses the start.
  await db
    .delete(characterTheatreLatestTickets)
    .where(eq(characterTheatreLatestTickets.characterId, testCharacter.id));
  const dialog = await openViewer(page, THEATRE_COPY.replayLastFilm);
  await waitForPhase(dialog, "refused");
  await expect(dialog.getByRole("alert")).toHaveText("Buy a ticket to watch a film.");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await expect(dialog.getByRole("slider")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
});
