import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterResearchAssignments,
  characterResearchJobs,
  characterShips,
  characters,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  RESEARCH_JOB_IDS,
} from "@/game/config/foundations";
import { playDialogueToText } from "./dialogue-steps";
import {
  expect,
  openNpcConversation,
  openTestCharacter,
  openUtility,
  test,
  utilitySurface,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * The Wise Old Enby's research jobs (#406) in a real browser.
 *
 * The server suites own the rules (exclusivity, capacity, exactly-once payment,
 * the atomic passage). This covers what only a rendered page can answer: the
 * Research Jobs and Conversation Topics buttons beneath the story conversations,
 * each job end to end, the compact field actions and FedHex section where they
 * belong, the confirmation that does not commit when declined, the durable arrival
 * modal, Abandon Assignment from Mission details, and the phone and desktop
 * layouts.
 */

const ENBY = "The Wise Old Enby";
const COURIER = RESEARCH_JOB_IDS.researchCourier;
const SURVEY = RESEARCH_JOB_IDS.geologicalFieldSurvey;
const CALIBRATION = RESEARCH_JOB_IDS.resonanceCalibration;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewport; runs once");
  await page.setViewportSize(PHONE);
});

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function locationOf(characterId: string) {
  const [row] = await db
    .select({ at: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row!.at;
}

async function creditsOf(characterId: string) {
  const [row] = await db
    .select({ credits: characters.credits })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row!.credits;
}

async function completeStoryGate(characterId: string) {
  const now = new Date();
  await db.insert(characterMissions).values({
    characterId,
    missionId: MISSION_IDS.notFromAroundHere,
    acceptedAt: now,
    completedAt: now,
  });
}

const assignmentOf = async (characterId: string) =>
  (
    await db
      .select()
      .from(characterResearchAssignments)
      .where(eq(characterResearchAssignments.characterId, characterId))
  )[0];

async function loansOf(characterId: string) {
  const loans: string[] = [
    ITEM_IDS.sealedResearchPacket,
    ITEM_IDS.geologicalSampleCase,
    ITEM_IDS.resonanceSampler,
  ];
  const rows = await db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId));
  return rows.filter((row) => loans.includes(row.itemId));
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

const talkTo = (page: Page) => page.getByRole("button", { name: `Talk to ${ENBY}` });

/** Open the Enby's Research Jobs list. */
async function openResearchJobs(page: Page) {
  const conversation = await openNpcConversation(page, ENBY);
  await conversation.locator('[data-conversation-group="research"]').click();
  await expect(conversation.locator("[data-research-jobs]")).toBeVisible();
  return conversation;
}

/** Step a dialogue forward until its terminal control is on screen. */
async function playToAction(conversation: Locator) {
  const next = conversation.locator("[data-dialogue-next]");
  for (let step = 0; step < 60; step += 1) {
    if ((await conversation.locator("[data-dialogue-action]").count()) > 0) return;
    await next.click();
  }
  throw new Error("The dialogue never reached its terminal control");
}

/** Step a dialogue to its end and press Finish. */
async function playToFinish(conversation: Locator) {
  const next = conversation.locator("[data-dialogue-next]");
  for (let step = 0; step < 60; step += 1) {
    const label = (await next.textContent())?.trim();
    await next.click();
    if (label === "Finish") return;
  }
  throw new Error("The dialogue never finished");
}

/** Take a job from the Research Jobs list, through the offer to the loan. */
async function acceptJob(conversation: Locator, jobId: string) {
  await conversation.locator(`[data-research-job="${jobId}"] [data-research-job-open]`).click();
  await playToAction(conversation);
  await conversation.locator("[data-dialogue-action]").click();
  // The accepted scene ends on the item beat the server's grant lets it show.
  await expect(
    conversation
      .locator("[data-dialogue-item-artwork]")
      .or(conversation.locator("[data-dialogue-text]")),
  ).toBeVisible();
  await playToFinish(conversation);
  await expect(conversation.locator("[data-research-jobs]")).toBeVisible();
}

async function closeConversation(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: `${ENBY} conversation` })).toHaveCount(0);
}

