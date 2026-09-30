import type { Browser, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { getPublishedUpdates } from "@/features/public-site/public-updates";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { auth } from "@/server/auth";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import {
  changeSanctionDurationAs,
  issueSanctionAs,
  openModerationCaseAs,
  reverseSanctionAs,
} from "@/server/moderation-seams";
import { reportMessage } from "@/server/player-reports";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "../integration/fixtures";
import { ADMIN_USER_ID, seedAdminOperator, seedNonAdminUser } from "./admin-session";
import { establishAuthenticatedSession, expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #248 — moderation review, sanctions, player notices and appeals, and
 * the published policies, in a real browser with real accounts.
 *
 * PostgreSQL coverage owns the rules (authorization, the access audit, case
 * joining, sanctions on every character, expiry, reversal, appeals). This
 * proves what only a browser can: an operator finds a reported player's case,
 * reads the reported message and its context, loads retained chat on request,
 * and issues a sanction behind a confirmation; the sanctioned player's open
 * Play tab shows the pinned notice and holds Send live, a second character is
 * covered too, and the player reads the notice and appeals it from a phone;
 * the operator decides the appeal and the player is released; a suspension
 * returns the player to Characters with no Play, yet still lets them appeal;
 * a non-admin sees only the 403 page; and the Community Rules, Safety &
 * Privacy, footer links, and the "Open Channels" Update are published.
 *
 * The operator queue, the access log, and the public General feed are shared
 * with concurrent tests, so every journey creates fresh accounts and locates
 * its own case by its subject's uniquely named character and its own tagged
 * messages. The operator session is a real Better Auth session for the fixed
 * allowlisted operator, issued through the server API so the rate-limited
 * sign-in form is not a shared budget (`admin-operator.spec.ts` exercises the
 * form itself).
 */

type Player = {
  userId: string;
  character: { id: string; displayName: string; playerAccountId: string };
};

const users: string[] = [];

test.afterEach(async () => {
  // Newest account first: a subject's cases go before the reporter they name.
  for (const userId of users.splice(0).reverse()) {
    await cleanupTestUser(db, authSchema, rune, userId);
  }
});

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 720 } as const;
const VIEWPORTS = [PHONE, DESKTOP] as const;
type Viewport = (typeof VIEWPORTS)[number];

function baseURL(): string {
  const port = process.env.PLAYWRIGHT_PORT ?? "3000";
  return process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
}

/** Sign in through Better Auth's server API and hand back the session cookie. */
async function sessionCookies(email: string, password: string) {
  const signIn = await auth.api.signInEmail({
    headers: new Headers({ host: new URL(baseURL()).host }),
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = [...parseSetCookieHeader(signIn.headers.get("set-cookie") ?? "").entries()].find(
    ([name, value]) => name.endsWith("session_token") && value.value,
  );
  if (!cookie) throw new Error("Better Auth sign-in did not return a session cookie");
  return [{ name: cookie[0], value: cookie[1].value, url: baseURL() }];
}

/** The fixed allowlisted operator, signed in on their own context. */
async function operator(browser: Browser, viewport: Viewport) {
  const { email, password } = await seedAdminOperator();
  const context = await browser.newContext({ viewport });
  await context.addCookies(await sessionCookies(email, password));
  return { context, page: await context.newPage() };
}

/** A fresh account with one Crash Site character, signed in on its own context. */
async function player(browser: Browser, viewport: Viewport, label: string) {
  const tag = randomUUID().slice(0, 6);
  const session = await establishAuthenticatedSession(
    browser,
    `${label} ${tag}`,
    `moderation-${tag}-${randomUUID().slice(0, 8)}@example.com`,
  );
  users.push(session.userId);
  const cookies = await session.context.cookies();
  await session.context.close();
  const context = await browser.newContext({ viewport });
  await context.addCookies(cookies);
  const created = await newCharacter(session.userId, `${label} ${tag}`);
  return { player: { userId: session.userId, character: created } as Player, context };
}

function newCharacter(userId: string, name: string) {
  return createCharacterForUser(
    db,
    rune,
    ownership,
    characters,
    userId,
    name,
    PORTRAIT_IDS.evaSalvageWelder,
    { seedLegacyStarterCutter: false },
  );
}

/** A reporter who never opens a browser: a fresh account with one character. */
async function reporterAccount(label: string): Promise<Player> {
  const tag = randomUUID().slice(0, 6);
  const userId = await createTestUser(db, authSchema, `${label} ${tag}`);
  users.push(userId);
  return { userId, character: await newCharacter(userId, `${label} ${tag}`) };
}

/**
 * A's report of one of B's public messages, written through the same server
 * call the Report UI uses (`whispers-safety.spec.ts` proves that UI). The
 * neighbours are tagged so the preserved context is recognisable.
 */
async function seedReport(reporter: Player, subject: Player, tag: string) {
  const at = Date.now();
  const message = (who: Player, body: string, agoMs: number) => ({
    channel: "general" as const,
    senderPlayerAccountId: who.character.playerAccountId,
    senderCharacterId: who.character.id,
    senderCharacterName: who.character.displayName,
    body,
    createdAt: new Date(at - agoMs),
  });
  const rows = await db
    .insert(rune.chatMessages)
    .values([
      message(reporter, `did you say something ${tag}`, 180_000),
      message(subject, `nobody wants you here, quit ${tag}`, 120_000),
      message(reporter, `please stop ${tag}`, 60_000),
    ])
    .returning({ id: rune.chatMessages.id, body: rune.chatMessages.body });
  const reported = rows.find((row) => row.body.startsWith("nobody wants you here"))!;
  const result = await reportMessage(reporter.userId, reporter.character.id, {
    messageId: reported.id,
    reason: "harassment_hate",
    note: `keeps following me around ${tag}`,
  });
  expect(result).toMatchObject({ status: "reported" });
  return {
    reportedBody: `nobody wants you here, quit ${tag}`,
    beforeBody: `did you say something ${tag}`,
    afterBody: `please stop ${tag}`,
    note: `keeps following me around ${tag}`,
  };
}

async function expectNoHorizontalOverflow(page: Page, dialog?: Locator) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${page.url()} overflows horizontally`,
  ).toBe(true);
  if (dialog) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
}

// -- Operator Console helpers ------------------------------------------------

/** A labelled form control on the case page (the label wraps the control). */
function control(scope: Locator, label: RegExp, kind: "select" | "textarea" = "select") {
  return scope.locator("label").filter({ hasText: label }).locator(kind);
}

/** Press a ConfirmAction: the first press arms it, the second commits. */
async function confirm(scope: Locator, name: string) {
  const button = scope.getByRole("button", { name, exact: true });
  await button.click();
  await scope.getByRole("button", { name, exact: true }).click();
}

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** Open the queue from the console home and return the card for a subject. */
async function findCase(admin: Page, subjectName: string, filter?: "Appeals") {
  await admin.goto("/admin");
  await admin.getByRole("link", { name: "Moderation queue" }).click();
  await expect(admin).toHaveURL(/\/admin\/moderation$/);
  const filters = admin.getByRole("navigation", { name: "Queue filters" });
  for (const name of ["Needs review", "Appeals", "Open", "Reviewed", "Actioned", "Dismissed"]) {
    await expect(filters.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  if (filter) {
    await filters.getByRole("link", { name: new RegExp(`^${filter}`) }).click();
    await expect(admin).toHaveURL(/filter=appeals/);
  }
  return admin
    .getByRole("list", { name: "Moderation cases" })
    .getByRole("listitem")
    .filter({ hasText: subjectName });
}

/** The case reference (`MOD-00042`) on a queue card. */
async function referenceOf(card: Locator): Promise<string> {
  const reference = (await card.getByRole("heading", { level: 2 }).innerText()).trim();
  expect(reference).toMatch(/^MOD-\d{5,}$/);
  return reference;
}

const CASE_SECTIONS = [
  "Case",
  "Reported content",
  "Preserved context",
  "Identities",
  "Recent reports against this account",
  "Blocks",
  "Retained chat",
  "Name history",
  "Notes",
  "Sanctions",
  "Case history",
];

/** Issue a sanction from the case page's form and confirm it. */
async function issue(
  admin: Page,
  input: { kind: string; rule: string; duration?: string; done: string },
) {
  const sanctions = region(admin, "Sanctions");
  await control(sanctions, /^Sanction/).selectOption({ label: input.kind });
  await control(sanctions, /^Rule/).selectOption({ label: input.rule });
  if (input.duration) {
    await control(sanctions, /^Duration/).selectOption({ label: input.duration });
  }
  await confirm(sanctions, "Issue sanction");
  await expect(sanctions.getByText(input.done, { exact: true })).toBeVisible();
}

// -- Player helpers ------------------------------------------------------------

const launcher = (page: Page) => page.locator("[data-chat-social-launcher]");

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

const noticeCard = (dialog: Locator) =>
  dialog
    .getByRole("region", { name: "Needs your attention" })
    .getByRole("listitem", { name: "Moderation notice" });

const composer = (dialog: Locator, channel: "general" | "trade") =>
  dialog.locator(`[data-chat-composer="${channel}"]`);

const RESTRICTED = "You have a social restriction. See the notice above.";

/** Type a draft so Send is disabled only by the restriction, never by an empty box. */
async function draft(dialog: Locator, channel: "general" | "trade", text: string) {
  const form = composer(dialog, channel);
  await expect(form).toBeVisible();
  await form.getByRole("textbox").fill(text);
  return form;
}

/** The notice page as the sanctioned player reads it. */
async function expectNoticeFacts(page: Page, reference: string, kind: string, rule: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${kind} · ${reference}`);
  const facts = page.locator("[data-notice-facts]");
  await expect(facts).toContainText(rule);
  await expect(facts).toContainText("Read the Community Rules");
  // The notice never says who reported or reviewed it.
  await expect(page.locator("main")).not.toContainText(/reporter|reported by|moderator:/i);
}

// -- 1. The restriction journey ----------------------------------------------------

for (const viewport of VIEWPORTS) {
  test(`report to restriction to appeal to reversal, at ${viewport.width}px`, async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
    test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");
    const phone = viewport.width === PHONE.width;
    const tag = randomUUID().slice(0, 8);
    const reporter = await reporterAccount("Wren");
    const subject = await player(browser, viewport, "Brask");
    const bName = subject.player.character.displayName;
    const seeded = await seedReport(reporter, subject.player, tag);
    const ops = await operator(browser, viewport);
    const admin = ops.page;

    // B is already in Play with Chat open when the operator acts.
    const play = await subject.context.newPage();
    await openPlay(play, subject.player.character.id);
    const dialog = await openChat(play);
    await expect(noticeCard(dialog)).toHaveCount(0);
    const general = await draft(dialog, "general", `still fine ${tag}`);
    await expect(general.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(dialog.locator("[data-chat-restricted]")).toHaveCount(0);
    await general.getByRole("textbox").fill("");
    // Every player-facing page carries the policies from inside Play.
    const policies = dialog.locator("[data-social-policy-links]");
    await expect(policies.getByRole("link", { name: "Community Rules" })).toHaveAttribute(
      "href",
      "/wiki/community-rules",
    );
    await expect(policies.getByRole("link", { name: "Safety & Privacy" })).toHaveAttribute(
      "href",
      "/wiki/safety-and-privacy",
    );

    // The operator opens the queue and finds B's case among any others.
    const card = await findCase(admin, bName);
    await expect(card).toHaveCount(1);
    const reference = await referenceOf(card);
    await expect(card).toContainText("Player report");
    await expect(card).toContainText("Harassment or hate");
    if (phone) await expectNoHorizontalOverflow(admin);
    await captureReviewScreenshot(admin, `issue-248-queue-${viewport.width}.png`);
    await card.getByRole("link", { name: reference }).click();

    // The case page reads in the required review order.
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(reference);
    await expect(admin.getByRole("heading", { level: 2 })).toHaveText(CASE_SECTIONS);
    const reported = region(admin, "Reported content");
    await expect(reported).toContainText(seeded.reportedBody);
    await expect(reported).toContainText(seeded.note);
    await expect(reported.locator("[data-reported-message]")).toContainText(seeded.reportedBody);
    const context = region(admin, "Preserved context");
    await expect(context).toContainText(seeded.beforeBody);
    await expect(context).toContainText(seeded.reportedBody);
    await expect(context).toContainText(seeded.afterBody);
    const identities = region(admin, "Identities");
    await expect(identities).toContainText(bName);
    await expect(identities).toContainText(reporter.character.displayName);
    await expect(region(admin, "Recent reports against this account")).toContainText(
      "1 report from 1 independent account",
    );
    await expect(region(admin, "Blocks")).toContainText("There is no score.");
    // Nothing is retained-loaded until the operator asks.
    const retained = region(admin, "Retained chat");
    await expect(retained.getByRole("group")).toHaveCount(0);
    await retained
      .getByRole("button", { name: "Load retained General/Trade (±12h)", exact: true })
      .click();
    const publicChat = retained.getByRole("group", { name: "Retained General/Trade" });
    await expect(publicChat).toContainText(seeded.reportedBody);
    await retained
      .getByRole("button", {
        name: "Load retained Whispers between these two accounts (±12h)",
        exact: true,
      })
      .click();
    await expect(retained.getByRole("group", { name: "Retained Whispers" })).toContainText(
      "No retained messages in this window.",
    );
    if (phone) await expectNoHorizontalOverflow(admin);
    await captureReviewScreenshot(admin, `issue-248-case-${viewport.width}.png`);

    // Internal notes and status moves are confirmed, recorded, and visible.
    const notes = region(admin, "Notes");
    await control(notes, /^Note/, "textarea").fill(`first offence in this window ${tag}`);
    await notes.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(notes.getByRole("list", { name: "Case notes" })).toContainText(
      `first offence in this window ${tag}`,
    );
    const header = region(admin, "Case");
    await confirm(header, "Mark Reviewed");
    await expect(header.getByText("Case is now Reviewed.")).toBeVisible();
    await expect(header.getByRole("button", { name: "Mark Reviewed" })).toHaveCount(0);

    // A 7-day Social restriction for Harassment, behind a confirmation.
    const sanctions = region(admin, "Sanctions");
    await control(sanctions, /^Sanction/).selectOption({ label: "Social restriction" });
    await control(sanctions, /^Rule/).selectOption({ label: "Harassment" });
    await control(sanctions, /^Duration/).selectOption({ label: "7 days" });
    await sanctions.getByRole("button", { name: "Issue sanction", exact: true }).click();
    await expect(sanctions).toContainText("Restrict all characters on this account from chat");
    await expect(sanctions).toContainText('It cites "Harassment"');
    await sanctions.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sanctions.getByRole("list", { name: "Case sanctions" })).toHaveCount(0);
    await confirm(sanctions, "Issue sanction");
    await expect(sanctions.getByText("Social restriction issued.", { exact: true })).toBeVisible();
    const sanction = sanctions.getByRole("list", { name: "Case sanctions" }).getByRole("listitem");
    await expect(sanction.getByRole("heading", { name: "Social restriction" })).toBeVisible();
    await expect(sanction).toContainText("In effect");
    await expect(sanction).toContainText("7 days");
    await expect(header).toContainText("Actioned");
    const history = region(admin, "Case history");
    await expect(history).toContainText("Set case status Open → Reviewed.");
    await expect(history).toContainText("Added a case note.");
    await expect(history).toContainText(`Issued Social restriction on ${reference}`);
    if (phone) await expectNoHorizontalOverflow(admin);

    // B's open Play tab shows the pinned notice live, and Send is held.
    await expect(noticeCard(dialog)).toHaveCount(1, { timeout: 15_000 });
    const pinned = noticeCard(dialog);
    await expect(pinned.getByRole("heading", { name: "Moderation notice" })).toBeVisible();
    await expect(pinned).toContainText(`Social restriction · ${reference}`);
    await expect(pinned).toContainText("Harassment");
    await expect(pinned).toContainText("7 days");
    await expect(pinned).toContainText("You can't send General, Trade, or Whisper messages");
    await expect(pinned.getByRole("link", { name: "Details and appeal" })).toBeVisible();
    await expect(pinned.getByRole("link", { name: "Community Rules" })).toHaveAttribute(
      "href",
      "/wiki/community-rules",
    );
    const restrictedGeneral = await draft(dialog, "general", `am i muted ${tag}`);
    await expect(
      restrictedGeneral.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    await expect(restrictedGeneral).toContainText(RESTRICTED);
    await dialog.getByRole("tab", { name: /^Trade/ }).click();
    const restrictedTrade = await draft(dialog, "trade", `wts nothing ${tag}`);
    await expect(restrictedTrade.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect(restrictedTrade).toContainText(RESTRICTED);
    await expectNoHorizontalOverflow(play, dialog);
    await captureReviewScreenshot(play, `issue-248-restricted-chat-${viewport.width}.png`);
    await dialog.getByRole("tab", { name: /^General/ }).click();

    // The restriction is account-wide: a second character is covered too.
    const alt = await newCharacter(subject.player.userId, `Brask Alt ${tag.slice(0, 5)}`);
    const altPlay = await subject.context.newPage();
    await openPlay(altPlay, alt.id);
    const altDialog = await openChat(altPlay);
    await expect(noticeCard(altDialog)).toHaveCount(1);
    const altGeneral = await draft(altDialog, "general", `alt speaking ${tag}`);
    await expect(altGeneral.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect(altGeneral).toContainText(RESTRICTED);
    await altPlay.close();

    // Characters shows the notice prominently; the player can still play.
    const characterList = await subject.context.newPage();
    await characterList.goto("/characters");
    await expect(characterList.getByRole("heading", { name: "Moderation notice" })).toBeVisible();
    await expect(
      characterList.getByRole("link", { name: "View notice and appeal", exact: true }),
    ).toHaveAttribute("href", /^\/moderation\/[0-9a-f-]{36}$/);
    await expect(characterList.getByRole("link", { name: "Moderation notices" })).toHaveAttribute(
      "href",
      "/moderation",
    );
    await expect(characterList.getByRole("link", { name: "Play", exact: true })).toHaveCount(2);
    if (phone) await expectNoHorizontalOverflow(characterList);
    await captureReviewScreenshot(characterList, `issue-248-characters-${viewport.width}.png`);
    await characterList.close();

    // B opens the notice from the pinned card and appeals it.
    const [notice] = await Promise.all([
      subject.context.waitForEvent("page"),
      pinned.getByRole("link", { name: "Details and appeal" }).click(),
    ]);
    await expect(notice).toHaveURL(/\/moderation\/[0-9a-f-]{36}$/);
    const noticeUrl = notice.url();
    await expectNoticeFacts(notice, reference, "Social restriction", "Harassment");
    await expect(notice.getByRole("heading", { name: "Appeal this decision" })).toBeVisible();
    const submit = notice.getByRole("button", { name: "Submit appeal" });
    await expect(submit).toBeDisabled();
    const appealText = `I was replying to a joke, not targeting anyone ${tag}`;
    await notice.getByLabel("Why should we review this?").fill(appealText);
    if (phone) await expectNoHorizontalOverflow(notice);
    await captureReviewScreenshot(notice, `issue-248-notice-${viewport.width}.png`);
    await submit.click();
    const status = notice.locator("[data-appeal-status]");
    await expect(status).toContainText("Appeal submitted. A moderator will read it");
    await expect(status).toContainText("under review");
    await expect(notice.getByRole("heading", { name: "Appeal this decision" })).toHaveCount(0);
    await notice.getByRole("link", { name: "All notices" }).click();
    await expect(
      notice.getByRole("heading", { name: "Moderation notices", level: 1 }),
    ).toBeVisible();
    await expect(notice.locator("[data-moderation-notice]")).toContainText(reference);
    await expect(notice.locator("[data-moderation-notice]")).toContainText("under review");
    if (phone) await expectNoHorizontalOverflow(notice);

    // The operator's Appeals filter shows the case, the appeal, and its text.
    const appealCard = await findCase(admin, bName, "Appeals");
    await expect(appealCard).toHaveCount(1);
    await expect(appealCard).toContainText("Appeal pending");
    await appealCard.getByRole("link", { name: reference }).click();
    const decided = region(admin, "Sanctions");
    await expect(decided).toContainText("Player appeal");
    await expect(decided).toContainText(appealText);
    await control(decided, /^Appeal outcome/).selectOption({ label: "Reverse" });
    await control(decided, /^Internal note/, "textarea").fill(`fair enough ${tag}`);
    await confirm(decided, "Decide appeal");
    // The success line lives in the form, which the refreshed case replaces
    // with the persisted decision, so assert the decision itself.
    await expect(decided).toContainText("Decision: Reversed");
    await expect(decided).toContainText("Reversed");
    if (phone) await expectNoHorizontalOverflow(admin);
    await captureReviewScreenshot(admin, `issue-248-appeal-decided-${viewport.width}.png`);

    // B's notice shows the outcome, and the composer is usable again.
    await notice.goto(noticeUrl);
    await expect(notice.locator("[data-appeal-status]")).toContainText("Appeal decided: Reversed");
    await expect(notice.locator("[data-notice-facts]")).toContainText("Reversed");
    await expect(noticeCard(dialog)).toHaveCount(0, { timeout: 15_000 });
    await expect(dialog.locator("[data-chat-restricted]")).toHaveCount(0);
    const released = await draft(dialog, "general", `back again ${tag}`);
    await expect(released.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await released.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      dialog.locator("[data-chat-message]", { hasText: `back again ${tag}` }),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(play, dialog);

    // Every operator view of this case is in the privileged access log.
    await admin.goto("/admin");
    await admin.getByRole("link", { name: "Privileged access log" }).click();
    await expect(admin).toHaveURL(/\/admin\/moderation\/access-log$/);
    const entries = admin.getByRole("list", { name: "Privileged access entries" });
    const forCase = entries.getByRole("listitem").filter({ hasText: reference });
    for (const kind of [
      "Case detail (reports, preserved evidence, safety signals)",
      "Retained General/Trade chat",
      "Retained Whispers",
    ]) {
      const entry = forCase.filter({ hasText: kind }).first();
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(ADMIN_USER_ID);
      await expect(entry.getByRole("link", { name: reference })).toHaveAttribute(
        "href",
        /^\/admin\/moderation\/[0-9a-f-]{36}$/,
      );
    }
    // The queue view itself is recorded, and so is this page.
    await expect(
      entries
        .getByRole("listitem")
        .filter({ hasText: "Moderation queue (report summaries)" })
        .first(),
    ).toBeVisible();
    if (phone) await expectNoHorizontalOverflow(admin);

    await ops.context.close();
    await subject.context.close();
  });
}

// -- 1b. Phone scrolling with a pinned notice --------------------------------------

/**
 * Put a current social restriction on the account through the operator seams
 * (the journey above proves the console path), so the drawer opens with the
 * pinned notice already there.
 */
async function restrictAccount(subject: Player): Promise<string> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const opened = await openModerationCaseAs(
      tx,
      ADMIN_USER_ID,
      subject.character.id,
      "Phone scrolling check",
      now,
    );
    const issued = await issueSanctionAs(
      tx,
      ADMIN_USER_ID,
      {
        caseId: opened.caseId,
        kind: "social_restriction",
        ruleCategory: "harassment",
        duration: "7d",
      },
      now,
    );
    return issued.sanctionId;
  });
}

/** Enough tagged history to overflow a feed's log several times over. */
function history(sender: Player, channel: "general" | "trade", tag: string, count: number) {
  const at = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    channel,
    senderPlayerAccountId: sender.character.playerAccountId,
    senderCharacterId: sender.character.id,
    senderCharacterName: sender.character.displayName,
    body: `${channel} line ${index + 1} ${tag}`,
    createdAt: new Date(at - (count - index) * 1_000),
  }));
}

