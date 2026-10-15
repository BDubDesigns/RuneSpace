import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characterMissions, characters } from "@/db/rune-space";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { inventoryStacks } from "@/db/rune-space";
import {
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  expect,
  test,
} from "./fixtures";
import { playDialogueToText } from "./dialogue-steps";

/**
 * Holo Hollow Landing and Last Leg Trading (#357): a walkable pad, a Local Place
 * with Toll Kade, three replayable topics available on foot, and a fuel counter
 * that stays shut until this character has reported Thrust Issues.
 */

async function standOnTheLanding(characterId: string, credits = 1000) {
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.holoHollowLanding, credits })
    .where(eq(characters.id, characterId));
}

async function enterTheShop(page: import("@playwright/test").Page) {
  await page
    .locator("[data-local-place-directory]")
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.lastLegTrading}"]`)
    .click();
  await expect(page.locator('[data-npc-interaction="toll_kade"]')).toBeVisible();
}

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test(`talks to Toll on foot before trade unlocks, on a ${viewport.name}`, async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await standOnTheLanding(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);

    // The pad itself has no resident and no ship; its one Local Place is the shop.
    await expect(page.locator("[data-local-place-directory]")).toContainText("Around the pad");
    await expect(page.locator('[data-npc-interaction="toll_kade"]')).toHaveCount(0);
    await enterTheShop(page);

    await expect(page.locator('[data-npc-interaction="toll_kade"]')).toContainText(
      "Tolliver “Toll” Kade",
    );
    const conversation = await openNpcConversation(page, "Tolliver “Toll” Kade");
    for (const topic of ["Skatboll", "Stillreach", "Fuel"]) {
      await expect(conversation.getByRole("button", { name: new RegExp(topic) })).toBeVisible();
    }

    await openConversationEntry(conversation, /Fuel/);
    const plate = conversation.locator("[data-dialogue-scene-location]");
    await expect(plate).toHaveText("LAST LEG TRADING");
    await expect(plate).toHaveCSS("white-space", "nowrap");
    await expect(plate).toHaveCSS("text-overflow", "ellipsis");
    const portrait = conversation.locator(".rs-dialogue-scene__npc");
    await playDialogueToText(conversation, /A full Small Fuel Canister holds fifty fuel units/);
    await expect(portrait).toHaveAttribute("src", /toll-kade-neutral\.png/);
    await playDialogueToText(conversation, /Check your tank first/);
    await expect(portrait).toHaveAttribute("src", /toll-kade-thoughtful\.png/);
    await playDialogueToText(conversation, /You can make fuel yourself/);
    await expect(portrait).toHaveAttribute("src", /toll-kade-friendly\.png/);
    await playDialogueToText(conversation, /A ship that can move it is nicer/);
    await expect(portrait).toHaveAttribute("src", /toll-kade-skeptical\.png/);
    await expect(
      conversation.locator('[data-dialogue-background="last_leg_trading_interior"]'),
    ).toBeVisible();

    // Deliberately overlong heading: it must truncate, never wrap or displace Close.
    const heading = conversation.getByRole("heading", { name: "Tolliver “Toll” Kade" });
    await heading.evaluate((node) => {
      node.textContent = "Tolliver “Toll” Kade the Incredibly Long-Named Freight Dispatcher";
    });
    await expect(heading).toHaveCSS("text-overflow", "ellipsis");
    await expect(heading).toHaveCSS("white-space", "nowrap");
    const close = conversation.getByRole("button", { name: /Close .*conversation/i });
    const [headingBox, closeBox] = await Promise.all([heading.boundingBox(), close.boundingBox()]);
    expect(headingBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(closeBox!.x + 1);
    expect(await heading.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  });
}

test("keeps the counter shut, and says why, until Thrust Issues is reported", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await standOnTheLanding(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  await enterTheShop(page);

  await page.locator('[data-npc-action="trade"]').click();
  const counter = page.getByRole("dialog", { name: "Trade with Tolliver “Toll” Kade" });
  await expect(counter).toContainText(
    "Trading unlocks after you report the completed Thrust Issues repair to Wade at Rusk Recovery.",
  );
  await expect(counter.locator("[data-trade-panel]")).toHaveCount(0);
});

test("opens the counter after Thrust Issues is reported, at the authored prices", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await standOnTheLanding(testCharacter.id, 1000);
  const now = new Date();
  await db.insert(characterMissions).values({
    characterId: testCharacter.id,
    missionId: MISSION_IDS.thrustIssues,
    acceptedAt: now,
    completedAt: now,
  });
  await db.insert(inventoryStacks).values({
    characterId: testCharacter.id,
    itemId: ITEM_IDS.oilShale,
    quantity: 4,
  });
  await openTestCharacter(page, testCharacter.id);
  await enterTheShop(page);

  await page.locator('[data-npc-action="trade"]').click();
  const trade = page.locator("[data-trade-panel]");
  await expect(trade.locator("[data-trade-credits]")).toContainText("1000 Credits");
  const full = trade.locator(`[data-trade-row="${ITEM_IDS.fullSmallFuelCanister}"]`);
  await expect(full.locator("[data-trade-unit-price]")).toHaveText("225");
  await expect(full.locator("[data-trade-daily-allowance]")).toHaveText("5 of 5 left today");
  const empty = trade.locator(`[data-trade-row="${ITEM_IDS.emptySmallFuelCanister}"]`);
  await expect(empty.locator("[data-trade-unit-price]")).toHaveText("40");
  // Oil Shale is only ever bought by the merchant.
  await expect(trade.locator(`[data-trade-row="${ITEM_IDS.oilShale}"]`)).toHaveCount(0);
});
