import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissions,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import {
  expect,
  expectExteriorMissionHalo,
  expectKeyboardFocusRingPaints,
  expectPointerFocusWithoutRing,
  openMapSurface,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";

/**
 * Holo Hollow's first settlement slice (#159): Local Place navigation, the
 * visible-but-locked HH B&B, Local-Place-scoped residents, and the
 * authoritative Bix merchant loop.
 */

/** Put the character in town with a known balance and carried materials. */
async function arriveInHoloHollow(
  characterId: string,
  options?: { credits?: number; shale?: number },
) {
  await db
    .update(characters)
    .set({
      currentLocationId: LOCATION_IDS.holoHollow,
      ...(options?.credits === undefined ? {} : { credits: options.credits }),
    })
    .where(eq(characters.id, characterId));
  if (options?.shale) {
    await db.insert(inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: options.shale,
    });
  }
}

test("hands an accepted Mission's NPC target to its Local Place entrance, then to the NPC", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  const now = new Date();
  // Keep the Change accepted with Bix not yet met: the current target is an
  // NPC who lives inside a Local Place in this town.
  await db
    .insert(characterMissions)
    .values([
      ...[
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      { characterId, missionId: MISSION_IDS.keepTheChange, acceptedAt: now },
    ]);
  await arriveInHoloHollow(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The place holding the target is the green target, with a real exterior halo.
  const directory = page.locator("[data-local-place-directory]");
  const shop = directory.locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`);
  await expectExteriorMissionHalo(shop.getByRole("link", { name: /^Enter / }), "active");
  // Keyboard focus paints its own ring on the green-guided link (#173), on a
  // phone and on a desktop viewport.
  await expectKeyboardFocusRingPaints(shop.getByRole("link", { name: /^Enter / }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectKeyboardFocusRingPaints(shop.getByRole("link", { name: /^Enter / }));
  await page.setViewportSize({ width: 390, height: 844 });
  // Only that one place is guided.
  await expect(directory.locator("[data-mission-guidance]")).toHaveCount(1);
  await expect(
    directory
      .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowAssistanceCenter}"]`)
      .locator("[data-mission-guidance]"),
  ).toHaveCount(0);

  // No map or hex guidance is added for the building.
  await openMapSurface(page);
  await expect(
    page.getByRole("group", { name: "Local map" }).locator("[data-mission-guidance]"),
  ).toHaveCount(0);
  await page.goBack();

  // Inside, the doorway is gone and the NPC's own interaction takes over.
  await shop.getByRole("link", { name: /^Enter / }).click();
  await page.waitForURL(new RegExp(`place=${LOCAL_PLACE_IDS.holoHollowSouvenirs}`));
  await expect(page.locator("[data-local-place-directory]")).toHaveCount(0);
  await expectExteriorMissionHalo(
    page.getByRole("button", { name: /Talk to Bix Weller/ }),
    "active",
  );
});

