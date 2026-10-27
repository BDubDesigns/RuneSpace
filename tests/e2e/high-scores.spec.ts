import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerAccounts, playerPresence } from "@/db/rune-space";
import { expect, openTestCharacter, test } from "./fixtures";

test("public navigation, rankings, and shareable profiles work on mobile and desktop", async ({
  browser,
  testCharacter,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { copied?: string }).copied = text;
        },
      },
    });
  });
  const page = await context.newPage();
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Public" });
  for (const name of ["Home", "Updates", "Wiki", "High Scores"])
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ players? online/)).toBeVisible();
  await page.getByRole("link", { name: "View High Scores" }).click();
  await expect(page.getByRole("heading", { name: "High Scores" })).toBeVisible();
  const ranking = page.getByLabel("Ranking");
  for (const label of [
    "Overall Level",
    "Overall XP",
    "Mining",
    "Refining",
    "Welding",
    "Fabrication",
    "Runeworking",
  ]) {
    await expect(ranking.getByRole("option", { name: label, exact: true })).toHaveCount(1);
  }
  await ranking.selectOption({ label: "Mining" });
  await page.getByLabel("Character name").fill(testCharacter.displayName);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByLabel("Ranking")).toHaveValue("mining");
  await page.getByRole("link", { name: testCharacter.displayName, exact: true }).click();
  await page.waitForURL(/high-scores\/characters/);
  await expect(page.getByRole("heading", { name: testCharacter.displayName })).toBeVisible();
  await expect(page.getByText(/^Player:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Trade" })).toHaveCount(0);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Profile link copied.")).toBeVisible();
  const copied = await page.evaluate(() => (window as Window & { copied?: string }).copied);
  expect(copied).toBe(
    `${new URL(page.url()).origin}/high-scores/characters/${encodeURIComponent(testCharacter.displayName)}`,
  );
  const shared = await context.newPage();
  await shared.goto(copied!);
  await expect(shared.getByRole("heading", { name: testCharacter.displayName })).toBeVisible();
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/high-scores");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const image = page.getByRole("link", { name: "RuneSpace home" }).locator("img:visible");
    await expect(image).toHaveAttribute(
      "src",
      width === 1280 ? /runespace-header-lockup/ : /runespace-emblem/,
    );
  }
  await page.setViewportSize({ width: 320, height: 844 });
  const menu = page.getByRole("button", { name: /Menu/ });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "High Scores", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await context.close();
});

test("players can reach High Scores from Character", async ({
  page,
  testCharacter,
  workerAuth,
}) => {
  // The canonical suite reuses each worker account across tests. Expire only
  // this fixture account's previous check-in so this test observes a new 204.
  const [account] = await db
    .select({ id: playerAccounts.id })
    .from(playerAccounts)
    .where(eq(playerAccounts.userId, workerAuth.userId));
  if (account)
    await db
      .update(playerPresence)
      .set({ lastCheckInAt: new Date(0) })
      .where(eq(playerPresence.playerAccountId, account.id));
  await page.setViewportSize({ width: 390, height: 844 });
  const checkIn = page.waitForResponse(
    (response) =>
      response.url().includes("/api/player-presence?") && response.request().method() === "POST",
  );
  await openTestCharacter(page, testCharacter.id);
  expect((await checkIn).status()).toBe(204);
  const online = await page.evaluate(
    async () => (await (await fetch("/api/player-presence")).json()) as { count: number },
  );
  expect(online.count).toBeGreaterThanOrEqual(1);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Character", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Character" })
    .getByRole("link", { name: "View High Scores" })
    .click();
  await expect(page).toHaveURL(/\/high-scores/, { timeout: 20_000 });
});

test("share uses the native sheet and reports copy failures", async ({
  browser,
  testCharacter,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { shared?: string }).shared = data.url;
      },
    });
  });
  const page = await context.newPage();
  await page.goto(`/high-scores/characters/${encodeURIComponent(testCharacter.displayName)}`);
  await page.getByRole("button", { name: "Share" }).click();
  expect(await page.evaluate(() => (window as Window & { shared?: string }).shared)).toBe(
    `${new URL(page.url()).origin}/high-scores/characters/${encodeURIComponent(testCharacter.displayName)}`,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
  });
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/Could not copy the link/)).toBeVisible();
  await page.goto("/high-scores/characters/Unknown%20Character");
  await expect(page.getByRole("heading", { name: "Character not found" })).toBeVisible();
  await context.close();
});

test("online count distinguishes zero, unavailable, and a stale last result", async ({
  browser,
}) => {
  const context = await browser.newContext();
  let fail = true;
  await context.route("**/api/player-presence", async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    else await route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' });
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Players online unavailable")).toBeVisible();
  fail = false;
  await page.reload();
  await expect(page.getByText("0 players online", { exact: true })).toBeVisible();
  fail = true;
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now + 180_000;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("0 players online (last known; update unavailable)")).toBeVisible();
  await context.close();
});