test.describe("the Research Jobs menu", () => {
  test("sits beside Conversation Topics under the story conversations, listing only what is open", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, id));
    // A carried Rune Fragment makes the story offer: it must stay on the top level.
    await db
      .insert(inventoryStacks)
      .values({ characterId: id, itemId: ITEM_IDS.runeFragment, quantity: 2 });
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);

    const conversation = await openNpcConversation(page, ENBY);
    await expect(conversation.locator('[data-conversation-section="current"]')).toContainText(
      "Show strange mineral",
    );
    await expect(conversation.locator("[data-conversation-group]")).toHaveText([
      "Conversation Topics",
      "Research Jobs",
    ]);
    // The topics are no longer a flat list on the hub.
    await expect(conversation.locator('[data-conversation-section="topics"]')).toHaveCount(0);

    await conversation.locator('[data-conversation-group="topics"]').click();
    await expect(conversation.locator('[data-conversation-section="topics"] button')).toHaveText([
      "Introductions",
      "The workshop",
      "Stillreach",
    ]);
    await conversation.locator("[data-conversation-back]").click();
    await expect(conversation.locator('[data-conversation-group="research"]')).toBeVisible();

    await conversation.locator('[data-conversation-group="research"]').click();
    // Calibration is not mentioned before the story has introduced RuneSpace.
    await expect(conversation.locator("[data-research-job]")).toHaveCount(2);
    const courier = conversation.locator(`[data-research-job="${COURIER}"]`);
    await expect(courier).toContainText("Research Courier");
    await expect(courier.locator("[data-research-job-pitch]")).toContainText("FedHex");
    await expect(courier.locator("[data-research-job-reward]")).toHaveText("25 Credits · No XP");
    const survey = conversation.locator(`[data-research-job="${SURVEY}"]`);
    await expect(survey.locator("[data-research-job-reward]")).toHaveText("75 Credits · No XP");
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "research-jobs-menu-mobile.png");

    await conversation.locator("[data-research-back]").click();
    await expect(conversation.locator("[data-conversation-group]")).toHaveCount(2);
    // Backing out of everything created nothing.
    expect(await assignmentOf(id)).toBeUndefined();
    expect(await loansOf(id)).toHaveLength(0);
  });

  test("opens Calibration once the story has introduced RuneSpace", async ({
    page,
    testCharacter,
  }) => {
    await completeStoryGate(testCharacter.id);
    await standAt(testCharacter.id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, testCharacter.id);
    const conversation = await openResearchJobs(page);
    await expect(conversation.locator("[data-research-job]")).toHaveCount(3);
    await expect(
      conversation.locator(`[data-research-job="${CALIBRATION}"] [data-research-job-reward]`),
    ).toContainText("Passage to Skatboll Crash Site");
  });
});

