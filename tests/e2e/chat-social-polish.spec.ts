import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { eq } from "drizzle-orm";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { whisperParticipantKey } from "@/game/domain/chat";
import { getPublishedUpdates } from "@/features/public-site/public-updates";
import { cleanupTestUser, createCharacterForUser } from "../integration/fixtures";
import { establishAuthenticatedSession, expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #261 — Chat/Social polish in a real browser with two real accounts on
 * two browser contexts: public `@mentions`, blocked-player placeholders in
 * General/Trade, and hiding a Whisper conversation.
 *
 * PostgreSQL coverage owns the rules (target resolution and refusals, Block
 * in both directions, per-feed counts, pagination with redacted rows, and
 * hide arithmetic). This proves what only a browser can: `@` opens a list of
 * characters in view and choosing one makes the mention; the mentioned player
 * sees the launcher and General tab light live, the message marked as theirs,
 * and the attention clear on every tab once read — while ordinary chat stays
 * quiet; a Block turns the sender's rows into placeholders that nothing
 * reveals; and a hidden conversation leaves the list and comes back with the
 * next Whisper — all without horizontal overflow at phone and desktop widths.
 *
 * Public feeds and the Crash Site population are game-wide and other tests
 * run concurrently, so every journey creates fresh accounts and looks only
 * for its own tagged messages and uniquely named characters.
 */

type Player = {
  userId: string;
  character: { id: string; displayName: string; playerAccountId: string };
};

const users: string[] = [];

test.afterEach(async () => {
  for (const userId of users.splice(0)) await cleanupTestUser(db, authSchema, rune, userId);
});

/** A fresh account with one Crash Site character, signed in on `context`. */
async function signIn(browser: Browser, context: BrowserContext, label: string): Promise<Player> {
  const tag = randomUUID().slice(0, 6);
  const session = await establishAuthenticatedSession(
    browser,
    `${label} ${tag}`,
    `polish-${tag}-${randomUUID().slice(0, 8)}@example.com`,
  );
  users.push(session.userId);
  const cookies = await session.context.cookies();
  await session.context.close();
  await context.clearCookies();
  await context.addCookies(cookies);
  // A name with a space and punctuation, as mentions must support.
  const character = await createCharacterForUser(
    db,
    rune,
    ownership,
    characters,
    session.userId,
    `${label} O'${tag}`,
    PORTRAIT_IDS.evaSalvageWelder,
    { seedLegacyStarterCutter: false },
  );
  return { userId: session.userId, character };
}

/** A second player on their own browser context at the same viewport. */
async function secondPlayer(page: Page, label: string) {
  const browser = page.context().browser()!;
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const player = await signIn(browser, context, label);
  return { player, context, page: await context.newPage() };
}

/** Durable public history written directly (nothing is published). */
async function seedPublic(player: Player, body: string) {
  await db.insert(rune.chatMessages).values({
    channel: "general",
    senderPlayerAccountId: player.character.playerAccountId,
    senderCharacterId: player.character.id,
    senderCharacterName: player.character.displayName,
    body,
    createdAt: new Date(Date.now() - 60_000),
  });
}

function launcher(page: Page) {
  return page.locator("[data-chat-social-launcher]");
}

async function openPlay(page: Page, characterId: string) {
  await openTestCharacter(page, characterId);
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
}

async function openChat(page: Page) {
  await launcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeChat(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Chat" })).toHaveCount(0);
}

const tab = (dialog: Locator, name: "General" | "Trade" | "Whispers") =>
  dialog.getByRole("tab", { name: new RegExp(`^${name}`) });

function messageRow(dialog: Locator, text: string) {
  return dialog.locator("[data-chat-message]", { hasText: text });
}

function attention(page: Page) {
  return launcher(page).locator("[data-chat-social-attention]");
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

const WIDTHS = [
  { width: 393, height: 851 },
  { width: 1280, height: 720 },
] as const;

/**
 * Two-account journeys seed the shared General feed and the Crash Site, so
 * each runs once, in chromium (the canonical project), covering both widths.
 */
function eachWidth(name: string, journey: (page: Page, width: number) => Promise<void>) {
  test(name, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "covers both widths from chromium");
    for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      await journey(page, viewport.width);
    }
  });
}

