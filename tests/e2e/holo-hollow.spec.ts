import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";

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

  // HH B&B is plainly there, and says why it cannot be entered.
  const bnb = directory.locator(`[data-local-place="${LOCAL_PLACE_IDS.hhBnb}"]`);
  await expect(bnb).toBeVisible();
  await expect(bnb).toHaveAttribute("data-local-place-access", "locked");
  await expect(bnb.locator("[data-local-place-locked-reason]")).toContainText("locals");
  // A locked place is not a link, so there is nothing to click into.
  await expect(bnb.getByRole("link")).toHaveCount(0);

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
});

test("scopes each resident to their own Local Place", async ({ page, testCharacter }) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await arriveInHoloHollow(characterId, { credits: 20 });
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Standing in town exposes neither resident.
  await expect(page.locator("[data-npc-interaction]")).toHaveCount(0);

  // Bix is the contact inside his shop, and Talk is separate from Trade.
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowSouvenirs}"]`)
    .click();
  await expect(page.getByRole("button", { name: /Talk to Bix Weller/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Renn Calder/ })).toHaveCount(0);
  // Trade is an offered action, not something that unfolds on arrival.
  await expect(page.locator('[data-local-place-action="trade"]')).toBeVisible();
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);

  // Talk stays the canonical conversation hub and carries no merchant command.
  const conversation = await openNpcConversation(page, "Bix Weller");
  const topics = conversation.locator('[data-conversation-section="topics"]').getByRole("button");
  await expect(topics).toHaveCount(3);
  await expect(conversation.getByRole("button", { name: /Trade/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Choosing Trade opens the Buy/Sell surface, and it can be closed again.
  await page.locator('[data-local-place-action="trade"]').click();
  await expect(page.locator("[data-trade-panel]")).toBeVisible();
  await page.locator('[data-local-place-action="trade"]').click();
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);

  // Renn is the contact at the Assistance Center, with no merchant function.
  await page.locator("[data-local-place-exit]").click();
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.holoHollowAssistanceCenter}"]`)
    .click();
  await expect(page.getByRole("button", { name: /Talk to Renn Calder/ })).toBeVisible();
  await expect(page.locator("[data-trade-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Talk to Bix Weller/ })).toHaveCount(0);
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
  await page.locator('[data-local-place-action="trade"]').click();

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
