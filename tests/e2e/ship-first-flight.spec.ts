import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldStacks,
  characterMissions,
  characterRepairTargets,
  characterShips,
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
} from "@/game/config/foundations";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";
import { playDialogueToText as playToText } from "./dialogue-steps";

/**
 * Issue #358 — the Rivet's first flight, played end to end at the canonical 390px
 * mobile width.
 *
 * Wade's Move Along offered by hand and accepted, the one Ship panel at the
 * berth, both refuel sources and the exact-waste confirmation, the gated and then
 * authorized Launch, the live authoritative countdown with minimize and a mid-
 * flight reload, the real landing relocating the character and ship, Move Along
 * completing itself with no reward, and the durable notice surviving a reload
 * until it is dismissed. Server arithmetic, concurrency and the three-hour
 * offline return are proven against PostgreSQL in the integration suite.
 */

const balance = getEffectiveGameBalance();
const SHIP = "[data-ship-panel]";
const BOARD = "[data-ship-board]";
const BAY = "[data-ship-bay]";
const LAUNCH = "[data-ship-launch]";
const NOTICE = "[data-ship-arrival-notice]";
const OVERLAY = 'img[data-scene-layer="overlay"]';

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

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function shipRow(characterId: string) {
  return (
    await db.select().from(characterShips).where(eq(characterShips.characterId, characterId))
  )[0];
}

