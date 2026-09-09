import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { cleanupTestUser } from "../integration/fixtures";
import { establishAuthenticatedSession, expect, test } from "./fixtures";

/**
 * Isolated account-level unread-news check (Issue #156).
 *
 * News read-through is account state, not gameplay state, so — like
 * `signout.spec.ts` — this establishes its own fresh account per run rather
 * than joining the shared serial mining fixture. Its session comes from
 * `establishAuthenticatedSession` rather than the real `/register` HTTP flow
 * — see that helper's docstring for why: this spec's contract is the news
 * indicator, not the registration form, and Better Auth's default sign-up
 * rate limit is a small budget shared across every concurrently running spec
 * on this one local test run.
 *
 * This proves the browser contract that cannot be proven below this layer: a
 * fresh account starts unread (Updates already exist in the
 * repository-authored content), the control is a real navigation to the
 * Updates index that clears the unread state, and the cleared state is
 * shared by a second character under the same account without acknowledging
 * again. The read-through math itself and its persistence are proven at the
 * unit and integration layers.
 */

function uniqueEmail() {
  return `account-news-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

function uniqueCharacterName(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`;
}

async function createCharacter(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("link", { name: "New character" }).click();
  await page.getByLabel("Character name").fill(name);
  // Character creation requires a deliberate portrait choice (issue #65).
  await page.getByRole("button", { name: "Cargo Pilot portrait" }).click();
  await page.getByRole("button", { name: "Create character" }).click();
  await expect(page.getByRole("img", { name: "RuneSpace" })).toBeVisible();
}

test("News indicator starts unread, clears through a real navigation, and stays shared across characters", async ({
  browser,
}) => {
  const { context, userId } = await establishAuthenticatedSession(
    browser,
    "Account News Fixture",
    uniqueEmail(),
  );
  try {
    const page = await context.newPage();
    await page.goto("/characters");
    await page.waitForURL(/\/characters$/);

    await createCharacter(page, uniqueCharacterName("News One"));
    const firstCharacterUrl = page.url();

    // A fresh account has never acknowledged news, and the repository already
    // has published Updates, so the control starts unread regardless of which
    // character just entered Play.
    const banner = page.getByRole("banner");
    const unreadNewsButton = banner.getByRole("button", {
      name: "News, unread update available",
      exact: true,
    });
    await expect(unreadNewsButton).toBeVisible();

    // Activating it is a real navigation to the Updates index (not a modal or
    // client-only state change), and acknowledges through whatever was newest
    // at that moment.
    await unreadNewsButton.click();
    await expect(page).toHaveURL(/\/updates$/);
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();

    // Returning to the same character's Play page reflects the cleared state.
    await page.goto(firstCharacterUrl);
    await expect(banner.getByRole("button", { name: "News", exact: true })).toBeVisible();
    await expect(banner.getByRole("button", { name: /unread/i })).toHaveCount(0);

    // The boundary is account-level: a second character under the same
    // account sees the already-cleared state without acknowledging again.
    await page.getByRole("link", { name: "Characters" }).click();
    await createCharacter(page, uniqueCharacterName("News Two"));
    await expect(banner.getByRole("button", { name: "News", exact: true })).toBeVisible();
    await expect(banner.getByRole("button", { name: /unread/i })).toHaveCount(0);
  } finally {
    await context.close();
    await cleanupTestUser(db, authSchema, rune, userId);
  }
});
