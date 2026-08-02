import { expect, test } from "@playwright/test";

/**
 * Isolated Sign-out check (Issue #52).
 *
 * Signing out revokes the server-side session, so it is deliberately NOT part
 * of the shared serial mining fixture (whose CI retries would reuse an invalid
 * session). This spec registers its own fresh account per run and asserts that
 * the authenticated header's Sign out control returns the player to the
 * signed-out landing.
 */

function uniqueEmail() {
  return `signout-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe.configure({ mode: "serial" });

test("Sign out from the authenticated header returns to the signed-out landing", async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseHost = databaseUrl ? new URL(databaseUrl).hostname : "";
  if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1") {
    throw new Error("Sign-out E2E fixtures require a disposable localhost PostgreSQL database");
  }

  // Register a fresh account and character for this isolated check.
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Sign-out Fixture");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page.getByLabel("Character name").fill(`Sign-out Fixture ${Date.now()}`);
  await page.getByRole("button", { name: "Create character" }).click();
  await expect(page.getByRole("img", { name: "RuneSpace" })).toBeVisible();

  // The control is present beside the brand in the authenticated header.
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();

  // Activating it clears the session and returns to the signed-out landing.
  await signOut.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
