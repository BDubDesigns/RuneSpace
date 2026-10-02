import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { db } from "@/db";
import {
  activeActions,
  characterSkillXp,
  characters,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, REPAIR_TARGET_IDS, SKILL_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #284 — character-owned site stashes in a real browser.
 *
 * The server suites own the rules (gates, capacity, swap and removal limits,
 * concurrency). This covers what only a rendered page can answer: that nothing
 * about a stash is on screen before the character has earned it; that once
 * earned it is a compact disclosure below the site's own activity, collapsed by
 * default and held open while its Welding runs; and that the Build Stash Mount
 * → Install Container → Stash journey works at phone width through the shared
 * storage surface.
 */

const balance = getEffectiveGameBalance();
const jagMount = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashTheJag, balance);

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function setWelding(characterId: string, level: number) {
  const totalXp = standardSkillLevelThresholds(balance).find(
    (threshold) => threshold.level === level,
  )!.totalXp;
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.welding, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

const disclosure = (page: Page) => page.locator("[data-site-stash-disclosure]");
const toggle = (page: Page) => page.locator("[data-site-stash-toggle]");

/** Open the disclosure if it is closed; a no-op when something already holds it open. */
async function expand(page: Page) {
  if ((await toggle(page).getAttribute("aria-expanded")) !== "true") await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}

test("shows nothing before the site's Welding gate, then a collapsed bar once earned", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await setWelding(characterId, 4);
  await page.reload();

  // No bar, no panel, no teaser, no disabled control: nothing mentions a stash.
  await expect(disclosure(page)).toHaveCount(0);
  await expect(page.locator("[data-site-stash]")).toHaveCount(0);
  await expect(
    page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashRuskRecovery}"]`),
  ).toHaveCount(0);
  await expect(page.getByText(/stash mount/i)).toHaveCount(0);

  await setWelding(characterId, 5);
  await page.reload();
  // Newly eligible: a compact bar that says the stage and the progress, closed.
  await expect(disclosure(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure(page).locator("[data-site-stash-summary]")).toContainText(
    "Galvanic Stock 0 / 3 · Mounting Bracket 0 / 2 · 0 / 10 welds",
  );
  const build = page.locator(
    `[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashRuskRecovery}"]`,
  );
  await expect(build).toHaveCount(0);

  // Opens on demand to the standard staged-material surface, and the disclosure
  // is a real keyboard control with an accurate state.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(build.getByRole("heading", { name: /Build Stash Mount/ })).toBeVisible();
  await expect(build).toContainText("Galvanic Stock");
  await expect(build).toContainText("Mounting Bracket");
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(build).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("keeps Deep Jag's mount hidden until the passage is open, even at Welding 8", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.deepJag);
  await setWelding(characterId, 8);
  await page.reload();
  await expect(disclosure(page)).toHaveCount(0);
  await expect(page.locator("[data-site-stash]")).toHaveCount(0);
  await expect(page.getByText(/stash mount/i)).toHaveCount(0);
});