/** A long Whisper conversation between two characters, oldest first. */
async function seedWhispers(
  me: Player,
  peer: Player,
  tag: string,
  count: number,
  { unreadForMe = false }: { unreadForMe?: boolean } = {},
) {
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(rune.whisperConversations)
      .values({ participantKey: [me.character.id, peer.character.id].sort().join(":") })
      .returning();
    await tx.insert(rune.whisperParticipants).values([
      {
        conversationId: conversation!.id,
        characterId: me.character.id,
        playerAccountId: me.character.playerAccountId,
        lastReadSeq: unreadForMe ? 0 : Number.MAX_SAFE_INTEGER,
      },
      {
        conversationId: conversation!.id,
        characterId: peer.character.id,
        playerAccountId: peer.character.playerAccountId,
      },
    ]);
    const at = Date.now();
    await tx.insert(rune.chatMessages).values(
      Array.from({ length: count }, (_, index) => {
        const sender = index % 2 === 0 ? peer : me;
        return {
          channel: "whisper",
          conversationId: conversation!.id,
          senderPlayerAccountId: sender.character.playerAccountId,
          senderCharacterId: sender.character.id,
          senderCharacterName: sender.character.displayName,
          body: `whisper line ${index + 1} ${tag}`,
          createdAt: new Date(at - (count - index) * 1_000),
        };
      }),
    );
  });
}

