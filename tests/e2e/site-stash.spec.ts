import { eq } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
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
import * as rune from "@/db/rune-space";
import { installedMaterials, seedRepairTarget } from "../integration/fixtures";
import { expect, openTestCharacter, test } from "./fixtures";
import { seedLegacyStarterCutter } from "./legacy-starter";
import { captureReviewScreenshot } from "./review-screenshot";
import {
  expectDetailsAboveNav,
  expectDetailsBeneathRow,
  expectSelectionMovesAndCloses,
} from "./storage-row-details";

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

/**
 * The bar is two intentional rows: the title and Show/Hide share the first, at
 * the bar's right edge, and the summary — however long — takes the full width of
 * the second. Measured, because a wrapping flow looks fine until a long summary
 * pushes the control somewhere odd.
 */
async function expectTwoRowBar(page: Page) {
  // One synchronous read: the reveal on opening scrolls smoothly, and boxes read
  // one call at a time would each be measured at a different scroll position.
  const { bar, title, indicator, summary } = await page.evaluate(() => {
    const rect = (selector: string) => {
      const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      bar: rect("[data-site-stash-toggle]"),
      title: rect("[data-site-stash-title]"),
      indicator: rect("[data-site-stash-indicator]"),
      summary: rect("[data-site-stash-summary]"),
    };
  });
  // Same row, control at the right edge.
  expect(Math.abs(title.y + title.height / 2 - (indicator.y + indicator.height / 2))).toBeLessThan(
    3,
  );
  expect(indicator.x).toBeGreaterThan(title.x + title.width - 1);
  expect(bar.x + bar.width - (indicator.x + indicator.width)).toBeLessThan(20);
  // The summary is a second row, spanning the bar.
  expect(summary.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  expect(summary.width).toBeGreaterThan(bar.width - 32);
  expect(bar.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
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
  // The bar is the panel's header: the work sits under it with no second title.
  await expect(toggle(page)).toContainText("Build Stash Mount");
  await expect(build).toBeVisible();
  await expect(build.getByRole("heading")).toHaveCount(0);
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
  await expectTwoRowBar(page);
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
  await expectTwoRowBar(page);
  await expect(notice).toHaveCount(0, { timeout: 10_000 });

  // Built: the bar asks for a container, and with none carried that is one quiet
  // explanation in place — no disabled workflow.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Mount built · Install a container");
  await expand(page);
  const stash = page.locator(`[data-site-stash="${LOCATION_IDS.theJag}"]`);
  await expect(stash).toBeVisible();
  await expect(stash.locator("[data-stash-hint]")).toContainText("Carry an unequipped container");
  await expect(stash.locator("[data-stash-install-confirm]")).toHaveCount(0);

  await carryContainer(characterId, ITEM_IDS.scrapBox);
  await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.salvageCutter });
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 });
  await page.reload();
  await expand(page);
  // The one eligible container is a real card, and installing goes straight to
  // the shared storage surface in this same panel.
  await expect(stash.locator("[data-stash-container-card]")).toHaveCount(1);
  await stash.locator("[data-stash-install-confirm]").click();
  const storage = stash.locator("[data-stash-storage]");
  await expect(storage).toBeVisible();
  await expect(storage).toBeInViewport();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  // The bar tracks the same state while the detail is open.
  await expect(summary).toContainText("Scrap Box · 0 / 3 slots");
  await expectTwoRowBar(page);

  // Real stack and unique deposits through the shared surface.
  await storage
    .locator("[data-storage-area='carried']")
    .getByRole("button", { name: /Ferrite Shale/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "DEPOSIT STACK" })
    .click();
  await expect(stash).toContainText("Stashed.");
  await expect(summary).toContainText("Scrap Box · 1 / 3 slots");
  await expect(storage.locator("[data-storage-area='stored']")).toContainText("Ferrite Shale");
  await storage
    .locator("[data-storage-area='carried']")
    .getByRole("button", { name: /Salvage Cutter/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "DEPOSIT ITEM" })
    .click();
  await expect(summary).toContainText("Scrap Box · 2 / 3 slots");
  await expect(storage.locator("[data-storage-area='stored']")).toContainText("Salvage Cutter");

  // Swap and Remove stay out of the way until asked for, then say what is valid
  // and why anything is not.
  await expect(stash.locator("[data-stash-remove]")).toHaveCount(0);
  await expect(stash.locator("[data-stash-management]")).toHaveCount(0);
  const management = page.locator("[data-stash-management-toggle]");
  await expect(management).toHaveAttribute("aria-expanded", "false");
  await management.click();
  await expect(management).toHaveAttribute("aria-expanded", "true");
  await expect(stash.locator("[data-stash-remove]")).toBeDisabled();
  await expect(stash.locator("[data-stash-management]")).toContainText(
    "only be removed once the stash is empty",
  );
  await expect(stash.locator("[data-stash-management]")).toContainText(
    "To swap, carry a different kind of container",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await captureReviewScreenshot(page, "site-stash-mobile.png");

  // Collapse and reopen go straight back to storage; a refresh lands collapsed
  // and reopens to the same stored items, which the server kept.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await toggle(page).click();
  await expect(storage).toBeVisible();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("Scrap Box · 2 / 3 slots");
  // Stored items stay at the site when the character is elsewhere and returns.
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await page.reload();
  await expect(disclosure(page)).toHaveCount(0);
  await standAt(characterId, LOCATION_IDS.theJag);
  await page.reload();
  await expect(summary).toContainText("Scrap Box · 2 / 3 slots");
  await expand(page);

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
  await storage
    .locator("[data-storage-area='stored']")
    .getByRole("button", { name: /Salvage Cutter/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "WITHDRAW ITEM" })
    .click();
  await expect(summary).toContainText("Scrap Box · 0 / 3 slots");

  await page.locator("[data-stash-management-toggle]").click();
  await expect(stash.locator("[data-stash-remove]")).toBeEnabled();
  await stash.locator("[data-stash-remove]").click();
  // The container is carried again, the mount stays built, and the panel offers
  // it back as the choice it is.
  await expect(stash.locator("[data-stash-container-card]")).toHaveCount(1);
  await expect(stash).toContainText("Scrap Box removed.");
  await expect(summary).toContainText("Mount built · Install a container");
});

