import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterEchoHunts,
  characterMissions,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import {
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  PLANET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { playDialogueToText } from "./dialogue-steps";
import {
  expect,
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";

/**
 * First Resonance Echo and Beginner Echo hunts (#393) at the 390 px portrait
 * width: the Wise Old Enby's in-person offer handing over two Seekers, a real
 * reading from ordinary Inventory Item Details resolving on its own timer into a
 * durable result, the last-reading and ruled-out lines, a discovery that
 * advances the Mission, the debrief with its 300 Runeworking XP, and the
 * Stillreach topic's personal beats. Unit and PostgreSQL coverage own the rules
 * (directions, tables, capacity, concurrency); this proves the running app.
 *
 * The hidden target is planted directly so the journey is deterministic; the
 * server's own random choice of it is covered in tests/integration.
 */

const ECHO = MISSION_IDS.firstResonanceEcho;
const ENBY = "The Wise Old Enby";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own phone viewport; runs once");
  await page.setViewportSize({ width: 390, height: 844 });
});

async function setUp(characterId: string) {
  const now = new Date();
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.hilltopWorkshop })
    .where(eq(characters.id, characterId));
  // Both earlier chapters finished before this one existed.
  await db.insert(characterMissions).values(
    [MISSION_IDS.notFromAroundHere, MISSION_IDS.firstRuneworkingLesson].map((missionId) => ({
      characterId,
      missionId,
      acceptedAt: now,
      completedAt: now,
    })),
  );
}

async function hideEchoAt(characterId: string, targetLocationId: string) {
  await db.delete(characterEchoHunts).where(eq(characterEchoHunts.characterId, characterId));
  await db.insert(characterEchoHunts).values({
    characterId,
    planetId: PLANET_IDS.stillreach,
    tier: "beginner",
    targetLocationId,
    startedAt: new Date(),
  });
}

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

async function runeworkingXp(characterId: string) {
  const [row] = await db
    .select({ totalXp: characterSkillXp.totalXp })
    .from(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, characterId),
        eq(characterSkillXp.skillId, SKILL_IDS.runeworking),
      ),
    );
  return row?.totalXp ?? 0;
}

async function finishScene(conversation: Locator, lastLine: RegExp) {
  await playDialogueToText(conversation, lastLine);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
}

async function closeConversation(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);
}

/** Open Inventory and the Seeker's ordinary Item Details. */
async function seekerDetails(page: Page) {
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await inventory.getByRole("button", { name: /^\d+ Beginner Echo Seeker/ }).click();
  const details = inventory.locator("[data-echo-seeker-details]");
  await expect(details).toBeVisible();
  return { inventory, details };
}