async function mentionJourney(page: Page, width: number) {
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Wren");
  const b = await secondPlayer(page, "Tamsin");
  const bName = b.player.character.displayName;
  await seedPublic(b.player, `anyone selling ore ${tag}`);

  // B is online on two tabs of the same character.
  await openPlay(b.page, b.player.character.id);
  const bOther = await b.context.newPage();
  await openPlay(bOther, b.player.character.id);

  await openPlay(page, a.character.id);
  const dialog = await openChat(page);
  await expect(messageRow(dialog, `anyone selling ore ${tag}`)).toHaveCount(1);
  const composer = dialog.locator('[data-chat-composer="general"] textarea');

  // An ordinary message reaches B live and lights nothing.
  const bDialog = await openChat(b.page);
  await composer.fill(`ordinary hello ${tag}`);
  await composer.press("Enter");
  await expect(messageRow(bDialog, `ordinary hello ${tag}`)).toHaveCount(1);
  await closeChat(b.page);
  await expect(attention(b.page)).toHaveCount(0);
  await expect(attention(bOther)).toHaveCount(0);

  // Typing @ and part of B's name offers B; choosing makes the mention.
  await composer.fill(`got ore? @${bName.slice(0, 4).toLowerCase()}`);
  const option = dialog.getByRole("option", { name: `@${bName}` });
  await expect(option).toBeVisible();
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, `issue-261-mention-options-${width}.png`);
  if (width < 600) await option.click();
  else await composer.press("Enter");
  await expect(composer).toHaveValue(`got ore? @${bName} `);
  await expect(dialog.locator("[data-chat-mention-options]")).toHaveCount(0);
  await composer.pressSequentially(`ping ${tag}`);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  const sent = messageRow(dialog, `ping ${tag}`);
  await expect(sent.locator(`[data-chat-mention="${b.player.character.id}"]`)).toHaveText(
    `@${bName}`,
  );
  // The sender's copy is marked, but it does not mention them.
  await expect(sent).not.toHaveAttribute("data-chat-mentions-me", "");

  // B's launcher lights on both tabs.
  await expect(attention(b.page)).toHaveAttribute("data-chat-social-attention", "1");
  await expect(attention(bOther)).toHaveAttribute("data-chat-social-attention", "1");
  await expect(launcher(b.page)).toHaveAccessibleName("Chat, 1 item needs attention");

  // Opening Chat shows the General badge and the message marked as B's, and
  // reading it clears the attention on every tab.
  await bOther.reload();
  await expect(attention(bOther)).toHaveAttribute("data-chat-social-attention", "1");
  const opened = await openChat(b.page);
  const mentioned = messageRow(opened, `ping ${tag}`);
  await expect(mentioned).toHaveAttribute("data-chat-mentions-me", "");
  await expect(mentioned.locator("[data-chat-mention-label]")).toHaveText("Mentions you");
  await expectNoHorizontalOverflow(b.page, opened);
  await captureReviewScreenshot(b.page, `issue-261-mention-received-${width}.png`);
  await expect(attention(b.page)).toHaveCount(0);
  await expect(tab(opened, "General").locator("[data-chat-mention-unread]")).toHaveCount(0);
  await expect(attention(bOther)).toHaveCount(0);
  await bOther.reload();
  await expect(launcher(bOther)).toHaveAttribute("data-realtime-status", "live");
  await expect(attention(bOther)).toHaveCount(0);

  // While B is on Trade, a General mention badges General; reading it clears.
  await tab(opened, "Trade").click();
  await composer.fill(`@${bName.slice(0, 5)}`);
  await dialog.getByRole("option", { name: `@${bName}` }).click();
  await composer.pressSequentially(`again ${tag}`);
  await composer.press("Enter");
  const badge = tab(opened, "General").locator("[data-chat-mention-unread]");
  await expect(badge).toHaveAttribute("data-chat-mention-unread", "1");
  await expect(tab(opened, "General")).toHaveAccessibleName("General, 1 unread mention");
  await tab(opened, "General").click();
  await expect(badge).toHaveCount(0);
  await expect(attention(b.page)).toHaveCount(0);

  await bOther.close();
  await b.context.close();
}