/**
 * One real touch swipe that STARTS over `start` (a chat log), moving the
 * content up by `distance` px (negative: back toward older content), as raw
 * touch events so Chromium's own touch scrolling — latching and scroll
 * chaining included — applies exactly as on a phone.
 */
async function swipeUpFrom(page: Page, start: Locator, distance = 300) {
  const box = await start.boundingBox();
  if (!box) throw new Error("swipe start is not rendered");
  const viewport = page.viewportSize()!;
  // The middle of the part of `start` that is on screen.
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewport.height);
  expect(bottom - top, "the chat log is on screen to start the swipe from").toBeGreaterThan(40);
  const x = Math.round(box.x + box.width / 2);
  const y0 = Math.round((top + bottom) / 2);
  const client = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", y0);
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await touch("touchMove", Math.round(y0 - (distance * step) / steps));
  }
  await touch("touchEnd", y0 - distance);
  await client.detach();
}

/** Whether `target` is fully inside the visible viewport. */
async function onScreen(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  const viewport = page.viewportSize()!;
  return box !== null && box.y >= 0 && box.y + box.height <= viewport.height;
}

/**
 * The review's acceptance: with the pinned notice above it, swiping with the
 * finger over the chat log alone reaches the newest message, the composer,
 * and the panel's footer — no nested-scroll dead end.
 */
