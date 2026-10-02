import type { BrowserContext, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser } from "../integration/fixtures";
import {
  chatEntry,
  dismissChat,
  establishAuthenticatedSession,
  expect,
  openChatSurface,
  openTestCharacter,
  test,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #246 — General and Trade inside the Chat/Social Drawer, in a real
 * browser at phone and desktop widths.
 *
 * Unit coverage owns the content contract, the budget bands, and feed merging;
 * PostgreSQL coverage owns persistence, the shared account-wide budget, the ad
 * charge and cooldown, retention, and publish-after-commit. This proves what
 * only a browser can: the channels switch inside the Drawer, messages read
 * well without horizontal overflow, the composer's length and rate states are
 * clear and count down with no polling, a promoted ad is distinct and shows in
 * both feeds, older history loads, and a live tab picks up deliveries and
 * catches up after a reconnect without rendering anything twice.
 *
 * The feeds are game-wide and other tests run concurrently, so every journey
 * looks only for its own uniquely tagged messages, and each uses its own fresh
 * account so no earlier journey's sends are in its budget.
 */

type ChatPlayer = {
  userId: string;
  character: { id: string; displayName: string; playerAccountId: string };
};

const players: string[] = [];

test.afterEach(async () => {
  for (const userId of players.splice(0)) await cleanupTestUser(db, authSchema, rune, userId);
});

/**
 * Sign `context` in as a fresh account with one character. The project's own
 * context keeps its device emulation; only its session cookie is replaced.
 */
async function signInFreshPlayer(
  context: BrowserContext,
  options: { credits?: number } = {},
): Promise<ChatPlayer> {
  const tag = randomUUID().slice(0, 6);
  const session = await establishAuthenticatedSession(
    context.browser()!,
    `Chat ${tag}`,
    `chat-${tag}-${randomUUID().slice(0, 8)}@example.com`,
  );
  players.push(session.userId);
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
    `Chat ${tag}`,
    PORTRAIT_IDS.evaSalvageWelder,
    { seedLegacyStarterCutter: false },
  );
  if (options.credits !== undefined) {
    await db
      .update(rune.characters)
      .set({ credits: options.credits })
      .where(eq(rune.characters.id, character.id));
  }
  return { userId: session.userId, character };
}

