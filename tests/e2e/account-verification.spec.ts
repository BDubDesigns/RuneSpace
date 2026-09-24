import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import * as ownership from "@/server/ownership";
import { cleanupTestUser, createLegacyCharacterForUser } from "../integration/fixtures";
import {
  stubTurnstile,
  submitRegistration,
  uniquePlayerName,
  useDistinctClientIp,
  verificationEmailsFor,
  waitForVerificationLink,
} from "./account-helpers";
import { expect, test } from "@playwright/test";
import { establishAuthenticatedSession, grantTestEarlyAccess } from "./fixtures";

/**
 * Soft-alpha registration and email verification (issue #221), through the
 * real forms against the production server:
 *
 * - sign up with a Player name → "Check your email" with the resend cooldown
 *   → the emailed link verifies and signs in → reserve a character;
 * - an unverified account's sign-in is refused without sending mail and
 *   offers the explicit resend, which then observes its cooldown;
 * - a session whose account is unverified cannot reach character creation.
 *
 * Turnstile runs through the gated loopback verifier and mail through the
 * run-scoped outbox (see `account-helpers.ts`). Server-side limits, the
 * forged-action refusal, and uniqueness under concurrency are proved in
 * `tests/integration/account-identity.test.ts`.
 *
 * These journeys start signed out, so they use the plain Playwright `test`
 * rather than the worker-session fixture.
 */

const PASSWORD = "sup3r-secret-password";

function uniqueEmail(label: string) {
  return `verify-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function userIdFor(email: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email));
  return rows[0]?.id;
}

test.describe("account verification", () => {
  const createdUsers: string[] = [];

  test.afterEach(async () => {
    for (const userId of createdUsers.splice(0)) {
      await cleanupTestUser(db, authSchema, rune, userId);
    }
  });

  test("sign up with a Player name, verify from the email, and reserve a character", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = uniqueEmail("journey");
    const playerName = uniquePlayerName("Soft Alpha");
    await submitRegistration(page, { playerName, email, password: PASSWORD });
    const userId = await userIdFor(email);
    if (userId) createdUsers.push(userId);

    // "Check your email": the address, the one-minute resend cooldown, and a
    // disabled resend until it elapses.
    await expect(page.getByText(email)).toBeVisible();
    await expect(
      page.getByText(/You can request another verification email in (1:00|0:[0-5]\d)\./),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeDisabled();
    expect(verificationEmailsFor(email)).toHaveLength(1);
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);

    // The emailed link verifies the address, signs the player in, and lands on
    // character selection.
    await page.goto(await waitForVerificationLink(email));
    await page.waitForURL("**/characters");
    await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();

    // Reserving and entering Play needs gameplay access (issue #223); fixture
    // Early Access keeps this registration journey independent of the global
    // switch. The closed-gate reservation journey is gameplay-access.spec.ts.
    await grantTestEarlyAccess(userId!);
    await page.reload();
    await page.getByRole("link", { name: "New character" }).click();
    const hero = `Reserved ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByLabel("Character name").fill(hero);
    await page.getByRole("button", { name: "Station Captain portrait" }).click();
    await page.getByRole("button", { name: "Create character" }).click();
    await page.waitForURL("**/play/**");
    await expect(page.getByText(hero, { exact: true }).first()).toBeVisible();
  });

  test("an unverified sign-in sends no email and offers the explicit resend with its cooldown", async ({
    page,
  }) => {
    const email = uniqueEmail("unverified");
    await submitRegistration(page, {
      playerName: uniquePlayerName("Unverified"),
      email,
      password: PASSWORD,
    });
    const userId = await userIdFor(email);
    if (userId) createdUsers.push(userId);
    expect(verificationEmailsFor(email)).toHaveLength(1);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Refused without a session or a new email; the resend is offered instead.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(verificationEmailsFor(email)).toHaveLength(1);
    await page.goto("/characters");
    await page.waitForURL("**/sign-in");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    const resend = page.getByRole("button", { name: "Resend verification email" });
    await expect(page.locator("[data-e2e-turnstile=issued]")).toHaveCount(1);
    await expect(resend).toBeEnabled();
    await resend.click();

    await expect(page.getByText("Verification email sent.")).toBeVisible();
    await expect(page.getByText(/You can request another verification email in/)).toBeVisible();
    await expect(resend).toBeDisabled();
    await waitForVerificationLink(email, 2);
    expect(verificationEmailsFor(email)).toHaveLength(2);
  });

  test("an unverified session cannot reach character creation", async ({ browser }) => {
    // A session issued before its account became subject to verification —
    // the shape of a pre-cutover session — must still be gated.
    const { context, userId } = await establishAuthenticatedSession(
      browser,
      "Unverified Session",
      uniqueEmail("session"),
    );
    createdUsers.push(userId);
    await db
      .update(authSchema.user)
      .set({ emailVerified: false })
      .where(eq(authSchema.user.id, userId));
    try {
      const page = await context.newPage();
      await stubTurnstile(page);
      await useDistinctClientIp(page);
      await page.goto("/characters");
      await expect(
        page.getByText("Verify your email address before creating characters."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "New character" })).toHaveCount(0);

      await page.goto("/characters/new");
      await expect(
        page.getByText("Verify your email address before creating characters."),
      ).toBeVisible();
      await expect(page.getByLabel("Character name")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("an unverified account with a saved character sees the verification reminder, not READY FOR ALPHA", async ({
    browser,
  }) => {
    // Issue #223: READY FOR ALPHA belongs only to a verified account waiting
    // for Soft Alpha; an unverified account (for example a pre-cutover one
    // with a saved character) keeps the verification reminder instead.
    const { context, userId } = await establishAuthenticatedSession(
      browser,
      "Unverified Legacy",
      uniqueEmail("legacy"),
      { earlyAccess: false },
    );
    createdUsers.push(userId);
    await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      userId,
      `Legacy ${Math.random().toString(36).slice(2, 8)}`,
      undefined,
      { gameplayAccess: false },
    );
    await db
      .update(authSchema.user)
      .set({ emailVerified: false })
      .where(eq(authSchema.user.id, userId));
    try {
      const page = await context.newPage();
      await useDistinctClientIp(page);
      await page.goto("/characters");
      await expect(
        page.getByText("Verify your email address before creating characters."),
      ).toBeVisible();
      await expect(page.getByText("READY FOR ALPHA", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Play" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