/**
 * Cross-activity ownership (#288 follow-up).
 *
 * A site stash's Welding and the site's own activity share one global
 * `state.activeAction`. Each activity's attempt meter, timing labels and
 * Start/Stop controls must answer only to its own action: the other one running
 * must never animate them, and the durable counts (welds completed) must move
 * only with the work that earns them.
 */
const meterIn = (scope: Locator, label: string) =>
  scope.getByRole("progressbar", { name: new RegExp(`^${label}:`) });
const meterValue = async (meter: Locator) => Number(await meter.getAttribute("aria-valuenow"));

/** Fast-forward the character's running action, so the server resolves it on the next load. */
async function ageActiveAction(characterId: string, milliseconds: number) {
  const ago = new Date(Date.now() - milliseconds);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
}

/**
 * Mining and the stash mount's Welding at one site, both directions. Each
 * activity's meters and controls answer only to its own action, and the mount's
 * completed welds move only while Welding actually runs.
 */
async function exerciseMiningAndStashWelding(page: Page, characterId: string, targetId: string) {
  const build = page.locator(`[data-repair-work-panel="${targetId}"]`);
  const mining = page.locator("[data-mining-activity]");
  const summary = disclosure(page).locator("[data-site-stash-summary]");
  const startMining = mining.getByRole("button", { name: "Start Mining" });
  await expand(page);
  await build.locator("[data-repair-contribute]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  // Nothing running: Mining is the idle, startable activity it always was.
  await expect(startMining).toBeEnabled();
  await expect(meterIn(mining, "Mining attempt")).toHaveCount(0);

  // 1. Welding runs. Its own current-weld timer advances ...
  await build.locator("[data-repair-start-welding]").click();
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();
  await expect
    .poll(async () => meterValue(meterIn(build, "Current weld")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // ... and Mining shows none of it: no Stop Mining, no attempt meter, no timing
  // label, and a Start Mining it could not honour is disabled and says why.
  await expect.soft(mining.getByRole("button", { name: "Stop Mining" })).toHaveCount(0);
  await expect.soft(meterIn(mining, "Mining attempt")).toHaveCount(0);
  await expect.soft(mining.getByText(/NORMAL TIMING|to next attempt/)).toHaveCount(0);
  await expect.soft(startMining).toBeDisabled();
  await expect.soft(mining.getByText(/Mining is idle/)).toBeVisible();
  await expect.soft(mining.getByText(/Another activity is active/)).toBeVisible();

  // 2. Stop Welding, start Mining. Mining's own attempt timer advances ...
  await build.locator("[data-repair-stop-welding]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  const weldsBeforeMining = await summary.innerText();
  await expect(startMining).toBeEnabled();
  await expect(mining.getByText(/Another activity is active/)).toHaveCount(0);
  await startMining.click();
  await expect(mining.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect
    .poll(async () => meterValue(meterIn(mining, "Mining attempt")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // ... while the stash's Welding is idle: no current-weld timer, no Stop Welding,
  // no Start Welding it could not honour, and its completed welds do not move.
  await expect.soft(meterIn(build, "Current weld")).toHaveCount(0);
  await expect.soft(build.locator("[data-repair-stop-welding]")).toHaveCount(0);
  await expect.soft(build.locator("[data-repair-start-welding]")).toBeDisabled();
  await expect.soft(build.locator("[data-clean-pass]")).toHaveCount(0);
  await expect(summary).toHaveText(weldsBeforeMining);
  // Mining attempts resolving in the background, then a reload, still leave the
  // welds where Welding left them.
  await ageActiveAction(characterId, 30_000);
  await page.reload();
  await expect(mining.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(summary).toHaveText(weldsBeforeMining);
  await expand(page);
  await expect(build.locator("[data-repair-start-welding]")).toBeDisabled();
  await expect(meterIn(build, "Current weld")).toHaveCount(0);

  // 3. Stop Mining and the idle stash is startable again.
  await mining.getByRole("button", { name: "Stop Mining" }).click();
  await expect(startMining).toBeEnabled();
  await expect(build.locator("[data-repair-start-welding]")).toBeEnabled();
}

test("The Jag: Welding and Mining never borrow each other's meters or controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.theJag);
  await seedLegacyStarterCutter(characterId);
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 3 },
  ]);
  await page.reload();
  await exerciseMiningAndStashWelding(page, characterId, REPAIR_TARGET_IDS.siteStashTheJag);
});

test("Processing Yard: Welding and Refining never borrow each other's meters or controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.abandonedProcessingYard);
  await setWelding(characterId, 5);
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.galvanicStock, quantity: 3 },
    { characterId, itemId: ITEM_IDS.mountingBracket, quantity: 2 },
    { characterId, itemId: ITEM_IDS.ferriteShale, quantity: 6 },
  ]);
  await page.reload();

  const build = page.locator(
    `[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashProcessingYard}"]`,
  );
  const refining = page.locator("[data-refining-activity]");
  const summary = disclosure(page).locator("[data-site-stash-summary]");
  const startRefining = refining.getByRole("button", { name: "Start Refining" });
  await expand(page);
  await build.locator("[data-repair-contribute]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  await expect(startRefining).toBeEnabled();

  // 1. Welding runs: its own timer advances, Refining looks and acts idle.
  await build.locator("[data-repair-start-welding]").click();
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();
  await expect
    .poll(async () => meterValue(meterIn(build, "Current weld")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect.soft(refining.getByRole("button", { name: "Stop Refining" })).toHaveCount(0);
  await expect.soft(meterIn(refining, "Refining attempt")).toHaveCount(0);
  await expect.soft(refining.locator("[data-bounded-run-progress]")).toHaveCount(0);
  await expect.soft(startRefining).toBeDisabled();

  // 2. Stop Welding, start Refining: Refining's timer advances, Welding is idle
  // and its completed welds do not move.
  await build.locator("[data-repair-stop-welding]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  const weldsBeforeRefining = await summary.innerText();
  await expect(startRefining).toBeEnabled();
  await refining.locator("[data-bounded-run-max]").click();
  await startRefining.click();
  await expect(refining.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  await expect
    .poll(async () => meterValue(meterIn(refining, "Refining attempt")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect.soft(meterIn(build, "Current weld")).toHaveCount(0);
  await expect.soft(build.locator("[data-repair-stop-welding]")).toHaveCount(0);
  await expect.soft(build.locator("[data-repair-start-welding]")).toBeDisabled();
  await expect.soft(build.locator("[data-clean-pass]")).toHaveCount(0);
  await expect(summary).toHaveText(weldsBeforeRefining);
  // One Refining attempt resolves in the background; the Max run is still going.
  await ageActiveAction(characterId, 5_000);
  await page.reload();
  await expect(refining.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  await expect(summary).toHaveText(weldsBeforeRefining);
});

test("keeps the compact bar to two rows at 320 px, with the longest recipes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const characterId = page.url().split("/").at(-1)!;
  // Rusk's mount names two long materials and ten welds.
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await setWelding(characterId, 5);
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure(page).locator("[data-site-stash-summary]")).toContainText(
    "Galvanic Stock 0 / 3 · Mounting Bracket 0 / 2 · 0 / 10 welds",
  );
  await expectTwoRowBar(page);
  await expand(page);
  await expectTwoRowBar(page);
});

test("opening the stash brings it into view, and nothing else scrolls the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.theJag);
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 3 },
  ]);
  // Record every scroll-into-view request from before the first script runs.
  await page.addInitScript(() => {
    const calls: { block?: string; behavior?: string; target: string }[] = [];
    (window as unknown as { __reveals: typeof calls }).__reveals = calls;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
      const options = typeof arg === "object" ? arg : {};
      calls.push({
        ...(options.block ? { block: options.block } : {}),
        ...(options.behavior ? { behavior: options.behavior } : {}),
        target:
          (this as HTMLElement).dataset.siteStashDisclosure !== undefined
            ? "disclosure"
            : (this as HTMLElement).hasAttribute("data-stash-storage")
              ? "storage"
              : "other",
      });
      return original.call(this, arg as ScrollIntoViewOptions);
    };
  });
  const reveals = () =>
    page.evaluate(() => (window as unknown as { __reveals: { target: string }[] }).__reveals);
  await page.reload();

  const build = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashTheJag}"]`);
  const nav = page.getByRole("navigation", { name: "Primary" });
  // Initial mount of a collapsed bar scrolls nothing.
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  expect(await reveals()).toEqual([]);

  // Mining is about a full phone screen, so the bar sits at the foot of the page.
  // Tapping Show there must leave the opened heading and first control on screen,
  // above the fixed bottom navigation, without a manual scroll.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrolledBefore = await page.evaluate(() => window.scrollY);
  expect(scrolledBefore).toBeGreaterThan(0);
  await toggle(page).click();
  await expect(toggle(page)).toBeInViewport();
  const contribute = build.locator("[data-repair-contribute]");
  await expect(contribute).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const control = (await contribute.boundingBox())!;
      const navigation = (await nav.boundingBox())!;
      return control.y + control.height <= navigation.y;
    })
    .toBe(true);
  expect(await reveals()).toEqual([{ block: "start", behavior: "smooth", target: "disclosure" }]);

  // Collapsing is not a reveal, and neither is a refresh that lands collapsed.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  expect(await reveals()).toHaveLength(1);

  // Welding opening the detail on its own is not a reveal either.
  await toggle(page).click();
  await build.locator("[data-repair-contribute]").click();
  await build.locator("[data-repair-start-welding]").click();
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  expect(await reveals()).toEqual([]);

  // Reduced motion still reveals, without the animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await build.locator("[data-repair-stop-welding]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await toggle(page).click();
  expect(await reveals()).toEqual([{ block: "start", behavior: "auto", target: "disclosure" }]);
});

