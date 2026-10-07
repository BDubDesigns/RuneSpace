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
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
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
 * Issue #330 — Thrust Issues, played end to end at the canonical 390px mobile
 * width, then checked at a representative desktop width.
 *
 * The whole job through the real UI: Wade withholding the offer below Welding 8
 * and then offering it by hand, the Propulsion System visible at the Crash Site
 * as a damaged system from the start, a partial installation that survives a
 * reload, sixteen real welding sections, the approved repaired ship appearing the
 * moment the last one lands, and the report adding nothing but the story. No
 * flight control exists at any stage. Server arithmetic and character-scoped
 * state are proven against PostgreSQL in the integration suite; the welding clock
 * is fast-forwarded by moving the durable cursor, exactly as a reconnect after
 * time away.
 */

const balance = getEffectiveGameBalance();
const propulsion = balance.repairTargets.propulsion;
const SYSTEM = `[data-ship-system="${REPAIR_TARGET_IDS.propulsionSystem}"]`;
const PANEL = `[data-repair-work-panel="${REPAIR_TARGET_IDS.propulsionSystem}"]`;
const SCENE = `[data-location-scene="${LOCATION_IDS.crashSite}"]`;
const REPORT_STATUS = "Propulsion restored. Report to Wade.";
const FLIGHT_READY_STATUS = "Propulsion restored. Ship flight-ready.";

function xpForLevel(level: number): number {
  return standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;
}

