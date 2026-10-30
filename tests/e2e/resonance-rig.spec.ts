import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissionProgress,
  characterMissions,
  characterRepairTargets,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { RESONANCE_RIG_OVERLAY } from "@/game/content/locations";
import { playDialogueToText } from "./dialogue-steps";
import {
  expect,
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * The personal Resonance Rig chapter (#441) in the running app at the 390 px phone
 * width: the Enby's offer, the build at the Crash Site, the recoverable arrival, the
 * explicit turn-in with its two-rune reveal, the genuine craft, the +500 XP scene
 * that must survive the Enby being relocated out from under it, and the departure.
 * Unit and PostgreSQL coverage own the rules; this proves what only a browser can.
 */

const ENBY = "The Wise Old Enby";
const HOME = MISSION_IDS.aPlaceToCallHome;
const OWN = MISSION_IDS.aRuneOfYourOwn;
const balance = getEffectiveGameBalance();
const rig = getRepairTargetBalance(REPAIR_TARGET_IDS.resonanceRig, balance);
const tp = balance.runeworking.recipes.skatbollTpRune;
const thresholds = standardSkillLevelThresholds(balance);
const levelXp = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own phone viewport; runs once");
  await page.setViewportSize({ width: 390, height: 844 });
});

async function setUp(characterId: string, options: { welding?: number } = {}) {
  const now = new Date();
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.hilltopWorkshop })
    .where(eq(characters.id, characterId));
  await db.insert(characterMissions).values(
    [MISSION_IDS.notFromAroundHere, MISSION_IDS.firstRuneworkingLesson].map((missionId) => ({
      characterId,
      missionId,
      acceptedAt: now,
      completedAt: now,
    })),
  );
  await db.insert(characterSkillXp).values([
    { characterId, skillId: SKILL_IDS.runeworking, totalXp: levelXp(5) },
    { characterId, skillId: SKILL_IDS.welding, totalXp: levelXp(options.welding ?? 12) },
  ]);
}

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
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

async function missionRow(characterId: string, missionId: string) {
  const [row] = await db
    .select()
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, missionId),
      ),
    );
  return row;
}

async function giveBill(characterId: string) {
  await db
    .insert(inventoryStacks)
    .values(
      rig.materials.map((item) => ({ characterId, itemId: item.itemId, quantity: item.quantity })),
    );
}

/** The Rig exactly as the twenty-fourth weld leaves it, with the arrival still owed. */
async function finishRig(characterId: string, acknowledged = false) {
  const row = {
    materials: Object.fromEntries(rig.materials.map((item) => [item.itemId, item.quantity])),
    weldingProgress: rig.repairIncrements,
    completedAt: new Date(),
    arrivalAcknowledgedAt: acknowledged ? new Date() : null,
    updatedAt: new Date(),
  };
  await db
    .insert(characterRepairTargets)
    .values({ characterId, targetId: REPAIR_TARGET_IDS.resonanceRig, ...row })
    .onConflictDoUpdate({
      target: [characterRepairTargets.characterId, characterRepairTargets.targetId],
      set: row,
    });
}

async function acceptHome(characterId: string) {
  const now = new Date();
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: HOME, acceptedAt: now })
    .onConflictDoNothing();
}

async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

