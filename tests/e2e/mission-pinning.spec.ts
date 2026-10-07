import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissionUnpins,
  characterMissions,
  inventoryStacks,
} from "@/db/rune-space";
import { ITEM_IDS, MISSION_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Mission pinning and the refreshed Mission Log (#325) in a real browser.
 *
 * Unit coverage owns which strips render for a given preference and the Log's
 * markup; integration coverage owns the command, its persistence and its
 * character scope. This proves what needs the running app: both surfaces write
 * the one server value and agree the moment the command resolves, at phone and
 * desktop widths, with keyboard focus kept somewhere sensible.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewports; runs once");
});

const PHONE = { width: 390, height: 844 } as const;
const WIDE = { width: 1440, height: 900 } as const;

/**
 * Two accepted Missions at once, as in the Holo Hollow strip journey: Hold It
 * Together still has work (green); Keep the Change has every requirement met
 * and only its hand-in left (blue). Walk It Off is completed.
 */
async function seedTwoActiveMissions(characterId: string) {
  const now = new Date();
  await db
    .insert(characterMissions)
    .values([
      ...[MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth, MISSION_IDS.wasteNot].map(
        (missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now }),
      ),
      { characterId, missionId: MISSION_IDS.holdItTogether, acceptedAt: now },
      { characterId, missionId: MISSION_IDS.keepTheChange, acceptedAt: now },
    ]);
  await db.insert(characterMissionProgress).values({
    characterId,
    missionId: MISSION_IDS.keepTheChange,
    progressKey: "bix-introduction",
    progress: 1,
  });
  await db.insert(inventoryStacks).values({ characterId, itemId: ITEM_IDS.powerCell, quantity: 3 });
}

const strip = (page: Page, missionId: string) =>
  page.locator(`[data-mission-strip="${missionId}"]`);
const unpinRows = (characterId: string) =>
  db
    .select({ missionId: characterMissionUnpins.missionId })
    .from(characterMissionUnpins)
    .where(eq(characterMissionUnpins.characterId, characterId));

test("pins from either surface on a phone, keeps the Mission active, and survives a reload", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await seedTwoActiveMissions(characterId);
  await page.setViewportSize(PHONE);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Both start pinned: nothing was ever written for them.
  const hold = strip(page, MISSION_IDS.holdItTogether);
  const change = strip(page, MISSION_IDS.keepTheChange);
  await expect(hold).toBeVisible();
  await expect(change).toBeVisible();
  const holdObjective = await hold.locator("[data-mission-strip-objective]").innerText();
  await captureReviewScreenshot(page, "issue-325-phone-strips-390.png");

  // Unpin straight from Current Missions: a named pin control, operated by
  // keyboard. Only that strip goes, and focus lands on the next Unpin.
  const unpinHold = page.getByRole("button", { name: "Unpin Hold It Together", exact: true });
  await unpinHold.focus();
  await page.keyboard.press("Enter");
  await expect(hold).toHaveCount(0);
  await expect(change).toBeVisible();
  // The strip keeps its own phase treatment; unpinning a neighbour changes none of it.
  await expect(change).toHaveAttribute("data-mission-phase", "turn_in");
  await expect(
    page.getByRole("button", { name: "Unpin Keep the Change", exact: true }),
  ).toBeFocused();

  // The Mission is still active in the Log, shown there as not pinned.
  await page.getByRole("button", { name: /^Missions/ }).click();
  const log = page.getByRole("dialog", { name: "Mission Log" });
  const holdEntry = log.locator(`[data-mission-log-entry="${MISSION_IDS.holdItTogether}"]`);
  const changeEntry = log.locator(`[data-mission-log-entry="${MISSION_IDS.keepTheChange}"]`);
  await expect(holdEntry).toHaveAttribute("data-mission-log-state", "active");
  await expect(holdEntry).toHaveAttribute("data-mission-phase", "work");
  await expect(changeEntry).toHaveAttribute("data-mission-phase", "turn_in");
  const pinHold = log.getByRole("button", { name: "Pin Hold It Together", exact: true });
  const pinChange = log.getByRole("button", { name: "Pin Keep the Change", exact: true });
  await expect(pinHold).toHaveAttribute("aria-pressed", "false");
  await expect(pinChange).toHaveAttribute("aria-pressed", "true");

  // Keep the Change is expanded (it is ready to turn in): its Current
  // Objective leads, ahead of the Progress list, with no reward preview.
  const current = changeEntry.locator("[data-mission-log-current]");
  await expect(current).toContainText("Current objective");
  await expect(changeEntry.locator("[data-mission-log-next]")).toHaveText(
    "Take the Power Cells to Tansy Rusk at The Jag",
  );
  const currentBox = (await current.boundingBox())!;
  const progressBox = (await changeEntry.locator("[data-mission-log-requirements]").boundingBox())!;
  expect(currentBox.y).toBeLessThan(progressBox.y);
  await expect(changeEntry.locator("[data-mission-log-reward]")).toHaveCount(0);
  // The pin control and the expand control are separate targets that never overlap.
  const expandBox = (await changeEntry.locator("button[aria-expanded]").boundingBox())!;
  const pinBox = (await pinChange.boundingBox())!;
  expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(pinBox.x);
  expect(pinBox.height).toBeGreaterThanOrEqual(44);
  expect(pinBox.width).toBeGreaterThanOrEqual(44);
  await captureReviewScreenshot(page, "issue-325-phone-mission-log-390.png");

  // Unpin from the Log too: the same result as unpinning from the strip.
  await pinChange.click();
  await expect(pinChange).toHaveAttribute("aria-pressed", "false");
  await expect(pinChange).toBeEnabled();

  // Completed Missions stay collapsed by default and never offer a pin.
  const completed = log.locator('[data-mission-log-section="completed"]');
  await completed.getByRole("button", { name: /Completed/ }).click();
  await expect(completed.locator("[data-mission-log-entry]")).toHaveCount(3);
  await expect(completed.locator("[data-mission-log-pin]")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Every active Mission unpinned: no strips and no placeholder objective.
  await expect(page.locator("[data-mission-strips]")).toHaveCount(0);
  await expect(page.locator("[data-mission-strip]")).toHaveCount(0);
  expect((await unpinRows(characterId)).map((row) => row.missionId).sort()).toEqual(
    [MISSION_IDS.holdItTogether, MISSION_IDS.keepTheChange].sort(),
  );

  // The preference is durable, and presentation only: the unpinned Keep the
  // Change still counts as ready to turn in, from the Mission projection.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Missions/ })).toHaveAccessibleName(
    "Missions, 1 ready to turn in",
  );
  await expect(page.locator("[data-mission-strip]")).toHaveCount(0);

  // Re-pin from the Log, by keyboard: the strip returns with its live objective.
  await page.getByRole("button", { name: /^Missions/ }).click();
  const reopened = page.getByRole("dialog", { name: "Mission Log" });
  const repin = reopened.getByRole("button", { name: "Pin Hold It Together", exact: true });
  await expect(repin).toHaveAttribute("aria-pressed", "false");
  await repin.focus();
  await page.keyboard.press("Space");
  await expect(repin).toHaveAttribute("aria-pressed", "true");
  await expect(repin).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(hold).toBeVisible();
  await expect(hold.locator("[data-mission-strip-objective]")).toHaveText(holdObjective);
  await expect(change).toHaveCount(0);
});

