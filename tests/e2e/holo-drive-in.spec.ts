import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters } from "@/db/rune-space";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LOCAL_MAP_LOCATION_IDS_BY_PLANET, getLocation } from "@/game/content/locations";
import {
  expect,
  openConversationEntry,
  openMapSurface,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";
import { playDialogueToText } from "./dialogue-steps";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * The Holo Drive-In (#491, slice 1): Skatboll's twelfth World Location north of Holo
 * Hollow, its one ordinary walking edge, and Tamsyn Suzara standing at the location
 * with her launch topics. The showings, tickets, buffs and viewer are exercised by
 * `holo-drive-in-theatre.spec.ts`.
 */

const DRIVE_IN = LOCATION_IDS.holoDriveIn;
const SKATBOLL_IDS = LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

/** Make the walk that just began arrive: age its action past any single leg. */
async function finishWalk(characterId: string) {
  const past = new Date(Date.now() - 120_000);
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

for (const viewport of [
  { name: "phone", ...PHONE },
  { name: "desktop", ...DESKTOP },
]) {
  test(`shows the Drive-In scene and Tamsyn with Talk and nothing else, on a ${viewport.name}`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await standAt(testCharacter.id, DRIVE_IN);
    await openTestCharacter(page, testCharacter.id);

    const location = getLocation(DRIVE_IN)!;
    const scene = page.getByTestId("location-scene");
    await expect(scene.getByRole("heading", { level: 1 })).toHaveText(/Holo Drive-In/i);
    await expect(scene).toHaveAttribute("data-location-scene", DRIVE_IN);
    const background = scene.locator('[data-scene-layer="background"]');
    await expect(background).toHaveAttribute("alt", location.presentation.scene.alt);
    await expect
      .poll(() => background.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(scene.locator('[data-scene-layer="overlay"]')).toHaveCount(0);
    await expect(page.getByText(location.description)).toBeVisible();

    // Tamsyn stands at the World Location itself: one resident, no Local Place, no
    // Trade. The Big Screen is a section of the location panel (see the theatre spec).
    await expect(page.locator("[data-local-place-directory]")).toHaveCount(0);
    await expect(page.locator("[data-local-place]")).toHaveCount(0);
    const tamsyn = page.locator('[data-npc-interaction="tamsyn_suzara"]');
    await expect(tamsyn).toHaveCount(1);
    await expect(tamsyn).toContainText("Tamsyn Suzara");
    await expect(tamsyn).toContainText("Holo Drive-In owner & operator");
    await expect(tamsyn.locator('[data-npc-action="talk"]')).toBeVisible();
    await expect(tamsyn.locator('[data-npc-action="trade"]')).toHaveCount(0);
    await expect(page.locator("[data-ship-berth]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Start|Stop) / })).toHaveCount(0);
    await expect(page.locator("[data-theatre-panel]")).toBeVisible();

    await expectNoPageOverflow(page);
    if (viewport.name === "phone") await captureReviewScreenshot(page, "holo-drive-in-mobile.png");
  });
}

test("Tamsyn's two story topics play in order with the approved portrait on each beat", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await openTestCharacter(page, testCharacter.id);

  const conversation = await openNpcConversation(page, "Tamsyn Suzara");
  await expect(
    conversation.getByRole("button", { name: /Tell me about the projector/ }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: /Why keep this place open\?/ }),
  ).toBeVisible();
  await expect(conversation.getByRole("button", { name: /What's showing\?/ })).toBeVisible();
  // Her three topics and nothing else: no farewell, story entry or Mission action.
  await expect(
    conversation.getByRole("button", { name: /See you|Goodbye|Mission|Accept/i }),
  ).toHaveCount(0);

  await openConversationEntry(conversation, /Tell me about the projector/);
  await expect(conversation.locator("[data-dialogue-scene-location]")).toHaveText(/HOLO DRIVE-IN/i);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  await playDialogueToText(conversation, /Oh, that old girl\?/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-neutral\.png/);
  await playDialogueToText(conversation, /She still runs beautifully/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-amused\.png/);
  await playDialogueToText(conversation, /Can't play the newer film formats/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-neutral\.png/);
  await expect(
    conversation.locator('[data-dialogue-background="holo_drive_in_concessions"]'),
  ).toBeVisible();

  // The backdrop and each portrait really decode.
  const backdrop = conversation.locator(
    '[data-dialogue-background="holo_drive_in_concessions"] img',
  );
  if ((await backdrop.count()) > 0) {
    await expect
      .poll(() => backdrop.first().evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await captureReviewScreenshot(page, "tamsyn-projector-mobile.png");
});

test("Why keep this place open? moves from neutral through wistful to welcoming, and replays", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await standAt(testCharacter.id, DRIVE_IN);
  await openTestCharacter(page, testCharacter.id);

  const conversation = await openNpcConversation(page, "Tamsyn Suzara");
  await openConversationEntry(conversation, /Why keep this place open\?/);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  await playDialogueToText(conversation, /Used to get visitors from all over/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-neutral\.png/);
  await playDialogueToText(conversation, /Then the new films stopped coming/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-wistful\.png/);
  await playDialogueToText(conversation, /there's still the regulars/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-wistful\.png/);
  await playDialogueToText(conversation, /Isn't that reason enough\?/);
  await expect(portrait).toHaveAttribute("src", /tamsyn-suzara-welcoming\.png/);
  await captureReviewScreenshot(page, "tamsyn-why-keep-open-mobile.png");

  // Finish returns to the hub, and the topic is replayable from its first beat.
  await conversation.getByRole("button", { name: /Finish/ }).click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  await openConversationEntry(conversation, /Why keep this place open\?/);
  await playDialogueToText(conversation, /Used to get visitors from all over/);
});

test("the Skatboll map gains the Drive-In's hex, with Holo Hollow its only walking edge", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(60_000);
  const characterId = testCharacter.id;
  await standAt(characterId, LOCATION_IDS.holoHollow);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await openMapSurface(page);

  const hexes = page.locator("[data-map-location]");
  await expect(hexes).toHaveCount(SKATBOLL_IDS.length);
  await expect(page.locator(`[data-map-location="${DRIVE_IN}"]`)).toHaveCount(1);
  // Open from the start: no mission, lock or status on it.
  await expect(
    page.locator(`[data-map-location="${DRIVE_IN}"]`).locator("[data-map-status]"),
  ).toHaveCount(0);
  const icon = page.locator('svg image[href="/map-icons/holo-drive-in.webp"]');
  await expect(icon).toHaveCount(1);
  const response = await page.request.get((await icon.getAttribute("href")) as string);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/webp");

  // One leg north of Holo Hollow: an ordinary walk with the usual single Walk control.
  await page.getByRole("button", { name: /Holo Drive-In/ }).click();
  await expect(page.getByRole("button", { name: /Walk to Holo Drive-In/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReviewScreenshot(page, "holo-drive-in-map-mobile.png");

  await page.getByRole("button", { name: /Walk to Holo Drive-In/ }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  await finishWalk(characterId);
  await page.reload();
  await openMapSurface(page);
  await expect(page.locator(`[data-map-location="${DRIVE_IN}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );

  // Standing at the Drive-In, the hexes it merely touches are not a single walk away.
  for (const name of [/Rusk Recovery/, /Power Annex/]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name: /^Walk to / })).toHaveCount(0);
  }
  // Holo Hollow is, and the walk back is the same kind of leg.
  await page.getByRole("button", { name: /Holo Hollow(?! Landing)/ }).click();
  await expect(page.getByRole("button", { name: /^Walk to Holo Hollow/ })).toBeVisible();

  await page.setViewportSize(DESKTOP);
  await expect(hexes).toHaveCount(SKATBOLL_IDS.length);
  await expectNoPageOverflow(page);
});
