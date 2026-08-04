import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { normalizeCharacterName } from "@/game/domain/character-name";
import { createCharacter } from "@/server/characters";
import { ensurePlayerAccount } from "@/server/ownership";
import { cleanupTestUser, createTestUser } from "../integration/fixtures";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error(
      "Character profile E2E fixtures require a disposable localhost PostgreSQL database",
    );
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

/** Short unique token so seeded names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

// Seeded fixtures, populated in beforeAll and referenced by name in tests.
let radaOne = "";
let radaTwo = "";
let kaelCutter = "";
let yardGhost = "";
const createdUsers: string[] = [];

/**
 * Create one owner user with one character at the Crash Site and return the
 * user ID. Optionally persists Mining XP so the derived level is meaningful.
 */
async function seedCharacter(ownerName: string, characterName: string, miningXp?: number) {
  const userId = await createTestUser(db, authSchema, ownerName);
  const account = await ensurePlayerAccount(userId);
  const character = await createCharacter(account.id, characterName);
  createdUsers.push(userId);
  if (miningXp !== undefined) {
    await db.insert(rune.characterSkillXp).values({
      characterId: character.id,
      skillId: SKILL_IDS.mining,
      totalXp: miningXp,
    });
  }
  return userId;
}

test.beforeAll(async () => {
  radaOne = `Rada One ${token()}`;
  radaTwo = `Rada Two ${token()}`;
  kaelCutter = `Kael Cutter ${token()}`;
  yardGhost = `Yard Ghost ${token()}`;
  // Two characters owned by one player, plus another player's character, all
  // at the Crash Site; one character at the Processing Yard to prove the
  // location scope.
  await seedCharacter("Rada Stonehand", radaOne, 500);
  await seedCharacter("Rada Stonehand", radaTwo);
  await seedCharacter("Kael Brighthome", kaelCutter, 500);
  const kaelUserId = await seedCharacter("Kael Brighthome", yardGhost);
  const yardRow = (
    await db
      .select({ id: rune.characters.id })
      .from(rune.characters)
      .where(eq(rune.characters.normalizedName, normalizeCharacterName(yardGhost)))
  )[0];
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(rune.characters.id, yardRow!.id));
});

test.afterAll(async () => {
  for (const userId of createdUsers.splice(0)) {
    await cleanupTestUser(db, authSchema, rune, userId);
  }
});

async function openPopulationFixture(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openPopulationFixture(page);
  await db.transaction(async (transaction) => {
    // Normalize the fixture character's gameplay state (the Travel phase can
    // leave it mid-run or at another location).
    await transaction
      .delete(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
    await transaction
      .delete(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, characterId));
    await transaction
      .delete(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, characterId));
    await transaction
      .delete(rune.characterPowerCellDailyClaims)
      .where(eq(rune.characterPowerCellDailyClaims.characterId, characterId));
    await transaction
      .delete(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    await transaction
      .delete(rune.equippedItems)
      .where(eq(rune.equippedItems.characterId, characterId));
    await transaction
      .delete(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, characterId));
    await transaction
      .delete(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, characterId));
    await transaction
      .delete(rune.characterStarterProvisioning)
      .where(eq(rune.characterStarterProvisioning.characterId, characterId));
    await transaction
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, characterId));
  });
  await page.reload();
  await expect(page.getByText("World map")).toBeVisible();
});

