import type { Locator, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterResearchAssignments,
  characterResearchJobs,
  characters,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  RESEARCH_JOB_IDS,
} from "@/game/config/foundations";
import { expect, openTestCharacter, openUtility, test, utilitySurface } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Destroy for Wise Old Enby loans (#408) in a real browser. The server suites
 * own the rules and the races; this covers what only a rendered page can: the
 * action appearing only for the exact held loan, the inline confirmation that
 * commits nothing when declined, the announced result, focus restored to the
 * grid, a stale confirmation, and the phone and desktop layouts.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const LOAN_ITEMS: string[] = [
  ITEM_IDS.sealedResearchPacket,
  ITEM_IDS.geologicalSampleCase,
  ITEM_IDS.resonanceSampler,
];

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewport; runs once");
  await page.setViewportSize(PHONE);
});

type LoanJob = {
  jobId: string;
  itemId: string;
  itemName: string;
  jobTitle: string;
  loss: string;
  progress: { sampledLocationIds?: string[]; recordedAt?: Date };
};

const JOBS: [LoanJob, LoanJob, LoanJob] = [
  {
    jobId: RESEARCH_JOB_IDS.researchCourier,
    itemId: ITEM_IDS.sealedResearchPacket,
    itemName: "Sealed Research Packet",
    jobTitle: "Research Courier",
    loss: "25 Credits",
    progress: {},
  },
  {
    jobId: RESEARCH_JOB_IDS.geologicalFieldSurvey,
    itemId: ITEM_IDS.geologicalSampleCase,
    itemName: "Geological Sample Case",
    jobTitle: "Geological Field Survey",
    loss: "75 Credits",
    progress: { sampledLocationIds: [LOCATION_IDS.prospectingQuarry, LOCATION_IDS.theDrySeam] },
  },
  {
    jobId: RESEARCH_JOB_IDS.resonanceCalibration,
    itemId: ITEM_IDS.resonanceSampler,
    itemName: "Resonance Sampler",
    jobTitle: "Resonance Calibration",
    loss: "free passage to Skatboll",
    progress: { recordedAt: new Date() },
  },
];

async function seedRun(characterId: string, job: LoanJob) {
  const now = new Date();
  await db.insert(characterMissions).values({
    characterId,
    missionId: MISSION_IDS.notFromAroundHere,
    acceptedAt: now,
    completedAt: now,
  });
  const [instance] = await db
    .insert(itemInstances)
    .values({ characterId, itemId: job.itemId })
    .returning({ id: itemInstances.id });
  const [run] = await db
    .insert(characterResearchAssignments)
    .values({
      characterId,
      jobId: job.jobId,
      itemInstanceId: instance!.id,
      startedAt: now,
      ...job.progress,
    })
    .returning({ id: characterResearchAssignments.id });
  return { instanceId: instance!.id, runId: run!.id };
}

const assignmentsOf = (characterId: string) =>
  db
    .select()
    .from(characterResearchAssignments)
    .where(eq(characterResearchAssignments.characterId, characterId));

async function loansOf(characterId: string) {
  const rows = await db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId));
  return rows.filter((row) => LOAN_ITEMS.includes(row.itemId));
}

