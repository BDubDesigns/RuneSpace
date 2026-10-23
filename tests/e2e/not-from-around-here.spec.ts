import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissions,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { playDialogueToText } from "./dialogue-steps";
import {
  expect,
  openConversationEntry,
  openMapSurface,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";

/**
 * Not From Around Here (#369, #389) at the 390 px portrait width the Inventory and
 * the conversation hub are designed for: the Rune Fragment's Inspect offer, the
 * three guided contacts, an optional hint that narrows to Toll, and the Wise Old
 * Enby at Hilltop Workshop — their ordinary topics, the in-person "Show strange
 * mineral" offer with its Not now, the single Stillreach pin, and the revelation
 * whose I UNDERSTAND alone completes the Mission. Unit and PostgreSQL coverage own
 * the rules; this proves what needs the running app — the blue tile, the modal's
 * keyboard and focus behavior, the Map hexes, the hub refreshing in place, and
 * that nothing fabricates a target.
 */

const MISSION = MISSION_IDS.notFromAroundHere;
const { runeFragment: FRAGMENT, runestone: STONE } = ITEM_IDS;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own phone viewport; runs once");
  await page.setViewportSize({ width: 390, height: 844 });
});

async function seed(characterId: string, stacks: { itemId: string; quantity: number }[]) {
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  if (stacks.length > 0) {
    await db.insert(inventoryStacks).values(stacks.map((stack) => ({ characterId, ...stack })));
  }
}

async function accepted(characterId: string, progress: Record<string, number> = {}) {
  const now = new Date();
  await db.insert(characterMissions).values({ characterId, missionId: MISSION, acceptedAt: now });
  await db.insert(characterMissionProgress).values(
    Object.entries({ "toll-lead": 0, "toll-hint": 0, ...progress }).map(([progressKey, value]) => ({
      characterId,
      missionId: MISSION,
      progressKey,
      progress: value,
    })),
  );
}

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

const rows = (characterId: string) =>
  db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));

const total = (stacks: { itemId: string; quantity: number }[], itemId: string) =>
  stacks.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.quantity, 0);

const missionRows = (characterId: string) =>
  db
    .select()
    .from(characterMissions)
    .where(
      and(eq(characterMissions.characterId, characterId), eq(characterMissions.missionId, MISSION)),
    );

async function progressOf(characterId: string) {
  const rows = await db
    .select()
    .from(characterMissionProgress)
    .where(
      and(
        eq(characterMissionProgress.characterId, characterId),
        eq(characterMissionProgress.missionId, MISSION),
      ),
    );
  return Object.fromEntries(rows.map((row) => [row.progressKey, row.progress]));
}

async function openInventory(page: Page) {
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  return inventory;
}

const tile = (inventory: Locator, name: string) =>
  inventory.getByRole("button", { name: new RegExp(`^\\d+ ${name}`) });

const litHexes = (page: Page) => page.locator("[data-map-location][data-mission-guidance]");

/**
 * Since #391 completing the mystery plays Seeker? I Hardly Know Her!'s opening
 * scene as its completion presentation, and accepts that lesson. Play it to its
 * end and back to the hub, which now lists the lesson.
 */
async function finishLessonScene(conversation: Locator) {
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/as promised/);
  await playDialogueToText(conversation, /a little more Mining experience/);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  await expect(
    conversation.locator(
      `[data-conversation-entry="${MISSION_IDS.firstRuneworkingLesson}:active"]`,
    ),
  ).toBeVisible();
}