test("Deep Jag: the mine and its stash share the site without sharing meters", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const characterId = page.url().split("/").at(-1)!;
  // The braced-open passage is a mine; Welding 8 earns the mount.
  await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.deepJagCaveIn, {
    materials: installedMaterials(getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance)),
    weldingProgress: getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance)
      .repairIncrements,
    completedAt: new Date(),
  });
  await standAt(characterId, LOCATION_IDS.deepJag);
  await setWelding(characterId, 8);
  await seedLegacyStarterCutter(characterId);
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.galvaferrite, quantity: 2 },
    { characterId, itemId: ITEM_IDS.mountingBracket, quantity: 2 },
    { characterId, itemId: ITEM_IDS.galvanicStock, quantity: 1 },
  ]);
  await page.reload();
  await expect(page.locator("[data-mining-activity]")).toBeVisible();
  // The longest recipe (three materials, fifteen welds) at the narrowest phone.
  await expect(disclosure(page).locator("[data-site-stash-summary]")).toContainText(
    "Galvaferrite 0 / 2 · Mounting Bracket 0 / 2 · Galvanic Stock 0 / 1 · 0 / 15 welds",
  );
  await expectTwoRowBar(page);
  await exerciseMiningAndStashWelding(page, characterId, REPAIR_TARGET_IDS.siteStashDeepJag);
});