test("selecting a same-location character opens its public profile panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const disclosure = page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ });
  // The disclosure label is "Characters here" with a compact count badge and
  // a truthful show/hide accessible label.
  await expect(disclosure).toHaveAttribute("aria-label", /^Show \d+ characters here$/);
  const badge = page.locator("[data-population-count]");
  await expect(badge).toBeVisible();
  expect(Number((await badge.textContent())?.trim())).toBeGreaterThanOrEqual(3);
  await disclosure.click();

  const radaTrigger = page.getByRole("button", {
    name: `${radaOne}, Level 2, player Rada Stonehand`,
  });
  await radaTrigger.click();
  const panel = page.locator("[data-character-profile-panel]");
  await expect(panel).toBeVisible();
  await expect(radaTrigger).toHaveAttribute("aria-expanded", "true");
  // The opened character's row stays visibly selected (Viewing indicator,
  // never color alone) and transfers only to the newly selected row.
  await expect(radaTrigger.getByText("Viewing", { exact: true })).toBeVisible();
  await expect(radaTrigger.getByText("Lv 2", { exact: true })).toBeVisible();

  // Portrait area is a neutral decorative placeholder (silhouette, no
  // first-letter glyph that could read like a numeric stat).
  await expect(panel.locator("[data-character-portrait] svg")).toBeVisible();
  expect(await panel.locator("[data-character-portrait]").innerText()).toBe("");
  await expect(panel.getByText(radaOne, { exact: true })).toBeVisible();
  await expect(panel.getByText("Player: Rada Stonehand")).toBeVisible();
  await expect(panel.getByText("Overall level 2")).toBeVisible();
  const skillRow = panel.locator("[data-character-skill]");
  await expect(skillRow).toHaveCount(1);
  await expect(skillRow.getByText(/^Mining — Level 2$/)).toBeVisible();
  await expect(skillRow.getByText("500 total XP")).toBeVisible();
  await expect(skillRow.getByText("550 XP to next level")).toBeVisible();
  await expect(skillRow.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

  // No private account information appears anywhere in the panel.
  await expect(panel.getByText("@")).toHaveCount(0);
  await expect(panel.getByText(/email/i)).toHaveCount(0);

  // Selecting a second character updates the SAME panel rather than stacking,
  // and the selected treatment transfers immediately to the new row. The
  // selected row's gold left rail comes from the button's own border (never
  // the inter-row separator), so it is visible in any list position; the
  // unselected non-first row must show no stray left rail.
  const kaelTrigger = page.getByRole("button", {
    name: `${kaelCutter}, Level 2, player Kael Brighthome`,
  });
  const radaTwoTrigger = page.getByRole("button", {
    name: `${radaTwo}, Level 1, player Rada Stonehand`,
  });
  await kaelTrigger.click();
  await expect(panel).toHaveCount(1);
  await expect(panel.getByText(kaelCutter, { exact: true })).toBeVisible();
  await expect(panel.getByText("Player: Kael Brighthome")).toBeVisible();
  await expect(panel.getByText(radaOne, { exact: true })).toHaveCount(0);
  await expect(kaelTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(radaTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(kaelTrigger.getByText("Viewing", { exact: true })).toBeVisible();
  await expect(radaTrigger.getByText("Viewing", { exact: true })).toHaveCount(0);
  await expect(kaelTrigger).toHaveCSS("border-left-color", "rgb(245, 196, 81)");
  await expect(kaelTrigger).toHaveCSS("border-left-width", "2px");
  await expect(radaTwoTrigger).toHaveCSS("border-left-color", "rgba(0, 0, 0, 0)");
  await expect(radaTwoTrigger).toHaveCSS("border-left-width", "2px");

  // Selecting a later row (Rada Two is never the first row of the sorted
  // fixture list) must show the SAME gold rail: the inter-row separator can
  // never recolor the selection rail.
  await radaTwoTrigger.click();
  await expect(panel).toHaveCount(1);
  await expect(panel.getByText(radaTwo, { exact: true })).toBeVisible();
  await expect(panel.getByText("Player: Rada Stonehand")).toBeVisible();
  await expect(panel.getByText("Overall level 1")).toBeVisible();
  await expect(panel.locator("[data-character-portrait] svg")).toBeVisible();
  await expect(radaTwoTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(kaelTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(radaTwoTrigger.getByText("Viewing", { exact: true })).toBeVisible();
  await expect(kaelTrigger.getByText("Viewing", { exact: true })).toHaveCount(0);
  await expect(radaTwoTrigger).toHaveCSS("border-left-color", "rgb(245, 196, 81)");
  await expect(radaTwoTrigger).toHaveCSS("border-left-width", "2px");
  await expect(kaelTrigger).toHaveCSS("border-left-color", "rgba(0, 0, 0, 0)");
  await expect(kaelTrigger).toHaveCSS("border-left-width", "2px");
  // Exactly one row is selected at any time.
  await expect(page.getByText("Viewing", { exact: true })).toHaveCount(1);

  // Mobile-first: no horizontal overflow at the canonical phone viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Review evidence: a LATER row selected (the gold rail regression case) and
  // the profile panel (neutral silhouette portrait, identity, overall level,
  // skill progress).
  await radaTwoTrigger.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/character-profile-mobile-rows.png" });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/character-profile-mobile-panel.png" });

  // Closing returns focus predictably to the name that opened the view and
  // removes the selected treatment from every row.
  await panel.getByRole("button", { name: "Close character profile" }).click();
  await expect(panel).toBeHidden();
  await expect(radaTwoTrigger).toBeFocused();
  await expect(radaTwoTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Viewing", { exact: true })).toHaveCount(0);
});

test("the profile panel works from the keyboard with predictable focus return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ }).click();

  const opener = page.getByRole("button", {
    name: `${radaOne}, Level 2, player Rada Stonehand`,
  });
  const panel = page.locator("[data-character-profile-panel]");
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();

  // Escape closes and focus returns to the opener.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();

  // Enter reopens; the explicit Close control closes and returns focus.
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close character profile" }).click();
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();

  // Switching targets from the keyboard updates the same panel.
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  const second = page.getByRole("button", {
    name: `${radaTwo}, Level 1, player Rada Stonehand`,
  });
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveCount(1);
  await expect(panel.getByText(radaTwo, { exact: true })).toBeVisible();
  await expect(panel.getByText("Overall level 1")).toBeVisible();

  // Closing with the disclosure collapsed must not strand focus on the hidden
  // list button: Escape falls back to the persistent disclosure trigger.
  const disclosure = page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ });
  await disclosure.click();
  await expect(page.locator("#location-population-list")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(disclosure).toBeFocused();
});

test("a failed profile read shows visible accessible feedback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ }).click();
  await page.route("**/api/character-profile?*", (route) => route.abort());
  await page.getByRole("button", { name: `${radaOne}, Level 2, player Rada Stonehand` }).click();
  const panel = page.locator("[data-character-profile-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("The profile could not be loaded.")).toBeVisible();
  await page.unroute("**/api/character-profile?*");
});

test("an authoritative location change invalidates the open profile panel", async ({ page }) => {
  // Seed an extra same-location character AFTER the page loaded, then refresh:
  // the accepted authoritative revision revalidates the population, and a
  // target that is no longer visible must never keep showing stale data.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ }).click();
  const trigger = page.getByRole("button", {
    name: `${radaOne}, Level 2, player Rada Stonehand`,
  });
  await trigger.click();
  const panel = page.locator("[data-character-profile-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(radaOne, { exact: true })).toBeVisible();

  // Move the target character to another location server-side, then refresh:
  // the server revalidates same-location visibility on the re-read, and the
  // panel must show the safe unavailable state instead of stale data.
  const targetRow = (
    await db
      .select({ id: rune.characters.id })
      .from(rune.characters)
      .where(eq(rune.characters.normalizedName, normalizeCharacterName(radaOne)))
  )[0];
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(rune.characters.id, targetRow!.id));

  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(panel.getByText("Character not found")).toBeVisible();
  await expect(panel.getByText(radaOne, { exact: true })).toHaveCount(0);

  // The removed opener is gone from the list, so Escape must fall back to the
  // persistent disclosure trigger instead of a missing control.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /^(Show|Hide) .*characters here$/ })).toBeFocused();

  // Reopen for the travel-invalidation assertion below.
  await page.getByRole("button", { name: `${radaTwo}, Level 1, player Rada Stonehand` }).click();
  await expect(panel).toBeVisible();

  // Travel away: the open profile panel must be invalidated immediately on the
  // authoritative location change (no stale crash-site content at the yard).
  await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
  await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
  await expect(page.getByText("Journey progress")).toBeVisible();
  const departPast = new Date(Date.now() - 25_000);
  await db
    .update(rune.activeActions)
    .set({ startedAt: departPast, resolvedThroughAt: departPast })
    .where(eq(rune.activeActions.characterId, characterId));
  await expect(
    page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
  ).toHaveAttribute("aria-current", "true", { timeout: 45_000 });
  await expect(panel).toBeHidden();
});