/** The Rig is one stage under both headers and conversations: measure it in a frame. */
async function expectRigOnStage(frame: Locator, label: string) {
  const background = frame.locator('img[data-scene-layer="background"]');
  const overlay = frame.locator('img[data-scene-layer="overlay"]');
  await expect(overlay).toHaveCount(1);
  await expect
    .poll(() => overlay.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const bg = (await background.boundingBox())!;
  const rigBox = (await overlay.boundingBox())!;
  const { placement } = RESONANCE_RIG_OVERLAY;
  const close = (actual: number, expected: number, what: string) =>
    expect(
      Math.abs(actual - expected),
      `${label} ${what}: ${actual} vs ${expected}`,
    ).toBeLessThanOrEqual(1.5);
  close(rigBox.width, (placement.width / 100) * bg.width, "width");
  close(rigBox.x, bg.x + (placement.left / 100) * bg.width, "x on the shared stage");
  close(rigBox.y, bg.y + (placement.top / 100) * bg.height, "y on the shared stage");
  await expect(frame.locator('img[data-scene-layer="background"]')).toHaveAttribute(
    "src",
    /crash-site-empty/,
  );
}

async function finishScene(conversation: Locator, lastLine: RegExp) {
  await playDialogueToText(conversation, lastLine);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");
}

const arrival = (page: Page) => page.locator("[data-resonance-arrival]");

test("the offer, the build, the recoverable arrival and the explicit turn-in", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await setUp(characterId);
  await openTestCharacter(page, characterId);

  // 1. The manual offer at Hilltop Workshop, with Accept Mission / Not Now.
  const offer = await openNpcConversation(page, ENBY);
  await openConversationEntry(offer, /A Place to Call Home/);
  await expect(offer.locator("[data-dialogue-text]")).toContainText(
    /I've been going over some old readings/,
  );
  await playDialogueToText(
    offer,
    /Fancy turning that Crash Site into something worth coming home to\?/,
  );
  await expect(offer.locator("[data-dialogue-action]")).toHaveText("Accept Mission");
  await expect(offer.locator("[data-dialogue-decline]")).toHaveText("Not Now");
  await offer.locator("[data-dialogue-action]").click();
  await playDialogueToText(offer, /secure the Rig with twenty-four welds/);
  await finishScene(offer, /secure the Rig with twenty-four welds/);
  await offer.locator("[data-dialogue-next]").click();
  await expect(offer.locator("[data-conversation-hub]")).toBeVisible();
  expect((await missionRow(characterId, HOME))?.acceptedAt).toBeTruthy();
  await page.keyboard.press("Escape");

  // 2. The Rig is built at the existing Crash Site through the ordinary repair panel.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await giveBill(characterId);
  await page.reload();
  const panel = page.locator(`[data-repair-work-panel="${REPAIR_TARGET_IDS.resonanceRig}"]`);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-repair-complete", "false");
  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.locator("[data-repair-start-welding]")).toBeVisible();
  expect(await carried(characterId, ITEM_IDS.resonanceCore)).toBe(0);
  // All but the last of the 24 welds, server-side; the last is a real weld.
  await db
    .update(characterRepairTargets)
    .set({ weldingProgress: rig.repairIncrements - 1 })
    .where(eq(characterRepairTargets.characterId, characterId));
  await page.reload();
  await panel.locator("[data-repair-start-welding]").click();
  await expect(panel.locator("[data-repair-stop-welding]")).toBeVisible();
  // The final weld lands while "away": the player only reloads afterwards.
  await fastForward(characterId, balance.welding.attemptDurationTicks * 1_000 + 5_000);
  await page.reload();

  // 3. The site is theirs: renamed, the Rig on the empty stage, the Enby standing there.
  await expect(page.locator("[data-scene-eyebrow]")).toHaveText("RESONANCE SITE");
  await expect(
    page.locator('[data-location-scene="crash_site"] img[data-scene-layer="background"]'),
  ).toHaveAttribute("alt", /Resonance Rig standing in the clearing/);
  await expectRigOnStage(
    page.locator('[data-location-scene="crash_site"] .rs-location-scene-viewport'),
    "4:1 header",
  );

  // 4. The arrival is a short presentation, never a conversation, and it plays through.
  await expect(arrival(page)).toBeVisible();
  await expect(arrival(page)).toHaveAttribute("data-resonance-arrival-phase", /playing|done/);
  await expectRigOnStage(arrival(page).locator(".rs-dialogue-scene"), "15:8 arrival");
  await expect(arrival(page)).toHaveAttribute("data-resonance-arrival-phase", "done", {
    timeout: 10_000,
  });
  await expect(arrival(page).locator("[data-dialogue-text]")).toContainText(
    "The Wise Old Enby has arrived.",
  );
  await captureReviewScreenshot(page, "resonance-arrival-mobile.png");
  // Nothing was started or completed by it.
  expect((await missionRow(characterId, HOME))?.completedAt).toBeNull();
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);

  // It is still owed after a reload until acknowledged, then never again.
  await page.reload();
  await expect(arrival(page)).toBeVisible();
  await arrival(page)
    .locator("[data-resonance-arrival-skip], [data-resonance-arrival-continue]")
    .first()
    .click();
  await arrival(page)
    .locator("[data-resonance-arrival-continue]")
    .click({ timeout: 3_000 })
    .catch(() => undefined);
  await expect(arrival(page)).toHaveCount(0);
  const [row] = await db
    .select()
    .from(characterRepairTargets)
    .where(eq(characterRepairTargets.characterId, characterId));
  expect(row?.arrivalAcknowledgedAt).toBeTruthy();
  await page.reload();
  await expect(arrival(page)).toHaveCount(0);

  // 5. The single Enby is here, with the ordinary Talk control and the turn-in guidance.
  await expect(page.getByRole("button", { name: `Talk to ${ENBY}` })).toBeVisible();
  const conversation = await openNpcConversation(page, ENBY);
  // No Research Jobs button at the Resonance Site: the workshop's work waits at home.
  await expect(conversation.locator('[data-conversation-group="research"]')).toHaveCount(0);
  await openConversationEntry(conversation, /A Place to Call Home/);
  await expect(conversation.locator("[data-dialogue-scene-location]")).toHaveText("RESONANCE SITE");
  await expectRigOnStage(conversation.locator(".rs-dialogue-scene"), "15:8 conversation");
  await playDialogueToText(conversation, /Consider them a practical demonstration/);
  await expect(conversation.locator("[data-dialogue-action]")).toHaveText(
    "Complete A Place to Call Home",
  );
  expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(0);
  await conversation.locator("[data-dialogue-action]").click();

  // 6. Only after the confirmed grant: the two-rune item art, then the lesson, same scene.
  await expect(conversation.locator("[data-dialogue-item-artwork]")).toBeVisible();
  await expect(conversation.locator("[data-dialogue-speaker-role]")).toContainText(
    /Skatboll TP Rune ×2/,
  );
  expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(2);
  await playDialogueToText(conversation, /Come and tell me when you've done it/);
  await finishScene(conversation, /Come and tell me when you've done it/);
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  // A Rune of Your Own is already accepted, with no offer anywhere.
  expect((await missionRow(characterId, OWN))?.acceptedAt).toBeTruthy();
  await expect(conversation.getByRole("button", { name: /A Rune of Your Own/ })).toBeVisible();
  await expect(conversation.locator("[data-dialogue-action]")).toHaveCount(0);
  await expect(conversation.locator("[data-dialogue-decline]")).toHaveCount(0);
});

