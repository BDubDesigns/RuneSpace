import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { getEffectiveGameBalance, getItemMaximumCharge } from "@/game/config/balance";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { getPublishedUpdates } from "@/features/public-site/public-updates";
import { cleanupTestUser, createCharacterForUser } from "../integration/fixtures";
import { establishAuthenticatedSession, expect, openTestCharacter, test } from "./fixtures";
import { populationDisclosure } from "./population-disclosure";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #268 — player trading in a real browser, with real accounts on
 * separate browser contexts at the same World Location.
 *
 * PostgreSQL coverage owns the rules and every race (#266 request authority,
 * budget, escalation, and exclusivity; #267 versions, consent, settlement,
 * capacity, last-Cutter safety, and audit; #268 durable outcomes). This is the
 * representative browser contract only: a trade starts from Nearby Players →
 * Character Profile → Trade, the recipient's request arrives live as a pinned
 * Chat/Social card without navigation or a modal, Accept opens the trade
 * surface for both, offers / Ready / Change Offer / Confirm reconcile across
 * both clients, a stateful Cutter keeps its charge, a capacity refusal returns
 * both to a correctable state, a reload resumes the same trade, same-account
 * characters trade with Trade alone on the profile, rapid requests make
 * Decline & Block prominent, and nothing overflows at phone or desktop widths.
 *
 * Every journey creates fresh accounts and uniquely named characters, since
 * the Crash Site population is shared with concurrently running specs. No
 * journey waits out an expiry: the 20-second and 5-minute timers belong to
 * the integration suites' injected clocks.
 */

type Player = {
  userId: string;
  character: { id: string; displayName: string; playerAccountId: string };
};

const { items, carrying } = getEffectiveGameBalance();
const MYKEA = items.starterContainer.itemId; // 8 slots
const SCRAP_BOX = items.scrapBox.itemId;
const SALVAGE = items.salvageCutter.itemId;
const SHALE = items.ferriteShale.itemId; // stack of 10
const FERRITE = items.refinedFerrite.itemId; // stack of 5
const PHONE = { width: 393, height: 851 } as const;
const DESKTOP = { width: 1280, height: 720 } as const;

const users: string[] = [];

test.afterEach(async () => {
  for (const userId of users.splice(0)) await cleanupTestUser(db, authSchema, rune, userId);
});

/** Each journey seeds the shared Crash Site, so it runs once, in chromium. */
function journey(name: string, body: (page: Page) => Promise<void>) {
  test(name, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
    test.setTimeout(120_000);
    await body(page);
  });
}

// --- fixtures -----------------------------------------------------------------

async function account(browser: Browser, context: BrowserContext, label: string) {
  const tag = randomUUID().slice(0, 6);
  const session = await establishAuthenticatedSession(
    browser,
    `${label} ${tag}`,
    `trade-${tag}-${randomUUID().slice(0, 8)}@example.com`,
  );
  users.push(session.userId);
  const cookies = await session.context.cookies();
  await session.context.close();
  await context.clearCookies();
  await context.addCookies(cookies);
  return session.userId;
}

/** A Crash Site character wearing a MYKEA (8 slots), with or without an equipped Cutter. */
async function character(userId: string, label: string, options: { cutter: boolean }) {
  const created = await createCharacterForUser(
    db,
    rune,
    ownership,
    characters,
    userId,
    `${label} ${randomUUID().slice(0, 6)}`,
    PORTRAIT_IDS.evaSalvageWelder,
    { seedLegacyStarterCutter: options.cutter },
  );
  const [pack] = await db
    .insert(rune.itemInstances)
    .values({ characterId: created.id, itemId: MYKEA })
    .returning();
  await db.insert(rune.equippedItems).values({
    characterId: created.id,
    assignmentKind: "container",
    suitSlotId: carrying.containerSuitSlotIds[0],
    itemInstanceId: pack!.id,
  });
  return created;
}

async function signIn(
  browser: Browser,
  context: BrowserContext,
  label: string,
  options = { cutter: false },
): Promise<Player> {
  const userId = await account(browser, context, label);
  return { userId, character: await character(userId, label, options) };
}

/** A second player on their own browser context at the same viewport. */
async function secondPlayer(page: Page, label: string, options = { cutter: false }) {
  const browser = page.context().browser()!;
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const player = await signIn(browser, context, label, options);
  return { player, context, page: await context.newPage() };
}