async function snapshot(characterId: string) {
  const [row] = await db
    .select({ credits: characters.credits, at: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  const history = await db
    .select()
    .from(characterResearchJobs)
    .where(eq(characterResearchJobs.characterId, characterId));
  return { ...row!, completions: history.reduce((sum, entry) => sum + entry.completions, 0) };
}

async function openInventory(page: Page): Promise<Locator> {
  await openUtility(page, "inventory");
  const inventory = utilitySurface(page, "Inventory");
  await expect(inventory).toBeVisible();
  return inventory;
}

const tileFor = (inventory: Locator, name: string) =>
  inventory.getByRole("button", { name: new RegExp(name) }).first();

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

for (const job of JOBS) {
  test.describe(job.jobTitle, () => {
    test("Destroy asks first, KEEP ITEM changes nothing, then it destroys, abandons and announces", async ({
      page,
      testCharacter,
    }) => {
      const id = testCharacter.id;
      await seedRun(id, job);
      // Something that survives, for focus to land on.
      await db
        .insert(inventoryStacks)
        .values({ characterId: id, itemId: ITEM_IDS.slag, quantity: 2 });
      await openTestCharacter(page, id);
      const before = await snapshot(id);
      const inventory = await openInventory(page);
      await tileFor(inventory, job.itemName).click();
      const destroy = inventory.locator("[data-mission-item-destroy-start]");
      await expect(destroy).toHaveText("Destroy");
      // The read-only loan details stay; the action sits beside them.
      await expect(inventory.locator(`[data-research-loan-details="${job.jobId}"]`)).toBeVisible();
      await destroy.click();

      const confirmation = inventory.locator("[data-mission-item-destroy-confirmation]");
      await expect(confirmation).toContainText(
        `Destroy ${job.itemName} and abandon ${job.jobTitle}?`,
      );
      await expect(confirmation).toContainText("permanent");
      await expect(confirmation).toContainText("all progress is lost");
      await expect(confirmation).toContainText(job.loss);
      await expect(confirmation.getByRole("button", { name: "KEEP ITEM" })).toBeFocused();
      await captureReviewScreenshot(page, `mission-item-destroy-${job.itemId}-mobile.png`);

      // Keep: nothing changes, and focus returns to the action that opened it.
      await confirmation.getByRole("button", { name: "KEEP ITEM" }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(destroy).toBeFocused();
      expect(await assignmentsOf(id)).toHaveLength(1);
      expect(await loansOf(id)).toHaveLength(1);

      await destroy.click();
      await confirmation.getByRole("button", { name: "DESTROY & ABANDON" }).click();
      const status = inventory.getByRole("status");
      await expect(status).toHaveText(
        `${job.itemName} destroyed. ${job.jobTitle} abandoned. Progress and reward forfeited.`,
      );
      await expect(tileFor(inventory, job.itemName)).toHaveCount(0);
      await expect(inventory.locator("[data-mission-item-destroy]")).toHaveCount(0);
      // Focus lands on the grid, not on the document body.
      await expect(page.locator("body")).not.toBeFocused();
      await expect(inventory.locator("button[aria-pressed]").first()).toBeFocused();

      expect(await assignmentsOf(id)).toHaveLength(0);
      expect(await loansOf(id)).toHaveLength(0);
      expect(await snapshot(id)).toEqual(before);
      await expectNoHorizontalOverflow(page);

      // The Mission is gone from the log, and the slot is free.
      await page.keyboard.press("Escape");
      await openUtility(page, "missions");
      await expect(
        utilitySurface(page, "Mission Log").locator(`[data-mission-log-entry="${job.jobId}"]`),
      ).toHaveCount(0);
    });
  });
}

test.describe("who is offered Destroy", () => {
  test("not an ordinary unique item, an orphan lookalike, or a loan whose run is gone", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    const [cutter] = await db
      .insert(itemInstances)
      .values({ characterId: id, itemId: ITEM_IDS.salvageCutter })
      .returning();
    expect(cutter).toBeDefined();
    // A packet no run owns.
    await db
      .insert(itemInstances)
      .values({ characterId: id, itemId: ITEM_IDS.sealedResearchPacket });
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Salvage Cutter").click();
    await expect(inventory.locator("[data-details-panel]")).toBeVisible();
    await expect(inventory.locator("[data-mission-item-destroy]")).toHaveCount(0);
    await tileFor(inventory, "Sealed Research Packet").click();
    await expect(inventory.locator("[data-research-loan-details]")).toContainText(
      "not tied to a current assignment",
    );
    await expect(inventory.locator("[data-mission-item-destroy]")).toHaveCount(0);
  });

  test("a delivered Courier has no packet; Mission Log Abandon still works unpaid", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    const seeded = await seedRun(id, JOBS[0]);
    // FedHex consumed the packet.
    await db
      .update(characterResearchAssignments)
      .set({ deliveredAt: new Date(), itemInstanceId: null })
      .where(eq(characterResearchAssignments.id, seeded.runId));
    await db.delete(itemInstances).where(eq(itemInstances.id, seeded.instanceId));
    await openTestCharacter(page, id);
    const credits = (await snapshot(id)).credits;
    const inventory = await openInventory(page);
    await expect(tileFor(inventory, "Sealed Research Packet")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openUtility(page, "missions");
    const log = utilitySurface(page, "Mission Log");
    await log.locator("[data-research-abandon-start]").click();
    await log
      .locator("[data-research-abandon-confirmation]")
      .getByRole("button", { name: "Abandon Assignment" })
      .click();
    await expect(log.locator(`[data-mission-log-entry="${JOBS[0].jobId}"]`)).toHaveCount(0);
    expect(await assignmentsOf(id)).toHaveLength(0);
    expect((await snapshot(id)).credits).toBe(credits);
  });
});

test.describe("fieldwork", () => {
  test("Destroy cancels a running field action so nothing records afterwards", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    await seedRun(id, JOBS[1]);
    await db
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.harmonicWorkings })
      .where(eq(characters.id, id));
    const now = new Date();
    await db.insert(activeActions).values({
      characterId: id,
      actionId: ACTION_IDS.researchSurfaceSample,
      startedAt: now,
      resolvedThroughAt: now,
    });
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Geological Sample Case").click();
    await inventory.locator("[data-mission-item-destroy-start]").click();
    await inventory
      .locator("[data-mission-item-destroy-confirmation]")
      .getByRole("button", { name: "DESTROY & ABANDON" })
      .click();
    await expect(inventory.getByRole("status")).toContainText("destroyed");
    expect(await db.select().from(activeActions).where(eq(activeActions.characterId, id))).toEqual(
      [],
    );
    expect(await assignmentsOf(id)).toHaveLength(0);
    expect((await snapshot(id)).completions).toBe(0);
  });
});

