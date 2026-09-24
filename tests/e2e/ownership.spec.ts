import { expect, test } from "@playwright/test";
import { registerVerifiedAccount, uniquePlayerName } from "./account-helpers";

/**
 * Player-journey e2e for issue #6: Better Auth + multi-character ownership.
 *
 * Exercises the full server-authoritative flow against a real running app:
 * register (with email verification, issue #221), create a character, select
 * it, and reach the protected placeholder.
 * Also asserts the ownership boundary — a signed-in user is redirected away from
 * a character id they do not own (the server verifies ownership on every
 * request; another player's id is never revealed).
 *
 * Run locally with a live PostgreSQL:
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... \
 *     pnpm test:e2e ownership
 */

function uniqueEmail() {
  return `player-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

// Unique-per-run character name so the e2e is isolated from any leftover rows
// in a shared database (the temp PostgreSQL used for validation persists).
function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

test("register, create, and select a character; ownership boundary enforced", async ({ page }) => {
  const email = uniqueEmail();
  const password = "sup3r-secret-password";

  // Landing routes to registration.
  await page.goto("/");
  await page.getByRole("link", { name: "Register" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Reserve your place in RuneSpace" }),
  ).toBeVisible();

  // Register and follow the emailed verification link (issue #221), which
  // signs the player in and lands on character selection.
  await registerVerifiedAccount(page, {
    playerName: uniquePlayerName("Captain Test"),
    email,
    password,
  });
  await expect(page.getByText(email)).toBeVisible();

  // Empty slots shown; create a new character.
  await page.getByRole("link", { name: "New character" }).click();
  await expect(page.getByRole("heading", { name: "New character" })).toBeVisible();

  const hero = uniqueName("Star Drifter");
  await page.getByLabel("Character name").fill(hero);
  // Character creation requires a deliberate portrait choice (issue #65).
  await page.getByRole("button", { name: "Station Captain portrait" }).click();
  await page.getByRole("button", { name: "Create character" }).click();

  // Lands on the protected placeholder for the created character.
  await page.waitForURL("**/play/**");
  await expect(page.getByText(hero, { exact: true }).first()).toBeVisible();

  // Back to characters via the play footer: the slot is now occupied with
  // preserved display casing.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Character", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Character" })
    .getByRole("link", { name: "Switch Character" })
    .click();
  await page.waitForURL("**/characters");
  await expect(page.getByText(hero)).toBeVisible();

  // Ownership boundary: a forged/foreign character id redirects away.
  await page.goto("/play/00000000-0000-0000-0000-000000000000");
  await page.waitForURL("**/characters");
});

test("character names are unique after normalization (case-insensitive collision)", async ({
  page,
}) => {
  const email = uniqueEmail();
  const password = "sup3r-secret-password";

  await registerVerifiedAccount(page, {
    playerName: uniquePlayerName("Second Pilot"),
    email,
    password,
  });

  await page.getByRole("link", { name: "New character" }).click();
  const hero = uniqueName("Nova Prime");
  await page.getByLabel("Character name").fill(hero);
  // Character creation requires a deliberate portrait choice (issue #65).
  await page.getByRole("button", { name: "Space Nerd portrait" }).click();
  await page.getByRole("button", { name: "Create character" }).click();
  await page.waitForURL("**/play/**");

  // Return and try to create a differently-cased/whitespaced collision of the
  // SAME per-run base — normalization must still detect the clash.
  await page.goto("/characters/new");
  await page.getByLabel("Character name").fill(`  ${hero.toLowerCase()} `);
  // The deliberately chosen portrait is required to enable the action; the
  // server still refuses the duplicate name (issue #65).
  await page.getByRole("button", { name: "Orbital Botanist portrait" }).click();
  await page.getByRole("button", { name: "Create character" }).click();

  // Stays on the new-character page with a "already taken" error (no redirect).
  await expect(page.getByRole("heading", { name: "New character" })).toBeVisible();
  await expect(page.getByText(/already taken/i)).toBeVisible();
});