/**
 * One interface (#288 UX follow-up): the compact bar is the header of ONE stash
 * panel, and what is under it is the one thing that stage needs — a visible
 * container choice, then the shared storage surface, with the rarely used
 * Swap / Remove behind a quiet management disclosure.
 */
async function builtMountAtTheJag(page: Page) {
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.theJag);
  const recipe = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashTheJag, balance);
  await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.siteStashTheJag, {
    materials: installedMaterials(recipe),
    weldingProgress: recipe.repairIncrements,
    completedAt: new Date(),
  });
  return characterId;
}

async function carryContainer(characterId: string, itemId: string) {
  const [row] = await db.insert(itemInstances).values({ characterId, itemId }).returning();
  return row!.id;
}

/** The control sits wholly on screen, clear of the fixed bottom navigation. */
async function expectAboveNav(page: Page, locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const box = (await locator.boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
      return box.y >= 0 && box.y + box.height <= nav.y;
    })
    .toBe(true);
}

const stashContent = (page: Page) => page.locator("[data-site-stash]");

/** Tap Show the way a player does at the foot of the page. */
async function showFromTheFoot(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}

test("a built mount without a container is one panel that asks for one in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = await builtMountAtTheJag(page);
  await page.reload();

  // Nothing eligible: one quiet explanation in place, no disabled workflow.
  await showFromTheFoot(page);
  await expect(stashContent(page).locator("[data-stash-hint]")).toContainText(
    "Carry an unequipped container",
  );
  await expect(page.locator("[data-stash-container-card]")).toHaveCount(0);
  await expect(page.locator("[data-stash-install-confirm]")).toHaveCount(0);
  // One frame, one heading: the bar IS the panel's header.
  await expect(disclosure(page).locator("[data-activity-panel]")).toHaveCount(0);
  await expect(disclosure(page).getByRole("heading", { name: "Site Stash" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Open|Close) Stash$/ })).toHaveCount(0);
  await captureReviewScreenshot(page, "site-stash-choose-none-mobile.png");

  // One eligible container: its real card is on screen at once. The equipped
  // container is never offered.
  const scrapBox = await carryContainer(characterId, ITEM_IDS.scrapBox);
  await page.reload();
  await showFromTheFoot(page);
  const cards = page.locator("[data-stash-container-card]");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-stash-container-card", scrapBox);
  await expect(cards.first()).toContainText("Scrap Box");
  await expect(cards.first()).toContainText("3 slots");
  await expectAboveNav(page, cards.first());
  await expectAboveNav(page, page.locator("[data-stash-install-confirm]"));
  await captureReviewScreenshot(page, "site-stash-choose-one-mobile.png");

  // Several: the player chooses; a card selects and does not install.
  const harness = await carryContainer(characterId, ITEM_IDS.freightHarness);
  await page.reload();
  await showFromTheFoot(page);
  await expect(cards).toHaveCount(2);
  const harnessCard = page.locator(`[data-stash-container-card="${harness}"]`);
  const scrapCard = page.locator(`[data-stash-container-card="${scrapBox}"]`);
  const install = page.locator("[data-stash-install-confirm]");
  await expect(install).toBeDisabled();
  await expect(harnessCard.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expectAboveNav(page, install);
  await harnessCard.getByRole("button").click();
  await expect(harnessCard.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(scrapCard.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect(install).toBeEnabled();
  await expect(toggle(page)).toContainText("Mount built · Install a container");

  // Installing moves straight to storage in the same panel: no second Open Stash,
  // the panel stays expanded, and the header proves the install.
  await install.click();
  await expect(page.locator("[data-stash-storage]")).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(disclosure(page).locator("[data-site-stash-summary]")).toContainText(
    "Freight Harness · 0 / 6 slots",
  );
  await expect(page.getByRole("button", { name: /^(Open|Close) Stash$/ })).toHaveCount(0);
  await expect(page.locator("[data-stash-container-card]")).toHaveCount(0);
  await expectAboveNav(page, page.getByRole("tab", { name: /^STASH/ }));
  // A concise confirmation that does not stay.
  const feedback = page.locator("[data-stash-feedback]");
  await expect(feedback).toContainText("Freight Harness installed.");
  await expect(feedback).toHaveCount(0, { timeout: 10_000 });
});

test("Container management hides Swap and Remove until asked, and swaps by selecting a card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = await builtMountAtTheJag(page);
  await carryContainer(characterId, ITEM_IDS.freightHarness);
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 2 });
  await page.reload();
  await showFromTheFoot(page);
  await page.locator("[data-stash-install-confirm]").click();
  const summary = disclosure(page).locator("[data-site-stash-summary]");
  await expect(summary).toContainText("Freight Harness · 0 / 6 slots");

  // One stored stack, so the replacement has something to hold.
  const storage = page.locator("[data-stash-storage]");
  await storage
    .locator("[data-storage-area='carried']")
    .getByRole("button", { name: /Ferrite Shale/ })
    .click();
  await storage
    .locator("[data-storage-selection]")
    .getByRole("button", { name: "DEPOSIT STACK" })
    .click();
  await expect(summary).toContainText("Freight Harness · 1 / 6 slots");

  // Only another container of the same kind is carried: not a valid swap, and the
  // reason is said in place. The same kind is never offered as a card.
  await carryContainer(characterId, ITEM_IDS.freightHarness);
  await page.reload();
  await expand(page);
  await expect(page.locator("[data-stash-management]")).toHaveCount(0);
  const management = page.locator("[data-stash-management-toggle]");
  await management.click();
  const region = page.locator("[data-stash-management]");
  await expect(region).toContainText("None of the containers you carry can replace it");
  await expect(page.locator("[data-stash-swap-card]")).toHaveCount(0);
  await expect(page.locator("[data-stash-swap-confirm]")).toHaveCount(0);
  // Opening it brought its heading on screen, above the fixed navigation.
  await expectAboveNav(page, region.getByRole("heading", { name: "Swap container" }));

  // A different kind with room: one card, selected by the player, then confirmed.
  const scrapBox = await carryContainer(characterId, ITEM_IDS.scrapBox);
  await page.reload();
  await expand(page);
  await management.click();
  const card = page.locator(`[data-stash-swap-card="${scrapBox}"]`);
  await expect(page.locator("[data-stash-swap-card]")).toHaveCount(1);
  await expect(card).toContainText("3 slots");
  const confirm = page.locator("[data-stash-swap-confirm]");
  // With exactly one candidate it starts selected; either way a card never swaps.
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(summary).toContainText("Freight Harness · 1 / 6 slots");
  await confirm.click();
  await expect(summary).toContainText("Scrap Box · 1 / 3 slots");
  await expect(page.locator("[data-site-stash]")).toContainText("Swapped in Scrap Box");
  // Everything stashed stayed put.
  await expect(page.locator("[data-storage-area='stored']")).toContainText("Ferrite Shale");
});

