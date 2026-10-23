import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissionProgress,
  characterMissions,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, skillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
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
 * Seeker? I Hardly Know Her! and the Resonance Rig (#391) at the 390 px portrait
 * width: the mystery's completion flowing straight into the lesson, the Enby's
 * Begin Lesson / Not Now offer to a character who finished the mystery earlier,
 * the Fragment advice following the character's Mining level, three real
 * attunements at the Rig, the Seeker's Sources drilling into the Rune
 * Fragment's, and the explicit turn-in with its 150 Runeworking XP. Unit and
 * PostgreSQL coverage own the rules; this proves what needs the running app.
 */

const LESSON = MISSION_IDS.firstRuneworkingLesson;
const MYSTERY = MISSION_IDS.notFromAroundHere;
const ENBY = "The Wise Old Enby";
const seeker = getEffectiveGameBalance().runeworking.recipes.beginnerEchoSeeker;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own phone viewport; runs once");
  await page.setViewportSize({ width: 390, height: 844 });
});

async function seed(characterId: string, stacks: { itemId: string; quantity: number }[]) {
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  if (stacks.length > 0) {
    await db.insert(inventoryStacks).values(stacks.map((stack) => ({ characterId, ...stack })));
  }
}

async function standAtHilltop(characterId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.hilltopWorkshop })
    .where(eq(characters.id, characterId));
}

/** The mystery solved before the lesson existed: completed, nothing after it. */
async function solvedEarlier(characterId: string) {
  const now = new Date();
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MYSTERY, acceptedAt: now, completedAt: now });
}

async function setMiningLevel(characterId: string, level: number) {
  const totalXp = skillLevelThresholds(SKILL_IDS.mining)!.find(
    (threshold) => threshold.level === level,
  )!.totalXp;
  await db
    .delete(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, characterId),
        eq(characterSkillXp.skillId, SKILL_IDS.mining),
      ),
    );
  await db.insert(characterSkillXp).values({ characterId, skillId: SKILL_IDS.mining, totalXp });
}

const lessonRows = (characterId: string) =>
  db
    .select()
    .from(characterMissions)
    .where(
      and(eq(characterMissions.characterId, characterId), eq(characterMissions.missionId, LESSON)),
    );

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

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

/** Move the running cycle's cursor back so that much time is due on the next load. */
async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

const talk = (page: Page) => page.getByRole("button", { name: `Talk to ${ENBY}` });
const topics = (conversation: Locator) =>
  conversation.locator('[data-conversation-section="topics"] button');

/** Step to the scene's last beat, then Finish back to the hub. */
async function finishScene(conversation: Locator, lastLine: RegExp) {
  await playDialogueToText(conversation, lastLine);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
}

/** Plays the rest of a lesson scene, proving only one advice branch is spoken. */
async function lessonTail(conversation: Locator, experienced: boolean) {
  await playDialogueToText(conversation, /Not admired from a safe distance/);
  const novice = /a little more Mining experience/;
  const expert = /Quite rude, really/;
  await playDialogueToText(conversation, experienced ? /done your share of Mining/ : /Quarry/);
  await finishScene(conversation, experienced ? expert : novice);
}

async function closeConversation(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);
}

