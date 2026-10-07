import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterRepairTargets,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";

/**
 * Issue #322 — Wheel Be Right Back, played end to end at the canonical 390px
 * mobile width.
 *
 * The whole job through the real UI: Wade offering it by hand at Rusk Recovery
 * with his own expressions, the Landing Gear appearing at the Crash Site only
 * once the job is taken, real parts and twelve real welding sections, the ship
 * status staying put through a reload, and the 250 Welding XP arriving once on
 * the actual report. Server arithmetic is proven against PostgreSQL in the
 * integration suite; the welding clock is fast-forwarded by moving the durable
 * cursor, exactly as a reconnect after time away.
 */

const balance = getEffectiveGameBalance();
const gear = balance.repairTargets.landingGear;
// The Landing Gear is one of the ship's systems (#322): the shell is always there,
// and its repair interior exists only while the job is authorized and unfinished.
const GEAR_SYSTEM = `[data-ship-system="${REPAIR_TARGET_IDS.landingGear}"]`;
const GEAR_PANEL = `[data-repair-work-panel="${REPAIR_TARGET_IDS.landingGear}"]`;
const STATUS = "Landing gear restored.";

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

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
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

test("plays Wheel Be Right Back: Wade's offer, the parts, twelve welds, and the report", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(150_000);
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize({ width: 390, height: 844 });
  // Everything through Brace Yourself, and nothing else: no A Cut Above, and
  // Fabrication, Refining and Welding all left at their starting level.
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
        MISSION_IDS.returnTheFavor,
        MISSION_IDS.breakItDown,
        MISSION_IDS.braceYourself,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Offered, not auto-accepted: Wade has a job to give, and nothing is on the
  // strip until it is taken.
  await expect(
    page
      .locator(`[data-npc-interaction="${NPC_IDS.wadeRusk}"]`)
      .locator('[data-npc-action="talk"]'),
  ).toHaveAttribute("data-mission-guidance", "available");
  await expect(page.locator(`[data-mission-strip="${MISSION_IDS.wheelBeRightBack}"]`)).toHaveCount(
    0,
  );

  let conversation = await openNpcConversation(page, "Wade Rusk");
  const entry = conversation.getByRole("button", { name: /Wheel Be Right Back/ });
  await expect(entry).toContainText("Available");
  await entry.click();

  // The locked offer, in Wade's own expressions: flat, flat, then the scowl he
  // keeps for handing a job off.
  await playToText(conversation, /Heard the Deep Jag brace is still holding\. Good work\./);
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, neutral expression" }),
  ).toBeVisible();
  await playToText(conversation, /Your ship's still sitting on her belly\. Get the wheels rebuilt/);
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, concerned expression" }),
  ).toBeVisible();
  await playToText(
    conversation,
    /Two Wheel Assemblies, two Mounting Brackets, one Galvanic Wire Spool\./,
  );
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, scowl expression" }),
  ).toBeVisible();
  await expect(conversation.getByRole("button", { name: /decline/i })).toHaveCount(0);
  // The wreck shows its Landing Gear from the start, damaged, before the job is
  // taken: visible, compact, and with no recipe and nothing to press. Checked
  // part-way through rather than at the very start, so this journey is not at the
  // Crash Site while other specs measure it.
  await page.keyboard.press("Escape");
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  const system = page.locator(GEAR_SYSTEM);
  await expect(system).toBeVisible();
  await expect(system).toHaveAttribute("data-ship-system-state", "offline");
  await expect(system.getByRole("heading")).toContainText("Ship");
  await expect(system.getByRole("heading")).toContainText("Landing Gear");
  await expect(system.locator('[data-ship-system-status="offline"]')).toHaveText(
    "The landing gear is damaged and cannot be repaired yet.",
  );
  await expect(system.getByRole("button")).toHaveCount(0);
  await expect(page.locator(GEAR_PANEL)).toHaveCount(0);
  await expect(system).not.toContainText("Wheel Assembl");
  await expect(system).not.toContainText("Welding");
  // Beside it, the Cargo Hold is the same kind of panel.
  await expect(page.locator(`[data-ship-system="${REPAIR_TARGET_IDS.cargoHold}"]`)).toBeVisible();
  // Back to Wade, who still has the job to give.
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Wheel Be Right Back/ }).click();
  await (await playToAction(conversation, "TAKE THE JOB")).click();
  await page.keyboard.press("Escape");

  // Taken: it is on the strip, and the Landing Gear still belongs to the Crash Site.
  const strip = page.locator(`[data-mission-strip="${MISSION_IDS.wheelBeRightBack}"]`);
  await expect(strip).toHaveAttribute("data-mission-phase", "work");
  await expect(page.locator(GEAR_PANEL)).toHaveCount(0);
  // Nothing installed or carried: the compact strip lists the whole shopping list.
  const stillNeeded = strip.locator("[data-mission-strip-needed]");
  await expect(stillNeeded).toHaveText(
    "Still needed: 2 Wheel Assemblies · 2 Mounting Brackets · 1 Galvanic Wire Spool",
  );

  // Returning to Wade with nothing done gets the locked reminder, and no report.
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Wheel Be Right Back/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    "Get them under the ship at the Crash Site.",
  );
  await expect(conversation.getByRole("button", { name: "REPORT REPAIR" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The parts were only ever handed over: Fabrication and Refining never moved.
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.wheelAssembly, quantity: 2 },
    { characterId, itemId: ITEM_IDS.mountingBracket, quantity: 2 },
    { characterId, itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
  ]);
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  // Everything is now carried, so there is nothing left to obtain.
  await expect(strip).toHaveAttribute("data-mission-phase", "work");
  await expect(stillNeeded).toHaveCount(0);

  // One Landing Gear panel beside the Cargo Hold: three authored material rows
  // and the twelve welds.
  // Accepting the job expanded the same panel; no second flag was set.
  await expect(system).toHaveAttribute("data-ship-system-state", "repair");
  await expect(system.locator("[data-ship-system-status]")).toHaveCount(0);
  const panel = page.locator(GEAR_PANEL);
  await expect(panel).toBeVisible();
  await expect(system).toContainText("Landing Gear");
  await expect(panel).toHaveAttribute("data-repair-complete", "false");
  await expect(panel.getByText(/Wheel Assembly —/)).toBeVisible();
  await expect(panel.getByText(/Mounting Bracket —/)).toBeVisible();
  await expect(panel.getByText(/Galvanic Wire Spool —/)).toBeVisible();
  await expect(panel.getByText("0 / 2").first()).toBeVisible();
  await expect(panel.getByText("0 / 12 welds")).toBeVisible();
  await expect(panel.locator("[data-repair-start-welding]")).toHaveCount(0);

  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.locator("[data-repair-start-welding]")).toBeVisible();
  await expect(panel.getByText("2 / 2").first()).toBeVisible();
  await panel.locator("[data-repair-start-welding]").click();
  await expect(panel.locator("[data-repair-stop-welding]")).toBeVisible();

  // Fast-forward all twelve sections the way the other journeys do.
  const ago = new Date(
    Date.now() - gear.repairIncrements * balance.welding.attemptDurationTicks * 1_000 - 5_000,
  );
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  expect(moved).toHaveLength(1);
  await page.reload();

  // Finished: the ship's own status, on the same panel, in the same wreck.
  await expect(system).toHaveAttribute("data-ship-system-state", "complete");
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(STATUS);
  await expect(page.locator(GEAR_PANEL)).toHaveCount(0);
  await expect(system.getByRole("button")).toHaveCount(0);
  expect(await weldingXp(characterId)).toBe(gear.repairIncrements * balance.welding.xpPerIncrement);

  // Durable across another reload, in the generic repair row.
  await page.reload();
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(STATUS);
  const [row] = await db
    .select({ completedAt: characterRepairTargets.completedAt })
    .from(characterRepairTargets)
    .where(
      and(
        eq(characterRepairTargets.characterId, characterId),
        eq(characterRepairTargets.targetId, REPAIR_TARGET_IDS.landingGear),
      ),
    );
  expect(row?.completedAt).not.toBeNull();
  await expect(strip).toHaveAttribute("data-mission-phase", "turn_in");

  // Back to Wade: the report, his two locked lines, then the 250 Welding XP tile.
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  const report = await openNpcConversation(page, "Wade Rusk");
  await report.getByRole("button", { name: /Wheel Be Right Back/ }).click();
  await (await playToAction(report, "REPORT REPAIR")).click();
  await playToText(report, /That'll hold\. She's got her feet back under her\./);
  await playToText(report, /Engine's still dead\. That's another job\./);
  await expect(report.getByRole("img", { name: "Wade Rusk, scowl expression" })).toBeVisible();
  // The reward tile follows the last line, not the other way round.
  await expect(report.locator("[data-dialogue-skill-xp-tile]")).toHaveCount(0);
  await report.locator("[data-dialogue-text]").click();
  await report.getByRole("button", { name: "Next", exact: true }).click();
  const xpTile = report.locator("[data-dialogue-skill-xp-tile]");
  await expect(xpTile).toBeVisible();
  await expect(xpTile.locator("[data-nameplate]")).toHaveText("Welding");
  await expect(xpTile).toContainText("+250");
  await page.keyboard.press("Escape");
  expect(await weldingXp(characterId)).toBe(850);

  // Exactly once, and nothing further opens: his follow-up, no report, no new job.
  await page.reload();
  const after = await openNpcConversation(page, "Wade Rusk");
  await after.getByRole("button", { name: /Wheel Be Right Back/ }).click();
  await expect(after.locator("[data-dialogue-text]")).toContainText(
    "Landing gear's done. Engine isn't.",
  );
  await expect(after.getByRole("button", { name: "REPORT REPAIR" })).toHaveCount(0);
  await expect(after.locator("[data-dialogue-skill-xp-tile]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await weldingXp(characterId)).toBe(850);
  await expect(page.locator("[data-mission-strip]")).toHaveCount(0);

  // The ship keeps its one wreck presentation and its status at the Crash Site.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(STATUS);
});