async function expectReachableFromLog(
  page: Page,
  dialog: Locator,
  log: Locator,
  newest: Locator,
  composerForm: Locator,
) {
  const footer = dialog.locator("[data-social-policy-links]");
  // A bounded number of swipes; a dead end never gets there.
  for (let swipe = 0; swipe < 8; swipe += 1) {
    if ((await onScreen(page, composerForm)) && (await onScreen(page, footer))) break;
    await swipeUpFrom(page, log);
  }
  await expect
    .poll(() => onScreen(page, composerForm), { message: "composer reachable" })
    .toBe(true);
  await expect.poll(() => onScreen(page, footer), { message: "footer reachable" }).toBe(true);
  await expect(newest).toBeInViewport();
  await expect(composerForm.getByText(RESTRICTED)).toBeVisible();
}

test("a phone player with a pinned notice can scroll General, Trade, and a long Whisper to the end", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  const tag = randomUUID().slice(0, 8);
  const { player: me, context } = await player(browser, PHONE, "Scroller");
  const cookies = await context.cookies();
  await context.close();
  // A phone: touch input and mobile viewport semantics, not only a narrow width.
  const phone = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
  await phone.addCookies(cookies);
  const peer = await reporterAccount("Scroll peer");

  await db
    .insert(rune.chatMessages)
    .values([...history(peer, "general", tag, 60), ...history(peer, "trade", tag, 60)]);
  await seedWhispers(me, peer, tag, 60);
  await restrictAccount(me);

  const page = await phone.newPage();
  await openPlay(page, me.character.id);
  const dialog = await openChat(page);
  await expect(noticeCard(dialog)).toBeVisible();

  for (const channel of ["general", "trade"] as const) {
    if (channel === "trade") await dialog.getByRole("tab", { name: /^Trade/ }).click();
    const log = dialog.locator(`[data-chat-log="${channel}"]`);
    const newest = log.getByText(`${channel} line 60 ${tag}`, { exact: true });
    await expect(newest).toBeVisible();
    // The newest message stays pinned to the bottom of the log (stick-to-bottom).
    await expectReachableFromLog(page, dialog, log, newest, composer(dialog, channel));
    // Reading older history still works from the same log.
    await swipeUpFrom(page, log, -600);
    await expect(log.getByRole("button", { name: "Load older messages" })).toBeVisible();
    // Back to the top of the panel for the next tab.
    await dialog.evaluate((panel) => panel.scrollTo(0, 0));
  }

  await dialog.getByRole("tab", { name: /^Whispers/ }).click();
  await dialog.getByRole("button", { name: new RegExp(`^${peer.character.displayName}`) }).click();
  const whisperLog = dialog.locator(`[data-whisper-log="${peer.character.id}"]`);
  const newestWhisper = whisperLog.getByText(`whisper line 60 ${tag}`, { exact: true });
  await expect(newestWhisper).toBeVisible();
  await expectReachableFromLog(
    page,
    dialog,
    whisperLog,
    newestWhisper,
    dialog.locator('[data-chat-composer="whisper"]'),
  );
  await expectNoHorizontalOverflow(page, dialog);
  await phone.close();
});