test("guides Keep the Change across the map: Holo Hollow MISSION, then The Jag TURN IN before arrival", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  const now = new Date();
  await db
    .insert(characterMissions)
    .values([
      ...[
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      { characterId, missionId: MISSION_IDS.keepTheChange, acceptedAt: now },
    ]);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Accepted at the Crash Site with Bix still to meet: Holo Hollow is the one
  // green MISSION destination, named in text and in the accessible label.
  await openMapSurface(page);
  const guidedHexes = page.locator("[data-map-location][data-mission-guidance]");
  const hollowHex = page.locator(`[data-map-location="${LOCATION_IDS.holoHollow}"]`);
  await expect(hollowHex).toHaveAttribute("data-mission-guidance", "active");
  await expect(hollowHex.locator("[data-map-mission-marker]")).toHaveText(/^Mission$/i);
  await expect(hollowHex).toHaveAttribute("aria-label", /Mission destination\./);
  await expect(guidedHexes).toHaveCount(1);

  // Bix met in town, Cells still missing: the Cells can come from Inventory,
  // the Annex, or Bix, so nothing is invented — no hex, doorway, or action.
  await db.insert(characterMissionProgress).values({
    characterId,
    missionId: MISSION_IDS.keepTheChange,
    progressKey: "bix-introduction",
    progress: 1,
  });
  await arriveInHoloHollow(characterId);
  await page.reload();
  await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
  await expect(guidedHexes).toHaveCount(0);
  await openTestCharacter(page, characterId);
  await expect(page.locator("[data-local-place-directory]")).toBeVisible();
  await expect(page.locator("[data-mission-guidance]")).toHaveCount(0);

  // Three Cells carried while still in Holo Hollow: every requirement holds, so
  // The Jag is already the blue TURN IN destination — before arrival.
  await db.insert(inventoryStacks).values({ characterId, itemId: ITEM_IDS.powerCell, quantity: 3 });
  await openTestCharacter(page, characterId);
  await openMapSurface(page);
  const jagHex = page.locator(`[data-map-location="${LOCATION_IDS.theJag}"]`);
  await expect(jagHex).toHaveAttribute("data-mission-guidance", "turn_in");
  await expect(jagHex.locator("[data-map-mission-marker]")).toHaveText(/^Turn in$/i);
  await expect(jagHex).toHaveAttribute("aria-label", /Mission turn-in\./);
  await expect(guidedHexes).toHaveCount(1);
  // The blue ring is a painted layer, not only an attribute.
  const ring = page.locator('[data-map-mission-ring="turn_in"]');
  await expect(ring).toHaveCount(1);
  const ringPaint = await ring.evaluate((element) => {
    const style = getComputedStyle(element);
    return { stroke: style.stroke, filter: style.filter };
  });
  expect(ringPaint.stroke).not.toBe("none");
  expect(ringPaint.filter).toContain("drop-shadow");

  // At The Jag the destination hands off to Tansy, the blue TURN IN handoff.
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.theJag })
    .where(eq(characters.id, characterId));
  await openTestCharacter(page, characterId);
  await expectExteriorMissionHalo(
    page.getByRole("button", { name: /Talk to Tansy Rusk/ }),
    "turn_in",
  );
  await openMapSurface(page);
  await expect(guidedHexes).toHaveCount(0);
});

test("presents Holo Hollow's places, keeps HH B&B visible but locked, and enters a shop without travelling", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveInHoloHollow(characterId, { credits: 20 });
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The town presents its places rather than a production activity.
  const directory = page.locator("[data-local-place-directory]");
  await expect(directory).toBeVisible();
  await expect(directory.locator("[data-local-place]")).toHaveCount(3);
  // A fresh character's unaccepted Walk It Off advertises no place in town.
  await expect(directory.locator("[data-mission-guidance]")).toHaveCount(0);

  // HH B&B is plainly there, and says why it cannot be entered.
  const bnb = directory.locator(`[data-local-place="${LOCAL_PLACE_IDS.hhBnb}"]`);
  await expect(bnb).toBeVisible();
  await expect(bnb).toHaveAttribute("data-local-place-access", "locked");
  await expect(bnb.locator("[data-local-place-locked-reason]")).toContainText("locals");
  // A locked place is not a link, so there is nothing to click into. Its
  // explicit CTA says so instead of offering Enter.
  await expect(bnb.getByRole("link")).toHaveCount(0);
  await expect(bnb.getByRole("button", { name: "Locals only" })).toBeDisabled();

  // Every open place offers an explicit Enter control; the card-sized link
  // beneath it stays out of the tab order and the accessibility tree.
  await expect(directory.getByRole("link", { name: /^Enter / })).toHaveCount(2);
  // An unguided beveled ActionLink still paints a visible keyboard focus ring (#173).
  await expectKeyboardFocusRingPaints(directory.getByRole("link", { name: /^Enter / }).first());
  await expect(directory.locator("[data-local-place-card-link]").first()).toHaveAttribute(
    "tabindex",
    "-1",
  );

  // Entering an open place is navigation, not a journey.
  await directory.locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`).click();
  await page.waitForURL(new RegExp(`place=${LOCAL_PLACE_IDS.holoHollowSouvenirs}`));
  await expect(
    page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`),
  ).toBeVisible();
  await expect(page.getByText("In transit", { exact: true })).toHaveCount(0);

  // The authoritative world position never left Holo Hollow.
  const [row] = await db
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  expect(row?.currentLocationId).toBe(LOCATION_IDS.holoHollow);

  // The open place survives a refresh, because it lives in the route.
  await page.reload();
  await expect(
    page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`),
  ).toBeVisible();

  // Browser Back leaves the shop and returns to the town surface.
  await page.goBack();
  await expect(page.locator("[data-local-place-directory]")).toBeVisible();

  // The explicit Enter control leads to exactly the place the card does.
  await directory
    .getByRole("link", { name: "Enter Holo Hollow Souvenirs + Mining Supplies" })
    .click();
  await page.waitForURL(new RegExp(`place=${LOCAL_PLACE_IDS.holoHollowSouvenirs}`));
  await expect(
    page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`),
  ).toBeVisible();
});

