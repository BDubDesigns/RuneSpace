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

test("Sign out from the authenticated header returns to the signed-out landing", async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseHost = databaseUrl ? new URL(databaseUrl).hostname : "";
  if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1") {
    throw new Error("Sign-out E2E fixtures require a disposable localhost PostgreSQL database");
  }

  // Register a fresh account and character for this isolated check. The
  // character name must stay within the 24-character limit (a longer name is
  // truncated and its truncated timestamp can collide with an earlier run on
  // the shared database), so use a compact base-36 timestamp plus a random
  // digit.
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Sign-out Fixture");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
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
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
