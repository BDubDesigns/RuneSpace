import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as rune from "@/db/rune-space";
import { characters as charactersTable, playerAccounts } from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { normalizeCharacterName } from "@/game/domain/character-name";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { createCharacterForUser, grantFixtureEarlyAccess } from "../integration/fixtures";
import {
  ADMIN_USER_ID,
  NON_ADMIN_USER_ID,
  seedAdminOperator,
  seedNonAdminUser,
} from "./admin-session";
import { openUtility, utilitySurface } from "./fixtures";

const FIXTURE_CHARACTER = "Operator Probe GADGET";
// Two real, provisioned characters on the operator's own account, to prove the
// Character surface's admin link follows the active character (#333).
const TWIN_A = "Shortcut Twin ZEPHYR";
const TWIN_B = "Shortcut Twin QUILL";
// A provisioned character on an ordinary (non-admin) account.
const ORDINARY_CHARACTER = "Ordinary Probe OTTER";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/**
 * Admin / Operator Console E2E (Issue #113, guardrail 2; tabs, full item grants
 * and the Character shortcut in #333).
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
  // This is the one intentional canonical serial exception: every test uses
  // the same fixed admin identity and the process-global allowlist, so the
  // session/bootstrap contract must not overlap within a shard.
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");

  test.beforeAll(async () => {
    await seedAdminOperator();

    // Give the admin one inspectable character so the console has something
    // deterministic to search for. We seed the account -> character rows via the
    // shared Drizzle schema. The running server's protective seam lazily
    // provisions gameplay state when the inspector loads.
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
      if (!created) throw new Error("Admin player account was not created");
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

    // The operator plays their own characters too: gameplay access is an
    // explicit Early Access grant, never implied by operator status.
    await grantFixtureEarlyAccess(db, rune, accountId);
    for (const name of [TWIN_A, TWIN_B]) {
      await ensureProvisionedCharacter(ADMIN_USER_ID, name);
    }
    await seedNonAdminUser();
    await ensureProvisionedCharacter(NON_ADMIN_USER_ID, ORDINARY_CHARACTER);
  });

  async function ensureProvisionedCharacter(userId: string, name: string) {
    const existing = await db
      .select({ id: charactersTable.id })
      .from(charactersTable)
      .where(eq(charactersTable.normalizedName, normalizeCharacterName(name)));
    if (existing[0]) return existing[0].id;
    const created = await createCharacterForUser(db, rune, ownership, characters, userId, name);
    return created.id;
  }

  async function characterIdByName(name: string): Promise<string> {
    const rows = await db
      .select({ id: charactersTable.id })
      .from(charactersTable)
      .where(eq(charactersTable.normalizedName, normalizeCharacterName(name)));
    if (!rows[0]) throw new Error(`Fixture character ${name} is missing`);
    return rows[0].id;
  }

  async function login(page: Page) {
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
  async function openInspector(page: Page) {
    await page.goto("/admin/characters");
    await page.getByLabel("Character name").fill(FIXTURE_CHARACTER);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText(FIXTURE_CHARACTER, { exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Character inspector" })).toBeVisible();
  }

  async function selectTab(page: Page, name: string) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }

  /** Rows in the character's operator history (the History tab). */
  async function auditRows(page: Page): Promise<number> {
    await selectTab(page, "History");
    return page.getByTestId("admin-audit-list").locator("li").count();
  }

  async function expectNoPageOverflow(page: Page) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test("admin can sign in and open a character inspector", async ({ page }) => {
    await login(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
    await openInspector(page);
    await selectTab(page, "History");
    await expect(page.getByText("Operator audit history").first()).toBeVisible();
  });

  test("admin can SET LOCATION and the mutation is audited", async ({ page }) => {
    await login(page);
    await openInspector(page);

    const auditCount = await auditRows(page);
    await selectTab(page, "Overview");

    // The fixture spawns at the crash site; teleporting to The Jag is a real
    // mutation (already there would be a "no change" no-op instead).
    await page.getByLabel(/TELEPORT \/ SET LOCATION/i).selectOption({ value: "the_jag" });
    await page.getByRole("button", { name: "Teleport here" }).click();
    await expect(page.getByText(/teleported to/i).first()).toBeVisible({ timeout: 8000 });

    await expect.poll(() => auditRows(page), { timeout: 8000 }).toBe(auditCount + 1);
  });

  test("the inspector shows one section at a time and every tab is reachable at phone and desktop width", async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize(PHONE);
    await openInspector(page);

    const sections = [
      { tab: "Overview", marker: page.getByRole("heading", { name: "Location & action" }) },
      { tab: "Inventory", marker: page.getByRole("heading", { name: "Carried inventory" }) },
      { tab: "Missions", marker: page.getByRole("heading", { name: "Mission resets" }) },
      { tab: "Skills", marker: page.getByRole("heading", { name: "Skill total XP" }) },
      { tab: "Account", marker: page.getByRole("region", { name: "Account access" }) },
      { tab: "Moderation", marker: page.getByRole("region", { name: "Moderation" }) },
      { tab: "History", marker: page.getByRole("heading", { name: "Operator audit history" }) },
    ];
    await expect(page.getByRole("tab")).toHaveCount(sections.length);

    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      for (const section of sections) {
        await selectTab(page, section.tab);
        await expect(section.marker).toBeVisible();
        // Only the selected section is shown; the others are not stacked below it.
        for (const other of sections.filter((candidate) => candidate !== section)) {
          await expect(other.marker).toHaveCount(0);
        }
        await expectNoPageOverflow(page);
      }
    }
    // The identity and refresh action stay put on every tab.
    await expect(page.getByTestId("admin-inspector-header")).toContainText(FIXTURE_CHARACTER);
    await expect(page.getByRole("button", { name: "Refresh state" })).toBeVisible();
  });

  test("the tab list is keyboard accessible with a roving tab stop", async ({ page }) => {
    await login(page);
    await openInspector(page);

    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await tab("Overview").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Inventory")).toBeFocused();
    await expect(tab("Inventory")).toHaveAttribute("aria-selected", "true");
    await expect(tab("Overview")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("End");
    await expect(tab("History")).toBeFocused();
    await expect(tab("History")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tab("Overview")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab("History")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab("Overview")).toBeFocused();
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });

  test("switching tabs mutates nothing, and a mutation result stays visible across tabs", async ({
    page,
  }) => {
    await login(page);
    await openInspector(page);
    const before = await auditRows(page);

    // An unsubmitted teleport choice is dropped by a tab switch, never submitted.
    await selectTab(page, "Overview");
    const location = page
      .getByText("Location", { exact: true })
      .locator("xpath=following-sibling::dd[1]");
    const locationBefore = await location.innerText();
    await page.getByLabel(/TELEPORT \/ SET LOCATION/i).selectOption({ value: "holo_hollow" });
    await selectTab(page, "Inventory");
    await selectTab(page, "Overview");
    expect(await location.innerText()).toBe(locationBefore);
    expect(await auditRows(page)).toBe(before);

    // A real mutation reports in the shared header and survives tab changes.
    await selectTab(page, "Skills");
    await page.getByLabel("Total XP").fill("37");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await page.getByRole("button", { name: "Confirm set" }).click();
    const result = page.getByTestId("admin-inspector-nav").getByText(/Set .* XP to 37/);
    await expect(result).toBeVisible({ timeout: 8000 });
    await selectTab(page, "Inventory");
    await expect(result).toBeVisible();
    await expect.poll(() => auditRows(page), { timeout: 8000 }).toBe(before + 1);
    await expect(page.getByTestId("admin-audit-list")).toContainText("total XP");
    // The refreshed snapshot is what the Skills tab shows.
    await selectTab(page, "Skills");
    await expect(page.getByText("37 XP").first()).toBeVisible();
  });

  test("ADD ITEM offers the whole catalog behind a filter and grants stackable and unique items", async ({
    page,
  }) => {
    await login(page);
    await openInspector(page);
    const before = await auditRows(page);
    await selectTab(page, "Inventory");

    const item = page.getByLabel(/^Item/);
    const quantity = page.getByLabel("Qty");
    const filter = page.getByLabel("Find item");
    const add = page.getByRole("button", { name: "Add", exact: true });
    const status = page.getByTestId("admin-inspector-nav");

    // Beyond the former six starter items.
    expect(await item.locator("option").count()).toBeGreaterThan(6);
    await filter.fill("zzzz-no-such-item");
    await expect(item.locator("option")).toHaveText(["No matching items"]);
    await expect(add).toBeDisabled();

    // An advanced stackable from the latest ship components.
    await filter.fill("drive");
    await item.selectOption({ label: "Drive Mount" });
    await quantity.fill("0");
    await add.click();
    await expect(status).toContainText("Quantity must be a positive whole number");
    await quantity.fill("2");
    await add.click();
    await expect(status).toContainText("Added 2 × Drive Mount.", { timeout: 8000 });
    await expect(
      page.getByTestId("admin-carried-stack").filter({ hasText: "Drive Mount × 2" }),
    ).toBeVisible();

    // A unique item the starter list never offered; the quantity is not used.
    await filter.fill("freight");
    await item.selectOption({ label: "Freight Harness (unique)" });
    await expect(quantity).toBeDisabled();
    await add.click();
    await expect(status).toContainText("Added 1 × Freight Harness.", { timeout: 8000 });
    await expect(
      page.getByTestId("admin-carried-unique").filter({ hasText: "Freight Harness" }),
    ).toBeVisible();

    // Capacity failure is reported clearly and grants nothing.
    await filter.fill("drive");
    await item.selectOption({ label: "Drive Mount" });
    await quantity.fill("9999");
    await add.click();
    await expect(status).toContainText("Could not add Drive Mount:", { timeout: 8000 });
    await expect(
      page.getByTestId("admin-carried-stack").filter({ hasText: "Drive Mount × 2" }),
    ).toBeVisible();

    // Two grants, two audit rows; the invalid and refused attempts added none.
    expect(await auditRows(page)).toBe(before + 2);
    await expect(page.getByTestId("admin-audit-list")).toContainText("Drive Mount");
    await expect(page.getByTestId("admin-audit-list")).toContainText("Freight Harness");
  });

  test("an operator sees Edit in Admin on the Character surface at phone and desktop width, following the active character", async ({
    page,
  }) => {
    await login(page);
    const twinA = await characterIdByName(TWIN_A);
    const twinB = await characterIdByName(TWIN_B);

    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto(`/play/${twinA}`);
      await openUtility(page, "character");
      const surface = utilitySurface(page, "Character");
      await expect(surface).toBeVisible();
      const link = surface.getByRole("link", { name: "Edit in Admin" });
      await expect(link).toHaveAttribute("href", `/admin/characters/${twinA}`);
      // Switch Character stays reachable beside it.
      await expect(surface.getByRole("link", { name: "Switch Character" })).toBeVisible();

      // Switching to the other character retargets the shortcut.
      await surface.getByRole("link", { name: "Switch Character" }).click();
      await page.waitForURL(/\/characters$/);
      await page.locator(`a[href="/play/${twinB}"]`).click();
      await page.waitForURL(new RegExp(`/play/${twinB}`));
      await openUtility(page, "character");
      const switched = utilitySurface(page, "Character").getByRole("link", {
        name: "Edit in Admin",
      });
      await expect(switched).toHaveAttribute("href", `/admin/characters/${twinB}`);

      // It lands on that character's inspector, skipping search.
      await switched.click();
      await page.waitForURL(new RegExp(`/admin/characters/${twinB}$`));
      await expect(page.getByRole("heading", { name: "Character inspector" })).toBeVisible();
      await expect(page.getByTestId("admin-inspector-header")).toContainText(TWIN_B);
    }
  });

  test("an ordinary player sees no Edit in Admin link and is refused the inspector by URL", async ({
    page,
  }) => {
    const seeded = await seedNonAdminUser();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(seeded.email);
    await page.getByLabel("Password", { exact: true }).fill(seeded.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 10000 });

    const ordinary = await characterIdByName(ORDINARY_CHARACTER);
    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto(`/play/${ordinary}`);
      await openUtility(page, "character");
      const surface = utilitySurface(page, "Character");
      await expect(surface).toBeVisible();
      await expect(surface.getByRole("link", { name: "Switch Character" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Edit in Admin" })).toHaveCount(0);
      await expect(page.locator("[data-character-admin-link]")).toHaveCount(0);
    }

    // Hiding the link is not the authorization: a forged URL is refused.
    await page.goto(`/admin/characters/${ordinary}`);
    await expect(page.getByText(/403 · Operator console/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Character inspector" })).toHaveCount(0);
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