test("a genuine craft, the +500 XP scene that survives the relocation, and the departure", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await setUp(characterId);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await acceptHome(characterId);
  await finishRig(characterId, true);
  // Mission 1 is already done, and Mission 2 accepted with its two gifted runes.
  const now = new Date();
  await db
    .update(characterMissions)
    .set({ completedAt: now })
    .where(
      and(eq(characterMissions.characterId, characterId), eq(characterMissions.missionId, HOME)),
    );
  await db.insert(characterMissions).values({ characterId, missionId: OWN, acceptedAt: now });
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.skatbollTpRune, quantity: 2 },
    { characterId, itemId: ITEM_IDS.cutQuartz, quantity: 1 },
    { characterId, itemId: ITEM_IDS.runestone, quantity: 1 },
  ]);
  await openTestCharacter(page, characterId);

  // The reminder before the craft: three approved lines, no turn-in control.
  const reminder = await openNpcConversation(page, ENBY);
  await openConversationEntry(reminder, /A Rune of Your Own/);
  await playDialogueToText(reminder, /what you can make, not what you can acquire/);
  await expect(reminder.locator("[data-dialogue-action]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);

  // The personal Rig's own recipe, with the existing quantity/Max controls.
  const station = page.locator("[data-resonance-rig]");
  await expect(station).toBeVisible();
  await expect(
    station.locator(`[data-attune-recipe="${ACTION_IDS.beginnerEchoSeekerRuneworking}"]`),
  ).toHaveCount(0);
  const recipe = station.locator(`[data-attune-recipe="${ACTION_IDS.skatbollTpRuneRuneworking}"]`);
  await expect(recipe).toBeVisible();
  await expect(recipe).toHaveAttribute("data-attune-recipe-ready", "true");
  await recipe.click();
  await station.locator("[data-attune-start]").click();
  await expect(station.locator("[data-rig-cycle]")).toBeVisible();
  // Committed at once: the ingredients are set aside, not yet consumed.
  await fastForward(characterId, tp.durationTicks * 1_000 + 2_000);
  await page.reload();
  expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(3);
  expect(await carried(characterId, ITEM_IDS.cutQuartz)).toBe(0);
  expect(await carried(characterId, ITEM_IDS.runestone)).toBe(0);

  // The player may already have used or traded the rune they made: it is not asked for.
  await db
    .delete(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, characterId),
        eq(inventoryStacks.itemId, ITEM_IDS.skatbollTpRune),
      ),
    );
  await page.reload();
  const xpBefore = await runeworkingXp(characterId);

  const conversation = await openNpcConversation(page, ENBY);
  await openConversationEntry(conversation, /A Rune of Your Own/);
  await playDialogueToText(conversation, /Keep your rune\. You've earned it/);
  await playDialogueToText(conversation, /Still a bit of a walk from there to the workshop/);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-action]")).toHaveText(
    "Complete A Rune of Your Own",
  );
  await conversation.locator("[data-dialogue-action]").click();

  // THE SEAM: the server has already moved the Enby home. The scene the player is in
  // must stay mounted and show the confirmed +500 XP and the farewell, with no
  // second Enby row anywhere and no Talk control for them here any more.
  const xpTile = conversation.locator("[data-dialogue-skill-xp-tile]");
  await expect(xpTile).toBeVisible();
  await expect(xpTile).toContainText("+500");
  await expect(conversation.locator("[data-dialogue-speaker-name]")).toHaveText("Skill XP");
  expect((await runeworkingXp(characterId)) - xpBefore).toBe(500);
  await expect(page.locator('[data-npc-interaction="wise_old_enby"]')).toHaveCount(0);
  await expect(conversation).toBeVisible();
  await captureReviewScreenshot(page, "resonance-xp-mobile.png");

  await playDialogueToText(conversation, /barely scratched the surface of what RuneSpace can do/);
  await conversation.locator("[data-dialogue-text]").click();
  await expect(conversation.locator("[data-dialogue-next]")).toHaveText("Finish");

  // The departure: sample the portrait's bottom edge against the frame's floor on
  // every animation frame. The approved portraits are cropped at the feet, so it
  // must never leave the floor (no vertical slide, no scale, never exposing feet).
  await page.evaluate(() => {
    const samples: { drift: number; opacity: number }[] = [];
    (window as unknown as { __portraitSamples: typeof samples }).__portraitSamples = samples;
    const tick = () => {
      const frame = document.querySelector<HTMLElement>(".rs-dialogue-scene");
      const image = frame?.querySelector<HTMLElement>('[data-scene-cue-target="portrait"] img');
      const layer = frame?.querySelector<HTMLElement>('[data-scene-cue-target="portrait"]');
      if (frame && image && layer) {
        samples.push({
          drift: Math.abs(
            image.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom,
          ),
          opacity: Number(getComputedStyle(layer).opacity),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await conversation.locator("[data-dialogue-next]").click();
  await expect(conversation.locator("[data-dialogue-skip]")).toBeVisible();
  await expect(conversation.locator('[data-scene-cue-target="rift"]')).toBeAttached();
  // The scene ends by itself and closes the conversation: the Enby has left.
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0, {
    timeout: 10_000,
  });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __portraitSamples: { drift: number; opacity: number }[] })
        .__portraitSamples,
  );
  expect(samples.length).toBeGreaterThan(10);
  expect(Math.max(...samples.map((sample) => sample.drift))).toBeLessThanOrEqual(0.5);
  // It faded out, never up from nothing.
  expect(samples[0]!.opacity).toBeGreaterThan(0.9);
  expect(Math.min(...samples.map((sample) => sample.opacity))).toBeLessThan(0.2);

  // The world: the Enby is gone from the Resonance Site and home at Hilltop, and the
  // Mission truth did not depend on the animation.
  expect((await missionRow(characterId, OWN))?.completedAt).toBeTruthy();
  await expect(page.getByRole("button", { name: `Talk to ${ENBY}` })).toHaveCount(0);
  await standAt(characterId, LOCATION_IDS.hilltopWorkshop);
  await page.reload();
  const home = await openNpcConversation(page, ENBY);
  await expect(home.locator('[data-conversation-group="research"]')).toBeVisible();
  // The Resonance Site is theirs for good.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  await expect(page.locator("[data-scene-eyebrow]")).toHaveText("RESONANCE SITE");
  await expect(page.locator("[data-resonance-rig]")).toBeVisible();
});