test("the Enby's two Seekers, a wrong reading, a discovery, and the debrief", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  await setUp(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);

  // The in-person offer, for a character who finished the lesson earlier.
  const conversation = await openNpcConversation(page, ENBY);
  await openConversationEntry(conversation, /First Resonance Echo/);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    /Now comes the interesting part/,
  );
  await expect(conversation.locator("[data-dialogue-action]")).toHaveText("Take the Seekers");
  await expect(conversation.locator("[data-dialogue-decline]")).toHaveText("Not Now");
  await conversation.locator("[data-dialogue-action]").click();
  // The gift scene: the two Seekers appear only now that they were given.
  await playDialogueToText(conversation, /set two more aside for you/);
  await conversation.locator("[data-dialogue-text]").click();
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator('[data-dialogue-subject="item"]')).toBeVisible();
  await finishScene(conversation, /elaborate travel plans/);
  expect(await carried(testCharacter.id, ITEM_IDS.beginnerEchoSeeker)).toBe(2);
  await expect(conversation.locator(`[data-conversation-entry="${ECHO}:offer"]`)).toHaveCount(0);
  await closeConversation(page);
  await expect(page.locator(`[data-mission-strip="${ECHO}"]`)).toContainText(
    "Find one Resonance Echo using a Beginner Echo Seeker (0/1)",
  );

  // A wrong reading from Hilltop Workshop toward The Low Hum (northeast).
  await hideEchoAt(testCharacter.id, LOCATION_IDS.theLowHum);
  await page.reload();
  let { inventory, details } = await seekerDetails(page);
  await expect(details.locator("[data-echo-searching]")).toHaveText("Searching: Stillreach");
  await expect(details.locator("[data-echo-last-reading]")).toHaveText(
    "No reading on this planet yet.",
  );
  await expect(details.locator("[data-echo-capacity-advisory]")).toContainText(
    "is lost if it doesn't fit",
  );
  const use = details.locator("[data-echo-use]");
  await expect(use).toHaveAttribute("data-mission-guidance", "active");
  await use.click();
  await expect(details.locator("[data-echo-reading]")).toBeVisible();
  // It resolves on its own timer, with no further input.
  const notice = page.locator("[data-echo-notice]");
  await expect(notice).toHaveAttribute("data-echo-notice", "wrong", { timeout: 15_000 });
  await expect(notice).toContainText("The Seeker trembles, then goes still.");
  await expect(notice).toContainText(
    "A faint resonance pulls toward the northeast. The Echo is not here.",
  );
  expect(await carried(testCharacter.id, ITEM_IDS.beginnerEchoSeeker)).toBe(1);
  await expect(details.locator("[data-echo-last-reading]")).toContainText(
    "Last reading: Hilltop Workshop, northeast,",
  );
  await expect(details.locator("[data-echo-ruled-out]")).toHaveAttribute(
    "data-echo-ruled-out",
    "true",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  // The result survives a reload, and dismissing it is presentation only.
  await page.reload();
  await expect(page.locator("[data-echo-notice]")).toHaveAttribute("data-echo-notice", "wrong");
  await page.locator("[data-echo-notice-dismiss]").click();
  await expect(page.locator("[data-echo-notice]")).toHaveCount(0);

  // A discovery where the player stands.
  await hideEchoAt(testCharacter.id, LOCATION_IDS.hilltopWorkshop);
  await page.reload();
  ({ inventory, details } = await seekerDetails(page));
  await details.locator("[data-echo-use]").click();
  await expect(page.locator("[data-echo-notice]")).toHaveAttribute("data-echo-notice", "found", {
    timeout: 15_000,
  });
  await expect(page.locator("[data-echo-notice-title]")).toHaveText("Resonance Echo discovered!");
  expect(await runeworkingXp(testCharacter.id)).toBe(50);
  expect(await carried(testCharacter.id, ITEM_IDS.beginnerEchoSeeker)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(inventory).toHaveCount(0);
  await expect(page.locator(`[data-mission-strip="${ECHO}"]`)).toContainText(
    "Return to the Wise Old Enby at Hilltop Workshop",
  );

  // The debrief, with its one-time 300 Runeworking XP.
  const debrief = await openNpcConversation(page, ENBY);
  await openConversationEntry(debrief, /First Resonance Echo/);
  await expect(debrief.locator("[data-dialogue-text]")).toContainText(/found something/);
  await playDialogueToText(debrief, /strange bits of the universe/);
  await expect(debrief.locator("[data-dialogue-action]")).toHaveText(
    "Complete First Resonance Echo",
  );
  await debrief.locator("[data-dialogue-action]").click();
  await expect(debrief.locator("[data-dialogue-skill-xp-tile]")).toContainText("300");
  await debrief.locator("[data-dialogue-next]").click();
  await expect(debrief.locator("[data-conversation-hub]")).toBeVisible();
  expect(await runeworkingXp(testCharacter.id)).toBe(350);

  // Aftercare, and the always-available Stillreach topic with the Enby's own reason.
  await openConversationEntry(debrief, /About Resonance Echoes/);
  await finishScene(debrief, /before noon/);
  await openConversationEntry(debrief, /^Stillreach$/);
  await playDialogueToText(debrief, /only half an answer/);
  await playDialogueToText(debrief, /room to be myself/);
  await playDialogueToText(debrief, /much more reasonable grievance/);
  await finishScene(debrief, /more to this place than the sky/);
  expect(await runeworkingXp(testCharacter.id)).toBe(350);
});