async function setSkillXp(characterId: string, skillId: string, totalXp: number) {
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
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

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

/** A finished repair row, the way a character who did the work has one. */
async function finishRepair(characterId: string, targetId: string) {
  const recipe = Object.values(balance.repairTargets).find((entry) => entry.targetId === targetId)!;
  await db.insert(characterRepairTargets).values({
    characterId,
    targetId,
    materials: Object.fromEntries(
      recipe.materials.map((material) => [material.itemId, material.quantity]),
    ),
    weldingProgress: recipe.repairIncrements,
    completedAt: new Date(),
    updatedAt: new Date(),
  });
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

test("plays Thrust Issues: Wade's offer at Welding 8, the mounts, sixteen welds, the restored ship, and the report", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(240_000);
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize({ width: 390, height: 844 });
  // Everything through Wheel Be Right Back, with the Cargo Hold and Landing Gear
  // repaired: the ship is still one wreck until its drive is fixed. Fabrication
  // and Refining are left at their starting level, and Welding one short of 8.
  await db.insert(characterMissions).values(
    [
      MISSION_IDS.walkItOff,
      MISSION_IDS.cutYourTeeth,
      MISSION_IDS.wasteNot,
      MISSION_IDS.holdItTogether,
      MISSION_IDS.keepTheChange,
      MISSION_IDS.tenThousandHours,
      // Wade's other Welding-gated offer: left open it would keep his Talk
      // control "available" from Welding 5 up and hide what this test checks.
      MISSION_IDS.tenThousandOneHours,
      MISSION_IDS.returnTheFavor,
      MISSION_IDS.breakItDown,
      MISSION_IDS.braceYourself,
      MISSION_IDS.wheelBeRightBack,
    ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
  );
  await finishRepair(characterId, REPAIR_TARGET_IDS.cargoHold);
  await finishRepair(characterId, REPAIR_TARGET_IDS.landingGear);
  await setSkillXp(characterId, SKILL_IDS.welding, xpForLevel(7));
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Below Welding 8 Wade has no such job: nothing is offered, advertised or on
  // the strip, though Wheel Be Right Back is complete.
  const talk = page
    .locator(`[data-npc-interaction="${NPC_IDS.wadeRusk}"]`)
    .locator('[data-npc-action="talk"]');
  await expect(talk).not.toHaveAttribute("data-mission-guidance", "available");
  await expect(page.locator(`[data-mission-strip="${MISSION_IDS.thrustIssues}"]`)).toHaveCount(0);
  let conversation = await openNpcConversation(page, "Wade Rusk");
  await expect(conversation.getByRole("button", { name: /Thrust Issues/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // At Welding 8 it is offered, by hand and not auto-accepted.
  await setSkillXp(characterId, SKILL_IDS.welding, xpForLevel(8));
  await page.reload();
  await expect(talk).toHaveAttribute("data-mission-guidance", "available");
  await expect(page.locator(`[data-mission-strip="${MISSION_IDS.thrustIssues}"]`)).toHaveCount(0);

  conversation = await openNpcConversation(page, "Wade Rusk");
  const entry = conversation.getByRole("button", { name: /Thrust Issues/ });
  await expect(entry).toContainText("Available");
  await entry.click();

  // The locked offer, in Wade's own expressions.
  await playToText(conversation, /Landing gear's holding\. Means there's one big problem left\./);
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, neutral expression" }),
  ).toBeVisible();
  await playToText(conversation, /Drive itself survived better than it had any right to\./);
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, concerned expression" }),
  ).toBeVisible();
  await playToText(conversation, /You'll need two Drive Mounts\. Galvaferrite work\./);
  await playToText(conversation, /get your beater ship off my front lawn\./);
  await expect(
    conversation.getByRole("img", { name: "Wade Rusk, scowl expression" }),
  ).toBeVisible();
  await expect(conversation.getByRole("button", { name: /decline/i })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Before the job is taken the Propulsion System is a visible damaged system at
  // the Crash Site: compact, with no recipe and nothing to press, in the approved
  // crashed scene. Checked part-way through, so this journey is not at the Crash
  // Site while other specs measure it.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  const scene = page.locator(SCENE);
  await expect(scene).toBeVisible();
  await expect(scene.locator("img")).toHaveAttribute("alt", /crashed Rivet Utility Shuttle/);
  const system = page.locator(SYSTEM);
  await expect(system).toBeVisible();
  await expect(system).toHaveAttribute("data-ship-system-state", "offline");
  await expect(system.getByRole("heading")).toContainText("Ship");
  await expect(system.getByRole("heading")).toContainText("Propulsion System");
  await expect(system.locator('[data-ship-system-status="offline"]')).toHaveText(
    "The propulsion system is damaged and cannot be repaired yet.",
  );
  await expect(system.getByRole("button")).toHaveCount(0);
  await expect(page.locator(PANEL)).toHaveCount(0);
  for (const hidden of ["Drive Mount", "Galvaferrite", "Welding", "Wade"]) {
    await expect(system).not.toContainText(hidden);
  }
  // Landing gear says only what the gear is, and the Cargo Hold is untouched.
  await expect(
    page
      .locator(`[data-ship-system="${REPAIR_TARGET_IDS.landingGear}"]`)
      .locator('[data-ship-system-status="complete"]'),
  ).toHaveText("Landing gear restored.");
  await expect(page.getByText("Propulsion offline")).toHaveCount(0);
  await expect(page.locator(`[data-ship-system="${REPAIR_TARGET_IDS.cargoHold}"]`)).toBeVisible();

  // Take the job.
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Thrust Issues/ }).click();
  await (await playToAction(conversation, "FIX THE DRIVE")).click();
  await page.keyboard.press("Escape");

  const strip = page.locator(`[data-mission-strip="${MISSION_IDS.thrustIssues}"]`);
  await expect(strip).toHaveAttribute("data-mission-phase", "work");
  await expect(strip.locator("[data-mission-strip-needed]")).toHaveText(
    "Still needed: 2 Drive Mounts · 1 Galvaferrite · 2 Mounting Brackets · 1 Galvanic Wire Spool",
  );

  // Back with nothing done: the locked reminder, and no report.
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Thrust Issues/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    "Try not to make the hole bigger.",
  );
  await expect(conversation.getByRole("button", { name: "REPORT REPAIR" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // One mount in hand: installed in part, and kept through a reload.
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.driveMount, quantity: 1 });
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  await expect(system).toHaveAttribute("data-ship-system-state", "repair");
  await expect(system.locator("[data-ship-system-status]")).toHaveCount(0);
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-repair-complete", "false");
  await expect(panel.getByText(/Drive Mount —/)).toBeVisible();
  await expect(panel.getByText(/Galvaferrite —/)).toBeVisible();
  await expect(panel.getByText(/Mounting Bracket —/)).toBeVisible();
  await expect(panel.getByText(/Galvanic Wire Spool —/)).toBeVisible();
  await expect(panel.getByText("0 / 16 welds")).toBeVisible();
  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.getByText("1 / 2").first()).toBeVisible();
  await expect(panel.locator("[data-repair-start-welding]")).toHaveCount(0);
  await page.reload();
  await expect(panel.getByText("1 / 2").first()).toBeVisible();
  await expect(panel.locator("[data-repair-start-welding]")).toHaveCount(0);

  // The rest, as a trade would have left it: Fabrication and Refining never moved.
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.driveMount, quantity: 1 },
    { characterId, itemId: ITEM_IDS.galvaferrite, quantity: 1 },
    { characterId, itemId: ITEM_IDS.mountingBracket, quantity: 2 },
    { characterId, itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
  ]);
  await page.reload();
  await panel.locator("[data-repair-contribute]").click();
  await expect(panel.locator("[data-repair-start-welding]")).toBeVisible();
  await panel.locator("[data-repair-start-welding]").click();
  await expect(panel.locator("[data-repair-stop-welding]")).toBeVisible();

  // Still the wreck while the weld is under way.
  await expect(scene.locator("img")).toHaveAttribute("alt", /crashed Rivet Utility Shuttle/);

  // Fast-forward all sixteen sections the way the other journeys do.
  const weldingBefore = await weldingXp(characterId);
  const ago = new Date(
    Date.now() - propulsion.repairIncrements * balance.welding.attemptDurationTicks * 1_000 - 5_000,
  );
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  expect(moved).toHaveLength(1);
  await page.reload();

  // The last section restores the ship at once, before any report: the approved
  // repaired scene, its own status, and no controls at all.
  await expect(scene.locator("img")).toHaveAttribute("alt", /repaired Rivet Utility Shuttle/);
  await expect(page.locator("[data-location-description]")).toContainText("propulsion restored");
  await expect(system).toHaveAttribute("data-ship-system-state", "complete");
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(REPORT_STATUS);
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(system.getByRole("button")).toHaveCount(0);
  expect((await weldingXp(characterId)) - weldingBefore).toBe(
    propulsion.repairIncrements * balance.welding.xpPerIncrement,
  );
  await expect(strip).toHaveAttribute("data-mission-phase", "turn_in");

  // Durable across another reload, in the generic repair row.
  await page.reload();
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(REPORT_STATUS);
  await expect(scene.locator("img")).toHaveAttribute("alt", /repaired Rivet Utility Shuttle/);
  const [row] = await db
    .select({ completedAt: characterRepairTargets.completedAt })
    .from(characterRepairTargets)
    .where(
      and(
        eq(characterRepairTargets.characterId, characterId),
        eq(characterRepairTargets.targetId, REPAIR_TARGET_IDS.propulsionSystem),
      ),
    );
  expect(row?.completedAt).not.toBeNull();

  // No flight control exists, here or anywhere else on the page.
  const noFlight = async () => {
    await expect(
      page.getByRole("button", { name: /flight controls|launch|board ship/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/Flight Controls|Board Ship|Stillreach/)).toHaveCount(0);
  };
  await noFlight();

  // The report: Wade's opening, the two locked lines, and nothing else. No XP
  // tile, no Credits, no item: the repair already paid for itself.
  const xpBeforeReport = await weldingXp(characterId);
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  const report = await openNpcConversation(page, "Wade Rusk");
  await report.getByRole("button", { name: /Thrust Issues/ }).click();
  await (await playToAction(report, "REPORT REPAIR")).click();
  await playToText(
    report,
    /All right\. Landing gear\. Propulsion\. Hold\. Still looks like hell\./,
  );
  await expect(report.getByRole("img", { name: "Wade Rusk, neutral expression" })).toBeVisible();
  await playToText(report, /But now it's a ship\./);
  await expect(report.getByRole("img", { name: "Wade Rusk, scowl expression" })).toBeVisible();
  await expect(report.locator("[data-dialogue-skill-xp-tile]")).toHaveCount(0);
  await expect(report.locator("[data-dialogue-credits-tile]")).toHaveCount(0);
  await expect(report.locator("[data-dialogue-item-artwork]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await weldingXp(characterId)).toBe(xpBeforeReport);
  await expect(page.locator("[data-mission-strip]")).toHaveCount(0);

  // Exactly once: Wade's follow-up, no report and no new job, and no flight prompt.
  await page.reload();
  const after = await openNpcConversation(page, "Wade Rusk");
  await after.getByRole("button", { name: /Thrust Issues/ }).click();
  await expect(after.locator("[data-dialogue-text]")).toContainText(
    "Still looks like hell. But it's a ship.",
  );
  await expect(after.getByRole("button", { name: "REPORT REPAIR" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await weldingXp(characterId)).toBe(xpBeforeReport);
  await expect(page.locator("[data-mission-strip]")).toHaveCount(0);

  // Back at the wreck's site: the repaired ship, the story caught up, the Cargo
  // Hold's storage intact, and still no way to fly it.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  await expect(system.locator('[data-ship-system-status="complete"]')).toHaveText(
    FLIGHT_READY_STATUS,
  );
  await expect(scene.locator("img")).toHaveAttribute("alt", /repaired Rivet Utility Shuttle/);
  const cargo = page.locator(`[data-ship-system="${REPAIR_TARGET_IDS.cargoHold}"]`);
  await expect(cargo).toHaveAttribute("data-ship-system-state", "complete");
  await expect(cargo.locator('[data-ship-system-status="complete"]')).toHaveText(
    "Cargo Hold operational.",
  );
  await expect(system.getByRole("button")).toHaveCount(0);
  await noFlight();

  // The same page at a representative desktop width: nothing overflows, and the
  // scene and every ship system are still there.
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(scene).toBeVisible();
    await expect(scene.locator("img")).toBeVisible();
    await expect(system).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
  }
});
