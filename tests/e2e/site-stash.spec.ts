import { eq } from "drizzle-orm";
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
 * about a stash is on screen before the character has earned it, and that the
 * Build Stash Mount → Install Container → Stash journey reads and works at
 * phone width through the shared storage surface.
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

test("shows no stash surface before the site's Welding gate, and builds it once earned", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await setWelding(characterId, 4);
  await page.reload();

  // No panel, no teaser, no disabled control: nothing mentions a stash at all.
  await expect(page.locator("[data-site-stash]")).toHaveCount(0);
  await expect(
    page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashRuskRecovery}"]`),
  ).toHaveCount(0);
  await expect(page.getByText(/stash mount/i)).toHaveCount(0);

  await setWelding(characterId, 5);
  await page.reload();
  const build = page.locator(
    `[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashRuskRecovery}"]`,
  );
  await expect(build).toBeVisible();
  await expect(build.getByRole("heading", { name: /Build Stash Mount/ })).toBeVisible();
  // The standard staged-material surface, with the authored Tier 2 recipe.
  await expect(build).toContainText("Galvanic Stock");
  await expect(build).toContainText("Mounting Bracket");
});

test("keeps Deep Jag's mount hidden until the passage is open, even at Welding 8", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.deepJag);
  await setWelding(characterId, 8);
  await page.reload();
  await expect(page.locator("[data-site-stash]")).toHaveCount(0);
  await expect(page.getByText(/stash mount/i)).toHaveCount(0);
});

test("builds, installs, stashes and retrieves at The Jag on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await standAt(characterId, LOCATION_IDS.theJag);
  // Welding 1 is all The Jag's mount asks of the character.
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 1 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 3 },
  ]);
  await page.reload();

  const build = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.siteStashTheJag}"]`);
  await expect(build.getByRole("heading", { name: /Build Stash Mount/ })).toBeVisible();
  await expect(page.locator("[data-site-stash]")).toHaveCount(0);
  await build.locator("[data-repair-contribute]").click();
  await expect(build.locator("[data-repair-start-welding]")).toBeVisible();
  await build.locator("[data-repair-start-welding]").click();
  await expect(build.locator("[data-repair-stop-welding]")).toBeVisible();

  // Fast-forward the six sections rather than waiting them out.
  const finishedAgo = new Date(
    Date.now() - jagMount.repairIncrements * balance.welding.attemptDurationTicks * 600 - 100,
  );
  await db
    .update(activeActions)
    .set({ startedAt: finishedAgo, resolvedThroughAt: finishedAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();

  // The mount is built: construction is gone and Install Container is offered,
  // disabled until the character actually carries an unequipped container.
  const stash = page.locator(`[data-site-stash="${LOCATION_IDS.theJag}"]`);
  await expect(stash).toBeVisible();
  await expect(build).toHaveCount(0);
  await expect(stash.locator("[data-stash-install]")).toBeDisabled();

  await db.insert(itemInstances).values({ characterId, itemId: ITEM_IDS.scrapBox });
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 });
  await page.reload();
  await expect(stash.locator("[data-stash-install]")).toBeEnabled();
  await stash.locator("[data-stash-install]").click();
  await stash.getByRole("button", { name: /Scrap Box · 3 slots/ }).click();
  await expect(stash.locator("[data-stash-occupancy]")).toContainText("Scrap Box · 0 / 3");
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
  await expect(storage.locator("[data-storage-area='stored']")).toContainText("Ferrite Shale");
  // A non-empty stash cannot give up its container.
  await expect(stash.locator("[data-stash-remove]")).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await captureReviewScreenshot(page, "site-stash-mobile.png");

  // Stored items stay at the site and survive a refresh.
  await page.reload();
  await expect(stash.locator("[data-stash-occupancy]")).toContainText("1 / 3");

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
});