test("completing the mystery flows straight into the lesson, and the Rig opens", async ({
  page,
  testCharacter,
}) => {
  const now = new Date();
  await db
    .insert(characterMissions)
    .values({ characterId: testCharacter.id, missionId: MYSTERY, acceptedAt: now });
  await db.insert(characterMissionProgress).values(
    ["toll-lead", "toll-hint"].map((progressKey) => ({
      characterId: testCharacter.id,
      missionId: MYSTERY,
      progressKey,
      progress: progressKey === "toll-lead" ? 1 : 0,
    })),
  );
  await seed(testCharacter.id, []);
  await standAtHilltop(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  // Before the mystery is complete the Rig is scenery.
  await expect(page.locator("[data-resonance-rig]")).toHaveCount(0);

  const conversation = await openNpcConversation(page, ENBY);
  await openConversationEntry(conversation, /Not From Around Here/);
  await playDialogueToText(conversation, /One step at a time/);
  await conversation.locator("[data-dialogue-action]").click();

  // The completion scene is the lesson itself; a new character hears the
  // novice Fragment advice only.
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/as promised/);
  await lessonTail(conversation, false);
  expect(await lessonRows(testCharacter.id)).toHaveLength(1);

  // No offer is left to accept twice; the lesson is current and its
  // instructions replay as a topic.
  await expect(conversation.locator(`[data-conversation-entry="${LESSON}:offer"]`)).toHaveCount(0);
  await expect(conversation.locator(`[data-conversation-entry="${LESSON}:active"]`)).toBeVisible();
  await expect(topics(conversation)).toHaveText([
    "Introductions",
    "The workshop",
    "Stillreach",
    "About RuneSpace",
    "First lesson",
    "Where to Find Fragments",
  ]);
  await closeConversation(page);

  await expect(page.locator(`[data-mission-strip="${LESSON}"]`)).toContainText(
    "Attune Beginner Echo Seekers at the Resonance Rig — 0 / 3",
  );
  const rig = page.locator("[data-resonance-rig]");
  await expect(rig).toBeVisible();
  // The Enby's card stays above the Rig.
  const card = await page.locator("[data-npc-interaction]").first().boundingBox();
  const rigBox = await rig.boundingBox();
  expect(card!.y).toBeLessThan(rigBox!.y);
  // Recipes stays readable without a single Fragment.
  await rig.locator('[data-rig-mode-select="recipes"]').click();
  await expect(
    rig.locator(`[data-rig-recipes-entry="${ACTION_IDS.beginnerEchoSeekerRuneworking}"]`),
  ).toContainText("Beginner Echo Seeker");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("a character who solved the mystery earlier is offered the lesson, and advice follows Mining", async ({
  page,
  testCharacter,
}) => {
  await solvedEarlier(testCharacter.id);
  await seed(testCharacter.id, []);
  await setMiningLevel(testCharacter.id, 7);
  await standAtHilltop(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  await expect(talk(page)).toHaveAttribute("data-mission-guidance", "available");

  const conversation = await openNpcConversation(page, ENBY);
  const offer = conversation.locator(`[data-conversation-entry="${LESSON}:offer"]`);
  await expect(offer).toHaveAttribute("data-mission-guidance", "available");

  // Not Now changes nothing.
  await openConversationEntry(conversation, /Seeker\? I Hardly Know Her!/);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/terrible listener/);
  await playDialogueToText(conversation, /considerably more reliable than it looks/);
  await expect(conversation.locator("[data-dialogue-action]")).toHaveText("Begin Lesson");
  await expect(conversation.locator("[data-dialogue-decline]")).toHaveText("Not Now");
  await conversation.locator("[data-dialogue-decline]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  expect(await lessonRows(testCharacter.id)).toHaveLength(0);

  // Mining 7: Where to Find Fragments points to the Quarry, and is replayable.
  await openConversationEntry(conversation, /Where to Find Fragments/);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/Prospecting Quarry/);
  await finishScene(conversation, /a little more Mining experience/);

  // Begin Lesson accepts and flows into the lesson.
  await openConversationEntry(conversation, /Seeker\? I Hardly Know Her!/);
  await playDialogueToText(conversation, /considerably more reliable than it looks/);
  await conversation.locator("[data-dialogue-action]").click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/as promised/);
  await lessonTail(conversation, false);
  expect(await lessonRows(testCharacter.id)).toHaveLength(1);
  await expect(offer).toHaveCount(0);
  await closeConversation(page);

  // Back at Mining 8, the same topic gives the experienced advice.
  await setMiningLevel(testCharacter.id, 8);
  await page.reload();
  const again = await openNpcConversation(page, ENBY);
  await openConversationEntry(again, /Where to Find Fragments/);
  await expect(again.locator("[data-dialogue-text]")).toContainText(/done your share of Mining/);
  await finishScene(again, /Quite rude, really/);
  await openConversationEntry(again, /First lesson/);
  await lessonTail(again, true);
});

test("three attunements, the Seeker's Sources, and the Enby's turn-in", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  await solvedEarlier(testCharacter.id);
  await db
    .insert(characterMissions)
    .values({ characterId: testCharacter.id, missionId: LESSON, acceptedAt: new Date() });
  await db.insert(characterMissionProgress).values({
    characterId: testCharacter.id,
    missionId: LESSON,
    progressKey: "seekers-attuned",
    progress: 0,
  });
  await seed(testCharacter.id, [{ itemId: ITEM_IDS.runeFragment, quantity: 4 }]);
  await standAtHilltop(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);

  // Sources for the Seeker beside the objective, drilling to the Fragment's.
  await page.getByRole("button", { name: "Missions" }).click();
  const log = page.getByRole("dialog", { name: "Mission Log" });
  const entry = log.locator(`[data-mission-log-entry="${LESSON}"]`);
  await entry.getByRole("button", { name: "How to get Beginner Echo Seeker" }).click();
  const seekerSources = page.getByRole("dialog", { name: "How to get Beginner Echo Seeker" });
  const runework = seekerSources.locator('[data-item-source-kind="runework"]');
  await expect(runework).toContainText("Runeworking");
  await expect(runework).toContainText("Hilltop Workshop");
  await expect(runework).toContainText("Never fails");
  await seekerSources.getByRole("button", { name: "How to get Rune Fragment" }).click();
  const fragmentSources = page.getByRole("dialog", { name: "How to get Rune Fragment" });
  await expect(fragmentSources.locator('[data-item-source-kind="mine"]').first()).toBeVisible();
  await fragmentSources.getByRole("button", { name: "Back to Beginner Echo Seeker" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /How to get/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(log).toHaveCount(0);

  // Attune three at the Rig.
  const rig = page.locator("[data-resonance-rig]");
  const start = rig.locator("[data-attune-start]");
  await expect(start).toHaveAttribute("data-mission-guidance", "active");
  await rig.getByRole("button", { name: "More attunements" }).click();
  await rig.getByRole("button", { name: "More attunements" }).click();
  await start.click();
  await expect(rig.locator("[data-rig-cycle-sequence]")).toBeVisible();
  await fastForward(testCharacter.id, seeker.durationTicks * GAME_TICK_MS * 3 + 1_000);
  await page.reload();
  await expect(rig.locator('[data-rig-stop="run_completed"]')).toBeVisible();
  expect(await carried(testCharacter.id, ITEM_IDS.beginnerEchoSeeker)).toBe(3);
  expect(await carried(testCharacter.id, ITEM_IDS.runeFragment)).toBe(1);
  await expect(page.locator(`[data-mission-strip="${LESSON}"]`)).toContainText(
    "Return to the Wise Old Enby at Hilltop Workshop",
  );
  await expect(talk(page)).toHaveAttribute("data-mission-guidance", "turn_in");

  // The explicit turn-in.
  const conversation = await openNpcConversation(page, ENBY);
  await openConversationEntry(conversation, /Seeker\? I Hardly Know Her!/);
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    /workshop is still standing/,
  );
  await playDialogueToText(conversation, /without setting anything on fire/);
  await expect(conversation.locator("[data-dialogue-action]")).toHaveText(
    "Complete Seeker? I Hardly Know Her!",
  );
  expect((await lessonRows(testCharacter.id))[0]?.completedAt).toBeNull();
  await conversation.locator("[data-dialogue-action]").click();
  await expect(conversation.locator("[data-dialogue-skill-xp-tile]")).toContainText("150");
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  expect((await lessonRows(testCharacter.id))[0]?.completedAt).not.toBeNull();
  expect(await runeworkingXp(testCharacter.id)).toBe(3 * seeker.baseXp + 150);
  expect(await carried(testCharacter.id, ITEM_IDS.beginnerEchoSeeker)).toBe(3);

  // Completed: no command left, and the aftercare topic appears.
  await expect(conversation.locator(`[data-conversation-entry^="${LESSON}:"]`)).toHaveCount(0);
  await openConversationEntry(conversation, /About the Seekers/);
  await finishScene(conversation, /bare minimum/);
  await closeConversation(page);

  // The Rig stays the player's.
  await page.reload();
  await expect(page.locator(`[data-mission-strip="${LESSON}"]`)).toHaveCount(0);
  await expect(page.locator("[data-attune-start]")).toBeEnabled();
});