test.describe("the Rune Fragment offer", () => {
  test("a carried Fragment glows blue and offers the Mission through Inspect, without using it up", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [
      { itemId: FRAGMENT, quantity: 8 },
      { itemId: STONE, quantity: 2 },
    ]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);

    // Blue "Mission available" on both offering items, with the artwork hopping.
    for (const name of ["Rune Fragment", "Runestone"]) {
      await expect(tile(inventory, name)).toHaveAttribute("data-mission-guidance", "available");
      await expect(tile(inventory, name).locator("[data-offer-hop]")).toHaveCount(1);
    }
    await expect(inventory.locator("[data-offer-hop]")).toHaveCount(2);

    // The ordinary Item Details, with Break Apart unchanged on a Runestone,
    // which also offers the same Mission.
    await tile(inventory, "Runestone").click();
    const details = inventory.locator("[data-details-panel]");
    await expect(details.getByRole("button", { name: "Break Apart" })).toBeVisible();
    await expect(details.locator("[data-item-offer-inspect]")).toBeVisible();

    await tile(inventory, "Rune Fragment").click();
    const inspect = details.locator("[data-item-offer-inspect]");
    await expect(inspect).toHaveText("Inspect");
    await expect(inspect).toHaveAttribute("data-mission-guidance", "available");
    await expect(details.locator("[data-item-description]")).toContainText(
      "A broken piece of an unusual mineral",
    );

    // Inspect opens the compact offer, in front of Inventory, with the real art.
    await inspect.click();
    const offer = page.getByRole("dialog", { name: "Not From Around Here mission offer" });
    await expect(offer).toBeVisible();
    await expect(offer.getByText("New mission", { exact: true })).toBeVisible();
    await expect(offer.getByRole("heading", { name: "Not From Around Here" })).toBeVisible();
    await expect(offer.locator("[data-item-offer-keeps]")).toHaveText(
      "Your Rune Fragment stays in your Inventory.",
    );
    await expect(offer.locator("[data-item-offer-accept]")).toHaveText("Start mission");
    // The offer shows the item type, not this stack: no quantity badge.
    await expect(offer.getByText(/^x\d+$/)).toHaveCount(0);
    await expect(offer.locator("[data-item-offer-description]")).toContainText(
      "resonate beyond ordinary space",
    );
    const art = offer.locator('[data-testid="item-artwork"]');
    await expect(art).toBeVisible();
    await expect
      .poll(() => art.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    // It fits the phone: nothing spills past the viewport on either axis.
    const box = (await offer.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);

    // Not now changes nothing and returns focus to Inspect.
    await offer.getByRole("button", { name: "Not now" }).click();
    await expect(offer).toHaveCount(0);
    await expect(inspect).toBeFocused();
    expect(await missionRows(testCharacter.id)).toHaveLength(0);

    // So does Escape.
    await inspect.click();
    await expect(offer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(offer).toHaveCount(0);
    await expect(inspect).toBeFocused();
    expect(await missionRows(testCharacter.id)).toHaveLength(0);

    // The keyboard reaches Start mission, and accepting is atomic.
    await inspect.click();
    await expect(offer).toBeVisible();
    const accept = offer.locator("[data-item-offer-accept]");
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(offer).toHaveCount(0);

    // The same overlay becomes Mission Started: the real title and the objective
    // the authoritative projection returned (the strip behind it shows the same).
    const started = page.getByRole("dialog", { name: "Not From Around Here mission started" });
    await expect(started).toBeVisible();
    await expect(started.getByRole("heading", { name: "Not From Around Here" })).toBeVisible();
    await expect(started.getByText("Mission started", { exact: true }).first()).toBeVisible();
    const objective = started.locator("[data-mission-started-objective]");
    await expect(objective).toHaveText("Find someone who might recognize the unusual fragment");
    await expect(
      page.locator(`[data-mission-strip="${MISSION}"] [data-mission-strip-objective]`),
    ).toHaveText((await objective.textContent()) ?? "");
    // No second acceptance control, and the box fits the phone.
    await expect(started.locator("[data-item-offer-accept]")).toHaveCount(0);
    const startedBox = (await started.boundingBox())!;
    expect(startedBox.x).toBeGreaterThanOrEqual(0);
    expect(startedBox.x + startedBox.width).toBeLessThanOrEqual(390);
    expect(startedBox.y + startedBox.height).toBeLessThanOrEqual(844);

    // Return to Inventory is a normal Inventory, not an open details pane.
    await started.locator("[data-mission-started-return]").click();
    await expect(started).toHaveCount(0);
    await expect(inventory.locator("[data-details-panel]")).toHaveCount(0);
    await expect(inventory.getByText(/Mission accepted: Not From Around Here/)).toBeVisible();
    await expect(tile(inventory, "Rune Fragment")).toBeVisible();
    expect(await missionRows(testCharacter.id)).toHaveLength(1);

    const [row] = await missionRows(testCharacter.id);
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.completedAt).toBeNull();
    // Nothing was consumed, and the blue and the Inspect action are gone.
    const fragments = await db
      .select()
      .from(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, testCharacter.id),
          eq(inventoryStacks.itemId, FRAGMENT),
        ),
      );
    expect(fragments.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(8);
    for (const name of ["Rune Fragment", "Runestone"]) {
      await expect(tile(inventory, name)).not.toHaveAttribute("data-mission-guidance", /.+/);
    }
    await expect(inventory.locator("[data-offer-hop]")).toHaveCount(0);
    await expect(details.locator("[data-item-offer-inspect]")).toHaveCount(0);
  });

  test("Show on Map opens the existing Map with the Mission's own guidance, without reaccepting", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [{ itemId: FRAGMENT, quantity: 3 }]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);
    await tile(inventory, "Rune Fragment").click();
    await inventory.locator("[data-item-offer-inspect]").click();
    await page
      .getByRole("dialog", { name: "Not From Around Here mission offer" })
      .locator("[data-item-offer-accept]")
      .click();
    const started = page.getByRole("dialog", { name: "Not From Around Here mission started" });
    await expect(started).toBeVisible();
    const acceptedAt = (await missionRows(testCharacter.id))[0]?.acceptedAt;

    await started.locator("[data-mission-started-map]").click();
    await page.waitForURL(/\/play\/[^/?]+\?surface=map$/);
    await expect(page.getByRole("dialog", { name: "Inventory" })).toHaveCount(0);
    await expect(started).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
    // The ordinary pinned guidance, not a parallel targeting system.
    await expect(litHexes(page).first()).toBeVisible();

    const rows = await missionRows(testCharacter.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acceptedAt).toEqual(acceptedAt);
  });

  test("a refused acceptance stays on the offer with the error and never shows Mission Started", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [{ itemId: FRAGMENT, quantity: 3 }]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);
    await tile(inventory, "Rune Fragment").click();
    await inventory.locator("[data-item-offer-inspect]").click();
    const offer = page.getByRole("dialog", { name: "Not From Around Here mission offer" });
    await expect(offer).toBeVisible();

    // The stack is gone by the time the player confirms.
    await seed(testCharacter.id, []);
    await offer.locator("[data-item-offer-accept]").click();
    await expect(offer.getByRole("alert")).toContainText("Inventory changed");
    await expect(offer).toBeVisible();
    await expect(page.getByRole("dialog", { name: /mission started/ })).toHaveCount(0);
    expect(await missionRows(testCharacter.id)).toHaveLength(0);
  });
});

