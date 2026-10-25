import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, fedhexParcels, inventoryStacks, itemInstances } from "@/db/rune-space";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { FEDHEX_ECHO_RECOVERY_BODY, FEDHEX_ECHO_RECOVERY_SUBJECT } from "@/game/content/fedhex";
import { getLocalPlace } from "@/game/content/local-places";
import { expect, openTestCharacter, openUtility, test, utilitySurface } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #399 — FedHex in a real browser, at phone and desktop width.
 *
 * The server suites own the rules (location, capacity, exactly-once, theft,
 * concurrency). This covers what only a rendered page can answer: both pickups
 * sit under their landing hubs and are enterable while empty, they show the
 * same approved 4:1 interior, a waiting parcel is counted unobtrusively and
 * shows the same mail from either planet, Claim is one at a time with a usable
 * refusal when the pack is full, and the claimed Legendary reads as Legendary.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const STILLREACH_PLACE = LOCAL_PLACE_IDS.fedhexStillreachLandingStation;
const HOLLOW_PLACE = LOCAL_PLACE_IDS.fedhexHoloHollowLanding;

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function mail(characterId: string, itemId: string) {
  const [row] = await db
    .insert(fedhexParcels)
    .values({
      characterId,
      messageType: "echo_legendary_recovery",
      sourceKey: `e2e:${itemId}:${Math.random()}`,
      senderKind: "npc",
      senderId: "wise_old_enby",
      senderDisplayName: "The Wise Old Enby",
      subject: FEDHEX_ECHO_RECOVERY_SUBJECT,
      body: FEDHEX_ECHO_RECOVERY_BODY,
      attachmentItemId: itemId,
      receivedAt: new Date(),
    })
    .returning();
  return row!;
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

async function expectSceneLoaded(page: import("@playwright/test").Page, alt: string) {
  const background = page.getByTestId("location-scene").locator('[data-scene-layer="background"]');
  await expect(background).toHaveAttribute("alt", alt);
  await expect
    .poll(() =>
      background.evaluate(
        (node) =>
          (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
}

test("both FedHex pickups are always there and enterable with an empty mailbox, on the same approved interior", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const place = getLocalPlace(STILLREACH_PLACE)!;
  await page.setViewportSize(PHONE);
  await standAt(characterId, LOCATION_IDS.stillreachLandingStation);
  await openTestCharacter(page, characterId);

  // The directory lists the pickup, enterable, with no pending indicator.
  const entry = page.locator(`[data-local-place="${STILLREACH_PLACE}"]`);
  await expect(entry).toContainText("FedHex — Stillreach Landing Station");
  await expect(entry).toHaveAttribute("data-local-place-access", "available");
  await expect(page.locator("[data-fedhex-pending-indicator]")).toHaveCount(0);
  await entry.locator("[data-local-place-enter]").click();
  await expect(page).toHaveURL(new RegExp(`[?&]place=${STILLREACH_PLACE}`));
  await expect(page.locator(`[data-local-place-surface="${STILLREACH_PLACE}"]`)).toBeVisible();
  await expectSceneLoaded(page, place.presentation.scene.alt);
  const stillreachAsset = await page
    .getByTestId("location-scene")
    .locator('[data-scene-layer="background"]')
    .getAttribute("src");

  // Friendly empty state, a way back, and no overflow.
  const mailbox = page.locator("[data-fedhex-mailbox]");
  await expect(mailbox).toBeVisible();
  await expect(mailbox.locator("[data-fedhex-empty]")).toContainText("Nothing is waiting for you");
  await expect(mailbox.getByRole("button")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fedhex-stillreach-empty-mobile.png");
  await page.locator("[data-local-place-exit]").click();
  await expect(page.locator("[data-fedhex-mailbox]")).toHaveCount(0);

  // The other planet's pickup is the same interior (one shared scene file).
  await standAt(characterId, LOCATION_IDS.holoHollowLanding);
  await openTestCharacter(page, characterId);
  const hollow = page.locator(`[data-local-place="${HOLLOW_PLACE}"]`);
  await expect(hollow).toContainText("FedHex — Holo Hollow Landing");
  await expect(hollow).toHaveAttribute("data-local-place-access", "available");
  await hollow.locator("[data-local-place-enter]").click();
  await expect(page.locator(`[data-local-place-surface="${HOLLOW_PLACE}"]`)).toBeVisible();
  await expectSceneLoaded(page, getLocalPlace(HOLLOW_PLACE)!.presentation.scene.alt);
  expect(
    await page
      .getByTestId("location-scene")
      .locator('[data-scene-layer="background"]')
      .getAttribute("src"),
  ).toBe(stillreachAsset);
  await expect(page.locator("[data-fedhex-empty]")).toBeVisible();
  await captureReviewScreenshot(page, "fedhex-holo-hollow-empty-mobile.png");
});

test("a waiting parcel is counted, read in full, then collected once as a Legendary item", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await standAt(characterId, LOCATION_IDS.stillreachLandingStation);
  const parcel = await mail(characterId, ITEM_IDS.minersGloves);
  await openTestCharacter(page, characterId);

  // The directory counts what waits, unobtrusively.
  await expect(page.locator("[data-fedhex-pending-indicator]")).toHaveText(
    "1 parcel waiting for you",
  );
  await page
    .locator(`[data-local-place="${STILLREACH_PLACE}"]`)
    .locator("[data-local-place-enter]")
    .click();

  const mailbox = page.locator("[data-fedhex-mailbox]");
  const card = mailbox.locator(`[data-fedhex-parcel="${parcel.id}"]`);
  await expect(card.locator("[data-fedhex-sender]")).toHaveText("The Wise Old Enby");
  await expect(card.locator("[data-fedhex-subject]")).toHaveText("Hey, did you drop this? 😏");
  await expect(card.locator("[data-fedhex-body]")).toHaveText(FEDHEX_ECHO_RECOVERY_BODY);
  await expect(card.locator(`[data-fedhex-attachment="${ITEM_IDS.minersGloves}"]`)).toContainText(
    "Miner's Gloves",
  );
  // The attachment is the Legendary tile: label, gold accent and sweep.
  await expect(card.locator('[data-item-rarity="legendary"]')).toHaveCount(1);
  await expect(card.locator('[data-item-rarity-label="legendary"]')).toBeVisible();
  await expect(card.locator("[data-item-shimmer-sweep]")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fedhex-parcel-mobile.png");

  // Claim the one parcel: it lands in Inventory, once, and the mailbox empties.
  await card.locator(`[data-fedhex-claim="${parcel.id}"]`).click();
  await expect(mailbox.locator("[data-fedhex-claimed]")).toBeVisible();
  await expect(mailbox.locator("[data-fedhex-empty]")).toBeVisible();
  await expect(page.locator("[data-fedhex-pending-indicator]")).toHaveCount(0);
  const owned = await db
    .select()
    .from(itemInstances)
    .where(
      and(
        eq(itemInstances.characterId, characterId),
        eq(itemInstances.itemId, ITEM_IDS.minersGloves),
      ),
    );
  expect(owned).toHaveLength(1);

  await openUtility(page, "inventory");
  const inventory = utilitySurface(page, "Inventory");
  await expect(inventory.locator('[data-item-rarity="legendary"]')).toContainText("Miner's Gloves");
  await expect(inventory.locator('[data-item-rarity-label="legendary"]')).toBeVisible();
});

test("a parcel that does not fit stays put with a useful explanation, then claims once room is made", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await standAt(characterId, LOCATION_IDS.holoHollowLanding);
  const parcel = await mail(characterId, ITEM_IDS.minersBoots);
  // Eight distinct single-item stacks fill the MYKEA's eight slots.
  const fillers = [
    ITEM_IDS.ferriteShale,
    ITEM_IDS.galvanite,
    ITEM_IDS.refinedFerrite,
    ITEM_IDS.galvanicStock,
    ITEM_IDS.scrapMetal,
    ITEM_IDS.slag,
    ITEM_IDS.uncutQuartz,
    ITEM_IDS.uncutTopaz,
  ];
  await db
    .insert(inventoryStacks)
    .values(fillers.map((itemId) => ({ characterId, itemId, quantity: 1 })));
  await openTestCharacter(page, characterId);
  await page
    .locator(`[data-local-place="${HOLLOW_PLACE}"]`)
    .locator("[data-local-place-enter]")
    .click();
  const card = page.locator(`[data-fedhex-parcel="${parcel.id}"]`);
  await card.locator(`[data-fedhex-claim="${parcel.id}"]`).click();
  await expect(card.locator("[data-fedhex-refusal]")).toContainText("Inventory is full");
  await expect(card).toBeVisible();
  expect(
    (await db.select().from(fedhexParcels).where(eq(fedhexParcels.id, parcel.id)))[0]!.claimedAt,
  ).toBeNull();
  await captureReviewScreenshot(page, "fedhex-parcel-full-mobile.png");

  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await card.locator(`[data-fedhex-claim="${parcel.id}"]`).click();
  await expect(page.locator("[data-fedhex-claimed]")).toBeVisible();
  await expect(page.locator("[data-fedhex-empty]")).toBeVisible();
});

test("the pickup lays out on desktop too, and the mailbox is the same from the other landing", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(DESKTOP);
  await standAt(characterId, LOCATION_IDS.holoHollowLanding);
  const parcel = await mail(characterId, ITEM_IDS.minersGloves);
  await openTestCharacter(page, characterId);
  await expect(page.locator("[data-fedhex-pending-indicator]")).toHaveText(
    "1 parcel waiting for you",
  );
  await page
    .locator(`[data-local-place="${HOLLOW_PLACE}"]`)
    .locator("[data-local-place-enter]")
    .click();
  await expect(page.locator(`[data-fedhex-parcel="${parcel.id}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fedhex-parcel-desktop.png");
});
