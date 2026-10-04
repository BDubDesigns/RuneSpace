import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characterMissions, characterSkillXp, characters, inventoryStacks } from "@/db/rune-space";
import {
  CONVERSATION_BACKGROUND_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #292 — Curly Must-Stash, played end to end at the canonical 390px
 * mobile width.
 *
 * The whole commission through the real UI: Curly as a second contact at
 * HH B&B, his offer and the first confirmed 150 Credits, the Build Stash Mount
 * activity appearing only once the job is taken, real materials and six real
 * welds, the activity vanishing and his room changing the moment the mount is
 * installed, and the second 150 only on the actual turn-in.
 */

const MOUNT_PANEL = `[data-repair-work-panel="${REPAIR_TARGET_IDS.curlyStashMount}"]`;
const BEFORE = CONVERSATION_BACKGROUND_IDS.curlyRoomBefore;
const AFTER = CONVERSATION_BACKGROUND_IDS.curlyRoomAfter;

async function creditsOf(characterId: string) {
  return (
    await db
      .select({ credits: characters.credits })
      .from(characters)
      .where(eq(characters.id, characterId))
  )[0]!.credits;
}

async function weldingXp(characterId: string) {
  return (
    (
      await db
        .select({ totalXp: characterSkillXp.totalXp })
        .from(characterSkillXp)
        .where(
          and(
            eq(characterSkillXp.characterId, characterId),
            eq(characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        )
    )[0]?.totalXp ?? 0
  );
}

/** Step through the open sequence until its text matches. */
async function playToText(dialogue: import("@playwright/test").Locator, pattern: RegExp) {
  const text = dialogue.locator("[data-dialogue-text]");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await text.isVisible()) && pattern.test((await text.textContent()) ?? "")) return;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      if (await text.isVisible()) await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(text).toContainText(pattern);
}

/** Step through the open sequence until its terminal control appears. */
async function playToAction(dialogue: import("@playwright/test").Locator, name: string) {
  const action = dialogue.getByRole("button", { name });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await action.isVisible()) return action;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      const text = dialogue.locator("[data-dialogue-text]");
      if (await text.isVisible()) await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(action).toBeVisible();
  return action;
}

/** Reveal the current beat's text, then move on to the next beat. */
async function next(dialogue: import("@playwright/test").Locator) {
  const text = dialogue.locator("[data-dialogue-text]");
  if (await text.isVisible()) await text.click();
  await dialogue.getByRole("button", { name: "Next" }).click();
}

function scene(dialogue: import("@playwright/test").Locator) {
  return dialogue.locator("[data-dialogue-background]");
}