/** The launcher's accessible name: "Chat", or its attention count. */
function launcherName(count: number) {
  if (count === 0) return "Chat";
  return `Chat, ${count} ${count === 1 ? "item needs" : "items need"} attention`;
}

test("a pinned notice lights the launcher until seen, and never clears Whisper unread", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  const tag = randomUUID().slice(0, 8);
  const { player: me, context } = await player(browser, PHONE, "Noticed");
  const peer = await reporterAccount("Notice peer");
  // Two unread Whispers from the peer (four lines, alternating, peer first).
  await seedWhispers(me, peer, tag, 4, { unreadForMe: true });
  const sanctionId = await restrictAccount(me);
  const page = await context.newPage();

  // A new notice asks for attention alongside the unread Whispers.
  await openPlay(page, me.character.id);
  await expect(launcher(page)).toHaveAccessibleName(launcherName(3));

  // Opening Chat/Social presents the notice; closing leaves only the Whispers.
  let dialog = await openChat(page);
  await expect(noticeCard(dialog)).toBeVisible();
  await dialog.getByRole("button", { name: "Close chat" }).click();
  await expect(dialog).toBeHidden();
  await expect(launcher(page)).toHaveAccessibleName(launcherName(2));

  // Seen stays seen on this device across a reload, and the notice stays pinned.
  await page.reload();
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
  await expect(launcher(page)).toHaveAccessibleName(launcherName(2));
  dialog = await openChat(page);
  await expect(noticeCard(dialog)).toBeVisible();

  // Reading the Whispers clears only their unread; the notice is untouched.
  await dialog.getByRole("tab", { name: /^Whispers/ }).click();
  await dialog.getByRole("button", { name: new RegExp(`^${peer.character.displayName}`) }).click();
  await expect(
    dialog.locator(`[data-whisper-log="${peer.character.id}"]`).getByText(`whisper line 4 ${tag}`),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close chat" }).click();
  await expect(launcher(page)).toHaveAccessibleName(launcherName(0));
  dialog = await openChat(page);
  await expect(noticeCard(dialog)).toBeVisible();
  await dialog.getByRole("button", { name: "Close chat" }).click();

  // A changed notice (a new end) is new again.
  await db.transaction((tx) =>
    changeSanctionDurationAs(tx, ADMIN_USER_ID, sanctionId, "30d", new Date()),
  );
  await page.reload();
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
  await expect(launcher(page)).toHaveAccessibleName(launcherName(1));

  // Reversal removes the notice and its card as before.
  await db.transaction((tx) => reverseSanctionAs(tx, ADMIN_USER_ID, sanctionId, new Date()));
  await page.reload();
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
  await expect(launcher(page)).toHaveAccessibleName(launcherName(0));
  dialog = await openChat(page);
  await expect(dialog.getByRole("region", { name: "Needs your attention" })).toHaveCount(0);
  await context.close();
});

