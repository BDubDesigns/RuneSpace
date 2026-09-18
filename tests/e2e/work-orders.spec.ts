import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissions,
  characterSkillXp,
  characterWorkOrderPostings,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getWorkOrder } from "@/game/content/work-orders";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";

/**
 * Issue #207 — playable Work Orders, and 10,001 Hours.
 *
 * The journey this protects is the one a player actually walks: the terminal
 * says something truthful at each of the three stages it can be in, Wade hands
 * the board over, a real job comes off it and onto the bench, and the bench —
 * not the terminal — is where the torch gets lit.
 *
 * The Welding itself is deliberately NOT welded out in full here. A nineteen
 * section job is a minute of wall clock and its arithmetic is proven
 * exhaustively against real PostgreSQL in tests/integration/work-orders.test.ts;
 * what only a browser can prove is that the surfaces say the right thing, that
 * acceptance moves the player to the bench without lighting the torch, and that
 * three postings are usable on a phone.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/** Everything before this slice: the chain through 10,000 Hours. */
async function completeTenThousandHours(characterId: string, now: Date) {
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
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
}

/** Put the character on a given Welding level by its authoritative XP curve. */
async function setWeldingLevel(characterId: string, level: number) {
  const totalXp = standardSkillLevelThresholds().find((row) => row.level === level)?.totalXp ?? 0;
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.welding, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

async function standAtYard(characterId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
    .where(eq(characters.id, characterId));
}

async function addStacks(characterId: string, itemId: string, stacks: readonly number[]) {
  await db
    .insert(inventoryStacks)
    .values(stacks.map((quantity) => ({ characterId, itemId, quantity })));
}

async function acceptTenThousandOneHours(characterId: string, now: Date) {
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.tenThousandOneHours, acceptedAt: now });
  await db.insert(characterMissionProgress).values({
    characterId,
    missionId: MISSION_IDS.tenThousandOneHours,
    progressKey: "work-orders-completed",
    progress: 0,
  });
}

async function postings(characterId: string) {
  return db
    .select()
    .from(characterWorkOrderPostings)
    .where(eq(characterWorkOrderPostings.characterId, characterId))
    .orderBy(characterWorkOrderPostings.slotIndex);
}

/** Click through an authored sequence until its action control appears. */
async function playToAction(
  dialogue: import("@playwright/test").Locator,
  actionName: string | RegExp,
) {
  const action = dialogue.getByRole("button", { name: actionName });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await action.isVisible()) return action;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      await dialogue.locator("[data-dialogue-text]").click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(action).toBeVisible();
  return action;
}

test("tells the truth at every stage before the board is the player's", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await completeTenThousandHours(characterId, now);
  await setWeldingLevel(characterId, 3);
  await standAtYard(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Below Welding 5 the terminal names the level rather than leaving the
  // player to guess what "not yet" means.
  const terminal = page.locator("[data-work-orders-terminal]");
  await expect(terminal).toHaveAttribute("data-work-orders-state", "locked");
  await expect(terminal.locator("[data-work-orders-control]")).toContainText(
    "Requires Welding Level 5",
  );
  // Nothing has been drawn: the board is not the player's, so it does not exist.
  expect(await postings(characterId)).toHaveLength(0);

  // At Welding 5, with Wade's offer waiting, the honest message is "go and see
  // Wade" — not an empty board, which would say there is no work when there is.
  await setWeldingLevel(characterId, 5);
  await page.reload();
  await expect(terminal).toHaveAttribute("data-work-orders-state", "awaiting_wade");
  await expect(terminal.locator("[data-work-orders-await-wade]")).toContainText(/Wade Rusk/);
  await expect(terminal.locator("[data-work-orders-board]")).toHaveCount(0);
  expect(await postings(characterId)).toHaveLength(0);

  // Wade's offer is available, and accepting it is the permanent unlock.
  const conversation = await openNpcConversation(page, "Wade Rusk");
  const offer = conversation.getByRole("button", { name: /10,001 Hours/ });
  await expect(offer).toContainText("Available");
  await offer.click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/decent/i);
  const accept = await playToAction(conversation, "TAKE THE WORK");
  await accept.click();
  await page.keyboard.press("Escape");

  // Three distinct real postings, and they are durable rather than redrawn.
  await expect(terminal).toHaveAttribute("data-work-orders-state", "open");
  await expect(terminal.locator("[data-work-order-posting]")).toHaveCount(3);
  const drawn = await postings(characterId);
  expect(drawn).toHaveLength(3);
  expect(new Set(drawn.map((row) => row.workOrderId)).size).toBe(3);

  await page.reload();
  const redrawn = await postings(characterId);
  expect(redrawn.map((row) => row.workOrderId)).toEqual(drawn.map((row) => row.workOrderId));

  // Every posting says what it is, who wants it, what it takes, how much work
  // it is and what it pays — and none of them overflows a 390px screen.
  const first = terminal.locator("[data-work-order-posting]").first();
  await expect(first.locator("[data-work-order-materials]")).toContainText(/Refined Ferrite/);
  await expect(first.locator("[data-work-order-payout]")).toContainText(/\d+ Cr/);
  // Every required material carries its own met/short state, so a mixed job
  // says which half is the problem without the player recounting Inventory.
  const materials = first.locator("[data-work-order-material]");
  expect(await materials.count()).toBeGreaterThan(0);
  for (const state of await materials.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-work-order-material-met")),
  )) {
    // Carrying nothing yet, so every requirement reads short rather than blank.
    expect(state).toBe("false");
  }
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(PHONE.width);

  // The objective is the job itself, and it points through the board.
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    /Complete 1 Work Order/,
  );
});