test.describe("stale confirmation", () => {
  test("a confirmation for a run that ended elsewhere is refused and cannot touch the new run", async ({
    page,
    testCharacter,
  }) => {
    const id = testCharacter.id;
    const first = await seedRun(id, JOBS[0]);
    await openTestCharacter(page, id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Sealed Research Packet").click();
    await inventory.locator("[data-mission-item-destroy-start]").click();
    const confirmation = inventory.locator("[data-mission-item-destroy-confirmation]");
    await expect(confirmation).toBeVisible();

    // Another tab abandons the run and starts a fresh one before this confirms.
    await db
      .delete(characterResearchAssignments)
      .where(eq(characterResearchAssignments.id, first.runId));
    await db.delete(itemInstances).where(eq(itemInstances.id, first.instanceId));
    const [fresh] = await db
      .insert(itemInstances)
      .values({ characterId: id, itemId: ITEM_IDS.sealedResearchPacket })
      .returning({ id: itemInstances.id });
    const [freshRun] = await db
      .insert(characterResearchAssignments)
      .values({
        characterId: id,
        jobId: JOBS[0].jobId,
        itemInstanceId: fresh!.id,
        startedAt: new Date(),
      })
      .returning({ id: characterResearchAssignments.id });

    await confirmation.getByRole("button", { name: "DESTROY & ABANDON" }).click();
    await expect(inventory.getByRole("alert")).toContainText("no longer active");
    const runs = await assignmentsOf(id);
    expect(runs.map((run) => run.id)).toEqual([freshRun!.id]);
    expect((await loansOf(id)).map((row) => row.id)).toEqual([fresh!.id]);
  });
});

test.describe("desktop layout", () => {
  test("shows the confirmation inside the docked Inventory without overflow", async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedRun(testCharacter.id, JOBS[2]);
    await openTestCharacter(page, testCharacter.id);
    const inventory = await openInventory(page);
    await tileFor(inventory, "Resonance Sampler").click();
    await inventory.locator("[data-mission-item-destroy-start]").click();
    await expect(inventory.locator("[data-mission-item-destroy-confirmation]")).toBeVisible();
    await captureReviewScreenshot(page, "mission-item-destroy-confirmation-desktop.png");
    await expectNoHorizontalOverflow(page);
  });
});
