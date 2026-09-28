import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissionProgress,
  characterMissions,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import {
  expect,
  expectKeyboardFocusRingPaints,
  openNpcConversation,
  openTestCharacter,
  resolvedCssVarColor,
  test,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #232 — Tansy's Fabrication teaching chapter in the browser.
 *
 * The real journey at phone width: Wade and Tansy in the yard together, the
 * two work areas, Return the Favor, a Salvage Cutter fabricated on the
 * Fabrication Station, Tansy's Tinkering demonstration, Break It Down, and
 * Tansy walking home. Then Manual Override at desktop width — Load, Trend,
 * Feed, a push, the hold at timer 0, Lock In, and a bust — and Tansy's
 * reactive openings. Timers are fast-forwarded by moving the durable cursor,
 * which is also exactly what a reconnect after time away looks like; the
 * arithmetic itself is proven against PostgreSQL in the integration suites.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const balance = getEffectiveGameBalance();

async function completeThroughTenThousandHours(characterId: string, at: Date) {
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: at, completedAt: at })),
    );
}

async function standAtRusk(characterId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
    .where(eq(characters.id, characterId));
}

/** The starter Cutter every character past Walk It Off carries, equipped. */
async function equipStarterCutter(characterId: string) {
  const [cutter] = await db
    .insert(itemInstances)
    .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })
    .returning();
  await db.insert(equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: balance.carrying.miningToolSuitSlotId,
    itemInstanceId: cutter!.id,
  });
}

async function give(characterId: string, itemId: string, quantity: number) {
  await db.insert(inventoryStacks).values({ characterId, itemId, quantity });
}

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

async function fabricationXp(characterId: string) {
  const [row] = await db
    .select({ totalXp: characterSkillXp.totalXp })
    .from(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, characterId),
        eq(characterSkillXp.skillId, SKILL_IDS.fabrication),
      ),
    );
  return row?.totalXp ?? 0;
}

/** Move the running action's cursor back so that much time is due on the next load. */
async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  // A silent no-op would leave the action running in real time, so a caller
  // that raced its own start command would pass or fail on wall-clock timing.
  // Wait for a server-confirmed running state before calling this.
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

/** Click through an authored sequence until one of its beats says something. */
async function playToDialogueText(dialogue: import("@playwright/test").Locator, pattern: RegExp) {
  const text = dialogue.locator("[data-dialogue-text]");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (pattern.test((await text.textContent()) ?? "")) return;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      // An item beat may carry no line at all; there is nothing to skip then.
      if (await text.isVisible()) await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(text).toContainText(pattern);
}