test("takes a job to the bench without lighting the torch, and keeps the board usable", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await completeTenThousandHours(characterId, now);
  await setWeldingLevel(characterId, 5);
  await acceptTenThousandOneHours(characterId, now);
  await standAtYard(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const terminal = page.locator("[data-work-orders-terminal]");
  await expect(terminal.locator("[data-work-order-posting]")).toHaveCount(3);

  // Carrying none of the material, every posting explains itself in words
  // rather than presenting three disabled controls with no reason.
  const blocked = terminal.locator("[data-work-order-blocked]").first();
  await expect(blocked).toHaveAttribute("data-work-order-blocked", "materials");
  await expect(blocked).toContainText(/short/i);

  // Buy the recipe for whichever job the board actually drew.
  const board = await postings(characterId);
  const target = getWorkOrder(board[0]!.workOrderId)!;
  for (const material of target.materials) {
    await addStacks(characterId, material.itemId, [material.quantity]);
  }
  await page.reload();

  const posting = terminal.locator(`[data-work-order-posting="${target.id}"]`);
  await posting.locator(`[data-work-order-accept="${target.id}"]`).click();

  // Accepted: the posting stays on the board, marked In Progress, and the other
  // two stay exactly where they were.
  await expect(posting.locator("[data-work-order-status]")).toContainText("In Progress");
  await expect(terminal.locator("[data-work-order-posting]")).toHaveCount(3);
  const afterAccept = await postings(characterId);
  expect(afterAccept.filter((row) => row.acceptedAt !== null)).toHaveLength(1);
  expect(afterAccept.map((row) => row.workOrderId)).toEqual(board.map((row) => row.workOrderId));

  // The materials are committed, not merely reserved.
  const carried = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(carried).toHaveLength(0);

  // Acceptance moved the player to the bench, which now shows the client job —
  // and the torch is NOT lit: the control offers to start it.
  const bench = page.locator("[data-work-order-bench]");
  await expect(bench).toBeVisible();
  await expect(bench).toHaveAttribute("data-work-order-active", "false");
  await expect(bench.locator("[data-work-order-start]")).toContainText("Start Welding");
  // Focus moved with the scroll, so a keyboard player is at the bench too.
  await expect(page.locator("[data-workbench]")).toBeFocused();
  // Nothing is running: acceptance is not a start.
  await expect(page.locator("[data-active-action]")).toHaveCount(0);

  // The Practice surface is gone while a customer's property is on the bench.
  await expect(page.locator("[data-practice-panel]")).toHaveCount(0);

  // The terminal offers the way back to the bench while the job is active.
  await expect(terminal.locator("[data-work-orders-goto-workbench]")).toBeVisible();
  await terminal.locator("[data-work-orders-goto-workbench]").click();
  await expect(page.locator("[data-workbench]")).toBeFocused();

  // Starting is the separate, explicit decision.
  await bench.locator("[data-work-order-start]").click();
  await expect(bench).toHaveAttribute("data-work-order-active", "true");
  await expect(bench.locator("[data-work-order-stop]")).toBeVisible();

  // Stop preserves the durable job: it is still on the bench, resumable.
  await bench.locator("[data-work-order-stop]").click();
  await expect(bench.locator("[data-work-order-start]")).toBeVisible();
  expect((await postings(characterId)).filter((row) => row.acceptedAt !== null)).toHaveLength(1);

  // The other two postings remain visible and explain why they cannot be taken.
  const others = terminal.locator("[data-work-order-posting][data-work-order-in-progress='false']");
  await expect(others).toHaveCount(2);
  await expect(others.first().locator("[data-work-order-blocked]")).toHaveAttribute(
    "data-work-order-blocked",
    "work_order_active",
  );

  // No horizontal overflow on a phone, and the board is coherent at desktop
  // width where all three postings sit side by side.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );
  await page.setViewportSize(DESKTOP);
  await expect(terminal.locator("[data-work-order-posting]")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    DESKTOP.width,
  );
});