async function setCredits(player: Player, credits: number) {
  await db
    .update(rune.characters)
    .set({ credits })
    .where(eq(rune.characters.id, player.character.id));
}

async function addStack(player: Player, itemId: string, quantity: number) {
  await db
    .insert(rune.inventoryStacks)
    .values({ characterId: player.character.id, itemId, quantity });
}

async function addUnique(player: Player, itemId: string, currentCharge: number | null = null) {
  const [row] = await db
    .insert(rune.itemInstances)
    .values({ characterId: player.character.id, itemId, currentCharge })
    .returning({ id: rune.itemInstances.id });
  return row!.id;
}

async function creditsOf(player: Player) {
  const [row] = await db
    .select({ credits: rune.characters.credits })
    .from(rune.characters)
    .where(eq(rune.characters.id, player.character.id));
  return row!.credits;
}

// --- page helpers ---------------------------------------------------------------

function launcher(page: Page) {
  return page.locator("[data-chat-social-launcher]");
}

async function openPlay(page: Page, characterId: string) {
  await openTestCharacter(page, characterId);
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
}

/** Nearby Players → the character's profile; returns its action group. */
async function openProfile(page: Page, name: string) {
  await populationDisclosure(page).click();
  await page.getByRole("button", { name: new RegExp(`^${name},`) }).click();
  const actions = page.getByRole("group", { name: `Interact with ${name}` });
  await expect(actions).toBeVisible();
  return actions;
}

async function requestTrade(page: Page, name: string) {
  await page
    .getByRole("group", { name: `Interact with ${name}` })
    .getByRole("button", { name: "Trade", exact: true })
    .click();
  await expect(profileWaiting(page)).toContainText(`Waiting for ${name}…`);
}

function profileWaiting(page: Page) {
  return page.locator("#character-profile-panel [data-trade-waiting]");
}