// -- 2. Suspension -------------------------------------------------------------

test("a suspension returns the player to Characters with no Play, and they can still appeal", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "two-account journey; runs once");
  test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");
  const tag = randomUUID().slice(0, 8);
  const reporter = await reporterAccount("Isla");
  const subject = await player(browser, PHONE, "Vex");
  const bName = subject.player.character.displayName;
  await seedReport(reporter, subject.player, tag);
  const ops = await operator(browser, PHONE);
  const admin = ops.page;

  // B is in Play when the suspension lands.
  const play = await subject.context.newPage();
  await openPlay(play, subject.player.character.id);

  const card = await findCase(admin, bName);
  await expect(card).toHaveCount(1);
  const reference = await referenceOf(card);
  await card.getByRole("link", { name: reference }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(reference);
  await issue(admin, {
    kind: "Account suspension",
    rule: "Threats or sharing private information",
    duration: "24 hours",
    done: "Account suspension issued.",
  });
  const sanctions = region(admin, "Sanctions");
  const suspension = sanctions.getByRole("list", { name: "Case sanctions" }).getByRole("listitem");
  await expect(suspension).toContainText("In effect");
  await expect(suspension).toContainText("24 hours");

  // The open Play tab's stream is closed and refused on reconnect: it returns
  // to Characters on its own.
  await expect(play).toHaveURL(/\/characters$/, { timeout: 30_000 });
  await expect(play.getByRole("heading", { name: "Moderation notice" })).toBeVisible();
  await expect(
    play.getByText("Your account is suspended.", { exact: false }).first(),
  ).toBeVisible();
  await expect(play.getByRole("link", { name: "Play", exact: true })).toHaveCount(0);
  await expect(play.getByRole("link", { name: "New character" })).toHaveCount(0);
  await expect(play.getByRole("link", { name: "Reserve character" })).toHaveCount(0);
  await expectNoHorizontalOverflow(play);
  await captureReviewScreenshot(play, "issue-248-suspended-characters-390.png");

  // Going straight to Play is refused the same way.
  await play.goto(`/play/${subject.player.character.id}`);
  await expect(play).toHaveURL(/\/characters$/);
  await expect(play.getByRole("link", { name: "Play", exact: true })).toHaveCount(0);

  // The notice and the appeal need only a session, not gameplay.
  await play.getByRole("link", { name: "View notice and appeal", exact: true }).click();
  await expect(play).toHaveURL(/\/moderation\/[0-9a-f-]{36}$/);
  await expectNoticeFacts(
    play,
    reference,
    "Account suspension",
    "Threats or sharing private information",
  );
  await expect(play.locator("[data-notice-facts]")).toContainText("24 hours");
  await expect(play.locator("[data-notice-facts]")).toContainText(
    "You can't enter RuneSpace gameplay",
  );
  await play.getByLabel("Why should we review this?").fill(`wrong person, please check ${tag}`);
  await expectNoHorizontalOverflow(play);
  await play.getByRole("button", { name: "Submit appeal" }).click();
  await expect(play.locator("[data-appeal-status]")).toContainText("under review");

  // The operator lengthens it, then reverses it.
  await admin.reload();
  const again = region(admin, "Sanctions");
  await expect(again).toContainText(`wrong person, please check ${tag}`);
  await control(again, /^New duration/).selectOption({ label: "30 days" });
  await confirm(again, "Change duration");
  await expect(again.getByText("Duration changed.", { exact: true })).toBeVisible();
  await expect(again.getByRole("list", { name: "Case sanctions" })).toContainText("30 days");
  await confirm(again, "Reverse");
  await expect(again.getByText("Account suspension reversed.", { exact: true })).toBeVisible();
  await expect(again.getByRole("list", { name: "Case sanctions" })).toContainText("Reversed");

  // The player is released on the next request: Play is back, the notice stays on record.
  await play.goto("/characters");
  await expect(play.getByRole("link", { name: "Play", exact: true })).toHaveCount(1);
  await expect(play.getByRole("heading", { name: "Moderation notice" })).toHaveCount(0);
  await expect(play.getByRole("link", { name: "Moderation notices" })).toBeVisible();
  await openPlay(play, subject.player.character.id);

  await ops.context.close();
  await subject.context.close();
});