async function openChat(page: Page, characterId: string) {
  await openTestCharacter(page, characterId);
  // A modal Drawer opened from the floating launcher below desktop width; the
  // docked Chat tab of the right rail (Chat is its home) from 1280px (#286).
  await expect(chatEntry(page)).toHaveAttribute("data-realtime-status", "live");
  const dialog = await openChatSurface(page);
  await expect(dialog.getByRole("tab", { name: "General" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return dialog;
}

const log = (dialog: Locator, channel: "General" | "Trade") =>
  dialog.getByRole("log", { name: `${channel} messages` });

const composer = (dialog: Locator) => dialog.locator("textarea");

async function sendFromComposer(dialog: Locator, text: string) {
  await composer(dialog).fill(text);
  await composer(dialog).press("Enter");
  await expect(composer(dialog)).toHaveValue("");
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

/**
 * Seed durable history directly, oldest first, one second apart. Every row is
 * a send by this account, so they all end a minute ago, outside the rolling
 * send window, leaving the journey's own budget untouched.
 */
async function seedHistory(player: ChatPlayer, channel: "general" | "trade", bodies: string[]) {
  const start = Date.now() - 60_000 - bodies.length * 1_000;
  await db.insert(rune.chatMessages).values(
    bodies.map((body, index) => ({
      channel,
      senderPlayerAccountId: player.character.playerAccountId,
      senderCharacterId: player.character.id,
      senderCharacterName: player.character.displayName,
      body,
      createdAt: new Date(start + index * 1_000),
    })),
  );
}

async function tradeAdJourney(page: Page, context: BrowserContext, width: number) {
  const player = await signInFreshPlayer(context, { credits: 60 });
  const tag = randomUUID().slice(0, 8);
  const dialog = await openChat(page, player.character.id);
  const playUrl = page.url();

  // General: a sent message renders as the player's own, trimmed, in place.
  await sendFromComposer(dialog, `  hello general ${tag}  `);
  const generalLine = log(dialog, "General").locator("[data-chat-message]", {
    hasText: `hello general ${tag}`,
  });
  await expect(generalLine).toHaveCount(1);
  await expect(generalLine).toContainText(player.character.displayName);
  await expect(generalLine).toContainText("(you)");

  // Trade is its own feed inside the same Drawer; nothing navigated.
  await dialog.getByRole("tab", { name: "Trade" }).click();
  await expect(dialog.getByRole("tab", { name: "Trade" })).toHaveAttribute("aria-selected", "true");
  await expect(log(dialog, "Trade").getByText(`hello general ${tag}`)).toHaveCount(0);
  await sendFromComposer(dialog, `WTS shale ${tag}`);
  await expect(log(dialog, "Trade").getByText(`WTS shale ${tag}`)).toBeVisible();
  expect(page.url()).toBe(playUrl);

  // Promote is a latched toggle that names its price before anything is spent.
  // Two sends so far: the ad is the account's third, still within Trade's.
  const promote = dialog.getByRole("button", { name: "Promote" });
  await promote.click();
  await expect(promote).toHaveAttribute("aria-pressed", "true");
  const post = dialog.getByRole("button", { name: "Post ad · 50 Credits" });
  await expect(post).toBeVisible();
  await expect(dialog.locator("[data-chat-promote-note]")).toContainText(
    "Costs 50 Credits (you have 60)",
  );
  await composer(dialog).fill(`Buying Refined Ferrite ${tag}`);
  await post.click();
  await expect(dialog.getByRole("status")).toHaveText("Promoted ad posted to General and Trade.");
  await expect(promote).toHaveAttribute("aria-pressed", "false");

  const tradeAd = log(dialog, "Trade").locator("[data-chat-promoted]", {
    hasText: `Buying Refined Ferrite ${tag}`,
  });
  await expect(tradeAd).toHaveCount(1);
  await expect(tradeAd).toContainText("Promoted ad");
  const adId = await tradeAd.getAttribute("data-chat-message");

  // Distinct but not disruptive: a brighter rim and slightly larger text.
  const ordinary = log(dialog, "Trade").locator("[data-chat-message]", {
    hasText: `WTS shale ${tag}`,
  });
  const size = (row: Locator) =>
    row
      .locator("p")
      .last()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  const ordinarySize = await size(ordinary);
  const adSize = await size(tradeAd);
  expect(adSize).toBeGreaterThan(ordinarySize);
  expect(adSize).toBeLessThanOrEqual(ordinarySize * 1.25);
  expect(await tradeAd.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe(
    "solid",
  );
  await captureReviewScreenshot(page, `issue-246-trade-ad-${width}.png`);

  // The same one record in General.
  await dialog.getByRole("tab", { name: "General" }).click();
  const generalAd = log(dialog, "General").locator(`[data-chat-message="${adId}"]`);
  await expect(generalAd).toHaveCount(1);
  await expect(generalAd).toHaveAttribute("data-chat-promoted", "");
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, `issue-246-general-${width}.png`);

  // The ad spent the Credits, and the account's next ad is cooling down.
  await dialog.getByRole("tab", { name: "Trade" }).click();
  await promote.click();
  await expect(dialog.locator("[data-chat-promote-note]")).toContainText(
    /You can post another promoted ad in (10m 00s|9m \d\ds)\./,
  );
  await expect(dialog.getByRole("button", { name: "Post ad · 50 Credits" })).toBeDisabled();

  // Closing returns to the same Play context.
  await dismissChat(page, dialog);
  expect(page.url()).toBe(playUrl);
}

/**
 * The canonical runner executes the chromium project only, and the feeds are
 * game-wide, so each seeding or multi-send journey runs once, in chromium,
 * and covers the phone and desktop widths itself (like `gameplay-access`).
 */
const WIDTHS = [
  { width: 393, height: 851 },
  { width: 1280, height: 720 },
] as const;

function eachWidth(
  name: string,
  journey: (page: Page, context: BrowserContext, width: number) => Promise<void>,
) {
  test(name, async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "covers both widths from chromium");
    for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      await journey(page, context, viewport.width);
    }
  });
}

eachWidth(
  "General and Trade switch in place, and one promoted ad shows in both feeds",
  tradeAdJourney,
);

test("the composer states its length and rate limits, counting down with no polling", async ({
  page,
  context,
}) => {
  // Width-independent logic, proven at the phone width canonical otherwise
  // never renders.
  await page.setViewportSize(WIDTHS[0]);
  const player = await signInFreshPlayer(context);
  const tag = randomUUID().slice(0, 8);
  const dialog = await openChat(page, player.character.id);
  const send = dialog.getByRole("button", { name: "Send" });
  const counter = dialog.locator("[data-chat-counter]");
  const pressure = dialog.locator("[data-chat-pressure]");

  // 280 characters is the whole contract, stated rather than silently cut.
  await composer(dialog).fill("x".repeat(281));
  await expect(counter).toHaveText("1 over the 280-character limit");
  await expect(composer(dialog)).toHaveAttribute("aria-invalid", "true");
  await expect(send).toBeDisabled();
  await composer(dialog).fill("x".repeat(280));
  await expect(counter).toHaveText("280/280");
  await expect(send).toBeEnabled();
  await composer(dialog).fill("");
  await expect(send).toBeDisabled();
  await expect(pressure).toHaveAttribute("data-chat-pressure", "clear");

  // From here on, nothing may poll: count every chat read and server action.
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/chat" || request.headers()["next-action"]) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });

  // A long unbroken message wraps inside the Drawer instead of overflowing.
  await sendFromComposer(dialog, `${tag}${"W".repeat(260)}`);
  await expect(log(dialog, "General").getByText(`${tag}WWW`, { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page, dialog);
  await expect(pressure).toHaveAttribute("data-chat-pressure", "low");
  await sendFromComposer(dialog, `two ${tag}`);
  await sendFromComposer(dialog, `three ${tag}`);
  await expect(pressure).toHaveAttribute("data-chat-pressure", "high");
  await expect(pressure).toContainText("3/5 in 10s");

  // The same shared count fills Trade's lower limit: red, disabled, counting.
  await dialog.getByRole("tab", { name: "Trade" }).click();
  await expect(pressure).toHaveAttribute("data-chat-pressure", "full");
  await expect(pressure).toContainText(/Slow down · \d+s/);
  await composer(dialog).fill(`blocked for now ${tag}`);
  await expect(send).toBeDisabled();
  const sendsSoFar = requests.length;

  // The first send ages out locally: Trade reopens, with no request made.
  await expect(pressure).toHaveAttribute("data-chat-pressure", "high", { timeout: 12_000 });
  await expect(send).toBeEnabled();
  expect(requests.slice(sendsSoFar)).toEqual([]);
});

async function otherTabJourney(page: Page, context: BrowserContext) {
  const player = await signInFreshPlayer(context);
  const tag = randomUUID().slice(0, 8);
  const dialog = await openChat(page, player.character.id);
  await dialog.getByRole("tab", { name: "Trade" }).click();
  const pressure = dialog.locator("[data-chat-pressure]");
  await expect(pressure).toHaveAttribute("data-chat-pressure", "clear");

  // A second tab of the same account spends the shared budget.
  const other = await context.newPage();
  const otherDialog = await openChat(other, player.character.id);
  for (const index of [1, 2, 3]) await sendFromComposer(otherDialog, `elsewhere ${index} ${tag}`);
  await expect(otherDialog.locator("[data-chat-pressure]")).toHaveAttribute(
    "data-chat-pressure",
    "high",
  );

  // This tab still believes it is clear until the server answers.
  await composer(dialog).fill(`from this tab ${tag}`);
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Slow down. You can send again in");
  await expect(pressure).toHaveAttribute("data-chat-pressure", "full");
  await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();
  // A refusal keeps the draft and never lands in the feed.
  await expect(composer(dialog)).toHaveValue(`from this tab ${tag}`);
  await expect(log(dialog, "Trade").getByText(`from this tab ${tag}`)).toHaveCount(0);
  await other.close();
}

eachWidth(
  "another tab's sends correct this tab's indicator through the server's refusal",
  otherTabJourney,
);

async function historyJourney(page: Page, context: BrowserContext, width: number) {
  const player = await signInFreshPlayer(context);
  const tag = randomUUID().slice(0, 8);
  const history = Array.from({ length: 55 }, (_, index) => `history ${tag} #${index + 1}`);
  await seedHistory(player, "general", history);

  const dialog = await openChat(page, player.character.id);
  const general = log(dialog, "General");
  // Latest 50 on open: the newest seeded message is there, the oldest not.
  await expect(general.getByText(`history ${tag} #55`, { exact: true })).toBeVisible();
  await expect(general.getByText(`history ${tag} #1`, { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Load older messages" }).click();
  await expect(general.getByText(`history ${tag} #1`, { exact: true })).toHaveCount(1);
  const seeded = await general
    .locator("[data-chat-message]", { hasText: `history ${tag} #` })
    .evaluateAll((rows) => rows.map((row) => row.lastElementChild?.textContent ?? ""));
  expect(seeded).toEqual(history);

  // A message from another tab arrives live, once.
  const other = await context.newPage();
  const otherDialog = await openChat(other, player.character.id);
  await sendFromComposer(otherDialog, `live ${tag}`);
  await expect(general.locator("[data-chat-message]", { hasText: `live ${tag}` })).toHaveCount(1);
  await other.close();

  // A message committed while this tab missed its delivery (written
  // directly, so nothing is published), then the stream ends as its lifetime
  // would: the reconnect re-reads durable history and shows it — once,
  // beside the already-delivered message, which is not duplicated.
  await seedHistory(player, "general", [`missed ${tag}`]);
  await expect(general.getByText(`missed ${tag}`)).toHaveCount(0);
  const reconnect = page.waitForRequest((request) =>
    new URL(request.url()).pathname.startsWith("/api/chat"),
  );
  const closed = await page.request.post("/api/e2e/realtime", {
    data: { characterId: player.character.id },
  });
  expect(closed.status()).toBe(200);
  await reconnect;
  await expect(general.locator("[data-chat-message]", { hasText: `missed ${tag}` })).toHaveCount(1);
  await expect(general.locator("[data-chat-message]", { hasText: `live ${tag}` })).toHaveCount(1);
  expect(
    await general
      .locator("[data-chat-message]")
      .evaluateAll(
        (rows) =>
          new Set(rows.map((row) => row.getAttribute("data-chat-message"))).size === rows.length,
      ),
  ).toBe(true);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, `issue-246-history-${width}.png`);
  await dismissChat(page, dialog);
}

eachWidth(
  "older history loads, deliveries arrive live, and a reconnect catches up once",
  historyJourney,
);