test("the wide desktop objectives region and the docked Log agree immediately", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await seedTwoActiveMissions(characterId);
  // Hold It Together starts unpinned; Keep the Change is pinned by absence.
  await db
    .insert(characterMissionUnpins)
    .values({ characterId, missionId: MISSION_IDS.holdItTogether });
  await page.setViewportSize(WIDE);
  await openTestCharacter(page, characterId);

  const rail = page.locator("[data-play-rail]");
  const region = rail.locator("[data-objectives-region]");
  await expect(region.locator("[data-mission-strip]")).toHaveCount(1);
  await expect(region.locator(`[data-mission-strip="${MISSION_IDS.keepTheChange}"]`)).toBeVisible();
  // One pinned Mission is a plain strip, with no collapse header to count it.
  await expect(region.locator("[data-objectives-toggle]")).toHaveCount(0);
  // Exactly one copy of the strips, in the rail.
  await expect(page.locator("[data-mission-strips]")).toHaveCount(1);

  await page
    .getByRole("tablist", { name: "Play utilities" })
    .getByRole("tab", { name: /^Missions/ })
    .click();
  const docked = page.locator("[data-docked-utility]");
  const pinHold = docked.getByRole("button", { name: "Pin Hold It Together", exact: true });
  await expect(pinHold).toHaveAttribute("aria-pressed", "false");

  // Pinning in the Log lands in the region straight away, in Mission order.
  await pinHold.click();
  await expect(pinHold).toHaveAttribute("aria-pressed", "true");
  const strips = region.locator("[data-mission-strip]");
  await expect(strips).toHaveCount(2);
  await expect(strips.nth(0)).toHaveAttribute("data-mission-strip", MISSION_IDS.holdItTogether);
  await expect(region.locator("[data-objectives-toggle]")).toContainText("Current Missions · 2");
  await captureReviewScreenshot(page, "issue-325-desktop-pinning-1440.png");

  // Unpinning from the region flips the Log's toggle with it.
  await region.getByRole("button", { name: "Unpin Keep the Change", exact: true }).click();
  await expect(region.locator(`[data-mission-strip="${MISSION_IDS.keepTheChange}"]`)).toHaveCount(
    0,
  );
  await expect(
    docked.getByRole("button", { name: "Pin Keep the Change", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  // The Mission itself is untouched: still listed as active, ready to turn in.
  await expect(
    docked.locator(`[data-mission-log-entry="${MISSION_IDS.keepTheChange}"]`),
  ).toHaveAttribute("data-mission-log-state", "ready_for_completion");
});