// -- 3. A non-admin --------------------------------------------------------------------

test("an ordinary signed-in player gets only the 403 page on every moderation route", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "runs once");
  test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");
  const tag = randomUUID().slice(0, 8);
  const reporter = await reporterAccount("Ode");
  const subject = await reporterAccount("Kai");
  const seeded = await seedReport(reporter, subject, tag);
  const [moderationCase] = await db
    .select({ id: rune.moderationCases.id, number: rune.moderationCases.caseNumber })
    .from(rune.moderationCases)
    .where(eq(rune.moderationCases.subjectPlayerAccountId, subject.character.playerAccountId));
  expect(moderationCase).toBeDefined();

  // A fixed, never-allowlisted, real Better Auth session.
  const ordinary = await seedNonAdminUser();
  const context = await browser.newContext({ viewport: PHONE });
  await context.addCookies(await sessionCookies(ordinary.email, ordinary.password));
  const page = await context.newPage();
  try {
    for (const path of [
      "/admin/moderation",
      "/admin/moderation?filter=appeals",
      "/admin/moderation/access-log",
      `/admin/moderation/${moderationCase!.id}`,
    ]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/sign-in/);
      await expect(page.getByText(/403 · Operator console/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Reported content" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Issue sanction|Mark Reviewed/ })).toHaveCount(
        0,
      );
      const text = await page.locator("body").innerText();
      expect(text).not.toContain(seeded.reportedBody);
      expect(text).not.toContain(subject.character.displayName);
      expect(text).not.toContain(`MOD-${String(moderationCase!.number).padStart(5, "0")}`);
      await expectNoHorizontalOverflow(page);
    }
  } finally {
    await context.close();
  }

  // Denied views leave no privileged-access row naming the non-admin.
  const rows = await db
    .select({ id: rune.privilegedAccessLogs.id })
    .from(rune.privilegedAccessLogs)
    .where(eq(rune.privilegedAccessLogs.adminUserId, ordinary.userId));
  expect(rows).toHaveLength(0);
});

// -- 4. Published policies and the Update -------------------------------------------------

