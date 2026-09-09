import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { cleanupTestUser } from "../integration/fixtures";
import { establishAuthenticatedSession, expect, test } from "./fixtures";

/**
 * Isolated Sign-out check (Issue #52).
 *
 * Signing out revokes the server-side session, so it is deliberately NOT part
 * of the shared serial mining fixture (whose CI retries would reuse an invalid
 * session). This spec's actual contract is the authenticated header's Sign
 * out control, not the registration form, so its session comes from
 * `establishAuthenticatedSession` rather than the real `/register` HTTP flow
 * — see that helper's docstring for why: Better Auth's default sign-up/sign-in
 * rate limit is a small budget shared across every concurrently running spec
 * on this one local test run, and the registration form itself is already
 * covered by its own dedicated journey.
 */

function uniqueEmail() {
  return `signout-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("Sign out from the authenticated header returns to the signed-out landing", async ({
  browser,
}) => {
  const { context, userId } = await establishAuthenticatedSession(
    browser,
    "Sign-out Fixture",
    uniqueEmail(),
  );
  try {
    const page = await context.newPage();
    await page.goto("/characters");
    await page.waitForURL(/\/characters$/);
    await page.getByRole("link", { name: "New character" }).click();
    const characterName = `Signout ${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`;
    await page.getByLabel("Character name").fill(characterName);
    // Character creation requires a deliberate portrait choice (issue #65).
    await page.getByRole("button", { name: "Cargo Pilot portrait" }).click();
    await page.getByRole("button", { name: "Create character" }).click();
    await expect(page.getByRole("img", { name: "RuneSpace" })).toBeVisible();

    // The control is present inside the single header panel beside the brand.
    const signOut = page.getByRole("banner").getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();

    // Activating it clears the session and returns to the signed-out landing.
    await signOut.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  } finally {
    await context.close();
    await cleanupTestUser(db, authSchema, rune, userId);
  }
});