/** Click through an authored sequence until its action control appears. */
async function playToAction(
  dialogue: import("@playwright/test").Locator,
  actionName: string | RegExp,
) {
  const action = dialogue.getByRole("button", { name: actionName });
  for (let attempt = 0; attempt < 60; attempt += 1) {
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

test("Tansy's Fabrication chapter, from Return the Favor to her walk home", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await completeThroughTenThousandHours(characterId, new Date());
  await equipStarterCutter(characterId);
  await give(characterId, ITEM_IDS.refinedFerrite, 5);
  await give(characterId, ITEM_IDS.powerCell, 1);
  await standAtRusk(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Tansy has come to the yard, and Wade is still in it: two people, one place.
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toBeVisible();
  // The station is still scenery: only the workshop, exactly as before.
  await expect(page.locator("[data-work-areas]")).toHaveCount(0);
  await expect(page.locator("[data-fabrication-station]")).toHaveCount(0);
  await expect(page.locator("[data-practice-panel]")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Return the Favor is a deliberate pickup from Tansy.
  const offer = await openNpcConversation(page, "Tansy Rusk");
  const offerEntry = offer.getByRole("button", { name: /Return the Favor/ });
  await expect(offerEntry).toContainText("Available");
  await offerEntry.click();
  await expect(offer.locator("[data-dialogue-scene-location]")).toHaveText("RUSK RECOVERY");
  await playToDialogueText(offer, /Manual Override/);
  const accept = await playToAction(offer, "TAKE THE JOB");
  await accept.click();
  await page.keyboard.press("Escape");

  // Two work areas now, as prominent cards; the station is where the work is.
  const areas = page.locator("[data-work-areas]");
  await expect(areas).toBeVisible();
  const stationCard = areas.locator('[data-work-area="fabrication"]');
  await expect(stationCard).toHaveAttribute("aria-pressed", "true");
  await expect(areas.locator('[data-work-area="workshop"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("[data-practice-panel]")).toHaveCount(0);
  const station = page.locator("[data-fabrication-station]");
  await expect(station).toBeVisible();
  await expect(station).toHaveAttribute("data-station-mode", "fabricate");
  // No Tinker yet: Tansy has not shown it.
  await expect(station.locator('[data-station-mode-select="tinker"]')).toHaveCount(0);

  // Fabricate lists what the carried materials make now — no filters. The
  // Scrap Box needs a Bracket and Scrap this character does not carry.
  const recipes = station.locator("[data-fabricate-recipes]");
  for (const actionId of [
    ACTION_IDS.mountingBracketFabrication,
    ACTION_IDS.scrapMetalFabrication,
    ACTION_IDS.salvageCutterFabrication,
  ]) {
    await expect(recipes.locator(`[data-fabricate-recipe="${actionId}"]`)).toBeVisible();
  }
  // Each Fabricate tile shows its per-batch time, in the station's "sec" unit.
  await expect(
    recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.mountingBracketFabrication}"]`),
  ).toContainText("2 Refined Ferrite → 1 Mounting Bracket · 7.2 sec");
  const box = recipes.locator(`[data-fabricate-recipe="${ACTION_IDS.scrapBoxFabrication}"]`);
  await expect(box).toHaveCount(0);
  await expect(station.getByRole("button", { name: /^Hide / })).toHaveCount(0);

  // Recipes is everything the character knows, carried materials or not.
  await station.locator('[data-station-mode-select="recipes"]').click();
  const catalog = station.locator("[data-fabrication-recipes-catalog]");
  await expect(catalog.locator("[data-recipes-catalog-entry]")).toHaveCount(4);
  await expect(
    catalog
      .locator(`[data-recipes-catalog-entry="${ACTION_IDS.scrapBoxFabrication}"]`)
      .locator("[data-station-requirement]")
      .first(),
  ).toContainText(/Need/);
  await expectNoHorizontalOverflow(page);
  await station.locator('[data-station-mode-select="fabricate"]').click();

  // The Mission's recipe is the guided one, selected, with its run at one.
  const cutterTile = recipes.locator(
    `[data-fabricate-recipe="${ACTION_IDS.salvageCutterFabrication}"]`,
  );
  await expect(cutterTile.locator('[data-mission-guidance="active"]')).toHaveCount(1);
  const runSize = station.locator("[data-bounded-run]");
  await expect(runSize).toHaveAttribute("data-bounded-run-quantity", "1");
  await expect(runSize).toHaveAttribute("data-bounded-run-affordable", "1");
  await expect(runSize.locator("[data-bounded-run-summary]")).toContainText(
    "1 batch · 5 Refined Ferrite + 1 Power Cell → 1 Salvage Cutter · 12 sec · 65 base Fabrication XP",
  );
  // Max is Max: a mode, never a number, with per-batch facts.
  await runSize.locator("[data-bounded-run-max]").click();
  await expect(runSize.locator("[data-bounded-run-value]")).toContainText("Max");
  await expect(runSize.locator("[data-bounded-run-summary]")).toContainText(
    "runs until the next workpiece cannot begin",
  );
  await runSize.locator("[data-bounded-run-decrease]").click();
  await expect(runSize).toHaveAttribute("data-bounded-run-quantity", "1");
  await captureReviewScreenshot(page, "fabrication-fabricate-phone.png");

  // Start: the workpiece is on the machine, its inputs reserved in place.
  await station.locator("[data-fabricate-start]").click();
  const live = station.locator("[data-live-workpiece]");
  await expect(live).toBeVisible();
  await expect(live).toContainText("Salvage Cutter");
  expect(await carried(characterId, ITEM_IDS.refinedFerrite)).toBe(5);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "fabrication-live-workpiece-phone.png");

  // Reconnect after the timer: the same workpiece, resolved exactly once.
  await fastForward(characterId, 13_000);
  await page.reload();
  await expect(page.locator("[data-live-workpiece]")).toHaveCount(0);
  expect(await carried(characterId, ITEM_IDS.refinedFerrite)).toBe(0);
  expect(await fabricationXp(characterId)).toBe(65);
  // What resolved while away is acknowledged at the station on return.
  await page.locator('[data-work-area="fabrication"]').click();
  const made = page.locator('[data-station-result="success"]');
  await expect(made.locator("[data-station-result-headline]")).toHaveText(
    "Salvage Cutter fabricated",
  );
  await expect(made.locator("[data-station-result-details]")).toHaveText("+65 Fabrication XP");

  // The turn-in: Tansy inspects it, takes it apart, and teaches Tinkering.
  const turnIn = await openNpcConversation(page, "Tansy Rusk");
  await turnIn.getByRole("button", { name: /Return the Favor/ }).click();
  await playToDialogueText(turnIn, /Let's see it/);
  const hand = await playToAction(turnIn, "HAND OVER THE CUTTER");
  await hand.click();
  await playToDialogueText(turnIn, /dismantles the Salvage Cutter/);
  await playToDialogueText(turnIn, /recovers 3 Scrap Metal/);
  await playToDialogueText(turnIn, /Tinkering unlocked/);
  await playToDialogueText(turnIn, /Good rule generally/);
  await page.keyboard.press("Escape");
  // The demonstration Scrap was illustrative: none of it is the player's.
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(0);
  expect(await fabricationXp(characterId)).toBe(65 + 100);
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    /Tinker one eligible fabricated item/,
  );

  // Break It Down: Tinker, now guided, on something the player can spare.
  await give(characterId, ITEM_IDS.mountingBracket, 1);
  await page.reload();
  await page.locator('[data-work-area="fabrication"]').click();
  const tinkerMode = page.locator('[data-station-mode-select="tinker"]');
  await expect(tinkerMode).toHaveAttribute("data-mission-guidance", "active");
  await tinkerMode.click();
  const tinker = page.locator("[data-tinker-mode]");
  await expect(tinker).toBeVisible();
  // Only what the character carries unequipped: the Cutter in hand is not listed.
  await expect(
    tinker.locator(`[data-tinker-target="${ACTION_IDS.salvageCutterTinkering}"]`),
  ).toHaveCount(0);
  await expect(tinker.getByRole("button", { name: /^Hide / })).toHaveCount(0);
  await tinker
    .locator(`[data-tinker-target="${ACTION_IDS.mountingBracketTinkering}"]`)
    .getByRole("button")
    .click();
  await expect(tinker.locator("[data-bounded-run-summary]")).toContainText(
    "1 batch · 1 Mounting Bracket · 14.4 sec · 25 Fabrication XP · 1 Scrap Metal",
  );
  await captureReviewScreenshot(page, "fabrication-tinker-phone.png");
  await tinker.locator("[data-tinker-start]").click();
  await expect(
    tinker.locator(`[data-tinker-cycle="${ACTION_IDS.mountingBracketTinkering}"]`),
  ).toBeVisible();
  // Committed at once: the Bracket is gone the moment the cycle begins.
  expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(0);
  await fastForward(characterId, 15_000);
  await page.reload();
  expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(1);
  await page.locator('[data-work-area="fabrication"]').click();
  const dismantled = page.locator('[data-station-result-kind="tinkering"]');
  await expect(dismantled.locator("[data-station-result-headline]")).toHaveText(
    "Mounting Bracket dismantled",
  );
  await expect(dismantled.locator("[data-station-result-details]")).toHaveText(
    "+1 Scrap Metal · +25 Fabrication XP",
  );
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    /Return to Tansy/,
  );

  const report = await openNpcConversation(page, "Tansy Rusk");
  await report.getByRole("button", { name: /Break It Down/ }).click();
  const tell = await playToAction(report, "TELL TANSY");
  await tell.click();
  await playToDialogueText(report, /Friday\. Do not forget\./);
  await playToDialogueText(report, /ready for real trouble/);
  await page.keyboard.press("Escape");
  expect(await fabricationXp(characterId)).toBe(65 + 100 + 25 + 250);

  // Tansy has gone home to The Jag; Wade stays in his yard.
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Manual Override at desktop width: push, hold at 0, Lock In, and a bust", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(DESKTOP);
  const now = new Date();
  await completeThroughTenThousandHours(characterId, now);
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.returnTheFavor, acceptedAt: now });
  await equipStarterCutter(characterId);
  await give(characterId, ITEM_IDS.refinedFerrite, 5);
  await give(characterId, ITEM_IDS.refinedFerrite, 2);
  await standAtRusk(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The work-area cards are ordinary keyboard controls.
  const stationCard = page.locator('[data-work-area="fabrication"]');
  await expectKeyboardFocusRingPaints(stationCard);
  await stationCard.click();
  const station = page.locator("[data-fabrication-station]");
  // The station's skill line carries Fabrication's own Shop Olive (#232).
  await expect(station.locator('[data-skill-progress="fabrication"] p').first()).toHaveCSS(
    "color",
    await resolvedCssVarColor(page, "--rs-skill-fabrication"),
  );
  await station
    .locator(`[data-fabricate-recipe="${ACTION_IDS.mountingBracketFabrication}"]`)
    .getByRole("button")
    .click();

  // Manual Override on before Start: the first workpiece is an Override one.
  // A latched toggle: subdued when off, Shop Olive when on, still clickable.
  const toggle = station.locator("[data-manual-override-toggle]");
  const shopOlive = await resolvedCssVarColor(page, "--rs-accent-shop-olive");
  await expect(toggle).not.toHaveCSS("border-top-color", shopOlive);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveCSS("border-top-color", shopOlive);
  await expect(toggle).toBeEnabled();
  // The keyboard ring still paints distinctly over the latched treatment.
  await expectKeyboardFocusRingPaints(toggle);
  await station.locator("[data-fabricate-start]").click();
  const machine = station.locator("[data-manual-override]");
  await expect(machine).toBeVisible();
  // The CI random source rolls the lowest draw: Load 2, trending HIGHER.
  await expect(machine.locator("[data-override-load-value]")).toHaveText("2");
  await expect(machine.locator("[data-override-trend-value]")).toContainText("Higher");
  await expect(machine.locator("[data-override-multiplier]")).toHaveText("1.00×");

  // Choose the Feed from the keyboard, then push: the Load rolls up to 3 — exact.
  const feedThree = machine.locator('[data-override-feed="3"]');
  await feedThree.focus();
  await page.keyboard.press("Space");
  await expect(feedThree).toBeChecked();
  await machine.locator("[data-override-push]").click();
  await expect(machine.locator("[data-override-multiplier]")).toHaveText("1.30×");
  await expect(machine.locator("[data-override-last-push]")).toContainText("Exact");
  await captureReviewScreenshot(page, "fabrication-manual-override-desktop.png");

  // The timer runs out; the finished piece holds at 0 for the player's call.
  await fastForward(characterId, 8_000);
  await page.reload();
  const live = page.locator("[data-live-workpiece]");
  await expect(live).toHaveAttribute("data-workpiece-held", "true");
  await expect(live).toContainText("holding on the machine");
  expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(0);
  await page.locator("[data-override-lock-in]").click();
  // floor(25 × 1.30)
  await expect.poll(() => fabricationXp(characterId)).toBe(32);
  expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(1);
  const lockedIn = page.locator('[data-station-result="success"]');
  await expect(lockedIn.locator("[data-station-result-headline]")).toHaveText(
    "Mounting Bracket fabricated",
  );
  await expect(lockedIn.locator("[data-station-result-details]")).toHaveText(
    "Manual Override 1.30× · +32 Fabrication XP",
  );
  await captureReviewScreenshot(page, "fabrication-result-beat-desktop.png");

  // A bust: the workpiece's whole input set is gone, nothing made, no XP.
  const bracketTile = page
    .locator(`[data-fabricate-recipe="${ACTION_IDS.mountingBracketFabrication}"]`)
    .getByRole("button");
  await bracketTile.click();
  await page.locator("[data-fabricate-start]").click();
  await expect(page.locator("[data-override-load-value]")).toHaveText("2");
  await page.locator('[data-override-feed="10"]').check({ force: true });
  await page.locator("[data-override-push]").click();
  await expect(page.locator("[data-live-workpiece]")).toHaveCount(0);
  await expect(
    page.locator('[data-station-result="bust"] [data-station-result-headline]'),
  ).toHaveText("Workpiece bust · materials lost");
  await expect(page.locator('[data-workpiece-result="bust"]')).toHaveCount(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator('[data-workpiece-result="bust"]')).toContainText(
    "Materials lost, no XP",
  );
  expect(await fabricationXp(characterId)).toBe(32);
  // Seven Ferrite: two in the Bracket, two lost to the bust.
  expect(await carried(characterId, ITEM_IDS.refinedFerrite)).toBe(3);
  await expectNoHorizontalOverflow(page);
});

test("Tansy reacts to a Manual Override bust, then opens the turn-in with it", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  const now = new Date();
  await completeThroughTenThousandHours(characterId, now);
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.returnTheFavor, acceptedAt: now });
  await db.insert(characterMissionProgress).values([
    {
      characterId,
      missionId: MISSION_IDS.returnTheFavor,
      progressKey: "salvage-cutter-fabricated",
      progress: 0,
    },
    {
      characterId,
      missionId: MISSION_IDS.returnTheFavor,
      progressKey: "override-bust",
      progress: 1,
    },
  ]);
  await equipStarterCutter(characterId);
  await standAtRusk(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Before a replacement exists: the one amused reminder, and no turn-in.
  const reminder = await openNpcConversation(page, "Tansy Rusk");
  await reminder.getByRole("button", { name: /Return the Favor/ }).click();
  await expect(reminder.locator("[data-dialogue-text]")).toContainText("You pressed it.");
  await playToDialogueText(reminder, /stop before it comes apart/);
  await expect(reminder.getByRole("button", { name: "HAND OVER THE CUTTER" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A replacement made and carried: the bust-aware opening, which rejoins the
  // one inspection and demonstration.
  await db
    .update(characterMissionProgress)
    .set({ progress: 1 })
    .where(
      and(
        eq(characterMissionProgress.characterId, characterId),
        eq(characterMissionProgress.progressKey, "salvage-cutter-fabricated"),
      ),
    );
  await db
    .insert(itemInstances)
    .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 });
  await page.reload();
  const turnIn = await openNpcConversation(page, "Tansy Rusk");
  await turnIn.getByRole("button", { name: /Return the Favor/ }).click();
  await expect(turnIn.locator("[data-dialogue-text]")).toContainText(
    "Don't think I didn't see that first one.",
  );
  await playToDialogueText(turnIn, /Usually\./);
  await expect(await playToAction(turnIn, "HAND OVER THE CUTTER")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