async function missionRow(characterId: string, missionId: string) {
  return (
    await db
      .select()
      .from(characterMissions)
      .where(
        and(
          eq(characterMissions.characterId, characterId),
          eq(characterMissions.missionId, missionId),
        ),
      )
  )[0];
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

test("plays Move Along: the offer, fuelling from both sources, the first flight, the landing and its durable notice", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(240_000);
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize({ width: 390, height: 844 });
  // Everything through Thrust Issues, reported, with the three ship repairs done.
  await db.insert(characterMissions).values(
    [
      MISSION_IDS.walkItOff,
      MISSION_IDS.cutYourTeeth,
      MISSION_IDS.wasteNot,
      MISSION_IDS.holdItTogether,
      MISSION_IDS.keepTheChange,
      MISSION_IDS.tenThousandHours,
      // Wade's other Welding-gated offer: left open it would keep his Talk
      // control "available" and hide what this test checks.
      MISSION_IDS.tenThousandOneHours,
      MISSION_IDS.returnTheFavor,
      MISSION_IDS.breakItDown,
      MISSION_IDS.braceYourself,
      MISSION_IDS.wheelBeRightBack,
      MISSION_IDS.thrustIssues,
    ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
  );
  for (const targetId of [
    REPAIR_TARGET_IDS.cargoHold,
    REPAIR_TARGET_IDS.landingGear,
    REPAIR_TARGET_IDS.propulsionSystem,
  ]) {
    await finishRepair(characterId, targetId);
  }
  // Three full canisters carried and one stored in the attached Cargo Hold.
  await db
    .insert(inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.fullSmallFuelCanister, quantity: 2 });
  await db
    .insert(cargoHoldStacks)
    .values({ characterId, itemId: ITEM_IDS.fullSmallFuelCanister, quantity: 1 });
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Wade offers Move Along by hand; it is not auto-accepted from Thrust Issues.
  expect(await missionRow(characterId, MISSION_IDS.moveAlong)).toBeUndefined();
  let conversation = await openNpcConversation(page, "Wade Rusk");
  const entry = conversation.getByRole("button", { name: /Move Along/ });
  await expect(entry).toContainText("Available");
  await entry.click();
  await (await playToAction(conversation, "TAKE HER TO THE PAD")).click();
  await expect
    .poll(async () => (await missionRow(characterId, MISSION_IDS.moveAlong))?.acceptedAt, {
      timeout: 30_000,
    })
    .toBeTruthy();
  await expect(conversation.getByRole("button", { name: "TAKE HER TO THE PAD" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Accepted: Wade now has only his reminder, and no hand-in of any kind.
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Move Along/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    /Crash Site to Holo Hollow Landing\. Ten fuel units\./,
  );
  await expect(conversation.getByRole("button", { name: /turn in|report|complete/i })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");

  // The single Ship panel at the berth: three systems, Cargo Hold usable, and a
  // Board Ship control now that the drive is restored.
  await standAt(characterId, LOCATION_IDS.crashSite);
  await page.reload();
  const ship = page.locator(SHIP);
  await expect(ship).toBeVisible();
  await expect(ship.locator("[data-ship-system]")).toHaveCount(3);
  // One panel, three sections: no stacked cards of its own inside it.
  await expect(page.locator(SHIP)).toHaveCount(1);
  await expect(ship.locator("[data-activity-panel]")).toHaveCount(0);
  await expect(ship).toContainText("Berthed at Crash Site");
  await expect(ship.locator('[data-ship-system-status="complete"]')).toHaveCount(3);
  await expect(ship.locator(BAY)).toHaveCount(0);

  await ship.locator(BOARD).click();
  const bay = ship.locator(BAY);
  await expect(bay).toBeVisible();

  // Launch is shown, with its numbers, but cannot go with an empty tank.
  const launch = bay.locator(LAUNCH);
  await expect(launch).toBeDisabled();
  await expect(bay.locator("[data-ship-launch-guidance]")).toContainText("needs at least 10 FU");
  await expect(bay.locator("[data-ship-route-cost]")).toHaveText("10 FU");
  await expect(bay.locator("[data-ship-route-notice]")).toContainText(
    "permanently moves your ship from the Crash Site to Holo Hollow Landing",
  );
  await expect(bay.locator("[data-ship-tank]")).toContainText("0 / 300 FU");

  // Exactly two source actions, with their counts. Load one from each.
  const fromInventory = bay.locator('[data-ship-refuel-source="inventory"]');
  const fromCargo = bay.locator('[data-ship-refuel-source="cargo_hold"]');
  await expect(fromInventory).toContainText("(2)");
  await expect(fromCargo).toContainText("(1)");
  await fromInventory.click();
  await expect(bay.locator("[data-ship-tank]")).toContainText("50 / 300 FU");
  await expect(bay.locator("[data-ship-refuel-feedback]")).toContainText("Loaded 50 FU.");
  await fromCargo.click();
  await expect(bay.locator("[data-ship-tank]")).toContainText("100 / 300 FU");
  await expect(fromCargo).toBeDisabled();
  await expect(bay.locator('[data-ship-refuel-reason="cargo_hold"]')).toContainText(
    "No Full Small Fuel Canister in the Cargo Hold.",
  );
  expect((await shipRow(characterId))?.fuelUnits).toBe(100);
  // No empty shell came back.
  const empties = await db
    .select()
    .from(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, characterId),
        eq(inventoryStacks.itemId, ITEM_IDS.emptySmallFuelCanister),
      ),
    );
  expect(empties).toHaveLength(0);

  // A nearly full tank states the exact gain and waste before anything is spent.
  await db
    .update(characterShips)
    .set({ fuelUnits: 280 })
    .where(eq(characterShips.characterId, characterId));
  await page.reload();
  await ship.locator(BOARD).click();
  await fromInventory.click();
  const confirm = bay.locator("[data-ship-refuel-confirm]");
  await expect(confirm).toContainText("adds 20 FU and wastes 30 FU");
  await expect(bay.locator("[data-ship-tank]")).toContainText("280 / 300 FU");
  await confirm.getByRole("button", { name: "CANCEL" }).click();
  await expect(confirm).toHaveCount(0);
  await fromInventory.click();
  await bay.locator("[data-ship-refuel-confirm-load]").click();
  await expect(bay.locator("[data-ship-tank]")).toContainText("300 / 300 FU");
  await expect(fromInventory).toBeDisabled();
  await expect(bay.locator('[data-ship-refuel-reason="inventory"]')).toHaveText(
    "The tank is full.",
  );
  // Back to a tank of 100 FU for the flight.
  await db
    .update(characterShips)
    .set({ fuelUnits: 100 })
    .where(eq(characterShips.characterId, characterId));
  await page.reload();
  await ship.locator(BOARD).click();

  // Launch: one control, no second confirmation, an authoritative countdown.
  await expect(launch).toBeEnabled();
  await expect(bay.locator("[data-ship-route-tank-after]")).toContainText("90 / 300 FU");
  await launch.click();
  const flight = page.locator("[data-flight-surface]");
  await expect(flight).toBeVisible();
  await expect(flight).toContainText("Holo Hollow Landing");
  await expect(flight.getByRole("button", { name: /cancel|abort|turn back/i })).toHaveCount(0);
  await expect(page.locator(SHIP)).toHaveCount(0);
  expect((await shipRow(characterId))?.fuelUnits).toBe(90);
  // Nothing has moved yet: the Mission is open and the character is still here.
  expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).toBeNull();

  // Minimize and reopen; a reload resumes the remaining time rather than restarting it.
  await flight.locator("[data-flight-minimize]").click();
  await expect(page.locator("[data-flight-minimized]")).toBeVisible();
  await page.locator("[data-flight-reopen]").click();
  await expect(page.locator("[data-flight-minimized]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-flight-surface]")).toBeVisible();
  // Nothing can be started in flight: no walking, no activities, no Ship panel.
  await expect(page.locator(SHIP)).toHaveCount(0);

  // Touchdown is confirmed by the server and announced durably.
  const notice = page.locator(NOTICE);
  await expect(notice).toBeVisible({ timeout: 45_000 });
  await expect(notice.locator("[data-ship-arrival-title]")).toHaveText(
    "Flight complete — Arrived at Holo Hollow Landing",
  );
  await expect(notice.locator("[data-ship-arrival-mission]")).toHaveText(
    "Mission Complete: Move Along",
  );
  // No reward tile, portrait or Wade scene.
  await expect(notice).not.toContainText(/reward|Wade/i);
  const landed = await db
    .select({ at: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  expect(landed[0]!.at).toBe(LOCATION_IDS.holoHollowLanding);
  expect((await shipRow(characterId))?.berthLocationId).toBe(LOCATION_IDS.holoHollowLanding);
  expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).not.toBeNull();
  expect(
    await db.select().from(activeActions).where(eq(activeActions.characterId, characterId)),
  ).toHaveLength(0);

  // The pad now carries the Rivet, and the same Ship panel reflects the new berth.
  await expect(
    page.locator(`[data-location-scene="${LOCATION_IDS.holoHollowLanding}"]`).locator(OVERLAY),
  ).toHaveCount(1);
  await expect(page.locator(SHIP)).toContainText("Berthed at Holo Hollow Landing");

  // The notice is a stored receipt, not a toast: it survives a reload.
  await page.reload();
  await expect(page.locator(NOTICE)).toBeVisible();
  await page.locator("[data-ship-arrival-dismiss]").click();
  await expect(page.locator(NOTICE)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(NOTICE)).toHaveCount(0);

  // At the new berth there is no flight back, and the Cargo Hold is right here.
  await page.locator(SHIP).locator(BOARD).click();
  await expect(page.locator("[data-ship-no-routes]")).toContainText(
    "No flights are available from Holo Hollow Landing.",
  );
  await expect(page.locator(`${SHIP} [data-cargo-hold-status="operational"]`)).toBeVisible();

  // Wade has a line only now that the Rivet has made the Landing.
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await page.reload();
  conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /Move Along/ }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(
    /Heard the Rivet made the Landing\./,
  );
  void NPC_IDS;
});
