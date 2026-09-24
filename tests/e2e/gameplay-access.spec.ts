import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser } from "../integration/fixtures";
import { registerVerifiedAccount, uniquePlayerName, useDistinctClientIp } from "./account-helpers";
import { ADMIN_USER_ID, seedAdminOperator, seedNonAdminUser } from "./admin-session";
import {
  establishAuthenticatedSession,
  grantTestEarlyAccess,
  openMapSurface,
  userIdForEmail,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";
import { assertDisposableE2EDatabase } from "./test-database";

/**
 * Issue #223 — the pre-alpha gameplay-access gate, account Early Access, and
 * the explicit public-gameplay switch, end to end.
 *
 * This is the ONLY browser spec that changes the global `runespace_access_state`
 * row. Its journeys run serially in one worker, every journey that opens public
 * gameplay closes it again itself, and `afterEach`/`afterAll` restore Closed and
 * the migrated launch target. It runs in exactly one Playwright project
 * (`playwright.config.ts` ignores it in `mobile`), so no second project can
 * race the same row. Every other spec's accounts carry fixture Early Access, so
 * the switch can never affect a parallel spec.
 */

const COUNTDOWN_TEXT = /^\d+D · \d{2}H · \d{2}M · \d{2}S$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The normal closed-gameplay launch presentation for the target the page was
 * rendered with: a live SOFT ALPHA OPENS IN countdown before the target, and
 * LAUNCH IMMINENT! with no timer at or after it. Keeps the journeys correct on
 * either side of October 27.
 */
async function expectLaunchPresentation(page: Page, targetAt: Date) {
  if (targetAt.getTime() > Date.now()) {
    await expect(page.getByText("SOFT ALPHA OPENS IN", { exact: true })).toBeVisible();
    await expect(page.getByRole("timer")).toHaveText(COUNTDOWN_TEXT);
  } else {
    await expect(page.getByText("LAUNCH IMMINENT!", { exact: true })).toBeVisible();
    await expect(page.getByRole("timer")).toHaveCount(0);
  }
}

function baseURL(): string {
  const configured = test.info().project.use.baseURL;
  if (!configured) throw new Error("Playwright baseURL is required");
  return configured;
}

async function setPublicGameplayOpen(open: boolean) {
  await db
    .update(rune.runespaceAccessState)
    .set({ publicGameplayOpen: open })
    .where(eq(rune.runespaceAccessState.id, 1));
}

async function setLaunchTarget(at: Date) {
  await db
    .update(rune.runespaceAccessState)
    .set({ softAlphaLaunchTargetAt: at })
    .where(eq(rune.runespaceAccessState.id, 1));
}

async function characterIdFor(userId: string): Promise<string> {
  const rows = await db
    .select({ id: rune.characters.id })
    .from(rune.characters)
    .innerJoin(rune.playerAccounts, eq(rune.playerAccounts.id, rune.characters.playerAccountId))
    .where(eq(rune.playerAccounts.userId, userId));
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

async function signIn(page: Page, email: string, password: string) {
  // Better Auth rate-limits /sign-in per client address; like the other
  // registration journeys, present this browser as its own client so parallel
  // canonical workers cannot exhaust a shared loopback budget.
  await useDistinctClientIp(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 10_000 });
}

/** Arm a confirm-before-commit operator control, check its copy, and confirm it. */
async function confirmOperatorAction(page: Page, label: string, title: string, prompt: string) {
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: label }).click();
}