test("plays Curly's whole commission: offer, first payment, the mount, and the second payment", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(120_000);
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize({ width: 390, height: 844 });
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.holoHollow, credits: 0 })
    .where(eq(characters.id, characterId));
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page
    .locator(`[data-local-place="${LOCAL_PLACE_IDS.hhBnb}"]`)
    .locator("[data-local-place-enter]")
    .click();
  await expect(page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.hhBnb}"]`)).toBeVisible();

  // Two separate contacts, Mara first; nothing to build before the job is taken.
  await expect(page.locator(`[data-npc-interaction="${NPC_IDS.maraKells}"]`)).toBeVisible();
  await expect(page.locator(`[data-npc-interaction="${NPC_IDS.curly}"]`)).toBeVisible();
  await expect(page.locator(MOUNT_PANEL)).toHaveCount(0);
  await expect(
    page.locator(`[data-npc-interaction="${NPC_IDS.curly}"]`).locator('[data-npc-action="talk"]'),
  ).toHaveAttribute("data-mission-guidance", "available");

  let conversation = await openNpcConversation(page, "Curly");
  await expect(conversation.getByRole("button", { name: /Back Home/ })).toHaveCount(0);

  // The always-available topic, in the room as it is now.
  await conversation.getByRole("button", { name: /Seeing the Worlds/ }).click();
  await expect(scene(conversation)).toHaveAttribute("data-dialogue-background", BEFORE);
  await expect(conversation.getByRole("img", { name: "Curly, smile expression" })).toBeVisible();
  await captureReviewScreenshot(page, "curly-mobile-room-before.png");
  // The same room at desktop width, portrait over the scene.
  await page.setViewportSize({ width: 1279, height: 900 });
  await captureReviewScreenshot(page, "curly-desktop-room-before.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await conversation.locator("[data-dialogue-back]").click();

  // The offer, with no Decline: only the acceptance control.
  await conversation.getByRole("button", { name: /Curly Must-Stash/ }).click();
  await expect(scene(conversation)).toHaveAttribute("data-dialogue-background", BEFORE);
  const take = await playToAction(conversation, "TAKE THE JOB");
  await expect(conversation.getByRole("button", { name: /decline/i })).toHaveCount(0);
  await take.click();

  // Curly hands the money over in his first line, then the confirmed tile.
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    "Here's the first hundred and fifty",
  );
  await next(conversation);
  const firstTile = conversation.locator("[data-dialogue-credits-tile]");
  await expect(firstTile).toBeVisible();
  await expect(firstTile).toHaveAttribute("data-credits-amount", "150");
  await expect(firstTile).toContainText("+150");
  await next(conversation);
  await expect(conversation.locator("[data-dialogue-credits-tile]")).toHaveCount(0);
  await playToText(conversation, /Some of it, anyway/);
  expect(await creditsOf(characterId)).toBe(150);
  await page.keyboard.press("Escape");

  // The job is taken, so the build appears below the B&B, and Curly reminds.
  const panel = page.locator(MOUNT_PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Build Stash Mount");
  await expect(panel.locator("[data-repair-contribute]")).toContainText("No useful");
  conversation = await openNpcConversation(page, "Curly");
  await conversation.getByRole("button", { name: /Curly Must-Stash/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    "How's the mount coming along?",
  );
  await expect(conversation.getByRole("button", { name: "COLLECT PAYMENT" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Re-entering never repays.
  expect(await creditsOf(characterId)).toBe(150);

  // Bring the materials, install them, and weld all six sections for real.
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
    { characterId, itemId: ITEM_IDS.slag, quantity: 3 },
  ]);
  await page.reload();
  await expect(panel.locator("[data-repair-contribute]")).toBeEnabled();
  await panel.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, "curly-mobile-build-panel.png");
  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.locator("[data-repair-start-welding]")).toBeVisible();
  await panel.locator("[data-repair-start-welding]").click();
  await expect(panel.locator("[data-repair-stop-welding]")).toBeVisible();

  // The last section lands and the activity is gone at once.
  await expect(panel).toHaveCount(0, { timeout: 60_000 });
  expect(await weldingXp(characterId)).toBe(300);
  const strip = page.locator(`[data-mission-strip="${MISSION_IDS.curlyMustStash}"]`);
  await expect(strip).toHaveAttribute("data-mission-phase", "turn_in");
  // Still gone after a refresh, and still unpaid.
  await page.reload();
  await expect(page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.hhBnb}"]`)).toBeVisible();
  await expect(page.locator(MOUNT_PANEL)).toHaveCount(0);
  expect(await creditsOf(characterId)).toBe(150);

  // The room is finished before he pays, and so is the replayable topic.
  conversation = await openNpcConversation(page, "Curly");
  await conversation.getByRole("button", { name: /Seeing the Worlds/ }).click();
  await expect(scene(conversation)).toHaveAttribute("data-dialogue-background", AFTER);
  await conversation.locator("[data-dialogue-back]").click();
  await conversation.getByRole("button", { name: /Curly Must-Stash/ }).click();
  await expect(scene(conversation)).toHaveAttribute("data-dialogue-background", AFTER);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    "An entire patch of floor!",
  );
  const collect = await playToAction(conversation, "COLLECT PAYMENT");
  await captureReviewScreenshot(page, "curly-mobile-room-after.png");
  await page.setViewportSize({ width: 1279, height: 900 });
  await captureReviewScreenshot(page, "curly-desktop-room-after.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await collect.click();

  await expect(conversation.locator("[data-dialogue-text]")).toContainText("There you go!");
  await next(conversation);
  const secondTile = conversation.locator("[data-dialogue-credits-tile]");
  await expect(secondTile).toHaveAttribute("data-credits-amount", "150");
  await captureReviewScreenshot(page, "curly-mobile-second-payment.png");
  await next(conversation);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText("toothbrush");
  expect(await creditsOf(characterId)).toBe(300);
  await page.keyboard.press("Escape");

  // Settled: the follow-up, both topics, no payment, no activity, no storage.
  conversation = await openNpcConversation(page, "Curly");
  await expect(conversation.getByRole("button", { name: /Back Home/ })).toBeVisible();
  await conversation.getByRole("button", { name: /Curly Must-Stash/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText("I found my toothbrush");
  await expect(conversation.locator("[data-dialogue-credits-tile]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(`[data-local-place-surface="${LOCAL_PLACE_IDS.hhBnb}"]`)).toBeVisible();
  await expect(page.locator(MOUNT_PANEL)).toHaveCount(0);
  // Curly's mount is his: no stash appears here for the player to open.
  await expect(page.locator("[data-site-stash-disclosure]")).toHaveCount(0);
  expect(await creditsOf(characterId)).toBe(300);
});