eachWidth(
  "@mentions offer characters in view, light only the mentioned player, and clear when read (#261)",
  mentionJourney,
);

test("a Block turns the sender's public messages into placeholders that reveal nothing, and Unblock restores them (#261)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  await page.setViewportSize(WIDTHS[0]);
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Orla");
  const b = await secondPlayer(page, "Brask");
  const bName = b.player.character.displayName;
  await seedPublic(b.player, `loud noises ${tag}`);

  await openPlay(page, a.character.id);
  const dialog = await openChat(page);
  await messageRow(dialog, `loud noises ${tag}`)
    .getByRole("button", { name: `Actions for ${bName}'s message` })
    .click();
  await dialog
    .getByRole("group", { name: `Actions for ${bName}'s message` })
    .getByRole("button", { name: "Block" })
    .click();
  await dialog
    .locator("[data-safety-block]")
    .getByRole("button", { name: "Block", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(`Blocked ${bName}.`);

  // The row keeps its place: B's name and time, the body replaced.
  const log = dialog.getByRole("log", { name: "General messages" });
  await expect(messageRow(dialog, `loud noises ${tag}`)).toHaveCount(0);
  const placeholder = log.locator("[data-chat-redacted]", { hasText: bName });
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toContainText("Message hidden — blocked player");
  await expect(placeholder.getByRole("button")).toHaveCount(0);
  await placeholder.click();
  await expect(log).not.toContainText(`loud noises ${tag}`);

  // A live message from B arrives as a placeholder too, never as text.
  await openPlay(b.page, b.player.character.id);
  const bDialog = await openChat(b.page);
  const bComposer = bDialog.locator('[data-chat-composer="general"] textarea');
  await bComposer.fill(`still talking ${tag}`);
  await bComposer.press("Enter");
  await expect(messageRow(bDialog, `still talking ${tag}`)).toHaveCount(1);
  await expect(log.locator("[data-chat-redacted]", { hasText: bName })).toHaveCount(2);
  await expect(log).not.toContainText(`still talking ${tag}`);
  // B is never told.
  await expect(bDialog).not.toContainText(/blocked|hidden/i);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "issue-261-blocked-placeholder-393.png");

  // Unblocking restores both messages in place.
  await tab(dialog, "Whispers").click();
  await dialog.getByRole("button", { name: "Blocked players" }).click();
  await dialog.getByRole("button", { name: `Unblock ${bName}` }).click();
  await expect(dialog.getByRole("status")).toHaveText(`Unblocked ${bName}.`);
  await tab(dialog, "General").click();
  await expect(messageRow(dialog, `loud noises ${tag}`)).toHaveCount(1);
  await expect(messageRow(dialog, `still talking ${tag}`)).toHaveCount(1);
  await expect(log.locator("[data-chat-redacted]", { hasText: bName })).toHaveCount(0);
  await b.context.close();
});