test("the departure can be skipped and the truth is the same", async ({ page, testCharacter }) => {
  const characterId = testCharacter.id;
  await setUp(characterId);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await acceptHome(characterId);
  await finishRig(characterId, true);
  const now = new Date();
  await db
    .update(characterMissions)
    .set({ completedAt: now })
    .where(
      and(eq(characterMissions.characterId, characterId), eq(characterMissions.missionId, HOME)),
    );
  await db.insert(characterMissions).values({ characterId, missionId: OWN, acceptedAt: now });
  // The craft is already on record: the progress row a genuine attunement writes.
  await db
    .insert(characterMissionProgress)
    .values({ characterId, missionId: OWN, progressKey: "tp-runes-attuned", progress: 1 });
  await openTestCharacter(page, characterId);

  const conversation = await openNpcConversation(page, ENBY);
  await openConversationEntry(conversation, /A Rune of Your Own/);
  await playDialogueToText(conversation, /Still a bit of a walk from there to the workshop/);
  await conversation.locator("[data-dialogue-text]").click();
  await conversation.locator("[data-dialogue-action]").click();
  await playDialogueToText(conversation, /barely scratched the surface/);
  await conversation.locator("[data-dialogue-text]").click();
  await conversation.locator("[data-dialogue-next]").click();
  await conversation.locator("[data-dialogue-skip]").click();
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);
  expect((await missionRow(characterId, OWN))?.completedAt).toBeTruthy();
  // Skipping granted nothing and paid nothing more.
  expect(await runeworkingXp(characterId)).toBe(levelXp(5) + 500);
});