test.describe("the offer across stacks", () => {
  test("offers from the stack the player inspects, with no quantity on the offer", async ({
    page,
    testCharacter,
  }) => {
    // Two Rune Fragment stacks of different sizes: the offer must not depend on either.
    await seed(testCharacter.id, [
      { itemId: FRAGMENT, quantity: 7 },
      { itemId: FRAGMENT, quantity: 3 },
    ]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);
    const fragmentTiles = inventory.getByRole("button", { name: /^\d+ Rune Fragment/ });
    await expect(fragmentTiles).toHaveCount(2);
    await expect(fragmentTiles.nth(0)).toHaveAttribute("data-mission-guidance", "available");
    await expect(fragmentTiles.nth(1)).toHaveAttribute("data-mission-guidance", "available");

    await fragmentTiles.nth(1).click();
    const inspect = inventory.locator("[data-details-panel] [data-item-offer-inspect]");
    await inspect.click();
    const offer = page.getByRole("dialog", { name: "Not From Around Here mission offer" });
    await expect(offer).toBeVisible();
    await expect(offer.getByText(/^x\d+$/)).toHaveCount(0);
    await offer.locator("[data-item-offer-accept]").click();
    await expect(offer).toHaveCount(0);
    const started = page.getByRole("dialog", { name: "Not From Around Here mission started" });
    await expect(started).toBeVisible();
    await started.locator("[data-mission-started-return]").click();
    await expect(inventory.getByText(/Mission accepted: Not From Around Here/)).toBeVisible();

    // Accepting consumed neither stack.
    const after = await rows(testCharacter.id);
    expect(total(after, FRAGMENT)).toBe(10);
    await expect(inventory.locator("[data-offer-hop]")).toHaveCount(0);
  });
});