async function openChat(page: Page) {
  await launcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function requestCard(dialog: Locator, fromName: string) {
  return dialog.getByRole("listitem", { name: `Trade request from ${fromName}` });
}

function surface(page: Page) {
  return page.getByRole("dialog", { name: "Trade" });
}

function offer(trade: Locator, side: "yours" | "theirs") {
  return trade.locator(`[data-trade-offer="${side}"]`);
}

async function expectStage(trade: Locator, stage: "compose" | "ready" | "review" | "confirmed") {
  await expect(trade.locator("[data-trade-surface]")).toHaveAttribute("data-trade-stage", stage);
}

async function expectNoHorizontalOverflow(page: Page, dialog?: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (dialog) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
}

/** The persistent primary actions are on screen and usable without scrolling. */
async function expectActionsInView(page: Page, trade: Locator) {
  const actions = trade.locator("[data-trade-actions]");
  await expect(actions).toBeInViewport();
  const box = await actions.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

// --- journeys -------------------------------------------------------------------

journey(
  "a trade starts from a profile, arrives live in Chat/Social, and completes for both players at phone width",
  async (page) => {
    await page.setViewportSize(PHONE);
    // A keeps an equipped Cutter, so giving the carried one is not a last Cutter.
    const a = await signIn(page.context().browser()!, page.context(), "Wren", { cutter: true });
    const b = await secondPlayer(page, "Tamsin");
    const aName = a.character.displayName;
    const bName = b.player.character.displayName;
    await setCredits(a, 40);
    await setCredits(b.player, 10);
    await addStack(a, SHALE, 6);
    await addStack(b.player, FERRITE, 5);
    const cutter = await addUnique(a, SALVAGE, 7);
    const charge = `Charge 7/${getItemMaximumCharge(SALVAGE)}`;

    await openPlay(b.page, b.player.character.id);
    const bPlayUrl = b.page.url();
    await openPlay(page, a.character.id);
    const aPlayUrl = page.url();

    // 1–2. Nearby Players → profile → Trade; the requester waits and can cancel.
    const actions = await openProfile(page, bName);
    await expect(actions.getByRole("button")).toHaveText(["Trade", "Whisper", "Report", "Block"]);
    await requestTrade(page, bName);
    await expect(
      profileWaiting(page).getByRole("button", { name: "Cancel Request" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "issue-268-profile-waiting-393.png");

    // 3. The request arrives live: attention on the launcher, no navigation,
    // no modal; the card is pinned inside Chat/Social.
    await expect(launcher(b.page)).toHaveAttribute("aria-label", "Chat, 1 item needs attention");
    await expect(b.page.getByRole("dialog")).toHaveCount(0);
    expect(b.page.url()).toBe(bPlayUrl);
    const bChat = await openChat(b.page);
    const card = requestCard(bChat, aName);
    await expect(card).toContainText(aName);
    await expect(card).toContainText("wants to trade with you.");
    await expect(card.getByRole("button", { name: "Decline & Block" })).toHaveCount(0);
    await expectNoHorizontalOverflow(b.page, bChat);
    await captureReviewScreenshot(b.page, "issue-268-request-card-393.png");

    // 4. Accept opens the trade surface for both players.
    await card.getByRole("button", { name: "Accept" }).click();
    const aTrade = surface(page);
    const bTrade = surface(b.page);
    await expect(aTrade).toBeVisible();
    await expect(bTrade).toBeVisible();
    await expect(bChat).toHaveCount(0);
    await expect(aTrade.locator("[data-trade-counterpart]")).toHaveText(bName);
    await expect(bTrade.locator("[data-trade-counterpart]")).toHaveText(aName);
    await expect(launcher(b.page)).toHaveAttribute("aria-label", "Chat");

    // 5–6. A offers Credits, a stack, and a charged Cutter; B sees it all read-only.
    await aTrade.getByLabel(/Credits to offer/).fill("12");
    await aTrade.getByRole("button", { name: "Set Credits" }).click();
    await expect(offer(aTrade, "yours").locator("[data-offer-credits]")).toHaveText("12 Credits");
    await aTrade.getByLabel("Quantity of Ferrite Shale to offer").fill("4");
    await aTrade.getByRole("button", { name: "Offer 4 Ferrite Shale" }).click();
    await expect(offer(aTrade, "yours").locator(`[data-offer-stack="${SHALE}"]`)).toContainText(
      "Ferrite Shale × 4",
    );
    await aTrade.locator(`[data-trade-offerable-item="${cutter}"]`).getByRole("button").click();
    await expect(offer(aTrade, "yours").locator(`[data-offer-item="${cutter}"]`)).toContainText(
      charge,
    );
    const theirs = offer(bTrade, "theirs");
    await expect(theirs.locator("[data-offer-credits]")).toHaveText("12 Credits");
    await expect(theirs.locator(`[data-offer-stack="${SHALE}"]`)).toContainText("× 4");
    await expect(theirs.locator(`[data-offer-item="${cutter}"]`)).toContainText(charge);
    await expect(theirs.getByRole("button")).toHaveCount(0);
    await bTrade.getByLabel("Quantity of Refined Ferrite to offer").fill("2");
    await bTrade.getByRole("button", { name: "Offer 2 Refined Ferrite" }).click();
    await expect(offer(aTrade, "theirs").locator(`[data-offer-stack="${FERRITE}"]`)).toContainText(
      "× 2",
    );

    // 7. Ready independently: A's side locks, and B sees A Ready.
    await aTrade.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(aTrade, "ready");
    await expect(offer(aTrade, "yours")).toHaveAttribute("data-trade-offer-locked", "");
    await expect(aTrade.getByRole("button", { name: "Set Credits" })).toHaveCount(0);
    await expect(aTrade.getByRole("button", { name: "Change Offer" })).toBeVisible();
    await expect(offer(bTrade, "theirs").locator("[data-trade-consent]")).toHaveText("Ready");

    // 8. B's edit after A's Ready clears consent in both clients.
    await bTrade.getByLabel("Quantity of Refined Ferrite to offer").fill("1");
    await bTrade.getByRole("button", { name: "Offer 1 Refined Ferrite" }).click();
    await expectStage(aTrade, "compose");
    await expect(offer(aTrade, "theirs").locator(`[data-offer-stack="${FERRITE}"]`)).toContainText(
      "× 3",
    );
    await expect(offer(bTrade, "theirs").locator("[data-trade-consent]")).toHaveText("Not ready");
    await expectNoHorizontalOverflow(page, aTrade);
    await expectActionsInView(page, aTrade);
    await captureReviewScreenshot(page, "issue-268-compose-393.png");

    // 9. Both Ready: the frozen You Give / You Receive review, no editing.
    await aTrade.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(aTrade, "ready");
    await bTrade.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(aTrade, "review");
    await expectStage(bTrade, "review");
    const give = aTrade.getByRole("region", { name: "You Give" });
    await expect(give.locator("[data-offer-credits]")).toHaveText("12 Credits");
    await expect(give.locator(`[data-offer-item="${cutter}"]`)).toContainText(charge);
    await expect(
      aTrade
        .getByRole("region", { name: "You Receive" })
        .locator(`[data-offer-stack="${FERRITE}"]`),
    ).toContainText("Refined Ferrite × 3");
    await expect(
      bTrade.getByRole("region", { name: "You Receive" }).locator(`[data-offer-item="${cutter}"]`),
    ).toContainText(charge);
    await expect(aTrade.locator("input")).toHaveCount(0);
    await expect(aTrade.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expectNoHorizontalOverflow(b.page, bTrade);
    await expectActionsInView(b.page, bTrade);
    await captureReviewScreenshot(b.page, "issue-268-review-393.png");

    // 10. The first Confirm waits and keeps Cancel; the second completes both.
    await aTrade.getByRole("button", { name: "Confirm Trade" }).click();
    await expectStage(aTrade, "confirmed");
    await expect(aTrade.locator("[data-trade-status]")).toHaveText(
      `Confirmed — waiting for ${bName}`,
    );
    await expect(aTrade.getByRole("button", { name: "Cancel Trade" })).toBeEnabled();
    await expect(bTrade.locator("[data-trade-status]")).toContainText(`${aName} has confirmed.`);
    expect(await creditsOf(a)).toBe(40);
    await bTrade.getByRole("button", { name: "Confirm Trade" }).click();

    const aDone = page.getByRole("dialog", { name: "Trade result" });
    const bDone = b.page.getByRole("dialog", { name: "Trade result" });
    for (const done of [aDone, bDone]) {
      await expect(done.locator("[data-trade-ended]")).toHaveAttribute(
        "data-trade-ended",
        "completed",
      );
    }
    await expect(aDone.getByRole("region", { name: "You gave" })).toContainText(charge);
    await expect(bDone.getByRole("region", { name: "You received" })).toContainText(charge);
    await expect(bDone.getByRole("region", { name: "You gave" })).toContainText(
      "Refined Ferrite × 3",
    );
    await expectNoHorizontalOverflow(b.page, bDone);
    await captureReviewScreenshot(b.page, "issue-268-complete-393.png");

    // Both clients converge on the one committed result.
    expect(await creditsOf(a)).toBe(28);
    expect(await creditsOf(b.player)).toBe(22);
    const [moved] = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.id, cutter));
    expect(moved).toMatchObject({ characterId: b.player.character.id, currentCharge: 7 });
    await bDone.getByRole("button", { name: "Done" }).click();
    await expect(bDone).toHaveCount(0);
    expect(b.page.url()).toBe(bPlayUrl);

    // B's Inventory shows the same Cutter with its charge intact.
    await b.page.getByRole("button", { name: /^Inventory/ }).click();
    const inventory = b.page.getByRole("dialog", { name: "Inventory" });
    await expect(inventory.getByText(`7/${getItemMaximumCharge(SALVAGE)}`)).toBeVisible();
    await aDone.getByRole("button", { name: "Done" }).click();
    expect(page.url()).toBe(aPlayUrl);
    await b.context.close();
  },
);

journey(
  "cancel paths, a capacity refusal both players can correct, and a reload that resumes the trade at desktop width",
  async (page) => {
    await page.setViewportSize(DESKTOP);
    const a = await signIn(page.context().browser()!, page.context(), "Orla");
    const b = await secondPlayer(page, "Brask");
    const aName = a.character.displayName;
    const bName = b.player.character.displayName;
    await setCredits(a, 20);
    const box = await addUnique(a, SCRAP_BOX);
    // B's 8 slots are all full: a Scrap Box would need a ninth.
    for (let index = 0; index < 7; index += 1) await addStack(b.player, FERRITE, 5);
    await addStack(b.player, SHALE, 10);

    await openPlay(b.page, b.player.character.id);
    await openPlay(page, a.character.id);
    await openProfile(page, bName);

    // 11a. Cancel Request: the recipient's card goes away.
    await requestTrade(page, bName);
    const bChat = await openChat(b.page);
    await expect(requestCard(bChat, aName)).toBeVisible();
    await profileWaiting(page).getByRole("button", { name: "Cancel Request" }).click();
    await expect(profileWaiting(page)).toHaveCount(0);
    await expect(requestCard(bChat, aName)).toHaveCount(0);
    await expect(launcher(b.page)).toHaveAttribute("aria-label", "Chat");

    // A new request, accepted.
    await requestTrade(page, bName);
    await requestCard(bChat, aName).getByRole("button", { name: "Accept" }).click();
    const aTrade = surface(page);
    const bTrade = surface(b.page);
    await aTrade.locator(`[data-trade-offerable-item="${box}"]`).getByRole("button").click();
    await expect(offer(bTrade, "theirs").locator(`[data-offer-item="${box}"]`)).toBeVisible();

    // 13. A reload resumes exactly the same session, version, and offer.
    const version = await aTrade.locator("[data-trade-surface]").getAttribute("data-trade-version");
    await page.reload();
    await expect(surface(page)).toBeVisible();
    await expect(surface(page).locator("[data-trade-surface]")).toHaveAttribute(
      "data-trade-version",
      version!,
    );
    await expect(offer(surface(page), "yours").locator(`[data-offer-item="${box}"]`)).toBeVisible();
    const sessions = await db
      .select({ id: rune.playerTradeSessions.id })
      .from(rune.playerTradeSessions)
      .where(eq(rune.playerTradeSessions.requesterCharacterId, a.character.id));
    expect(sessions).toHaveLength(1);

    // 12. Both Ready and Confirm; settlement refuses B's full Inventory, and
    // both clients return to a correctable compose state with the reason.
    await aTrade.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(aTrade, "ready");
    await bTrade.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(bTrade, "review");
    await expectStage(aTrade, "review");
    await bTrade.getByRole("button", { name: "Confirm Trade" }).click();
    await expectStage(bTrade, "confirmed");
    await aTrade.getByRole("button", { name: "Confirm Trade" }).click();
    await expectStage(aTrade, "compose");
    await expectStage(bTrade, "compose");
    await expect(aTrade.locator("[data-trade-settlement-refusal]")).toContainText(
      `${bName}'s Inventory wouldn't have room for this trade. Nothing moved.`,
    );
    await expect(bTrade.locator("[data-trade-settlement-refusal]")).toContainText(
      "Your Inventory wouldn't have room for this trade. Nothing moved.",
    );
    await expect(offer(bTrade, "yours").locator("[data-trade-consent]")).toHaveText("Not ready");
    await expect(offer(bTrade, "theirs").locator("[data-trade-consent]")).toHaveText("Not ready");
    const [held] = await db
      .select({ characterId: rune.itemInstances.characterId })
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.id, box));
    expect(held!.characterId).toBe(a.character.id);
    await expectNoHorizontalOverflow(page, aTrade);
    await expectActionsInView(page, aTrade);
    await captureReviewScreenshot(page, "issue-268-capacity-refusal-1280.png");

    // Correcting the offer clears the reason for both.
    await offer(aTrade, "yours")
      .getByRole("button", { name: "Remove Scrap Box from your offer" })
      .click();
    await expect(aTrade.locator("[data-trade-settlement-refusal]")).toHaveCount(0);
    await expect(bTrade.locator("[data-trade-settlement-refusal]")).toHaveCount(0);

    // 11b. Cancel Trade: the other player is told, and nothing moved.
    await bTrade.getByRole("button", { name: "Cancel Trade" }).click();
    await expect(bTrade).toHaveCount(0);
    await expect(b.page.getByRole("dialog", { name: "Trade result" })).toHaveCount(0);
    const aEnded = page.getByRole("dialog", { name: "Trade result" });
    await expect(aEnded.locator("[data-trade-ended]")).toHaveAttribute(
      "data-trade-ended",
      "canceled",
    );
    await expect(aEnded).toContainText(`${bName} canceled the trade. Nothing moved.`);
    expect(await creditsOf(a)).toBe(20);
    await aEnded.getByRole("button", { name: "Done" }).click();
    await expect(aEnded).toHaveCount(0);
    await b.context.close();
  },
);

journey(
  "two characters on the same account trade with Trade alone on the profile",
  async (page) => {
    await page.setViewportSize(PHONE);
    const userId = await account(page.context().browser()!, page.context(), "Kestrel");
    const first: Player = { userId, character: await character(userId, "Kes", { cutter: false }) };
    const second: Player = { userId, character: await character(userId, "Rel", { cutter: false }) };
    await setCredits(first, 30);
    await setCredits(second, 0);
    const other = await page.context().newPage();
    await openPlay(other, second.character.id);
    await openPlay(page, first.character.id);

    // 14. Trade stays; Whisper, Report, and Block would only refuse here.
    const actions = await openProfile(page, second.character.displayName);
    await expect(actions.getByRole("button")).toHaveText(["Trade"]);
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "issue-268-same-account-profile-393.png");
    await requestTrade(page, second.character.displayName);

    const chat = await openChat(other);
    await requestCard(chat, first.character.displayName)
      .getByRole("button", { name: "Accept" })
      .click();
    const giver = surface(page);
    const taker = surface(other);
    await giver.getByLabel(/Credits to offer/).fill("25");
    await giver.getByRole("button", { name: "Set Credits" }).click();
    await expect(offer(taker, "theirs").locator("[data-offer-credits]")).toHaveText("25 Credits");
    // A one-sided gift between your own characters is still Ready and Confirm.
    await giver.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(giver, "ready");
    await taker.getByRole("button", { name: "Ready", exact: true }).click();
    await expectStage(giver, "review");
    await giver.getByRole("button", { name: "Confirm Trade" }).click();
    await expectStage(giver, "confirmed");
    await taker.getByRole("button", { name: "Confirm Trade" }).click();
    await expect(other.getByRole("dialog", { name: "Trade result" })).toContainText("25 Credits");
    await expect(page.getByRole("dialog", { name: "Trade result" })).toContainText("25 Credits");
    expect(await creditsOf(first)).toBe(5);
    expect(await creditsOf(second)).toBe(25);
    await other.close();
  },
);