test("lives through build, Welding, completion and use at The Jag on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.theJag);
  // Welding 1 is all The Jag's mount asks of the character. Only part of the
  // material to start with, so progress has to survive a refresh.
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 });
  await page.reload();

  const build = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashTheJag}"]`);
  const summary = disclosure(page).locator("[data-site-stash-summary]");
  await expect(disclosure(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Refined Ferrite 0 / 6 · Slag 0 / 3 · 0 / 6 welds");
  await expect(build).toHaveCount(0);
  // Secondary to the site's own activity: it comes after Mining in the page.
  const belowMining = await page.evaluate(() => {
    const mining = document.querySelector("[data-mining-activity]");
    const bar = document.querySelector("[data-site-stash-disclosure]");
    return Boolean(
      mining && bar && mining.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(belowMining).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The bar sits at the end of the page, under the footer navigation; scroll
  // all the way down so the capture shows it clear of the nav.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await captureReviewScreenshot(page, "site-stash-collapsed-mobile.png");

  // A partial contribution while idle, then collapse by hand: still collapsed
  // and still accurate after a refresh.
  await expand(page);
  await build.locator("[data-repair-contribute]").click();
  await expect(summary).toContainText("Refined Ferrite 5 / 6");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Refined Ferrite 5 / 6 · Slag 0 / 3 · 0 / 6 welds");

  // The rest of the material, then Welding begins.
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 1 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 3 },
  ]);
  await page.reload();
  await expand(page);
  await build.locator("[data-repair-contribute]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  await build.locator("[data-repair-start-welding]").click();
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();
  // While its Welding runs the detail cannot be collapsed away.
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

  // A refresh mid-weld lands collapsed-by-default state on an open panel anyway:
  // Stop (and the Clean Pass beside it) are never hidden.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();
  await captureReviewScreenshot(page, "site-stash-welding-mobile.png");

  // Fast-forward the six sections rather than waiting them out. The page picks
  // the completion up by itself, with no reload.
  const finishedAgo = new Date(
    Date.now() - jagMount.repairIncrements * balance.welding.attemptDurationTicks * 600 - 100,
  );
  await db
    .update(activeActions)
    .set({ startedAt: finishedAgo, resolvedThroughAt: finishedAgo })
    .where(eq(activeActions.characterId, characterId));
  const notice = page.locator("[data-site-stash-notice]");
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText("Stash Mount built");
  await expect(page.locator("[data-site-stash-announcement]")).toContainText("Stash Mount built");
  // Construction is gone: the compact bar now says the next step, not a full panel.
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Mount built · Install a container");
  await expect(build).toHaveCount(0);
  await expect(notice).toHaveCount(0, { timeout: 10_000 });

  // Built stash starts compact and opens to Install Container, disabled until
  // the character actually carries an unequipped container.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Mount built · Install a container");
  await expand(page);
  const stash = page.locator(`[data-site-stash="${LOCATION_IDS.theJag}"]`);
  await expect(stash).toBeVisible();
  await expect(stash.locator("[data-stash-install]")).toBeDisabled();

  await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.scrapBox });
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 });
  await page.reload();
  await expand(page);
  await expect(stash.locator("[data-stash-install]")).toBeEnabled();
  await stash.locator("[data-stash-install]").click();
  await stash.getByRole("button", { name: /Scrap Box · 3 slots/ }).click();
  await expect(stash.locator("[data-stash-occupancy]")).toContainText("Scrap Box · 0 / 3");
  // The bar tracks the same state while the detail is open.
  await expect(summary).toContainText("Scrap Box · 0 / 3 slots");
  // Nothing stored: it may be removed, and nothing else is a candidate to swap.
  await expect(stash.locator("[data-stash-remove]")).toBeEnabled();
  await expect(stash.locator("[data-stash-swap]")).toBeDisabled();

  // The one shared storage surface, not a second copy of it.
  await stash.locator("[data-stash-open]").click();
  const storage = stash.locator("[data-stash-storage]");
  await expect(storage).toBeVisible();
  await storage
    .locator("[data-storage-area='carried']")
    .getByRole("button", { name: /Ferrite Shale/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "DEPOSIT STACK" })
    .click();
  await expect(stash).toContainText("Stashed.");
  await expect(stash.locator("[data-stash-occupancy]")).toContainText("1 / 3");
  await expect(summary).toContainText("Scrap Box · 1 / 3 slots");
  await expect(storage.locator("[data-storage-area='stored']")).toContainText("Ferrite Shale");
  // A non-empty stash cannot give up its container, and says why.
  await expect(stash.locator("[data-stash-remove]")).toBeDisabled();
  await expect(stash.locator("[data-stash-hint]")).toContainText(
    "only be removed once the stash is empty",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await captureReviewScreenshot(page, "site-stash-mobile.png");

  // Stored items stay at the site and survive a refresh, which re-collapses.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Scrap Box · 1 / 3 slots");
  await expand(page);

  await stash.locator("[data-stash-open]").click();
  // A phone shows one region at a time and a reload resets it to the carried one.
  await storage.getByRole("tab", { name: /^STASH/ }).click();
  await storage
    .locator("[data-storage-area='stored']")
    .getByRole("button", { name: /Ferrite Shale/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "WITHDRAW STACK" })
    .click();
  await expect(stash.locator("[data-stash-occupancy]")).toContainText("0 / 3");

  await expect(stash.locator("[data-stash-remove]")).toBeEnabled();
  await stash.locator("[data-stash-remove]").click();
  // The container is carried again and the mount stays built.
  await expect(stash.locator("[data-stash-install]")).toBeEnabled();
  await expect(stash).toContainText("Scrap Box removed.");
  await expect(summary).toContainText("Mount built · Install a container");
});