test.describe("the investigation", () => {
  test("lights all three contacts, then one hint narrows the Map to Toll", async ({
    page,
    testCharacter,
  }) => {
    await accepted(testCharacter.id);
    await standAt(testCharacter.id, LOCATION_IDS.holoHollow);
    await openTestCharacter(page, testCharacter.id);

    await expect(page.locator(`[data-mission-strip="${MISSION}"]`)).toContainText(
      "Find someone who might recognize the unusual fragment",
    );
    await openMapSurface(page);
    // Wade (Crash Site), Tansy (The Jag) and Toll (the Landing): three green hexes.
    await expect(litHexes(page)).toHaveCount(3);
    for (const locationId of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theJag,
      LOCATION_IDS.holoHollowLanding,
    ]) {
      await expect(page.locator(`[data-map-location="${locationId}"]`)).toHaveAttribute(
        "data-mission-guidance",
        "active",
      );
    }

    // Wade, at the Crash Site, offers the optional hint with green guidance.
    await standAt(testCharacter.id, LOCATION_IDS.crashSite);
    await openTestCharacter(page, testCharacter.id);
    const conversation = await openNpcConversation(page, "Wade Rusk");
    const entry = conversation.locator(`[data-conversation-entry="${MISSION}:lead"]`);
    await expect(entry).toHaveAttribute("data-mission-guidance", "active");
    await openConversationEntry(conversation, /Not From Around Here/);
    await playDialogueToText(conversation, /Go ask him/);
    // Opening and reading the scene records nothing until its control is used.
    expect((await progressOf(testCharacter.id))["toll-hint"]).toBe(0);
    await conversation.locator("[data-dialogue-action]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    await expect(conversation.locator(`[data-conversation-entry="${MISSION}:lead"]`)).toHaveCount(
      0,
    );
    expect(await progressOf(testCharacter.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });
    await page.keyboard.press("Escape");

    // Everything narrows to Toll alone, and the Mission stays Active.
    await expect(page.locator(`[data-mission-strip="${MISSION}"]`)).toContainText(
      "Ask Tolliver Kade at Last Leg Trading about the fragment",
    );
    await openMapSurface(page);
    await expect(litHexes(page)).toHaveCount(1);
    await expect(
      page.locator(`[data-map-location="${LOCATION_IDS.holoHollowLanding}"]`),
    ).toHaveAttribute("data-mission-guidance", "active");
  });

  test("Toll alone advances the Mission, which then points to Stillreach with no Skatboll pin", async ({
    page,
    testCharacter,
  }) => {
    await accepted(testCharacter.id);
    // Straight to Toll, before Thrust Issues and with Trade still shut.
    await standAt(testCharacter.id, LOCATION_IDS.holoHollowLanding);
    await openTestCharacter(page, testCharacter.id);

    const directory = page.locator("[data-local-place-directory]");
    const shop = directory.locator(`[data-local-place="${LOCAL_PLACE_IDS.lastLegTrading}"]`);
    await expect(shop.locator("[data-local-place-enter]")).toHaveAttribute(
      "data-mission-guidance",
      "active",
    );
    await shop.click();
    const conversation = await openNpcConversation(page, "Tolliver “Toll” Kade");
    const entry = conversation.locator(`[data-conversation-entry="${MISSION}:conversation"]`);
    await expect(entry).toHaveAttribute("data-mission-guidance", "active");
    await openConversationEntry(conversation, /Not From Around Here/);
    await playDialogueToText(conversation, /Hilltop Workshop/);
    expect((await progressOf(testCharacter.id))["toll-lead"]).toBe(0);
    await playDialogueToText(conversation, /The hill isn't going anywhere/);
    await conversation.locator("[data-dialogue-action]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    expect(await progressOf(testCharacter.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });

    // His ordinary topics are untouched, and the Mission scene is gone.
    for (const topic of ["Skatboll", "Stillreach", "Fuel"]) {
      await expect(conversation.getByRole("button", { name: new RegExp(topic) })).toBeVisible();
    }
    await expect(
      conversation.locator(`[data-conversation-entry="${MISSION}:conversation"]`),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    const expectUnfinished = async () => {
      const strip = page.locator(`[data-mission-strip="${MISSION}"]`);
      await expect(strip).toContainText("Find the researcher at Hilltop Workshop on Stillreach");
      // Only the hand-in to the Enby is left, and it is on another planet.
      await expect(strip).toHaveAttribute("data-mission-phase", "turn_in");
      // No Skatboll hex is pinned: the researcher is not on this map.
      await openMapSurface(page);
      await expect(litHexes(page)).toHaveCount(0);
      const [row] = await missionRows(testCharacter.id);
      expect(row?.completedAt).toBeNull();
    };
    await expectUnfinished();

    // Refreshing, or signing back in, changes nothing.
    await page.reload();
    await expectUnfinished();
  });

  test("an unpinned Mission goes quiet on the Map but is never blocked", async ({
    page,
    testCharacter,
  }) => {
    await accepted(testCharacter.id);
    await standAt(testCharacter.id, LOCATION_IDS.holoHollow);
    await openTestCharacter(page, testCharacter.id);
    await page.getByRole("button", { name: /Unpin Not From Around Here/ }).click();
    await expect(page.locator(`[data-mission-strip="${MISSION}"]`)).toHaveCount(0);
    await openMapSurface(page);
    await expect(litHexes(page)).toHaveCount(0);

    // The conversation is still there and still advances the Mission.
    await standAt(testCharacter.id, LOCATION_IDS.theJag);
    await openTestCharacter(page, testCharacter.id);
    const conversation = await openNpcConversation(page, "Tansy Rusk");
    await openConversationEntry(conversation, /Not From Around Here/);
    await playDialogueToText(conversation, /Worst case, you've had a walk/);
    await conversation.locator("[data-dialogue-action]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    expect((await progressOf(testCharacter.id))["toll-hint"]).toBe(1);
  });
});

test.describe("NPC placement", () => {
  test("a hint plays where Wade and Tansy actually stand for this character", async ({
    page,
    testCharacter,
  }) => {
    await accepted(testCharacter.id);
    const now = new Date();
    await db.insert(characterMissions).values(
      [MISSION_IDS.keepTheChange, MISSION_IDS.tenThousandHours].map((missionId) => ({
        characterId: testCharacter.id,
        missionId,
        acceptedAt: now,
        completedAt: now,
      })),
    );
    await standAt(testCharacter.id, LOCATION_IDS.holoHollow);
    await openTestCharacter(page, testCharacter.id);
    await openMapSurface(page);
    // Both teachers share Wade's yard: one hex for the pair, plus Toll's.
    await expect(litHexes(page)).toHaveCount(2);
    await expect(
      page.locator(`[data-map-location="${LOCATION_IDS.ruskRecovery}"]`),
    ).toHaveAttribute("data-mission-guidance", "active");

    await standAt(testCharacter.id, LOCATION_IDS.ruskRecovery);
    await openTestCharacter(page, testCharacter.id);
    for (const npc of [NPC_IDS.wadeRusk, NPC_IDS.tansyRusk]) {
      await expect(page.locator(`[data-npc-interaction="${npc}"]`)).toBeVisible();
    }
  });
});

test.describe("the Wise Old Enby at Hilltop Workshop (#389)", () => {
  const ENBY = "The Wise Old Enby";
  const talk = (page: Page) => page.getByRole("button", { name: `Talk to ${ENBY}` });

  test("is there for any visitor, with three ordinary topics and no Mission", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, []);
    await standAt(testCharacter.id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, testCharacter.id);
    await expect(page.locator(`[data-npc-interaction="${NPC_IDS.wiseOldEnby}"]`)).toBeVisible();
    await expect(talk(page)).not.toHaveAttribute("data-mission-guidance", /.+/);

    const conversation = await openNpcConversation(page, ENBY);
    await expect(conversation.locator('[data-conversation-section="current"]')).toHaveCount(0);
    const topics = conversation.locator('[data-conversation-section="topics"] button');
    await expect(topics).toHaveText(["Introductions", "The workshop", "Stillreach"]);

    await openConversationEntry(conversation, /Introductions/);
    // The workshop interior is behind the portrait, labelled by the hill.
    await expect(conversation.getByText("Hilltop Workshop").first()).toBeVisible();
    await playDialogueToText(conversation, /‘Wise’ is still under review/);
    await conversation.locator("[data-dialogue-text]").click();
    await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");
    await conversation.locator("[data-dialogue-next]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    expect(await missionRows(testCharacter.id)).toHaveLength(0);
  });

  test("offers the mystery in person for a carried stone, and finishes it on I UNDERSTAND", async ({
    page,
    testCharacter,
  }) => {
    await seed(testCharacter.id, [{ itemId: FRAGMENT, quantity: 2 }]);
    await standAt(testCharacter.id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, testCharacter.id);
    await expect(talk(page)).toHaveAttribute("data-mission-guidance", "available");

    const conversation = await openNpcConversation(page, ENBY);
    const offer = conversation.locator(`[data-conversation-entry="${MISSION}:offer"]`);
    await expect(offer).toContainText("Show strange mineral");
    await expect(offer).toHaveAttribute("data-mission-guidance", "available");

    // Not now is read-only and returns to the hub.
    await openConversationEntry(conversation, /Show strange mineral/);
    await playDialogueToText(conversation, /longer story than it looks/);
    await expect(conversation.locator("[data-dialogue-action]")).toHaveText("Start mission");
    await conversation.locator("[data-dialogue-decline]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    expect(await missionRows(testCharacter.id)).toHaveLength(0);

    // Start mission accepts the same Mission and the hub refreshes in place.
    await openConversationEntry(conversation, /Show strange mineral/);
    await playDialogueToText(conversation, /longer story than it looks/);
    await conversation.locator("[data-dialogue-action]").click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
    await expect(offer).toHaveCount(0);
    const turnIn = conversation.locator(`[data-conversation-entry="${MISSION}:turn_in"]`);
    await expect(turnIn).toHaveAttribute("data-mission-guidance", "turn_in");
    expect(await missionRows(testCharacter.id)).toHaveLength(1);
    expect(total(await rows(testCharacter.id), FRAGMENT)).toBe(2);

    // The direct opening, then the shared explanation; reading it completes nothing.
    await openConversationEntry(conversation, /Not From Around Here/);
    await expect(conversation.locator("[data-dialogue-text]")).toContainText(
      /rather well-equipped fool/,
    );
    await playDialogueToText(conversation, /One step at a time/);
    expect((await missionRows(testCharacter.id))[0]?.completedAt).toBeNull();
    await expect(conversation.locator("[data-dialogue-action]")).toHaveText("I UNDERSTAND");
    await conversation.locator("[data-dialogue-action]").click();

    await finishLessonScene(conversation);
    await expect(conversation.locator(`[data-conversation-entry^="${MISSION}:"]`)).toHaveCount(0);
    await expect(conversation.getByRole("button", { name: /About RuneSpace/ })).toBeVisible();
    expect((await missionRows(testCharacter.id))[0]?.completedAt).not.toBeNull();
    expect(total(await rows(testCharacter.id), FRAGMENT)).toBe(2);
    expect(await progressOf(testCharacter.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });

    // A refresh keeps it Completed, with no stale offer, pin or Inspect.
    await page.reload();
    await expect(talk(page)).not.toHaveAttribute("data-mission-guidance", /.+/);
    await expect(page.locator(`[data-mission-strip="${MISSION}"]`)).toHaveCount(0);
    const inventory = await openInventory(page);
    await expect(tile(inventory, "Rune Fragment")).not.toHaveAttribute(
      "data-mission-guidance",
      /.+/,
    );
  });

  test("pins only Hilltop on Stillreach and lets Toll's lead open the scene without the stone", async ({
    page,
    testCharacter,
  }) => {
    await accepted(testCharacter.id, { "toll-lead": 1 });
    await seed(testCharacter.id, []);
    await standAt(testCharacter.id, LOCATION_IDS.stillreachLandingStation);
    await openTestCharacter(page, testCharacter.id);
    await expect(page.locator(`[data-mission-strip="${MISSION}"]`)).toContainText(
      "Find the researcher at Hilltop Workshop on Stillreach",
    );
    await openMapSurface(page);
    await expect(litHexes(page)).toHaveCount(1);
    await expect(
      page.locator(`[data-map-location="${LOCATION_IDS.hilltopWorkshop}"]`),
    ).toHaveAttribute("data-mission-guidance", "turn_in");

    await standAt(testCharacter.id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, testCharacter.id);
    await expect(talk(page)).toHaveAttribute("data-mission-guidance", "turn_in");
    const conversation = await openNpcConversation(page, ENBY);
    await openConversationEntry(conversation, /Not From Around Here/);
    await expect(conversation.locator("[data-dialogue-text]")).toContainText(/Toll sent you/);
    await playDialogueToText(conversation, /One step at a time/);
    await conversation.locator("[data-dialogue-action]").click();
    await finishLessonScene(conversation);
    await expect(conversation.getByRole("button", { name: /About RuneSpace/ })).toBeVisible();
    expect((await missionRows(testCharacter.id))[0]?.completedAt).not.toBeNull();
    expect(await progressOf(testCharacter.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });
  });
});