test("scopes each resident to their own Local Place", async ({ page, testCharacter }) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveInHoloHollow(characterId, { credits: 20 });
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Standing in town exposes neither resident.
  await expect(page.locator("[data-npc-interaction]")).toHaveCount(0);

  // Bix is the contact inside his shop: one person, with Talk above Trade.
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`)
    .click();
  const contact = page.locator("[data-npc-interaction]");
  const actions = contact.locator("[data-npc-action]");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveAttribute("data-npc-action", "talk");
  await expect(actions.nth(0)).toHaveText("Talk");
  await expect(actions.nth(1)).toHaveAttribute("data-npc-action", "trade");
  await expect(actions.nth(1)).toHaveText("Trade");
  // An unguided beveled ActionButton paints a visible keyboard focus ring;
  // pointer focus does not (#173).
  await expectKeyboardFocusRingPaints(actions.nth(1));
  await expectPointerFocusWithoutRing(actions.nth(1));
  await expect(page.getByRole("button", { name: /Talk to Bix Weller/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Renn Calder/ })).toHaveCount(0);
  // Trade belongs to Bix's card, not the shop description, and is offered
  // rather than unfolded on arrival.
  await expect(page.locator("[data-local-place-surface] [data-npc-action]")).toHaveCount(0);
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);
  // On a phone the actions stack vertically at full card width.
  const talkBox = (await actions.nth(0).boundingBox())!;
  const tradeBox = (await actions.nth(1).boundingBox())!;
  const contactBox = (await contact.boundingBox())!;
  expect(tradeBox.y).toBeGreaterThanOrEqual(talkBox.y + talkBox.height);
  expect(Math.abs(tradeBox.x - talkBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tradeBox.width - talkBox.width)).toBeLessThanOrEqual(1);
  expect(talkBox.width).toBeGreaterThan(contactBox.width * 0.8);

  // Talk stays the canonical conversation hub and carries no merchant command.
  const conversation = await openNpcConversation(page, "Bix Weller");
  const topics = conversation.locator('[data-conversation-section="topics"]').getByRole("button");
  await expect(topics).toHaveCount(3);
  await expect(conversation.getByRole("button", { name: /Trade/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Choosing Trade opens the Buy/Sell surface beneath Bix's card, and it can
  // be closed again.
  const trade = contact.locator('[data-npc-action="trade"]');
  await trade.click();
  await expect(page.locator("[data-trade-panel]")).toBeVisible();
  await trade.click();
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);
  await trade.click();
  await expect(page.locator("[data-trade-panel]")).toBeVisible();

  // Renn is the contact at the Assistance Center: Talk only, no merchant.
  await page.locator("[data-local-place-exit]").click();
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowAssistanceCenter}"]`)
    .click();
  await expect(page.getByRole("button", { name: /Talk to Renn Calder/ })).toBeVisible();
  await expect(contact.locator("[data-npc-action]")).toHaveCount(1);
  await expect(contact.locator('[data-npc-action="trade"]')).toHaveCount(0);
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Talk to Bix Weller/ })).toHaveCount(0);

  // Trade left open in Bix's shop does not reappear on return.
  await page.locator("[data-local-place-exit]").click();
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`)
    .click();
  await expect(page.getByRole("button", { name: /Talk to Bix Weller/ })).toBeVisible();
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);
});

test("buys and sells against the authoritative balance without leaving the shop", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveInHoloHollow(characterId, { credits: 20, shale: 5 });
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`)
    .click();
  await page.locator('[data-npc-action="trade"]').click();

  const trade = page.locator("[data-trade-panel]");
  await expect(trade.locator("[data-trade-credits]")).toContainText("20 Credits");

  // Buy: Power Cells are the only stock, priced at eight Credits.
  const cellRow = trade.locator(`[data-trade-row="${ITEM_IDS.powerCell}"]`);
  await expect(trade.locator("[data-trade-row]")).toHaveCount(1);
  await expect(cellRow.locator("[data-trade-unit-price]")).toHaveText("8");
  await expect(cellRow.locator("[data-trade-quantity]")).toHaveText("1");
  await expect(cellRow.locator("[data-trade-total]")).toHaveText("8");

  // The total tracks the quantity before anything is committed.
  await cellRow.getByRole("button", { name: /Increase Power Cell quantity/ }).click();
  await expect(cellRow.locator("[data-trade-quantity]")).toHaveText("2");
  await expect(cellRow.locator("[data-trade-total]")).toHaveText("16");
  await cellRow.getByRole("button", { name: /Decrease Power Cell quantity/ }).click();
  await expect(cellRow.locator("[data-trade-quantity]")).toHaveText("1");

  // Max is capped by what the balance can actually pay for.
  await cellRow.locator("[data-trade-max]").click();
  await expect(cellRow.locator("[data-trade-quantity]")).toHaveText("2");

  await cellRow.locator(`[data-trade-commit="${ITEM_IDS.powerCell}"]`).click();
  await expect(trade.locator("[data-trade-feedback]")).toContainText("Bought 2 Power Cell");
  // Still in the shop, with Credits and carried quantity refreshed.
  await expect(
    page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`),
  ).toBeVisible();
  await expect(trade.locator("[data-trade-credits]")).toContainText("4 Credits");
  await expect(cellRow.locator("[data-trade-owned]")).toHaveText("2");

  // Sell: Bix buys the four approved materials, Shale at two Credits each.
  await trade.locator('[data-trade-mode="sell"]').click();
  await expect(trade.locator("[data-trade-row]")).toHaveCount(4);
  const shaleRow = trade.locator(`[data-trade-row="${ITEM_IDS.ferriteShale}"]`);
  await expect(shaleRow.locator("[data-trade-unit-price]")).toHaveText("2");
  await expect(shaleRow.locator("[data-trade-owned]")).toHaveText("5");
  await shaleRow.locator("[data-trade-max]").click();
  await expect(shaleRow.locator("[data-trade-quantity]")).toHaveText("5");
  await expect(shaleRow.locator("[data-trade-total]")).toHaveText("10");
  await shaleRow.locator(`[data-trade-commit="${ITEM_IDS.ferriteShale}"]`).click();

  await expect(trade.locator("[data-trade-feedback]")).toContainText("Sold 5 Ferrite Shale");
  await expect(trade.locator("[data-trade-credits]")).toContainText("14 Credits");

  // The persisted balance matches exactly what the surface reported.
  const [row] = await db
    .select({ credits: characters.credits })
    .from(characters)
    .where(eq(characters.id, characterId));
  expect(row?.credits).toBe(14);

  // The same balance is available from Inventory.
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.locator("[data-inventory-credits]")).toContainText("14 Credits");
});

test("opening Trade reveals the Trade surface above the bottom navigation", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveInHoloHollow(characterId, { credits: 20 });
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`)
    .click();
  const trade = page.locator('[data-npc-action="trade"]');
  await expect(trade).toBeVisible();
  const navTop = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!.y;

  await trade.click();
  const region = page.locator("[data-npc-trade]");
  // Focus moves into the surface the player just opened ...
  await expect(region).toBeFocused();
  // ... and the surface, which fits this viewport in Buy mode, is scrolled
  // fully clear of the fixed bottom navigation rather than clipped by it.
  const box = (await region.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(navTop + 1);
  await expect(region.getByRole("heading", { name: "Buy and sell" })).toBeInViewport();

  // Closing Trade leaves focus on the control the player used.
  await trade.click();
  await expect(region).toHaveCount(0);
  await expect(trade).toBeFocused();
});