test("Hide removes a Whisper conversation from one side's list until the next Whisper or a reopen (#261)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  await page.setViewportSize(WIDTHS[0]);
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Imke");
  const b = await secondPlayer(page, "Corvin");
  const aName = a.character.displayName;
  const bName = b.player.character.displayName;
  // An unread Whisper from B, written directly.
  const [conversation] = await db
    .insert(rune.whisperConversations)
    .values({ participantKey: whisperParticipantKey(a.character.id, b.player.character.id) })
    .returning();
  await db.insert(rune.whisperParticipants).values([
    {
      conversationId: conversation!.id,
      characterId: a.character.id,
      playerAccountId: a.character.playerAccountId,
    },
    {
      conversationId: conversation!.id,
      characterId: b.player.character.id,
      playerAccountId: b.player.character.playerAccountId,
      lastReadSeq: Number.MAX_SAFE_INTEGER,
    },
  ]);
  await db.insert(rune.chatMessages).values({
    channel: "whisper",
    conversationId: conversation!.id,
    senderPlayerAccountId: b.player.character.playerAccountId,
    senderCharacterId: b.player.character.id,
    senderCharacterName: bName,
    body: `first word ${tag}`,
    createdAt: new Date(Date.now() - 60_000),
  });

  await openPlay(page, a.character.id);
  const dialog = await openChat(page);
  await tab(dialog, "Whispers").click();
  const row = dialog.locator(`[data-whisper-conversation="${b.player.character.id}"]`);
  await row.click();
  await expect(messageRow(dialog, `first word ${tag}`)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Hide", exact: true }).click();

  // Back on the list: the conversation is gone, its unread cleared, and the
  // way back is explained.
  await expect(dialog.locator("[data-whisper-inbox]")).toContainText(
    `Hid your conversation with ${bName}.`,
  );
  await expect(row).toHaveCount(0);
  await expect(attention(page)).toHaveCount(0);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "issue-261-whisper-hidden-393.png");

  // B's side is unchanged.
  await openPlay(b.page, b.player.character.id);
  const bDialog = await openChat(b.page);
  await tab(bDialog, "Whispers").click();
  await bDialog.locator(`[data-whisper-conversation="${a.character.id}"]`).click();
  await expect(messageRow(bDialog, `first word ${tag}`)).toHaveCount(1);

  // B's next Whisper brings it back for A, live, with only the new one unread.
  const bComposer = bDialog.locator('[data-chat-composer="whisper"] textarea');
  await bComposer.fill(`you there? ${tag}`);
  await bComposer.press("Enter");
  await expect(messageRow(bDialog, `you there? ${tag}`)).toHaveCount(1);
  await expect(row).toHaveAttribute("data-whisper-unread", "1");
  await row.click();
  await expect(messageRow(dialog, `first word ${tag}`)).toHaveCount(1);
  await expect(messageRow(dialog, `you there? ${tag}`)).toHaveCount(1);

  // Hidden again, starting a Whisper by exact name reopens the same history.
  await dialog.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(row).toHaveCount(0);
  await dialog.getByLabel("Character name").fill(bName);
  await dialog.locator("[data-start-whisper]").getByRole("button", { name: "Whisper" }).click();
  await expect(dialog.getByRole("log", { name: `Whispers with ${bName}` })).toBeVisible();
  await expect(messageRow(dialog, `first word ${tag}`)).toHaveCount(1);
  await dialog.getByRole("button", { name: "All Whispers" }).click();
  await expect(row).toHaveCount(1);
  await expect(bDialog).not.toContainText("Hid your conversation");
  await expect(bDialog.getByRole("heading", { name: new RegExp(aName) })).toBeVisible();
  await b.context.close();
});

test.describe("Chat/Social polish on the public site", () => {
  test("Heads Up is the newest Update, on the homepage, and links Safety & Privacy", async ({
    page,
  }) => {
    expect(getPublishedUpdates()[0]?.slug).toBe("heads-up");
    await page.goto("/updates");
    const newest = page
      .getByRole("list", { name: "Published Updates" })
      .getByRole("listitem")
      .first();
    await expect(newest.getByRole("link", { name: "Heads Up", exact: true })).toHaveAttribute(
      "href",
      "/updates/heads-up",
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Heads Up", level: 2 })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/updates/heads-up");
    await expect(page).toHaveTitle("Heads Up — RuneSpace");
    await expect(
      page.locator("article").getByRole("link", { name: "Safety & Privacy" }),
    ).toHaveAttribute("href", "/wiki/safety-and-privacy");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("News points a returning player at Heads Up", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "runs once");
    const [latest, previous] = getPublishedUpdates();
    expect(latest?.slug).toBe("heads-up");
    const tag = randomUUID().slice(0, 6);
    const { userId, context } = await establishAuthenticatedSession(
      browser,
      `News ${tag}`,
      `polish-news-${tag}-${randomUUID().slice(0, 8)}@example.com`,
    );
    users.push(userId);
    try {
      const created = await createCharacterForUser(
        db,
        rune,
        ownership,
        characters,
        userId,
        `Newsy ${tag}`,
        PORTRAIT_IDS.evaSalvageWelder,
        { seedLegacyStarterCutter: false },
      );
      // Everything before Heads Up is already read, so only it is news.
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
          .getByRole("link", { name: "Heads Up", exact: true }),
      ).toBeVisible();
      await openTestCharacter(page, created.id);
      await expect(banner.getByRole("button", { name: "News", exact: true })).toBeVisible();
      await expect(banner.getByRole("button", { name: /unread/i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