journey(
  "rapid requests make Decline & Block prominent, a fifth is refused, and Block stops further requests",
  async (page) => {
    await page.setViewportSize(PHONE);
    const browser = page.context().browser()!;
    const a = await signIn(browser, page.context(), "Pell");
    // A second character on A's account, for the account-wide fifth request.
    const alt: Player = {
      userId: a.userId,
      character: await character(a.userId, "Pella", { cutter: false }),
    };
    const b = await secondPlayer(page, "Quill");
    const aName = a.character.displayName;
    const bName = b.player.character.displayName;

    await openPlay(b.page, b.player.character.id);
    const altPage = await page.context().newPage();
    await openPlay(altPage, alt.character.id);
    await openPlay(page, a.character.id);
    await openProfile(page, bName);
    const bChat = await openChat(b.page);

    // 15. Three send-and-cancel cycles, then a fourth that waits.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await requestTrade(page, bName);
      await profileWaiting(page).getByRole("button", { name: "Cancel Request" }).click();
      await expect(profileWaiting(page)).toHaveCount(0);
    }
    await requestTrade(page, bName);
    const card = requestCard(bChat, aName);
    await expect(card.locator("[data-trade-request-card]")).toHaveAttribute(
      "data-block-prominent",
      "",
    );
    await expect(card.getByRole("button", { name: "Decline & Block" })).toBeVisible();
    await expectNoHorizontalOverflow(b.page, bChat);
    await captureReviewScreenshot(b.page, "issue-268-block-prominent-393.png");

    // The same account's fifth request inside the window is refused, from any character.
    await openProfile(altPage, bName);
    await altPage
      .getByRole("group", { name: `Interact with ${bName}` })
      .getByRole("button", { name: "Trade", exact: true })
      .click();
    await expect(altPage.locator("#character-profile-panel").getByRole("alert")).toContainText(
      "You've sent a lot of trade requests.",
    );
    await expect(profileWaiting(altPage)).toHaveCount(0);

    // Decline & Block runs the ordinary Block confirmation.
    await card.getByRole("button", { name: "Decline & Block" }).click();
    const confirm = card.locator("[data-safety-block]");
    await expect(confirm.getByRole("heading", { name: `Block ${aName}?` })).toBeVisible();
    await confirm.getByRole("button", { name: "Block", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(profileWaiting(page)).toHaveCount(0);
    const [block] = await db
      .select()
      .from(rune.playerBlocks)
      .where(
        and(
          eq(rune.playerBlocks.blockerPlayerAccountId, b.player.character.playerAccountId),
          eq(rune.playerBlocks.blockedPlayerAccountId, a.character.playerAccountId),
        ),
      );
    expect(block).toBeTruthy();

    // 16. After the Block, a new request is refused and never reaches B.
    await page
      .getByRole("group", { name: `Interact with ${bName}` })
      .getByRole("button", { name: "Trade", exact: true })
      .click();
    await expect(page.locator("#character-profile-panel").getByRole("alert")).toContainText(
      "can't take a trade request right now",
    );
    await expect(bChat.locator('[data-social-card^="trade-request:"]')).toHaveCount(0);
    await expect(launcher(b.page)).toHaveAttribute("aria-label", "Chat");
    await altPage.close();
    await b.context.close();
  },
);

// --- public communication -------------------------------------------------------

test.describe("trading on the public site", () => {
  test("Meet Me There is the newest Update and links the Player Trading Wiki page", async ({
    page,
  }) => {
    expect(getPublishedUpdates()[0]?.slug).toBe("meet-me-there");
    await page.goto("/updates");
    const newest = page
      .getByRole("list", { name: "Published Updates" })
      .getByRole("listitem")
      .first();
    await expect(newest.getByRole("link", { name: "Meet Me There", exact: true })).toHaveAttribute(
      "href",
      "/updates/meet-me-there",
    );
    // The homepage's latest-Update section names it too.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Meet Me There", level: 2 })).toBeVisible();

    await page.goto("/updates/meet-me-there");
    await expect(page).toHaveTitle("Meet Me There — RuneSpace");
    await expect(page.getByRole("heading", { name: "Patch notes", level: 2 })).toBeVisible();
    const link = page.locator("article").getByRole("link", { name: "Player Trading" });
    await expect(link).toHaveAttribute("href", "/wiki/player-trading");
    await link.click();
    await expect(page).toHaveURL("/wiki/player-trading");
    await expect(page.getByRole("heading", { name: "Player Trading", level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ready, then Confirm", level: 2 }),
    ).toBeVisible();
  });

  test("the Player Trading page sits under Gear & Credits and stays contained at 390px", async ({
    page,
  }) => {
    await page.goto("/wiki");
    await expect(
      page.getByRole("list", { name: "Gear & Credits" }).getByRole("link", {
        name: "Player Trading",
        exact: true,
      }),
    ).toHaveAttribute("href", "/wiki/player-trading");
    await page.setViewportSize(PHONE);
    for (const path of ["/updates/meet-me-there", "/wiki/player-trading"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("News points a returning player at Meet Me There", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "runs once");
    const [latest, previous] = getPublishedUpdates();
    expect(latest?.slug).toBe("meet-me-there");
    const tag = randomUUID().slice(0, 6);
    const { userId, context } = await establishAuthenticatedSession(
      browser,
      `News ${tag}`,
      `trade-news-${tag}-${randomUUID().slice(0, 8)}@example.com`,
    );
    users.push(userId);
    try {
      const created = await character(userId, "Newsy", { cutter: false });
      // Everything before Meet Me There is already read, so only it is news.
      await db
        .update(rune.playerAccounts)
        .set({ newsReadThroughAt: new Date(previous!.publishedAt) })
        .where(eq(rune.playerAccounts.id, created.playerAccountId));
      const page = await context.newPage();
      await openTestCharacter(page, created.id);
      const banner = page.getByRole("banner");
      await banner
        .getByRole("button", { name: "News, unread update available", exact: true })
        .click();
      await expect(page).toHaveURL(/\/updates$/);
      await expect(
        page
          .getByRole("list", { name: "Published Updates" })
          .getByRole("listitem")
          .first()
          .getByRole("link", { name: "Meet Me There", exact: true }),
      ).toBeVisible();
      // Reading it cleared the account's unread state.
      await openTestCharacter(page, created.id);
      await expect(banner.getByRole("button", { name: "News", exact: true })).toBeVisible();
      await expect(banner.getByRole("button", { name: /unread/i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
