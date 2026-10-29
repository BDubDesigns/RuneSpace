import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { LOCAL_MAP_LOCATION_IDS_BY_PLANET, getLocation } from "@/game/content/locations";
import { teleportCharacterAsAdmin } from "@/server/admin-command-seams";
import {
  expect,
  openConversationEntry,
  openMapSurface,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";
import { playDialogueToText } from "./dialogue-steps";
import { expectElementsInsideHexes } from "./map-geometry";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Stillreach Slice A (#373): the planet map (eight hexes, nine with Werner's Lab, #429),
 * ordinary walking and the scenes, for a character placed there by the real admin teleport command.
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

test("an admin-placed Stillreach character sees exactly the nine hexes and nine routes, nothing from Skatboll", async ({
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
  // The canvas draws one line per authored undirected edge: nine.
  await expect(page.locator("[data-map-scroll-viewport] svg line")).toHaveCount(9);

  // Standing at the Landing Station; the other eight are visible but only the
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
        // The fuel terminal, Refiner-To-Go, the FedHex pickup (#399) and Milky Waymo (#404).
        await expect(places).toHaveCount(4);
        await expect(
          page.locator(`[data-local-place="${LOCAL_PLACE_IDS.stillreachFuelTerminal}"]`),
        ).toHaveCount(1);
        await expect(
          page.locator(`[data-local-place="${LOCAL_PLACE_IDS.stillreachRefinerToGo}"]`),
        ).toHaveCount(1);
        await expect(
          page.locator(`[data-local-place="${LOCAL_PLACE_IDS.fedhexStillreachLandingStation}"]`),
        ).toHaveCount(1);
        await expect(
          page.locator(
            `[data-local-place="${LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation}"]`,
          ),
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

// ---------------------------------------------------------------------------
// Werner's Lab (#429): Stillreach's ninth World Location, with Werner standing at
// the location itself, three always-available topics, a Stone and uncut-gem
// counter that needs nothing first, and no Lapidary action of any kind. The
// character is placed at the lab directly; flying to Stillreach is proven in
// stillreach-flight.spec.ts.
// ---------------------------------------------------------------------------

const LAB = LOCATION_IDS.wernersLab;
const LAB_DESKTOP = { width: 1280, height: 800 };

async function standAtTheLab(characterId: string, credits = 1000) {
  await db
    .update(characters)
    .set({ currentLocationId: LAB, credits })
    .where(eq(characters.id, characterId));
}

for (const viewport of [
  { name: "phone", ...PHONE },
  { name: "desktop", ...LAB_DESKTOP },
]) {
  test(`shows the lab scene and Werner with independent Talk and Trade, on a ${viewport.name}`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await standAtTheLab(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);

    const location = getLocation(LAB)!;
    await expect(page.getByRole("heading", { name: "Werner's Lab" })).toBeVisible();
    const scene = page.getByTestId("location-scene");
    await expect(scene).toHaveAttribute("data-location-scene", LAB);
    const background = scene.locator('[data-scene-layer="background"]');
    await expect(background).toHaveAttribute("alt", location.presentation.scene.alt);
    await expect
      .poll(() => background.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(scene.locator('[data-scene-layer="overlay"]')).toHaveCount(0);

    // Werner stands at the World Location itself: one resident, no Local Place, and
    // Talk and Trade side by side with nothing to unlock first.
    await expect(page.locator("[data-local-place]")).toHaveCount(0);
    const werner = page.locator('[data-npc-interaction="werner"]');
    await expect(werner).toHaveCount(1);
    await expect(werner).toContainText("Werner");
    await expect(werner.locator('[data-npc-action="talk"]')).toBeVisible();
    await expect(werner.locator('[data-npc-action="trade"]')).toBeVisible();

    // No Lapidary, workstation or mining action is offered, real or disabled.
    await expect(page.getByRole("button", { name: /^(Start|Stop) / })).toHaveCount(0);
    await expect(page.getByText(/lapidary/i)).toHaveCount(0);
    await expect(page.locator("[data-ship-berth]")).toHaveCount(0);

    await expectNoPageOverflow(page);
    if (viewport.name === "phone") await captureReviewScreenshot(page, "werners-lab-mobile.png");
  });
}

test("Werner's three topics play in order with the approved portrait on each beat", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAtTheLab(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);

  const conversation = await openNpcConversation(page, "Werner");
  for (const topic of ["About the Lab", "The Quarry", "Gem Cutting"]) {
    await expect(conversation.getByRole("button", { name: new RegExp(topic) })).toBeVisible();
  }
  // Three ordinary topics and nothing else: no story entry, offer or Mission action.
  await expect(conversation.getByRole("button", { name: /Mission|Accept|Lesson/i })).toHaveCount(0);

  await openConversationEntry(conversation, /About the Lab/);
  const plate = conversation.locator("[data-dialogue-scene-location]");
  await expect(plate).toHaveText(/WERNER.S LAB/i);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  await playDialogueToText(conversation, /It's a mineral laboratory/);
  await expect(portrait).toHaveAttribute("src", /werner-neutral\.png/);
  await playDialogueToText(conversation, /The quarry provides the raw material/);
  await expect(portrait).toHaveAttribute("src", /werner-thoughtful\.png/);
  await playDialogueToText(conversation, /don't touch my equipment/);
  await expect(portrait).toHaveAttribute("src", /werner-intense\.png/);
  await expect(
    conversation.locator('[data-dialogue-background="werners_lab_interior"]'),
  ).toBeVisible();

  // The interior and each portrait really decode.
  const interior = conversation.locator('[data-dialogue-background="werners_lab_interior"] img');
  if ((await interior.count()) > 0) {
    await expect
      .poll(() => interior.first().evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test("The Quarry ends on the amused portrait and replays from the start", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAtTheLab(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);

  const conversation = await openNpcConversation(page, "Werner");
  await openConversationEntry(conversation, /The Quarry/);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  await playDialogueToText(conversation, /Most people walk through that quarry/);
  await expect(portrait).toHaveAttribute("src", /werner-neutral\.png/);
  await playDialogueToText(conversation, /Every stone has a structure/);
  await expect(portrait).toHaveAttribute("src", /werner-thoughtful\.png/);
  await playDialogueToText(conversation, /knowing how to listen is a rare quality/);
  await expect(portrait).toHaveAttribute("src", /werner-amused\.png/);
});

test("trades at the authored prices with no Mission, and sells nothing but Stone", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAtTheLab(testCharacter.id, 1000);
  await db.insert(inventoryStacks).values([
    { characterId: testCharacter.id, itemId: ITEM_IDS.uncutQuartz, quantity: 1 },
    { characterId: testCharacter.id, itemId: ITEM_IDS.uncutTopaz, quantity: 1 },
    { characterId: testCharacter.id, itemId: ITEM_IDS.uncutSapphire, quantity: 1 },
  ]);
  await openTestCharacter(page, testCharacter.id);

  await page.locator('[data-npc-interaction="werner"] [data-npc-action="trade"]').click();
  const trade = page.locator("[data-trade-panel]");
  await expect(trade.locator("[data-trade-credits]")).toContainText("1000 Credits");

  // Buying: Stone only, 5 Credits, 12 a day.
  const stone = trade.locator(`[data-trade-row="${ITEM_IDS.stone}"]`);
  await expect(trade.locator("[data-trade-row]")).toHaveCount(1);
  await expect(stone.locator("[data-trade-unit-price]")).toHaveText("5");
  await expect(stone.locator("[data-trade-daily-allowance]")).toHaveText("12 of 12 left today");

  await stone.locator("[data-trade-commit]").click();
  await expect(trade.locator("[data-trade-credits]")).toContainText("995 Credits");
  await expect(stone.locator("[data-trade-daily-allowance]")).toHaveText("11 of 12 left today");

  // Selling: Stone at 2 and the three uncut gems at 8, 18 and 35. No allowance shows.
  await trade.locator('[data-trade-mode="sell"]').click();
  const prices: Record<string, string> = {
    [ITEM_IDS.stone]: "2",
    [ITEM_IDS.uncutQuartz]: "8",
    [ITEM_IDS.uncutTopaz]: "18",
    [ITEM_IDS.uncutSapphire]: "35",
  };
  await expect(trade.locator("[data-trade-row]")).toHaveCount(4);
  for (const [itemId, price] of Object.entries(prices)) {
    await expect(
      trade.locator(`[data-trade-row="${itemId}"]`).locator("[data-trade-unit-price]"),
    ).toHaveText(price);
  }
  await expect(trade.locator("[data-trade-daily-allowance]")).toHaveCount(0);

  await trade
    .locator(`[data-trade-row="${ITEM_IDS.uncutSapphire}"]`)
    .locator("[data-trade-commit]")
    .click();
  await expect(trade.locator("[data-trade-credits]")).toContainText("1030 Credits");

  // Selling Stone back does not restore the day's allowance.
  await trade
    .locator(`[data-trade-row="${ITEM_IDS.stone}"]`)
    .locator("[data-trade-commit]")
    .click();
  await expect(trade.locator("[data-trade-credits]")).toContainText("1032 Credits");
  await trade.locator('[data-trade-mode="buy"]').click();
  await expect(
    trade.locator(`[data-trade-row="${ITEM_IDS.stone}"]`).locator("[data-trade-daily-allowance]"),
  ).toHaveText("11 of 12 left today");
});

test("the map links the lab to the Quarry and Harmonic Workings but not The Survey Line", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAtTheLab(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  await openMapSurface(page);

  await expect(page.locator("[data-map-location]")).toHaveCount(9);
  await expect(page.locator(`[data-map-location="${LAB}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The approved identifier is painted on the lab's hex and decodes as a WebP.
  const icon = page.locator('svg image[href="/map-icons/werner-lab.webp"]');
  await expect(icon).toHaveCount(1);
  const response = await page.request.get("/map-icons/werner-lab.webp");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/webp");
  // No mining status on a location that mines nothing.
  await expect(page.locator(`[data-map-location="${LAB}"] [data-map-status]`)).toHaveCount(0);

  for (const name of [/Prospecting Quarry/, /Harmonic Workings/]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name: /^Walk to / })).toBeVisible();
  }
  // The Survey Line touches the lab on the hex grid, but no route is authored.
  await page.getByRole("button", { name: /The Survey Line/ }).click();
  await expect(page.getByRole("button", { name: /^Walk to / })).toHaveCount(0);
  await expect(page.locator("[data-map-destination-panel]")).toContainText("No route from here");
  await expectNoPageOverflow(page);
  await captureReviewScreenshot(page, "werners-lab-map-mobile.png");
});
