import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characters as charactersTable, playerAccounts } from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { normalizeCharacterName } from "@/game/domain/character-name";
import { ADMIN_USER_ID, seedAdminOperator, seedNonAdminUser } from "./admin-session";

const FIXTURE_CHARACTER = "Operator Probe GADGET";

/**
 * Admin / Operator Console E2E (Issue #113, guardrail 2).
 *
 * Deterministic session bootstrap is PROVEN at the PostgreSQL integration layer
 * (`tests/integration/admin-session-proof.test.ts`): we seed a fixed admin user
 * + credential account and Better Auth authenticates those credentials (real
 * session, no user.id mutation). Here we seed the same fixed admin, sign in
 * through the real `/sign-in` UI (so Better Auth issues + signs the session
 * cookie natively), and exercise the console.
 *
 * Only runs when the server allowlist is configured (the canonical runner sets
 * `RUNESPACE_ADMIN_USER_IDS`); the quick `test:e2e` command skips it.
 */
test.describe("admin operator console", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");

  test.beforeAll(async () => {
    await seedAdminOperator();

    // Give the admin one inspectable character so the console has something
    // deterministic to search for. We seed the account -> character rows via the
    // shared Drizzle schema (NOT via `@/server/*`, which pulls the Better Auth
    // instance into the Playwright process and trips its strip-only TypeScript
    // transpiler). The running server's protective seam lazily provisions
    // gameplay state when the inspector loads.
    const existingAccounts = await db
      .select({ id: playerAccounts.id })
      .from(playerAccounts)
      .where(eq(playerAccounts.userId, ADMIN_USER_ID));
    let accountId = existingAccounts[0]?.id;
    if (!accountId) {
      const [created] = await db
        .insert(playerAccounts)
        .values({ userId: ADMIN_USER_ID })
        .returning({ id: playerAccounts.id });
      accountId = created.id;
    }

    const normalized = normalizeCharacterName(FIXTURE_CHARACTER);
    const existingCharacters = await db
      .select({ id: charactersTable.id })
      .from(charactersTable)
      .where(eq(charactersTable.normalizedName, normalized));
    if (!existingCharacters.length) {
      await db.insert(charactersTable).values({
        playerAccountId: accountId,
        slot: 1,
        displayName: FIXTURE_CHARACTER,
        normalizedName: normalized,
        portraitId: PORTRAIT_IDS.evaSalvageWelder,
      });
    }
  });

  async function login(page: import("@playwright/test").Page) {
    const seeded = await seedAdminOperator();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(seeded.email);
    await page.getByLabel("Password", { exact: true }).fill(seeded.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Wait for the sign-in to complete before visiting /admin. Better Auth's
    // sign-in navigates away from /sign-in and sets the session cookie; an
    // immediate navigation can otherwise abort the in-flight POST. We wait for
    // the URL to leave /sign-in (the exact post-login target can vary).
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 10000,
    });
  }

  /** Search the fixture character and open its inspector from the search page. */
  async function openInspector(page: import("@playwright/test").Page) {
    await page.goto("/admin/characters");
    await page.getByLabel("Character name").fill(FIXTURE_CHARACTER);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText(FIXTURE_CHARACTER, { exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "State snapshot" })).toBeVisible();
  }

  test("admin can sign in and open a character inspector", async ({ page }) => {
    await login(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
    await openInspector(page);
    await expect(page.getByText("Operator audit history").first()).toBeVisible();
  });

  test("admin can SET LOCATION and the mutation is audited", async ({ page }) => {
    await login(page);
    await openInspector(page);

    const audit = page.getByTestId("admin-audit-list");
    const auditCount = await audit.locator("li").count();

    // The fixture spawns at the crash site; teleporting to The Jag is a real
    // mutation (already there would be a "no change" no-op instead).
    await page.getByLabel(/TELEPORT \/ SET LOCATION/i).selectOption({ value: "the_jag" });
    await page.getByRole("button", { name: "Teleport here" }).click();
    await expect(page.getByText(/teleported to/i).first()).toBeVisible({ timeout: 8000 });

    await expect(audit.locator("li")).toHaveCount(auditCount + 1, { timeout: 8000 });
  });

  test("an AUTHENTICATED NON-ADMIN is denied the console (safe 403, not sign-in, not console)", async ({
    page,
  }) => {
    // Seed a real non-admin Better Auth user and sign in through the real
    // /sign-in UI, so the browser holds a genuine, non-admin session cookie.
    const seeded = await seedNonAdminUser();
    await seedAdminOperator();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(seeded.email);
    await page.getByLabel("Password", { exact: true }).fill(seeded.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 10000,
    });

    // Visiting /admin as an authenticated non-admin must render the safe 403
    // Forbidden page — never the console, and never a redirect to /sign-in
    // (which would silently appear to log the user out).
    await page.goto("/admin");
    await expect(page.getByText(/403 · Operator console/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeHidden();
    await expect(page).not.toHaveURL(/\/sign-in/);
    // The inspector route is equally denied for a non-admin.
    await page.goto("/admin/characters/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/403 · Operator console/i)).toBeVisible();
  });
});