test("reduced motion shows the arrival and the departure at their final state, with no motion", async ({
  page,
  testCharacter,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const characterId = testCharacter.id;
  await setUp(characterId);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await acceptHome(characterId);
  await finishRig(characterId, false);
  await openTestCharacter(page, characterId);

  await expect(arrival(page)).toBeVisible();
  await expect(arrival(page)).toHaveAttribute("data-resonance-arrival-phase", "done");
  // The portrait is simply there, fully visible, in its resting place.
  const layer = arrival(page).locator('[data-scene-cue-target="portrait"]');
  await expect(layer).toHaveCSS("opacity", "1");
  await expect(layer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  expect(await layer.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(arrival(page).locator("[data-dialogue-text]")).toContainText(
    "The Wise Old Enby has arrived.",
  );
  await arrival(page).locator("[data-resonance-arrival-continue]").click();
  await expect(arrival(page)).toHaveCount(0);
});

test("the arrival's frames follow the approved order and never lift the portrait", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await setUp(characterId);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await acceptHome(characterId);
  await finishRig(characterId, false);
  // Hold every cue animation at creation and freeze the page's timers, so the show can
  // be read at exact timestamps instead of raced against the wall clock.
  await page.addInitScript(() => {
    const held: Animation[] = [];
    (window as unknown as { __cueAnimations: Animation[] }).__cueAnimations = held;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      const animation = original.apply(this, args);
      if ((this as HTMLElement).dataset?.sceneCueTarget) {
        animation.pause();
        held.push(animation);
      }
      return animation;
    };
  });
  await page.clock.install();
  await openTestCharacter(page, characterId);
  // The cue player waits one frame before it animates; give it exactly that.
  await expect(arrival(page)).toBeVisible();
  await page.clock.runFor(200);
  await page.waitForFunction(
    () => (window as unknown as { __cueAnimations: Animation[] }).__cueAnimations.length >= 5,
  );

  const read = (at: number) =>
    page.evaluate((time) => {
      const w = window as unknown as { __cueAnimations: Animation[] };
      for (const animation of w.__cueAnimations) animation.currentTime = time;
      const root = document.querySelector("[data-resonance-arrival]")!;
      const layer = (name: string) =>
        root.querySelector<HTMLElement>(`[data-scene-cue-target="${name}"]`)!;
      const frame = root.querySelector<HTMLElement>(".rs-dialogue-scene")!;
      const image = layer("portrait").querySelector("img")!;
      return {
        portrait: Number(getComputedStyle(layer("portrait")).opacity),
        rift: Number(getComputedStyle(layer("rift")).opacity),
        core: Number(getComputedStyle(layer("core")).opacity),
        // Feet stay hidden: the portrait's bottom is the frame's floor at every instant.
        drift: Math.abs(
          image.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom,
        ),
      };
    }, at);

  const start = await read(0);
  expect(start).toMatchObject({ portrait: 0, rift: 0, core: 0 });
  // The Core lights first, before any rift or portrait.
  const coreLit = await read(300);
  expect(coreLit.core).toBeGreaterThan(0.3);
  expect(coreLit.rift).toBe(0);
  expect(coreLit.portrait).toBe(0);
  await captureReviewScreenshot(page, "resonance-arrival-core.png");
  // The rift opens beside the Rig while the portrait is still absent...
  const riftOpen = await read(700);
  expect(riftOpen.rift).toBeGreaterThan(0.5);
  expect(riftOpen.portrait).toBe(0);
  await captureReviewScreenshot(page, "resonance-arrival-rift.png");
  // ...the portrait fades in with the rift still open behind it...
  const fading = await read(1100);
  expect(fading.portrait).toBeGreaterThan(0);
  expect(fading.portrait).toBeLessThan(1);
  expect(fading.rift).toBeGreaterThan(0.5);
  await captureReviewScreenshot(page, "resonance-arrival-fade.png");
  // ...and the rift closes behind them.
  const settled = await read(2_000);
  expect(settled.portrait).toBe(1);
  expect(settled.rift).toBe(0);
  for (const at of [0, 300, 700, 1_100, 1_500, 2_000]) {
    expect((await read(at)).drift, `portrait floor at ${at}ms`).toBeLessThanOrEqual(0.5);
  }
  // Let the show end for real: the caption lands and the arrival can be dismissed.
  await page.clock.runFor(5_000);
  await expect(arrival(page)).toHaveAttribute("data-resonance-arrival-phase", "done");
  await expect(arrival(page).locator("[data-dialogue-text]")).toContainText(
    "The Wise Old Enby has arrived.",
  );
});

test("the Rig reads on a phone and on desktop, in the header and in the 15:8 scene", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await setUp(characterId);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await acceptHome(characterId);
  await finishRig(characterId, true);
  await openTestCharacter(page, characterId);

  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "intermediate", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const frame = page.locator('[data-location-scene="crash_site"] .rs-location-scene-viewport');
    await expect(frame).toBeVisible();
    await expectRigOnStage(frame, `header @${viewport.name}`);
    // The Rig is in view, not just placed: most of its width is inside the frame.
    const shown = await frame.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const image = node.querySelector('img[data-scene-layer="overlay"]')!.getBoundingClientRect();
      const visible = Math.min(image.right, rect.right) - Math.max(image.left, rect.left);
      return visible / image.width;
    });
    expect(shown, `Rig fraction in view @${viewport.name}`).toBeGreaterThan(0.9);
    await captureReviewScreenshot(page, `resonance-site-${viewport.name}.png`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
});