test.describe("Research Courier", () => {
  test("runs from the workshop to the Stillreach FedHex and back for 25 Credits, then repeats briefly", async ({
    page,
    testCharacter,
  }) => {
    test.setTimeout(90_000);
    const id = testCharacter.id;
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);

    const conversation = await openResearchJobs(page);
    // First time: the full introduction (four beats), then the accept control.
    await conversation.locator(`[data-research-job="${COURIER}"] [data-research-job-open]`).click();
    await playDialogueToText(conversation, /Interested\?/);
    await conversation.locator("[data-dialogue-text]").click();
    await expect(conversation.locator("[data-dialogue-action]")).toHaveText("ACCEPT ASSIGNMENT");
    await expect(conversation.locator("[data-dialogue-decline]")).toHaveText("NOT RIGHT NOW");
    // NOT RIGHT NOW writes nothing.
    await conversation.locator("[data-dialogue-decline]").click();
    expect(await assignmentOf(id)).toBeUndefined();

    await acceptJob(conversation, COURIER);
    expect(await loansOf(id)).toHaveLength(1);
    // The other jobs are visible but blocked, naming the current assignment.
    await expect(
      conversation.locator(`[data-research-job="${SURVEY}"] [data-research-job-blocked]`),
    ).toContainText("Research Courier");
    await expect(
      conversation.locator(`[data-research-job="${SURVEY}"] [data-research-job-open]`),
    ).toHaveCount(0);
    await closeConversation(page);

    // The packet is an ordinary carried item and shows its state.
    await openUtility(page, "inventory");
    const inventory = utilitySurface(page, "Inventory");
    await inventory.getByRole("button", { name: /Sealed Research Packet/ }).click();
    await expect(inventory.locator(`[data-research-loan-details="${COURIER}"]`)).toContainText(
      "cannot be sold, traded, stored or dropped",
    );
    await expect(inventory).toContainText("2 kg");
    await captureReviewScreenshot(page, "research-courier-packet-mobile.png");
    await page.keyboard.press("Escape");
    await expect(utilitySurface(page, "Inventory")).toHaveCount(0);
    // The Mission Log carries Abandon Assignment, collapsed behind a confirmation.
    await openUtility(page, "missions");
    const log = utilitySurface(page, "Mission Log");
    await expect(log.locator(`[data-mission-log-entry="${COURIER}"]`)).toBeVisible();
    await expect(log.locator(`[data-mission-log-pin="${COURIER}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(log.locator("[data-research-abandon-start]")).toBeVisible();

    // At the Stillreach FedHex: the delivery sits above the Parcel Pickup.
    await standAt(id, LOCATION_IDS.stillreachLandingStation);
    await openTestCharacter(page, id);
    await page
      .locator(`[data-local-place="${LOCAL_PLACE_IDS.fedhexStillreachLandingStation}"]`)
      .locator("[data-local-place-enter]")
      .click();
    const delivery = page.locator('[data-research-delivery="ready"]');
    await expect(delivery).toBeVisible();
    const mailbox = page.locator("[data-fedhex-mailbox]");
    const deliveryBox = (await delivery.boundingBox())!;
    const mailboxBox = (await mailbox.boundingBox())!;
    expect(deliveryBox.y + deliveryBox.height).toBeLessThanOrEqual(mailboxBox.y);
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "research-courier-fedhex-mobile.png");
    const creditsBefore = await creditsOf(id);
    await delivery.locator("[data-research-deliver]").click();
    await expect(page.locator('[data-research-delivery="done"]')).toContainText(
      "Research packet accepted. Delivery recorded.",
    );
    await expect(page.locator('[data-research-delivery="ready"]')).toHaveCount(0);
    expect(await creditsOf(id)).toBe(creditsBefore);
    expect(await loansOf(id)).toHaveLength(0);
    // The Parcel Pickup is untouched.
    await expect(page.locator("[data-fedhex-empty]")).toBeVisible();

    // The objective is now the return, and nothing was paid at FedHex.
    await openUtility(page, "missions");
    await expect(
      utilitySurface(page, "Mission Log").locator("[data-mission-log-next]"),
    ).toContainText("Return to The Wise Old Enby");

    // Back at the workshop: Research Jobs carries the finished run.
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    await expect(talkTo(page)).toHaveAttribute("data-mission-guidance", "turn_in");
    const back = await openNpcConversation(page, ENBY);
    await expect(back.locator('[data-conversation-group="research"]')).toHaveAttribute(
      "data-mission-guidance",
      "turn_in",
    );
    await back.locator('[data-conversation-group="research"]').click();
    await back.locator("[data-research-job-run]").click();
    await playToAction(back);
    await expect(back.locator("[data-dialogue-action]")).toHaveText("COLLECT PAYMENT — 25 CR");
    await back.locator("[data-dialogue-action]").click();
    await expect(back.locator("[data-dialogue-credits-tile]")).toHaveAttribute(
      "data-credits-amount",
      "25",
    );
    expect(await creditsOf(id)).toBe(creditsBefore + 25);
    await playToFinish(back);
    expect(await assignmentOf(id)).toBeUndefined();

    // Repeat: the short introduction (two beats) instead of the full one.
    await back.locator(`[data-research-job="${COURIER}"] [data-research-job-open]`).click();
    await expect(
      back.locator(`[data-dialogue-player="${"research_courier_repeat_offer"}"]`),
    ).toBeVisible();
    await playToAction(back);
    await expect(back.locator("[data-dialogue-action]")).toHaveText("ACCEPT ASSIGNMENT");
  });
});

test.describe("Geological Field Survey", () => {
  test("collects three surface specimens in 8 ticks each, above Mining, and pays 75 Credits", async ({
    page,
    testCharacter,
  }) => {
    test.setTimeout(120_000);
    const id = testCharacter.id;
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await acceptJob(conversation, SURVEY);
    await closeConversation(page);
    const run = (await assignmentOf(id))!;
    expect(await loansOf(id)).toHaveLength(1);

    // At the Quarry: one compact row above Mining, 8 ticks.
    await standAt(id, LOCATION_IDS.prospectingQuarry);
    await openTestCharacter(page, id);
    const action = page.locator("[data-research-field-action]");
    await expect(action).toBeVisible();
    await expect(action.locator("[data-research-start]")).toHaveText(
      "COLLECT SURFACE SAMPLE — 8 ticks",
    );
    await expect(action).toContainText("4.8");
    const mining = page.locator("[data-mining-activity], [data-activity-panel]").first();
    if ((await mining.count()) > 0) {
      const actionBox = (await action.boundingBox())!;
      const miningBox = (await mining.boundingBox())!;
      expect(actionBox.y).toBeLessThan(miningBox.y);
      // A short row, never a permanent full-size panel.
      expect(actionBox.height).toBeLessThan(miningBox.height);
    }
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "research-survey-quarry-mobile.png");
    await action.locator("[data-research-start]").click();
    await expect(action.locator("[data-research-progress]")).toBeVisible();
    // Nothing is recorded before the eighth tick has passed.
    expect((await assignmentOf(id))!.sampledLocationIds).toEqual([]);
    await expect(page.locator("[data-research-done]")).toContainText(
      "Surface specimen collected: Prospecting Quarry. 1/3 samples collected.",
      { timeout: 20_000 },
    );
    await expect(action.locator("[data-research-start]")).toHaveCount(0);
    expect((await assignmentOf(id))!.sampledLocationIds).toEqual([LOCATION_IDS.prospectingQuarry]);

    // The case's own details show what is collected and what is missing.
    await openUtility(page, "inventory");
    const inventory = utilitySurface(page, "Inventory");
    await inventory.getByRole("button", { name: /Geological Sample Case/ }).click();
    const sites = inventory.locator("[data-research-loan-sites]");
    await expect(sites.locator('[data-research-site-collected="true"]')).toHaveCount(1);
    await expect(sites.locator('[data-research-site-collected="false"]')).toHaveCount(2);
    await expect(inventory).toContainText("100 g");

    // The other two sites, in the other order, complete the case.
    for (const site of [LOCATION_IDS.harmonicWorkings, LOCATION_IDS.theDrySeam]) {
      await standAt(id, site);
      await openTestCharacter(page, id);
      await page.locator("[data-research-field-action] [data-research-start]").click();
      await expect
        .poll(async () => (await assignmentOf(id))!.sampledLocationIds.includes(site), {
          timeout: 20_000,
        })
        .toBe(true);
    }
    expect((await assignmentOf(id))!.sampledLocationIds).toHaveLength(3);
    // No ore, no extra items: Mining was never touched.
    expect(
      await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, id)),
    ).toEqual([]);
    expect(await loansOf(id)).toHaveLength(1);

    // Payment at the workshop reclaims the case and pays once.
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const credits = await creditsOf(id);
    const back = await openResearchJobs(page);
    await back.locator("[data-research-job-run]").click();
    await playToAction(back);
    await expect(back.locator("[data-dialogue-action]")).toHaveText("COLLECT PAYMENT — 75 CR");
    await back.locator("[data-dialogue-action]").click();
    await expect(back.locator("[data-dialogue-credits-tile]")).toHaveAttribute(
      "data-credits-amount",
      "75",
    );
    expect(await creditsOf(id)).toBe(credits + 75);
    expect(await loansOf(id)).toHaveLength(0);
    expect(await assignmentOf(id)).toBeUndefined();
    const [history] = await db
      .select()
      .from(characterResearchJobs)
      .where(
        and(eq(characterResearchJobs.characterId, id), eq(characterResearchJobs.jobId, SURVEY)),
      );
    expect(history?.completions).toBe(1);
    expect(run.id).toBeTruthy();
  });

  test("explains a full Inventory without accepting or issuing anything", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, id));
    await db
      .insert(inventoryStacks)
      .values(
        [
          ITEM_IDS.ferriteShale,
          ITEM_IDS.galvanite,
          ITEM_IDS.refinedFerrite,
          ITEM_IDS.galvanicStock,
          ITEM_IDS.scrapMetal,
          ITEM_IDS.slag,
          ITEM_IDS.uncutQuartz,
          ITEM_IDS.uncutTopaz,
        ].map((itemId) => ({ characterId: id, itemId, quantity: 1 })),
      );
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await conversation.locator(`[data-research-job="${SURVEY}"] [data-research-job-open]`).click();
    await playToAction(conversation);
    await conversation.locator("[data-dialogue-action]").click();
    // The authored refusal beat plays, with the functional slot explanation.
    await expect(
      conversation.locator('[data-dialogue-player="geological_survey_capacity"]'),
    ).toBeVisible();
    await expect(conversation).toContainText("Your Inventory is full");
    expect(await assignmentOf(id)).toBeUndefined();
    expect(await loansOf(id)).toHaveLength(0);
  });
});

test.describe("Resonance Calibration", () => {
  test("records at The Low Hum, declines the passage without cost, then teleports once and shows a durable arrival", async ({
    page,
    testCharacter,
  }) => {
    test.setTimeout(120_000);
    const id = testCharacter.id;
    await completeStoryGate(id);
    // The Rivet is parked at Stillreach with fuel: it must stay there.
    await db
      .insert(characterShips)
      .values({
        characterId: id,
        berthLocationId: LOCATION_IDS.stillreachLandingStation,
        fuelUnits: 20,
      })
      .onConflictDoUpdate({
        target: characterShips.characterId,
        set: { berthLocationId: LOCATION_IDS.stillreachLandingStation, fuelUnits: 20 },
      });
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await acceptJob(conversation, CALIBRATION);
    await closeConversation(page);

    // Nothing can be teleported before a reading: the run only offers a reminder.
    await standAt(id, LOCATION_IDS.theLowHum);
    await openTestCharacter(page, id);
    const action = page.locator("[data-research-field-action]");
    await expect(action.locator("[data-research-start]")).toHaveText(
      "RECORD RESONANCE SIGNATURE — 8 ticks",
    );
    await captureReviewScreenshot(page, "research-calibration-low-hum-mobile.png");
    await action.locator("[data-research-start]").click();
    await expect(page.locator("[data-research-done]")).toContainText(
      "Resonance signature recorded. The sampler hums softly. Return it to The Wise Old Enby at Hilltop Workshop.",
      { timeout: 20_000 },
    );
    await expect(action.locator("[data-research-start]")).toHaveCount(0);
    await openUtility(page, "inventory");
    const inventory = utilitySurface(page, "Inventory");
    await inventory.getByRole("button", { name: /Resonance Sampler/ }).click();
    await expect(inventory.locator("[data-research-loan-recorded]")).toContainText(
      "Signature Recorded",
    );

    // At the workshop the whole farewell plays before any control to travel.
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const back = await openResearchJobs(page);
    await back.locator("[data-research-job-run]").click();
    await playDialogueToText(back, /Perfectly normal\./);
    await expect(back.locator("[data-dialogue-action]")).toHaveCount(0);
    await playDialogueToText(back, /Probably\./);
    await expect(back.locator("[data-dialogue-action]")).toHaveCount(0);
    await playToAction(back);
    await expect(back.locator("[data-dialogue-text]")).toContainText(
      "Whenever you're ready, then. Safe travels!",
    );
    await expect(back.locator("[data-dialogue-action]")).toHaveText("OPEN PASSAGE TO SKATBOLL");
    // Opening the control only asks; the character has not moved.
    await back.locator("[data-dialogue-action]").click();
    const confirmation = page.locator("[data-research-passage-confirmation]");
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("heading", { name: "RETURN TO SKATBOLL?" })).toBeVisible();
    await expect(confirmation).toContainText("Crash Site, Skatboll");
    await expect(confirmation).toContainText("Rivet, its fuel and your Cargo Hold stay");
    await expect(confirmation).toContainText("Milky Waymo costs 200 Credits");
    await expect(confirmation.locator("[data-research-passage-confirm]")).toHaveText(
      "TELEPORT NOW",
    );
    await expect(confirmation.locator("[data-research-passage-decline]")).toHaveText("NOT YET");
    await captureReviewScreenshot(page, "research-calibration-confirmation-mobile.png");
    expect(await locationOf(id)).toBe(LOCATION_IDS.hilltopWorkshop);

    // NOT YET, Escape and the outside tap are non-committing.
    await confirmation.locator("[data-research-passage-decline]").click();
    await expect(page.locator("[data-research-passage-confirmation]")).toHaveCount(0);
    await back.locator("[data-dialogue-action]").click();
    await expect(page.locator("[data-research-passage-confirmation]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-research-passage-confirmation]")).toHaveCount(0);
    expect(await locationOf(id)).toBe(LOCATION_IDS.hilltopWorkshop);
    expect((await assignmentOf(id))?.recordedAt).toBeTruthy();
    expect(await loansOf(id)).toHaveLength(1);
    expect(await creditsOf(id)).toBe(10);

    // TELEPORT NOW commits once.
    await back.locator("[data-dialogue-action]").click();
    await page.locator("[data-research-passage-confirm]").click();
    await expect.poll(() => locationOf(id)).toBe(LOCATION_IDS.crashSite);
    expect(await assignmentOf(id)).toBeUndefined();
    expect(await loansOf(id)).toHaveLength(0);
    const [ship] = await db.select().from(characterShips).where(eq(characterShips.characterId, id));
    expect(ship).toMatchObject({
      berthLocationId: LOCATION_IDS.stillreachLandingStation,
      fuelUnits: 20,
    });

    // The durable arrival modal presents over the real Crash Site.
    const arrival = page.getByRole("dialog", { name: "Resonance Calibration arrival" });
    await expect(arrival).toBeVisible();
    await expect(arrival).toContainText("Welcome to Skatboll");
    await expect(arrival).toContainText("Crash Site");
    await expect(arrival).toContainText("The passage closes behind you.");
    await expect(arrival).toContainText("Resonance Calibration completed.");
    await expect(arrival.locator("[data-research-arrival-continue]")).toHaveText("CONTINUE");
    await captureReviewScreenshot(page, "research-calibration-arrival-mobile.png");

    // A reload before dismissing shows it again, and it never replays the passage.
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Resonance Calibration arrival" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Resonance Calibration arrival" })).toHaveCount(
      0,
    );
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Resonance Calibration arrival" })).toHaveCount(
      0,
    );
    expect(await locationOf(id)).toBe(LOCATION_IDS.crashSite);
    expect(await creditsOf(id)).toBe(10);
  });

  test("CONTINUE dismisses the arrival too, and stays dismissed", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await completeStoryGate(id);
    // A committed passage whose receipt has not been dismissed.
    const when = new Date();
    await db.insert(characterResearchJobs).values({
      characterId: id,
      jobId: CALIBRATION,
      completions: 1,
      lastCompletedAt: when,
    });
    await standAt(id, LOCATION_IDS.crashSite);
    await openTestCharacter(page, id);
    const arrival = page.getByRole("dialog", { name: "Resonance Calibration arrival" });
    await expect(arrival).toBeVisible();
    await arrival.locator("[data-research-arrival-continue]").click();
    await expect(arrival).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Resonance Calibration arrival" })).toHaveCount(
      0,
    );
  });
});

test.describe("Abandon Assignment", () => {
  test("is in Mission details from anywhere, asks first, then frees the slot with nothing paid", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await acceptJob(conversation, SURVEY);
    await closeConversation(page);
    // Far from the workshop, partway through.
    await standAt(id, LOCATION_IDS.theLowHum);
    await openTestCharacter(page, id);
    const credits = await creditsOf(id);

    await openUtility(page, "missions");
    const log = utilitySurface(page, "Mission Log");
    await log.locator("[data-research-abandon-start]").click();
    const confirmation = log.locator("[data-research-abandon-confirmation]");
    await expect(confirmation).toContainText("permanently forfeited");
    await expect(confirmation).toContainText("Geological Sample Case");
    await captureReviewScreenshot(page, "research-abandon-confirmation-mobile.png");
    // Cancel changes nothing.
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(await assignmentOf(id)).toBeDefined();
    await log.locator("[data-research-abandon-start]").click();
    await log
      .locator("[data-research-abandon-confirmation]")
      .getByRole("button", { name: "Abandon Assignment" })
      .click();
    await expect(log.locator(`[data-mission-log-entry="${SURVEY}"]`)).toHaveCount(0);
    expect(await assignmentOf(id)).toBeUndefined();
    expect(await loansOf(id)).toHaveLength(0);
    expect(await creditsOf(id)).toBe(credits);
    expect(await db.select().from(activeActions).where(eq(activeActions.characterId, id))).toEqual(
      [],
    );

    // The slot is free: another job can be taken straight away.
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const again = await openResearchJobs(page);
    await expect(again.locator("[data-research-job-blocked]")).toHaveCount(0);
    await acceptJob(again, COURIER);
    expect((await assignmentOf(id))?.jobId).toBe(COURIER);
  });
});

test.describe("layout", () => {
  test("lays the menu, the field action and the Mission Log out on desktop without overflow", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await page.setViewportSize(DESKTOP);
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "research-jobs-menu-desktop.png");
    await acceptJob(conversation, SURVEY);
    await closeConversation(page);
    await standAt(id, LOCATION_IDS.theDrySeam);
    await openTestCharacter(page, id);
    await expect(page.locator("[data-research-field-action]")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureReviewScreenshot(page, "research-survey-dry-seam-desktop.png");
    await expect(page.locator(`[data-mission-strip="${SURVEY}"]`)).toBeVisible();
    await expect(page.locator(`[data-mission-strip-unpin="${SURVEY}"]`)).toBeVisible();
  });
});

test.describe("pinning and repeated acceptance", () => {
  test("a research run unpins and re-pins like a Mission, keeps its fieldwork and survives a reload", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await acceptJob(conversation, SURVEY);
    await closeConversation(page);
    await standAt(id, LOCATION_IDS.prospectingQuarry);
    await openTestCharacter(page, id);

    // A new run starts pinned.
    const strip = page.locator(`[data-mission-strip="${SURVEY}"]`);
    await expect(strip).toBeVisible();
    await strip.locator(`[data-mission-strip-unpin="${SURVEY}"]`).click();
    await expect(strip).toHaveCount(0);
    // Fieldwork does not depend on the pin.
    await expect(page.locator("[data-research-start]")).toBeVisible();
    await page.reload();
    await expect(page.locator(`[data-mission-strip="${SURVEY}"]`)).toHaveCount(0);
    await expect(page.locator("[data-research-start]")).toBeVisible();

    // Mission Log pins it again.
    await openUtility(page, "missions");
    const log = utilitySurface(page, "Mission Log");
    const toggle = log.locator(`[data-mission-log-pin="${SURVEY}"]`);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator(`[data-mission-strip="${SURVEY}"]`)).toBeVisible();
    expect((await assignmentOf(id))?.pinned).toBe(true);
  });

  test("a stale list accepting the held job shows no second item grant", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await standAt(id, LOCATION_IDS.hilltopWorkshop);
    await openTestCharacter(page, id);
    const conversation = await openResearchJobs(page);
    await conversation.locator(`[data-research-job="${COURIER}"] [data-research-job-open]`).click();
    await playToAction(conversation);
    // Meanwhile (another tab, a retry) the same job was accepted.
    await db.transaction(async (tx) => {
      const [instance] = await tx
        .insert(itemInstances)
        .values({ characterId: id, itemId: ITEM_IDS.sealedResearchPacket })
        .returning();
      await tx.insert(characterResearchAssignments).values({
        characterId: id,
        jobId: COURIER,
        itemInstanceId: instance!.id,
        startedAt: new Date(),
      });
    });
    await conversation.locator("[data-dialogue-action]").click();
    await expect(conversation.locator("[data-research-jobs]")).toContainText(
      "Research Courier is already your current assignment.",
    );
    await expect(conversation.locator("[data-dialogue-item-artwork]")).toHaveCount(0);
    await expect(
      conversation.locator('[data-dialogue-player="research_courier_accepted"]'),
    ).toHaveCount(0);
    expect(await loansOf(id)).toHaveLength(1);
  });
});