test.describe("published policies and the Open Channels Update", () => {
  test("Chat & Community Rules publishes the locked copy", async ({ page }) => {
    await page.goto("/wiki/community-rules");
    await expect(page).toHaveTitle("Chat & Community Rules — RuneSpace Wiki");
    await expect(
      page.getByRole("heading", { name: "Chat & Community Rules", level: 1 }),
    ).toBeVisible();
    for (const heading of [
      "Don't target people for who they are",
      "Don't harass people",
      "No threats or real-world intimidation",
      "Don't scam or spam people",
      "Swearing isn't the problem",
      "Use Block and Report",
      "Moderation isn't a game",
      "What happens if you break the rules?",
      "The short version",
    ]) {
      await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
    }
    // It points at the disclosure, and both directions are real links.
    const article = page.locator("article");
    await expect(article.getByRole("link", { name: "Safety & Privacy" }).first()).toHaveAttribute(
      "href",
      "/wiki/safety-and-privacy",
    );
  });

  test("Safety & Privacy states retention, Whisper privacy, and appeals", async ({ page }) => {
    await page.goto("/wiki/safety-and-privacy");
    await expect(page).toHaveTitle("Safety & Privacy — RuneSpace Wiki");
    await expect(page.getByRole("heading", { name: "Safety & Privacy", level: 1 })).toBeVisible();
    const article = page.locator("article");
    await expect(article).toContainText("90 days");
    await expect(article).toContainText("not end-to-end encrypted");
    await expect(
      page.getByRole("heading", { name: "Moderation notices and appeals", level: 2 }),
    ).toBeVisible();
    await expect(article).toContainText("You can appeal each notice once");
    await expect(
      article.getByRole("link", { name: "Chat & Community Rules" }).first(),
    ).toHaveAttribute("href", "/wiki/community-rules");
  });

  test("the Wiki index lists both policies under Community & Safety", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByRole("heading", { name: "Community & Safety", level: 3 })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Community & Safety" }).getByRole("link"),
    ).toHaveText(["Chat & Community Rules", "Safety & Privacy"]);
  });

  test("every public page footer links both policies", async ({ page }) => {
    for (const path of [
      "/",
      "/updates",
      "/wiki",
      "/wiki/getting-started",
      "/updates/open-channels",
    ]) {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(
        footer.getByRole("link", { name: "Community Rules", exact: true }),
      ).toHaveAttribute("href", "/wiki/community-rules");
      await expect(
        footer.getByRole("link", { name: "Safety & Privacy", exact: true }),
      ).toHaveAttribute("href", "/wiki/safety-and-privacy");
    }
    // The footer link is a real navigation.
    await page.goto("/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Community Rules", exact: true })
      .click();
    await expect(page).toHaveURL("/wiki/community-rules");
    await expect(
      page.getByRole("heading", { name: "Chat & Community Rules", level: 1 }),
    ).toBeVisible();
  });

  test("Open Channels is the newest Update and links both policies", async ({ page }) => {
    await page.goto("/updates");
    const listed = page.getByRole("list", { name: "Published Updates" }).getByRole("listitem");
    await expect(
      listed.first().getByRole("link", { name: "Open Channels", exact: true }),
    ).toHaveAttribute("href", "/updates/open-channels");
    await expect(listed.first().getByText("September 30, 2026", { exact: true })).toBeVisible();

    // The homepage's latest-Update section names it too.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Open Channels", level: 2 })).toBeVisible();

    await page.goto("/updates");
    await listed.first().getByRole("link", { name: "Open Channels", exact: true }).click();
    await expect(page).toHaveURL("/updates/open-channels");
    await expect(page).toHaveTitle("Open Channels — RuneSpace");
    await expect(page.getByRole("heading", { name: "Open Channels", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patch notes", level: 2 })).toBeVisible();
    const article = page.locator("article");
    await expect(article.getByRole("link", { name: "Chat & Community Rules" })).toHaveAttribute(
      "href",
      "/wiki/community-rules",
    );
    await expect(article.getByRole("link", { name: "Safety & Privacy" })).toHaveAttribute(
      "href",
      "/wiki/safety-and-privacy",
    );
    await article.getByRole("link", { name: "Safety & Privacy" }).click();
    await expect(page).toHaveURL("/wiki/safety-and-privacy");
  });

  test("the public pages stay contained at 390px with the new footer links", async ({ page }) => {
    await page.setViewportSize(PHONE);
    for (const path of [
      "/",
      "/updates",
      "/updates/open-channels",
      "/wiki",
      "/wiki/community-rules",
      "/wiki/safety-and-privacy",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("contentinfo").getByRole("link", { name: "Community Rules" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("News points a returning player at Open Channels", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "runs once");
    const [latest, previous] = getPublishedUpdates();
    expect(latest?.slug).toBe("open-channels");
    const tag = randomUUID().slice(0, 6);
    const { userId, context } = await establishAuthenticatedSession(
      browser,
      `News ${tag}`,
      `moderation-news-${tag}-${randomUUID().slice(0, 8)}@example.com`,
    );
    users.push(userId);
    try {
      const character = await newCharacter(userId, `Newsy ${tag}`);
      // Everything before Open Channels is already read, so only it is news.
      await db
        .update(rune.playerAccounts)
        .set({ newsReadThroughAt: new Date(previous!.publishedAt) })
        .where(eq(rune.playerAccounts.id, character.playerAccountId));
      const page = await context.newPage();
      await openTestCharacter(page, character.id);
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
          .getByRole("link", { name: "Open Channels", exact: true }),
      ).toBeVisible();
      // Reading it cleared the account's unread state.
      await openTestCharacter(page, character.id);
      await expect(banner.getByRole("button", { name: "News", exact: true })).toBeVisible();
      await expect(banner.getByRole("button", { name: /unread/i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
