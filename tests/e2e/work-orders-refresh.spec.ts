import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissions,
  characterSkillXp,
  characterWorkOrderBoardRefreshes,
  characterWorkOrderPostings,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { pacificResetDate } from "@/game/domain/daily-reset";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import { LOCATION_IDS, MISSION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getWorkOrder } from "@/game/content/work-orders";
import { expect, openTestCharacter, test } from "./fixtures";

/**
 * Issue #217 — ForceSales' one-per-Pacific-day full-board refresh.
 *
 * The three settled copy states (`docs/work-orders.md`) are the whole
 * player-facing surface here; the entitlement math itself (concurrency,
 * anti-redraw, the reset-date boundary) is proven exhaustively against real
 * PostgreSQL in tests/integration/work-order-refresh.test.ts. What only a
 * browser proves is that the right state renders, that pressing the real
 * button actually replaces the board while leaving an active job untouched,
 * and that none of it breaks on a phone or without a mouse.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

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

async function setSkillLevel(characterId: string, skillId: string, level: number) {
  const totalXp = standardSkillLevelThresholds().find((row) => row.level === level)?.totalXp ?? 0;
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
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

async function addStacks(characterId: string, itemId: string, stacks: readonly number[]) {
  await db
    .insert(inventoryStacks)
    .values(stacks.map((quantity) => ({ characterId, itemId, quantity })));
}

async function postings(characterId: string) {
  return db
    .select()
    .from(characterWorkOrderPostings)
    .where(eq(characterWorkOrderPostings.characterId, characterId))
    .orderBy(characterWorkOrderPostings.slotIndex);
}

/** Board unlocked, standing at the terminal, Welding and Refining both at 5. */
async function forceSalesEligible(characterId: string, now: Date) {
  await completeTenThousandHours(characterId, now);
  await setSkillLevel(characterId, SKILL_IDS.welding, 5);
  await setSkillLevel(characterId, SKILL_IDS.refining, 5);
  await acceptTenThousandOneHours(characterId, now);
  await standAtYard(characterId);
}

test("shows the first-unlock glow until a real refresh commits, and never touches the active job", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await forceSalesEligible(characterId, now);

  // The board is drawn lazily on first load, so it must exist before slot
  // zero's job can be identified and paid for.
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const before = await postings(characterId);
  const active = getWorkOrder(before[0]!.workOrderId)!;
  for (const material of active.materials) {
    await addStacks(characterId, material.itemId, [material.quantity]);
  }
  await page.reload();

  // Accept whatever the board drew into slot zero, so a refresh has a real
  // In Progress posting to leave alone.
  const terminal = page.locator("[data-work-orders-terminal]");
  await terminal.locator(`[data-work-order-accept="${active.id}"]`).click();
  await expect(
    terminal.locator(`[data-work-order-posting="${active.id}"] [data-work-order-status]`),
  ).toContainText("In Progress");

  // Never refreshed: the NEW glow, its own settled copy, and the free button.
  const panel = terminal.locator("[data-work-orders-refresh]");
  await expect(panel).toHaveAttribute("data-work-orders-refresh-state", "first_unlock");
  await expect(panel).toContainText("New Work Available");
  await expect(panel).toContainText("Your contractor profile now qualifies for conductive repair work.");
  const control = panel.locator("[data-work-orders-refresh-control]");
  await expect(control).toHaveText("Refresh Board — Free");

  // Reachable and operable without a mouse.
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Queue refreshed. New postings loaded.")).toBeVisible();

  // The active job survived exactly; the other two were genuinely redrawn.
  const after = await postings(characterId);
  const activeAfter = after.find((row) => row.slotIndex === before[0]!.slotIndex)!;
  expect(activeAfter.workOrderId).toBe(active.id);
  expect(activeAfter.acceptedAt).not.toBeNull();
  await expect(
    terminal.locator(`[data-work-order-posting="${active.id}"] [data-work-order-status]`),
  ).toContainText("In Progress");
  const clearedBefore = before.filter((row) => row.slotIndex !== before[0]!.slotIndex);
  const clearedAfter = after.filter((row) => row.slotIndex !== before[0]!.slotIndex);
  for (const row of clearedAfter) {
    const original = clearedBefore.find((entry) => entry.slotIndex === row.slotIndex)!;
    expect(row.workOrderId).not.toBe(original.workOrderId);
  }

  // Spent for today: the settled copy names Pro, and there is no button left
  // to press by accident.
  await expect(panel).toHaveAttribute("data-work-orders-refresh-state", "used_today");
  await expect(panel).toContainText("ForceSales Free · Daily refresh used");
  await expect(panel).toContainText("Contact your Network Administrator to authorize an upgrade.");
  await expect(panel.locator("[data-work-orders-refresh-control]")).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );
  await page.setViewportSize(DESKTOP);
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    DESKTOP.width,
  );
});

test("reads as a plain available refresh after an earlier day's refresh, never the first-unlock glow", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await forceSalesEligible(characterId, now);

  // A refresh two days ago proves `everRefreshed`, without spending today's.
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  await db.insert(characterWorkOrderBoardRefreshes).values({
    characterId,
    resetDate: pacificResetDate(twoDaysAgo),
    refreshedAt: twoDaysAgo,
  });

  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = page.locator("[data-work-orders-refresh]");
  await expect(panel).toHaveAttribute("data-work-orders-refresh-state", "available");
  await expect(panel).toContainText("ForceSales Free · 1 refresh available today");
  await expect(panel).toContainText("Replaces all unaccepted postings. In Progress work stays put.");
  const control = panel.locator("[data-work-orders-refresh-control]");
  await expect(control).toHaveText("Refresh Board");

  await control.click();
  await expect(panel).toHaveAttribute("data-work-orders-refresh-state", "used_today");
  await expect(panel.locator("[data-work-orders-refresh-control]")).toHaveCount(0);

  const rows = await db
    .select()
    .from(characterWorkOrderBoardRefreshes)
    .where(eq(characterWorkOrderBoardRefreshes.characterId, characterId));
  expect(rows).toHaveLength(2);
});
