import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser } from "../integration/fixtures";
import { establishAuthenticatedSession, expect, openTestCharacter, test } from "./fixtures";
import { populationDisclosure } from "./population-disclosure";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #247 — Whispers, Block, and Report inside the Chat/Social Drawer and
 * from the same-location profile, in a real browser at phone and desktop
 * widths, with two real accounts on two browser contexts.
 *
 * PostgreSQL coverage owns the rules (identity, shared budget, unread
 * arithmetic, Block scope and non-disclosure, evidence windows, dedupe, and
 * retention). This proves what only a browser can: a Whisper starts from a
 * chat sender and from a profile without leaving Play, arrives live with
 * unread on the launcher and the Whispers tab, reading clears unread on the
 * account's other tab, the Block / Report / Report + Block paths are obvious
 * and work, a blocked player's public messages disappear for the blocker only,
 * and Blocked Players can unblock — all without horizontal overflow.
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
    `whisper-${tag}-${randomUUID().slice(0, 8)}@example.com`,
  );
  users.push(session.userId);
  const cookies = await session.context.cookies();
  await session.context.close();
  await context.clearCookies();
  await context.addCookies(cookies);
  const character = await createCharacterForUser(
    db,
    rune,
    ownership,
    characters,
    session.userId,
    `${label} ${tag}`,
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

const tab = (dialog: Locator, name: "General" | "Trade" | "Whispers") =>
  dialog.getByRole("tab", { name: new RegExp(`^${name}`) });

function messageRow(dialog: Locator, text: string) {
  return dialog.locator("[data-chat-message]", { hasText: text });
}

async function openMessageActions(dialog: Locator, sender: string, text: string) {
  await messageRow(dialog, text)
    .getByRole("button", { name: `Actions for ${sender}'s message` })
    .click();
}

async function whisperComposer(dialog: Locator) {
  const composer = dialog.locator('[data-chat-composer="whisper"] textarea');
  await expect(composer).toBeVisible();
  return composer;
}

async function sendWhisper(dialog: Locator, text: string) {
  const composer = await whisperComposer(dialog);
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(messageRow(dialog, text)).toHaveCount(1);
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

async function whisperJourney(page: Page, width: number) {
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Wren");
  const b = await secondPlayer(page, "Tamsin");
  const aName = a.character.displayName;
  const bName = b.player.character.displayName;
  await seedPublic(b.player, `anyone selling ore ${tag}`);

  // B is online on two tabs of the same character.
  await openPlay(b.page, b.player.character.id);
  const bOther = await b.context.newPage();
  await openPlay(bOther, b.player.character.id);

  // A starts a Whisper from a chat sender in General, without leaving Play.
  await openPlay(page, a.character.id);
  const playUrl = page.url();
  const dialog = await openChat(page);
  await expect(messageRow(dialog, `anyone selling ore ${tag}`)).toHaveCount(1);
  await openMessageActions(dialog, bName, `anyone selling ore ${tag}`);
  const actions = dialog.getByRole("group", { name: `Actions for ${bName}'s message` });
  await expect(actions.getByRole("button", { name: "Whisper" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Report" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Block" })).toBeVisible();
  await actions.getByRole("button", { name: "Whisper" }).click();
  await expect(tab(dialog, "Whispers")).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("log", { name: `Whispers with ${bName}` })).toBeVisible();
  const long = `${"x".repeat(60)}${tag}${"y".repeat(60)}`;
  await sendWhisper(dialog, `got 40 shale ${tag}`);
  await sendWhisper(dialog, long);
  expect(page.url()).toBe(playUrl);

  // B's launcher and both tabs show durable unread, delivered live.
  for (const tabPage of [b.page, bOther]) {
    await expect(launcher(tabPage)).toHaveAttribute("aria-label", "Chat, 2 items need attention");
  }
  const bDialog = await openChat(b.page);
  await expect(tab(bDialog, "Whispers")).toHaveAccessibleName("Whispers, 2 unread");
  await tab(bDialog, "Whispers").click();
  const entry = bDialog.getByRole("button", { name: `${aName}, 2 unread` });
  await expect(entry).toBeVisible();
  await expectNoHorizontalOverflow(b.page, bDialog);
  await captureReviewScreenshot(b.page, `issue-247-whisper-inbox-${width}.png`);
  await entry.click();
  await expect(messageRow(bDialog, `got 40 shale ${tag}`)).toHaveCount(1);
  await expect(messageRow(bDialog, long)).toHaveCount(1);
  await expectNoHorizontalOverflow(b.page, bDialog);

  // Reading on one tab clears unread there and on the other tab.
  await expect(launcher(b.page)).toHaveAttribute("aria-label", "Chat");
  await expect(launcher(bOther)).toHaveAttribute("aria-label", "Chat");
  await bOther.close();

  // B replies; A sees it live, once, in the open conversation.
  await sendWhisper(bDialog, `deal ${tag}`);
  await expect(messageRow(dialog, `deal ${tag}`)).toHaveCount(1);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, `issue-247-whisper-conversation-${width}.png`);

  // Closing returns to the same Play state.
  await dialog.getByRole("button", { name: "Close chat" }).click();
  await expect(dialog).toHaveCount(0);
  expect(page.url()).toBe(playUrl);

  // A Whisper also starts from the same-location profile (Nearby Players).
  await populationDisclosure(page).click();
  await page.getByRole("button", { name: new RegExp(`^${bName},`) }).click();
  const profileActions = page.getByRole("group", { name: `Interact with ${bName}` });
  await profileActions.getByRole("button", { name: "Whisper" }).click();
  const reopened = page.getByRole("dialog", { name: "Chat" });
  await expect(reopened.getByRole("log", { name: `Whispers with ${bName}` })).toBeVisible();
  await expect(messageRow(reopened, `deal ${tag}`)).toHaveCount(1);
  expect(page.url()).toBe(playUrl);
  await reopened.getByRole("button", { name: "Close chat" }).click();
  await populationDisclosure(page).click();
  await b.context.close();
}