test("opens a stash item's details beneath its own row on phone and desktop (Issue #291)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = await builtMountAtTheJag(page);

  // An installed Freight Harness filled to its six slots, and seven carried
  // entries: several rows in both regions at three columns and at four, with a
  // long-named stack and a charged unique item in each.
  const harness = await carryContainer(characterId, ITEM_IDS.freightHarness);
  await db
    .insert(rune.siteStashContainers)
    .values({ characterId, locationId: LOCATION_IDS.theJag, itemInstanceId: harness });
  await db.insert(rune.siteStashStacks).values(
    [
      [ITEM_IDS.ferriteShale, 4],
      [ITEM_IDS.refinedFerrite, 3],
      [ITEM_IDS.slag, 2],
    ].map(([itemId, quantity]) => ({
      characterId,
      locationId: LOCATION_IDS.theJag,
      itemId: itemId as string,
      quantity: quantity as number,
    })),
  );
  const stored = await db
    .insert(itemInstances)
    .values(
      [0, 1, 2].map(() => ({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })),
    )
    .returning();
  await db.insert(rune.siteStashItemInstances).values(
    stored.map((instance) => ({
      characterId,
      locationId: LOCATION_IDS.theJag,
      itemInstanceId: instance.id,
    })),
  );
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.ferriteShale, quantity: 2 },
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 1 },
    { characterId, itemId: ITEM_IDS.scrapMetal, quantity: 6 },
  ]);
  await db
    .insert(itemInstances)
    .values(
      [0, 1, 2].map(() => ({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })),
    );

  await page.reload();
  await showFromTheFoot(page);
  const storage = page.locator("[data-stash-storage]");
  const carriedSection = storage.locator("[data-storage-area='carried']");
  const stashSection = storage.locator("[data-storage-area='stored']");
  const regions = [
    { tab: /^CARRIED/, section: carriedSection, tiles: 7 },
    { tab: /^STASH/, section: stashSection, tiles: 6 },
  ];

  // Phone, three columns: first, middle and last of each tab.
  for (const { tab, section, tiles } of regions) {
    await storage.getByRole("tab", { name: tab }).click();
    await expect(section.locator("button[aria-pressed]")).toHaveCount(tiles);
    for (const index of [0, Math.floor(tiles / 2), tiles - 1]) {
      const measured = await expectDetailsBeneathRow(page, section, index);
      expect(measured.columns).toBe(3);
      await expectDetailsAboveNav(page, section);
    }
    await expectSelectionMovesAndCloses(page, section);
  }
  await captureReviewScreenshot(page, "site-stash-mobile-row-details.png");

  // The long name at the narrowest phone, from a real stack in the stash.
  await page.setViewportSize({ width: 320, height: 640 });
  const stashTiles = stashSection.locator("button[aria-pressed]");
  const refinedIndex = await stashTiles.evaluateAll((tiles) =>
    tiles.findIndex((tile) => tile.getAttribute("aria-label")?.includes("Refined Ferrite")),
  );
  expect(refinedIndex).toBeGreaterThanOrEqual(0);
  const narrow = await expectDetailsBeneathRow(page, stashSection, refinedIndex);
  expect(narrow.columns).toBe(3);
  expect(narrow.name.text).toBe("Refined Ferrite");
  await expectDetailsAboveNav(page, stashSection);
  await expect(stashSection.locator("[data-storage-selection]")).toContainText("Quantity 3");

  // A real withdraw from the selected stack: the entry is gone from the stash, the
  // selection is reconciled with no stale details left behind, and the host's
  // own feedback shows.
  await stashSection
    .locator("[data-storage-selection]")
    .getByRole("button", {
      name: "WITHDRAW STACK",
    })
    .click();
  await expect(page.locator("[data-storage-selection]")).toHaveCount(0);
  await expect(stashSection.locator("button[aria-pressed]")).toHaveCount(5);

  // Desktop, four columns, both regions side by side.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(carriedSection).toBeVisible();
  await expect(stashSection).toBeVisible();
  for (const section of [carriedSection, stashSection]) {
    const count = await section.locator("button[aria-pressed]").count();
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      const measured = await expectDetailsBeneathRow(page, section, index);
      expect(measured.columns).toBe(4);
    }
  }
  await captureReviewScreenshot(page, "site-stash-desktop-row-details.png");
});