test.describe("gameplay access gate and launch controls", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.RUNESPACE_ADMIN_USER_IDS, "requires RUNESPACE_ADMIN_USER_IDS allowlist");

  let migratedTarget: Date;
  let adminContext: BrowserContext;
  let admin: Page;
  // Player A registers through the real UI and later receives Early Access.
  let playerAContext: BrowserContext;
  let playerA: Page;
  let playerAUserId: string;
  let playerACharacterName: string;
  let playerACharacterId: string;
  // Player B is an ordinary verified account that never has Early Access.
  let playerBContext: BrowserContext;
  let playerB: Page;
  let playerBUserId: string;
  let playerBCharacterId: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    assertDisposableE2EDatabase();
    const [state] = await db.select().from(rune.runespaceAccessState);
    expect(state?.publicGameplayOpen, "public gameplay must start Closed").toBe(false);
    migratedTarget = state!.softAlphaLaunchTargetAt;

    await seedAdminOperator();
    adminContext = await browser.newContext({ baseURL: baseURL() });
    admin = await adminContext.newPage();
    const adminSeed = await seedAdminOperator();
    await signIn(admin, adminSeed.email, adminSeed.password);

    playerAContext = await browser.newContext({ baseURL: baseURL() });
    playerA = await playerAContext.newPage();
    await playerA.setViewportSize({ width: 390, height: 844 });

    const emailB = `access-b-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const sessionB = await establishAuthenticatedSession(browser, "Ordinary Waiting", emailB, {
      earlyAccess: false,
    });
    playerBContext = sessionB.context;
    playerBUserId = sessionB.userId;
    playerB = await playerBContext.newPage();
    await playerB.setViewportSize({ width: 390, height: 844 });
    const characterB = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      playerBUserId,
      `Waiting ${Math.random().toString(36).slice(2, 7)}`,
      undefined,
      { seedLegacyStarterCutter: false, gameplayAccess: false },
    );
    playerBCharacterId = characterB.id;
  });

  test.afterEach(async () => {
    await setPublicGameplayOpen(false);
    await setLaunchTarget(migratedTarget);
  });

  test.afterAll(async () => {
    await setPublicGameplayOpen(false);
    if (migratedTarget) await setLaunchTarget(migratedTarget);
    await adminContext?.close();
    await playerAContext?.close();
    await playerBContext?.close();
    for (const userId of [playerAUserId, playerBUserId]) {
      if (userId) await cleanupTestUser(db, authSchema, rune, userId);
    }
  });

  test("1. a verified ordinary account reserves while closed and returns to Characters", async ({
    browser,
  }) => {
    // Review screenshots show the real persisted October 27 target so the
    // displayed date and timer agree. Behavioral runs inject a future target so
    // the journey stays a countdown journey after October 27.
    let launchTarget = migratedTarget;
    if (process.env.RUNESPACE_E2E_SCREENSHOTS !== "true") {
      launchTarget = new Date(Date.now() + 34 * DAY_MS + 7 * HOUR_MS);
      await setLaunchTarget(launchTarget);
    }

    const landingContext = await browser.newContext({ baseURL: baseURL() });
    try {
      const landing = await landingContext.newPage();
      await landing.setViewportSize({ width: 390, height: 844 });
      await landing.goto("/");
      await expect(landing.getByText("SOFT ALPHA — OCTOBER 27", { exact: true })).toBeVisible();
      await expect(
        landing.getByText(
          "Create your account, verify your email, and reserve up to three globally unique character names before RuneSpace Soft Alpha opens October 27.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        landing.getByRole("link", { name: "Reserve your characters", exact: true }),
      ).toBeVisible();
      await expectLaunchPresentation(landing, launchTarget);
      await captureReviewScreenshot(landing, "gameplay-access-landing-launch-state.png");
    } finally {
      await landingContext.close();
    }

    const email = `access-a-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await registerVerifiedAccount(
      playerA,
      { playerName: uniquePlayerName("Soft Alpha"), email, password: "sup3r-secret-password" },
      { earlyAccess: false },
    );
    playerAUserId = await userIdForEmail(email);

    await expect(playerA.getByText("SOFT ALPHA · OCTOBER 27", { exact: true })).toBeVisible();
    await expect(playerA.getByRole("heading", { name: "Claim your crew" })).toBeVisible();
    await expect(
      playerA.getByText(
        "Reserve your first character name before RuneSpace Soft Alpha opens October 27.",
        { exact: true },
      ),
    ).toBeVisible();
    await expectLaunchPresentation(playerA, launchTarget);
    await expect(playerA.getByRole("link", { name: "Reserve character" })).toHaveCount(3);
    await expect(playerA.getByRole("link", { name: "New character" })).toHaveCount(0);
    await captureReviewScreenshot(playerA, "gameplay-access-claim-your-crew.png");

    await playerA.getByRole("link", { name: "Reserve character" }).first().click();
    playerACharacterName = `Reserved ${Math.random().toString(36).slice(2, 8)}`;
    await playerA.getByLabel("Character name").fill(playerACharacterName);
    await playerA.getByRole("button", { name: "Station Captain portrait" }).click();
    await playerA.getByRole("button", { name: "Create character" }).click();

    // Closed reservation lands back on Characters, never in gameplay.
    await playerA.waitForURL(/\/characters$/);
    playerACharacterId = await characterIdFor(playerAUserId);
    await expect(playerA.getByRole("heading", { name: "Your crew is reserved" })).toBeVisible();
    await expect(
      playerA.getByText(
        "Your character names and portraits are saved to your RuneSpace account. Soft Alpha opens October 27.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(playerA.getByText(playerACharacterName, { exact: true })).toBeVisible();
    await expect(playerA.getByText("READY FOR ALPHA", { exact: true })).toBeVisible();
    await expectLaunchPresentation(playerA, launchTarget);
    // No fake disabled Play control.
    await expect(playerA.getByRole("link", { name: "Play" })).toHaveCount(0);
    await expect(playerA.getByRole("button", { name: "Play" })).toHaveCount(0);
    await expect(playerA.getByRole("link", { name: "Reserve character" })).toHaveCount(2);
    await captureReviewScreenshot(playerA, "gameplay-access-crew-reserved.png");
  });

  test("2. a direct Play URL is refused back to Characters", async () => {
    await playerA.goto(`/play/${playerACharacterId}`);
    await playerA.waitForURL(/\/characters$/);
    await expect(playerA.getByRole("heading", { name: "Your crew is reserved" })).toBeVisible();
  });

  test("3. an operator grants Early Access and the account can play", async () => {
    await admin.goto("/admin/characters");
    await admin.getByLabel("Character name").fill(playerACharacterName);
    await admin.getByRole("button", { name: "Search" }).click();
    await admin.getByText(playerACharacterName, { exact: true }).first().click();
    await expect(admin.getByRole("heading", { name: "State snapshot" })).toBeVisible();

    const panel = admin.getByRole("region", { name: "Account access" });
    await expect(panel.getByText("Not granted", { exact: true })).toBeVisible();
    await expect(panel.getByText("Verified", { exact: true })).toBeVisible();
    await expect(panel.getByText("Closed", { exact: true })).toBeVisible();
    await confirmOperatorAction(
      admin,
      "Grant Early Access",
      "Grant Early Access to this account?",
      "All characters on this RuneSpace account will be able to enter gameplay before public Soft Alpha opens.",
    );
    await expect(panel.getByText("Granted", { exact: true })).toBeVisible();
    await expect(panel.getByText(ADMIN_USER_ID, { exact: true })).toBeVisible();
    await expect(
      admin
        .getByTestId("admin-account-audit-list")
        .getByText("Granted Early Access to this account."),
    ).toBeVisible();
    await captureReviewScreenshot(admin, "gameplay-access-admin-account-access.png");

    await playerA.goto("/characters");
    await expect(playerA.getByRole("heading", { name: "EARLY ACCESS ENABLED" })).toBeVisible();
    await expect(
      playerA.getByText("You can play now. Public Soft Alpha opens October 27.", { exact: true }),
    ).toBeVisible();
    // afterEach restored the migrated target, so this is the real one.
    await expectLaunchPresentation(playerA, migratedTarget);
    await expect(playerA.getByText("READY FOR ALPHA", { exact: true })).toHaveCount(0);
    await captureReviewScreenshot(playerA, "gameplay-access-early-access.png");
    await playerA.getByRole("link", { name: "Play" }).click();
    await playerA.waitForURL(new RegExp(`/play/${playerACharacterId}$`));
    await expect(playerA.getByRole("link", { name: "Map" })).toBeVisible();
  });

  test("4. revoking Early Access returns an already-open Play page to Characters on its next refresh", async () => {
    // Start a walk so the already-open PlayConsole schedules its own
    // authoritative refreshPlayAction at the arrival boundary.
    await openMapSurface(playerA);
    await playerA.getByRole("button", { name: /The Long Scramble/ }).click();
    await playerA.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
    await expect(playerA.getByText("In transit", { exact: true }).first()).toBeVisible();

    await confirmOperatorAction(
      admin,
      "Revoke Early Access",
      "Revoke Early Access for this account?",
      "All characters on this RuneSpace account will lose early gameplay access. While public gameplay is closed, their next gameplay request returns them to Characters.",
    );
    await expect(
      admin
        .getByRole("region", { name: "Account access" })
        .getByText("Not granted", { exact: true }),
    ).toBeVisible();

    // No further input: the stale page's own boundary refresh is refused and
    // navigates back to Characters instead of retrying.
    await playerA.waitForURL(/\/characters$/, { timeout: 45_000 });
    await expect(playerA.getByRole("heading", { name: "Your crew is reserved" })).toBeVisible();
    await expect(playerA.getByText("READY FOR ALPHA", { exact: true })).toBeVisible();
  });

  test("5-6. opening public gameplay admits ordinary accounts; closing blocks them again but not Early Access", async () => {
    await admin.goto("/admin");
    const control = admin.getByRole("region", { name: "PUBLIC GAMEPLAY" });
    await expect(
      control.getByText("October 27, 2026 · 9:00 AM Pacific", { exact: true }),
    ).toBeVisible();
    await expect(admin.getByTestId("public-gameplay-state")).toHaveText("Closed");
    await captureReviewScreenshot(admin, "gameplay-access-admin-public-closed.png");

    await playerB.goto("/characters");
    await expect(playerB.getByText("READY FOR ALPHA", { exact: true })).toBeVisible();

    await confirmOperatorAction(
      admin,
      "Open Public Gameplay",
      "Open RuneSpace to everyone?",
      "Verified accounts will immediately be able to enter gameplay. This does not bypass future moderation/suspension restrictions.",
    );
    await expect(admin.getByTestId("public-gameplay-state")).toHaveText("Open");
    await expect(control.getByTestId("soft-alpha-countdown")).toHaveCount(0);
    await expect(
      admin.getByTestId("admin-system-audit-list").getByText("Opened public gameplay.").first(),
    ).toBeVisible();
    await captureReviewScreenshot(admin, "gameplay-access-admin-public-open.png");

    // Ordinary account: normal playable Characters experience, then Play.
    await playerB.goto("/characters");
    await expect(playerB.getByText("READY FOR ALPHA", { exact: true })).toHaveCount(0);
    await expect(playerB.getByTestId("soft-alpha-countdown")).toHaveCount(0);
    await playerB.getByRole("link", { name: "Play" }).click();
    await playerB.waitForURL(new RegExp(`/play/${playerBCharacterId}$`));
    await expect(playerB.getByRole("link", { name: "Map" })).toBeVisible();
    // Stage a command on the open page while gameplay is still open.
    await openMapSurface(playerB);
    await playerB.getByRole("button", { name: /The Long Scramble/ }).click();

    // Early Access account for the "still allowed" half of the journey.
    await grantTestEarlyAccess(playerAUserId);

    await confirmOperatorAction(
      admin,
      "Close Public Gameplay",
      "Close public gameplay?",
      "New gameplay requests from ordinary accounts will be blocked. Accounts with Early Access remain able to play.",
    );
    await expect(admin.getByTestId("public-gameplay-state")).toHaveText("Closed");

    // The already-open ordinary Play page is refused on its next command.
    await playerB.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
    await playerB.waitForURL(/\/characters$/);
    await expect(playerB.getByText("READY FOR ALPHA", { exact: true })).toBeVisible();

    // The Early Access account still enters gameplay.
    await playerA.goto(`/play/${playerACharacterId}`);
    await expect(playerA).toHaveURL(new RegExp(`/play/${playerACharacterId}$`));
    await expect(playerA.getByRole("link", { name: "Map" })).toBeVisible();
  });

  test("7. at and after the launch target while closed, countdowns read LAUNCH IMMINENT!", async ({
    browser,
  }) => {
    await setLaunchTarget(new Date(Date.now() - 60_000));

    await playerB.goto("/characters");
    await expect(playerB.getByText("LAUNCH IMMINENT!", { exact: true })).toBeVisible();
    await expect(playerB.getByText("SOFT ALPHA OPENS IN", { exact: true })).toHaveCount(0);
    await expect(playerB.getByText("READY FOR ALPHA", { exact: true })).toBeVisible();

    const landingContext = await browser.newContext({ baseURL: baseURL() });
    try {
      const landing = await landingContext.newPage();
      await landing.goto("/");
      await expect(landing.getByText("LAUNCH IMMINENT!", { exact: true })).toBeVisible();
    } finally {
      await landingContext.close();
    }

    await admin.goto("/admin");
    await expect(
      admin.getByRole("region", { name: "PUBLIC GAMEPLAY" }).getByText("LAUNCH IMMINENT!"),
    ).toBeVisible();
    // Reaching the target changed nothing: gameplay is still Closed.
    await expect(admin.getByTestId("public-gameplay-state")).toHaveText("Closed");
    await playerB.goto(`/play/${playerBCharacterId}`);
    await playerB.waitForURL(/\/characters$/);
  });

  test("8. a non-admin cannot reach the Early Access or public gameplay controls", async ({
    browser,
  }) => {
    const seeded = await seedNonAdminUser();
    const context = await browser.newContext({ baseURL: baseURL() });
    try {
      const page = await context.newPage();
      await signIn(page, seeded.email, seeded.password);
      await page.goto("/admin");
      await expect(page.getByText(/403 · Operator console/i)).toBeVisible();
      await expect(page.getByRole("region", { name: "PUBLIC GAMEPLAY" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open Public Gameplay" })).toHaveCount(0);
      await page.goto(`/admin/characters/${playerACharacterId}`);
      await expect(page.getByRole("region", { name: "Account access" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Grant Early Access" })).toHaveCount(0);
    } finally {
      await context.close();
    }
    const [state] = await db.select().from(rune.runespaceAccessState);
    expect(state?.publicGameplayOpen).toBe(false);
  });
});