eachWidth(
  "a Whisper starts from a chat sender or a profile, arrives live, and reads clear unread everywhere",
  whisperJourney,
);

test("Block hides the blocked account's public messages for the blocker only, stops Whispers, and unblocks", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  await page.setViewportSize(WIDTHS[0]);
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Orla");
  const b = await secondPlayer(page, "Brask");
  const aName = a.character.displayName;
  const bName = b.player.character.displayName;
  await seedPublic(b.player, `loud noises ${tag}`);
  // An earlier Whisper from B, so history exists before the Block.
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(rune.whisperConversations)
      .values({
        participantKey: [a.character.id, b.player.character.id].sort().join(":"),
      })
      .returning();
    await tx.insert(rune.whisperParticipants).values([
      {
        conversationId: conversation!.id,
        characterId: a.character.id,
        playerAccountId: a.character.playerAccountId,
        lastReadSeq: Number.MAX_SAFE_INTEGER,
      },
      {
        conversationId: conversation!.id,
        characterId: b.player.character.id,
        playerAccountId: b.player.character.playerAccountId,
      },
    ]);
    await tx.insert(rune.chatMessages).values({
      channel: "whisper",
      conversationId: conversation!.id,
      senderPlayerAccountId: b.player.character.playerAccountId,
      senderCharacterId: b.player.character.id,
      senderCharacterName: bName,
      body: `before the block ${tag}`,
      createdAt: new Date(Date.now() - 60_000),
    });
  });

  await openPlay(page, a.character.id);
  const dialog = await openChat(page);
  await openMessageActions(dialog, bName, `loud noises ${tag}`);
  await dialog
    .getByRole("group", { name: `Actions for ${bName}'s message` })
    .getByRole("button", { name: "Block" })
    .click();
  const confirm = dialog.locator("[data-safety-block]");
  await expect(confirm.getByRole("heading", { name: `Block ${bName}?` })).toBeFocused();
  await expect(confirm).toContainText("They won't be told.");
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "issue-247-block-confirm-393.png");
  await confirm.getByRole("button", { name: "Block", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(`Blocked ${bName}.`);
  await expect(messageRow(dialog, `loud noises ${tag}`)).toHaveCount(0);

  // B still sees their own message, and is never told.
  await openPlay(b.page, b.player.character.id);
  const bDialog = await openChat(b.page);
  await expect(messageRow(bDialog, `loud noises ${tag}`)).toHaveCount(1);
  await tab(bDialog, "Whispers").click();
  await bDialog.getByRole("button", { name: new RegExp(`^${aName}`) }).click();
  await expect(messageRow(bDialog, `before the block ${tag}`)).toHaveCount(1);
  const composer = await whisperComposer(bDialog);
  await composer.fill(`hello? ${tag}`);
  await composer.press("Enter");
  await expect(bDialog.getByRole("alert")).toHaveText("Your Whisper couldn't be delivered.");
  await expect(bDialog).not.toContainText(/blocked/i);
  await expect(messageRow(bDialog, `hello? ${tag}`)).toHaveCount(0);

  // A keeps the history, cannot Whisper, and manages the Block.
  await tab(dialog, "Whispers").click();
  const conversation = dialog.getByRole("button", { name: new RegExp(`^${bName}`) });
  await expect(conversation).toContainText("Blocked");
  await conversation.click();
  await expect(messageRow(dialog, `before the block ${tag}`)).toHaveCount(1);
  await expect(dialog.locator("[data-whisper-blocked]")).toContainText(
    `You blocked ${bName}. Unblock them to send a Whisper.`,
  );
  await expect(dialog.locator('[data-chat-composer="whisper"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "All Whispers" }).click();
  await dialog.getByRole("button", { name: "Blocked players" }).click();
  const blocked = dialog.locator("[data-blocked-players]");
  await expect(blocked.locator(`[data-blocked-player="${b.player.character.id}"]`)).toContainText(
    bName,
  );
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "issue-247-blocked-players-393.png");
  await blocked.getByRole("button", { name: `Unblock ${bName}` }).click();
  await expect(blocked.getByRole("status")).toHaveText(`Unblocked ${bName}.`);
  await expect(blocked).toContainText("You haven't blocked anyone.");

  // Unblocking restores the public message.
  await tab(dialog, "General").click();
  await expect(messageRow(dialog, `loud noises ${tag}`)).toHaveCount(1);
  const events = await db
    .select({ kind: rune.playerBlockEvents.kind })
    .from(rune.playerBlockEvents)
    .where(eq(rune.playerBlockEvents.blockerPlayerAccountId, a.character.playerAccountId));
  expect(events.map((event) => event.kind).sort()).toEqual(["block", "unblock"]);
  await b.context.close();
});

test("Report Message, Report + Block from a Whisper, and Report Player from a profile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  await page.setViewportSize(WIDTHS[1]);
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(page.context().browser()!, page.context(), "Idris");
  const b = await secondPlayer(page, "Vex");
  const bName = b.player.character.displayName;
  await seedPublic(b.player, `cheap cells dm me ${tag}`);

  await openPlay(page, a.character.id);
  const dialog = await openChat(page);

  // Report Message: a reason and an optional note.
  await openMessageActions(dialog, bName, `cheap cells dm me ${tag}`);
  await dialog
    .getByRole("group", { name: `Actions for ${bName}'s message` })
    .getByRole("button", { name: "Report" })
    .click();
  const form = dialog.locator("[data-safety-report]");
  await expect(form.getByRole("heading", { name: "Report message" })).toBeFocused();
  const send = form.getByRole("button", { name: "Send report" });
  await expect(send).toBeDisabled();
  for (const reason of [
    "Harassment or hate",
    "Threats",
    "Spam or scam",
    "Sexual or inappropriate",
    "Offensive name or profile",
    "Other",
  ]) {
    await expect(form.getByRole("radio", { name: reason })).toBeVisible();
  }
  await form.getByRole("radio", { name: "Spam or scam" }).check();
  await form.getByLabel("Note (optional)").fill(`phishing link ${tag}`);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "issue-247-report-form-1280.png");
  await send.click();
  await expect(dialog.getByRole("status")).toHaveText("Report sent. RuneSpace will review it.");
  const [report] = await db
    .select()
    .from(rune.playerReports)
    .where(eq(rune.playerReports.reporterPlayerAccountId, a.character.playerAccountId));
  expect(report).toMatchObject({
    kind: "message",
    reason: "spam_scam",
    note: `phishing link ${tag}`,
    reportedCharacterId: b.player.character.id,
  });
  // Reporting alone never blocks: the message is still here.
  await expect(messageRow(dialog, `cheap cells dm me ${tag}`)).toHaveCount(1);

  // The same message again is recognised, not stored twice.
  await openMessageActions(dialog, bName, `cheap cells dm me ${tag}`);
  await dialog
    .getByRole("group", { name: `Actions for ${bName}'s message` })
    .getByRole("button", { name: "Report" })
    .click();
  await form.getByRole("radio", { name: "Other" }).check();
  await form.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByRole("status")).toHaveText("You've already reported this message.");

  // B has no Whispers yet, and starts one from A's same-location profile.
  await openPlay(b.page, b.player.character.id);
  const bDialog = await openChat(b.page);
  await tab(bDialog, "Whispers").click();
  await expect(bDialog).toContainText("No Whispers yet.");
  await bDialog.getByRole("button", { name: "Close chat" }).click();
  await populationDisclosure(b.page).click();
  await b.page.getByRole("button", { name: new RegExp(`^${a.character.displayName},`) }).click();
  await b.page
    .getByRole("group", { name: `Interact with ${a.character.displayName}` })
    .getByRole("button", { name: "Whisper" })
    .click();
  const bChat = b.page.getByRole("dialog", { name: "Chat" });
  await sendWhisper(bChat, `pay up or else ${tag}`);

  // Report + Block from that Whisper.

  await tab(dialog, "Whispers").click();
  await dialog.getByRole("button", { name: new RegExp(`^${bName}`) }).click();
  await openMessageActions(dialog, bName, `pay up or else ${tag}`);
  await dialog
    .getByRole("group", { name: `Actions for ${bName}'s message` })
    .getByRole("button", { name: "Report" })
    .click();
  await form.getByRole("radio", { name: "Threats" }).check();
  await form.getByRole("checkbox", { name: `Also block ${bName}` }).check();
  await form.getByRole("button", { name: "Report and block" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    `Report sent. RuneSpace will review it. You've blocked ${bName}.`,
  );
  await expect(dialog.locator("[data-whisper-blocked]")).toBeVisible();
  const whisperReport = await db
    .select()
    .from(rune.playerReports)
    .where(
      and(
        eq(rune.playerReports.reporterPlayerAccountId, a.character.playerAccountId),
        eq(rune.playerReports.channel, "whisper"),
      ),
    );
  expect(whisperReport).toHaveLength(1);
  await dialog.getByRole("button", { name: "Close chat" }).click();

  // Report Player from the same-location profile.
  await populationDisclosure(page).click();
  await page.getByRole("button", { name: new RegExp(`^${bName},`) }).click();
  await page
    .getByRole("group", { name: `Interact with ${bName}` })
    .getByRole("button", { name: "Report" })
    .click();
  const profileForm = page.locator("[data-character-profile-panel] [data-safety-report]");
  await expect(profileForm.getByRole("heading", { name: `Report ${bName}` })).toBeFocused();
  await profileForm.getByRole("radio", { name: "Offensive name or profile" }).check();
  await profileForm.getByRole("button", { name: "Send report" }).click();
  await expect(page.locator("[data-character-profile-panel]").getByRole("status")).toHaveText(
    "Report sent. RuneSpace will review it.",
  );
  await expectNoHorizontalOverflow(page);
  const playerReports = await db
    .select()
    .from(rune.playerReports)
    .where(
      and(
        eq(rune.playerReports.reporterPlayerAccountId, a.character.playerAccountId),
        eq(rune.playerReports.kind, "player"),
      ),
    );
  expect(playerReports).toMatchObject([{ reason: "offensive_name_profile", evidence: null }]);
  await b.context.close();
});