test("finishes the current practice weld to clear the bench for client work", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await completeTenThousandHours(characterId, now);
  await setWeldingLevel(characterId, 5);
  await acceptTenThousandOneHours(characterId, now);
  await addStacks(characterId, ITEM_IDS.scrapMetal, [1, 1, 1, 1]);
  await standAtYard(characterId);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Start a practice weld, then stop it: the bench now holds a real partial
  // weld the player has already paid two Scrap for.
  const practice = page.locator("[data-practice-panel]");
  await practice.locator("[data-practice-start]").click();
  await expect(practice).toHaveAttribute("data-practice-active", "true");
  await practice.locator("[data-practice-stop]").click();
  await expect(practice.locator("[data-practice-start]")).toContainText("Resume Practice");

  // That unfinished weld holds the bench against customer work, and the
  // terminal says so rather than silently disabling the control.
  const board = await postings(characterId);
  const target = getWorkOrder(board[0]!.workOrderId)!;
  for (const material of target.materials) {
    await addStacks(characterId, material.itemId, [material.quantity]);
  }
  await page.reload();
  const posting = page.locator(`[data-work-order-posting="${target.id}"]`);
  await expect(posting.locator("[data-work-order-blocked]")).toHaveAttribute(
    "data-work-order-blocked",
    "workbench_occupied",
  );
  await expect(posting.locator(`[data-work-order-accept="${target.id}"]`)).toBeDisabled();

  // "Stop After Current Weld" resolves it without costing the next weld's Scrap.
  const scrapBefore = (
    await db
      .select()
      .from(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, characterId),
          eq(inventoryStacks.itemId, ITEM_IDS.scrapMetal),
        ),
      )
  ).length;
  await page.locator("[data-practice-finish]").click();

  // Armed reads back real server state, not a local guess, and actually
  // paints the shared success glow rather than a data attribute nobody can
  // see: `rs-bevel`'s clip-path would clip a shadow drawn on the button
  // itself, so the glow lives on the unclipped wrapper span — checked as
  // computed paint, not class names, the same class of bug
  // `expectExteriorMissionHalo` already guards the Mission-guidance halo
  // against.
  const finishControl = page.locator("[data-practice-finish]");
  await expect(finishControl).toHaveAttribute("data-practice-finish-armed", "true");
  await expect(finishControl).toBeDisabled();
  await expect(finishControl).toContainText("Stopping After Current Weld");
  await expect(async () => {
    const glow = await finishControl
      .locator("xpath=..")
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(glow).not.toBe("none");
    expect(glow).toContain("136, 215, 99");
  }).toPass();

  // It resumes the paid weld so it can actually finish — waiting for the run to
  // start before waiting for it to end, so the assertion below cannot pass
  // against the state from before the click.
  await expect(page.locator("[data-practice-panel]")).toHaveAttribute(
    "data-practice-active",
    "true",
  );

  // The weld finishes on its own and the run stops there — no next weld, and
  // the same Scrap still in the player's hands.
  await expect(page.locator("[data-practice-panel]")).toHaveAttribute(
    "data-practice-active",
    "false",
    { timeout: 45_000 },
  );
  await expect(page.locator("[data-practice-start]")).toContainText("Start Practice");
  const scrapAfter = (
    await db
      .select()
      .from(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, characterId),
          eq(inventoryStacks.itemId, ITEM_IDS.scrapMetal),
        ),
      )
  ).length;
  expect(scrapAfter).toBe(scrapBefore);

  // The bench is clear, so the customer job can take it.
  await page.reload();
  const clearedPosting = page.locator(`[data-work-order-posting="${target.id}"]`);
  await expect(clearedPosting.locator("[data-work-order-blocked]")).toHaveCount(0);
  await clearedPosting.locator(`[data-work-order-accept="${target.id}"]`).click();
  await expect(page.locator("[data-work-order-bench]")).toBeVisible();
});
