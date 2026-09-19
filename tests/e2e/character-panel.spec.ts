import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characterSkillXp, characters } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #213 — the current character's profile in a real browser.
 *
 * What this proves beyond the unit coverage: the footer destination is
 * Character and opens the shared overlay, the header identifies the character
 * being played, the canonical Character Level and Credits are the ones the
 * server projected, every skill the game defines is listed (including an
 * untrained one), and Switch Character stays reachable without scrolling the
 * skill list and lands on the existing selector.
 */

const balance = getEffectiveGameBalance();

function xpForLevel(level: number): number {
  return standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;
}

async function setSkillXp(characterId: string, skillId: string, totalXp: number) {
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

test("the Character destination shows identity, canonical level, Credits, and every skill", async ({
  page,
  testCharacter,
}) => {
  const characterId = await openTestCharacter(page, testCharacter.id);
  // Mining 4, Refining 2, Welding untrained: the issue's worked example, so
  // the canonical rule (1 + 3 + 1 + 0) shows a level no single skill has.
  await setSkillXp(characterId, SKILL_IDS.mining, xpForLevel(4));
  await setSkillXp(characterId, SKILL_IDS.refining, xpForLevel(2));
  await db.update(characters).set({ credits: 42 }).where(eq(characters.id, characterId));
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });

  const nav = page.getByRole("navigation", { name: "Primary" });
  const trigger = nav.getByRole("button", { name: "Character", exact: true });
  await expect(trigger).toHaveText("Character");
  await trigger.click();

  // The same overlay contract as Inventory: a modal dialog, dismissible, with
  // focus moved inside it.
  const dialog = page.getByRole("dialog", { name: "Character" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await expect(dialog.getByText(testCharacter.displayName, { exact: true })).toBeVisible();
  await expect(dialog.locator("[data-character-portrait] img")).toBeVisible();
  await expect(dialog.getByText("Character level 5")).toBeVisible();
  await expect(dialog.locator("[data-character-credits]")).toContainText("42 Credits");

  // Every skill the game defines with an approved curve, discovered through
  // the canonical source rather than a list this screen keeps.
  const expectedSkills = [SKILL_IDS.mining, SKILL_IDS.refining, SKILL_IDS.welding].map(
    (skillId) => getSkillPresentation(skillId)!.displayName,
  );
  const skillRows = dialog.locator("[data-character-skill]");
  await expect(skillRows).toHaveCount(expectedSkills.length);
  for (const displayName of expectedSkills) {
    await expect(skillRows.getByText(new RegExp(`^${displayName} — Level \\d+$`))).toBeVisible();
  }
  await expect(skillRows.getByText(/^Mining — Level 4$/)).toBeVisible();
  await expect(skillRows.getByText(/^Refining — Level 2$/)).toBeVisible();
  // An untrained skill is still Level 1 with no earned progress toward 2.
  await expect(skillRows.getByText(/^Welding — Level 1$/)).toBeVisible();
  await expect(
    skillRows.filter({ hasText: /^Welding — Level 1/ }).getByRole("progressbar"),
  ).toHaveAttribute("aria-valuenow", "0");
  // Progress is through the current level, never a lifetime-XP bar, and there
  // is no overall-character XP meter.
  await expect(
    skillRows.filter({ hasText: /^Mining — Level 4/ }).getByRole("progressbar"),
  ).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveCount(expectedSkills.length);

  await captureReviewScreenshot(page, "character-panel-mobile.png");
});

test("Switch Character stays reachable without scrolling and reuses the character selector", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Character", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Character" });
  const switchAction = dialog.getByRole("link", { name: "Switch Character" });
  await expect(switchAction).toBeVisible();

  // Scroll the skill list to the bottom: the action must not have moved off
  // screen, and must stay inside the dialog's visible box.
  await dialog.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(switchAction).toBeInViewport();
  const [actionBox, dialogBox] = await Promise.all([
    switchAction.boundingBox(),
    dialog.boundingBox(),
  ]);
  if (!actionBox || !dialogBox) throw new Error("Expected both to be laid out");
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);

  // It lands on the existing selection screen, and switching still works from
  // there: this character's own slot plays it again.
  await switchAction.click();
  await page.waitForURL("**/characters");
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  const slot = page
    .getByRole("listitem")
    .filter({ hasText: testCharacter.displayName })
    .filter({ has: page.getByRole("link", { name: "Play" }) });
  await expect(slot).toHaveCount(1);
  await slot.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(new RegExp(`/play/${testCharacter.id}(?:\\?[^#]*)?$`));
  // Back in Play as the same character: its own Character surface says so.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", {
      name: "Character",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Character" }).getByText(testCharacter.displayName, {
      exact: true,
    }),
  ).toBeVisible();
});

test("the Character overlay joins the single-open rule and returns focus on close", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  const trigger = nav.getByRole("button", { name: "Character", exact: true });

  // The same rule Inventory and the Mission Log already follow: one overlay at
  // a time, dismissed before the next is opened (the modal backdrop owns the
  // screen while it is up).
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Character" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // Escape dismisses and returns focus to the footer destination that opened it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Character" })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await nav.getByRole("button", { name: /^Inventory/ }).click();
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Inventory" })).toHaveCount(0);

  // Reopening Character leaves exactly one dialog, never a stack.
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Character" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // The explicit Close control closes it too, with the same focus return.
  await page.getByRole("button", { name: "Close character" }).click();
  await expect(page.getByRole("dialog", { name: "Character" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
