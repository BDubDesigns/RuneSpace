import { expect, test, openTestCharacter } from "./fixtures";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";

/**
 * Seeds the exact post-Walk-It-Off boundary through authoritative rows:
 * Walk It Off stamped complete, Cut Your Teeth accepted, and the Cutter
 * granted but carried (unequipped). The server commands recheck everything;
 * this only skips replaying mission one's travel-and-talk slice.
 */
async function seedPostWalkItOffBoundary(characterId: string) {
  const cutter = (
    await db
      .insert(itemInstances)
      .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })
      .returning({ id: itemInstances.id })
  )[0]!;
  const now = new Date();
  await db.insert(characterMissions).values([
    { characterId, missionId: "walk_it_off", acceptedAt: now, completedAt: now },
    { characterId, missionId: "cut_your_teeth", acceptedAt: now },
  ]);
  return cutter.id;
}

async function addShale(characterId: string, quantity: number) {
  await db.insert(inventoryStacks).values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity });
}

async function miningXpTotal(characterId: string) {
  const rows = await db
    .select()
    .from(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, characterId),
        eq(characterSkillXp.skillId, SKILL_IDS.mining),
      ),
    );
  return rows[0]?.totalXp ?? 0;
}

async function refiningXpTotal(characterId: string) {
  const rows = await db
    .select()
    .from(characterSkillXp)
    .where(
      and(
        eq(characterSkillXp.characterId, characterId),
        eq(characterSkillXp.skillId, SKILL_IDS.refining),
      ),
    );
  return rows[0]?.totalXp ?? 0;
}

async function travelTo(
  page: import("@playwright/test").Page,
  characterId: string,
  locationId: string,
  walkButton: RegExp,
) {
  await page.getByLabel("Local map").scrollIntoViewIfNeeded();
  await expect(page.locator(`[data-map-location="${locationId}"]`)).toBeVisible();
  await page.locator(`[data-map-location="${locationId}"]`).click();
  await expect(page.getByRole("button", { name: walkButton })).toBeVisible();
  await page.getByRole("button", { name: walkButton }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  const ago = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
}

test("equips the Cutter through Inventory, shows a full stack, and earns Mining +100 once", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.theJag })
    .where(eq(characters.id, characterId));
  const cutterId = await seedPostWalkItOffBoundary(characterId);
  await addShale(characterId, 10);
  await openTestCharacter(page, characterId);
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Objective derives equip-first precedence from authoritative equipment.
  await expect(page.locator("[data-mission-objective]")).toContainText("Cut Your Teeth");
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Equip the Salvage Cutter from Inventory",
  );

  // Mission guidance: the unmet equip requirement targets the Cutter affordance
  // in Inventory, while Start Mining is NOT highlighted (equip comes first in
  // authored order).
  await page.getByRole("button", { name: "Inventory" }).click();
  const guidedInventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
  await expect(
    guidedInventoryDrawer.getByRole("button", { name: "Salvage Cutter" }),
  ).toHaveAttribute("data-mission-guidance", "active");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start Mining" })).not.toHaveAttribute(
    "data-mission-guidance",
  );

  // Real Inventory → Equip flow (the same overlay Mining E2E exercises).
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventoryDrawer).toBeVisible();
  // Select the CUTTER by name — the seeded stack tiles are selectable too,
  // but only a unique item gains an Equip control.
  const cutterTile = inventoryDrawer.getByRole("button", { name: "Salvage Cutter" });
  await expect(cutterTile).toBeVisible();
  await cutterTile.click();
  const detailsPanel = inventoryDrawer.locator("[data-details-panel]");
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: /Equip in Mining tool/ })).toBeVisible();
  await detailsPanel.getByRole("button", { name: /Equip in Mining tool/ }).click();
  // The equip returns authoritative state; close the drawer before the next
  // surface (the modal overlay would otherwise intercept outside clicks).
  await page.keyboard.press("Escape");
  await page.reload();

  // Mission guidance — tracked activity step: with the Cutter equipped but no
  // attempts, the authored recommended acquisition (Mining) guides Start
  // Mining. Scavenge is never highlighted merely because it can also yield
  // shale.
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await page.reload();
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Complete 5 Mining attempts — 0 / 5",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).not.toHaveAttribute(
    "data-mission-guidance",
  );

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const miningAgo = new Date(Date.now() - 5 * 10 * GAME_TICK_MS - 100);
  await db
    .update(activeActions)
    .set({ startedAt: miningAgo, resolvedThroughAt: miningAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Complete 5 Mining attempts — 5 / 5",
  );
  await page.getByRole("button", { name: "Stop Mining" }).click();

  // Restore the full stack: every requirement holds and guidance moves to the
  // turn-in NPC. The HUD shows all four simultaneous requirements together
  // plus the turn-in objective.
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await addShale(characterId, 10);
  await page.reload();
  await expect(page.locator("[data-mission-objective-requirements]")).toContainText(
    "Get a full stack of Ferrite Shale — 10 / 10",
  );

  // Objective advances past both steps: with a full stack already carried,
  // equip + collect satisfy instantly and the turn-in objective shows.
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Show a full stack of Ferrite Shale to Tansy Rusk",
  );
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  // The Missions footer badge counts ready-to-turn-in missions only: exactly 1.
  await expect(page.locator("[data-missions-badge]")).toHaveText("1");

  // Talk to Tansy: active + ready routes to the turn-in with SHOW SHALE control.
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansy = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(tansy).toBeVisible();
  const showShale = tansy.getByRole("button", { name: "SHOW SHALE" });
  await expect(showShale).toBeVisible();
  const miningXpBeforeCutTurnIn = await miningXpTotal(characterId);

  await showShale.click();
  // Presentation only after authoritative success: shale item beat first...
  const shaleReveal = tansy.locator('[data-dialogue-subject="item"]');
  await expect(shaleReveal).toBeVisible();
  await expect(tansy.locator("[data-dialogue-speaker-role]")).toContainText("Ferrite Shale ×10");
  // ...then the shared XP tile with Mining nameplate and +100 badge.
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  const xpTile = tansy.locator("[data-dialogue-skill-xp-tile]");
  await expect(xpTile).toBeVisible();
  await expect(xpTile.locator("[data-nameplate]")).toHaveText("Mining");
  await expect(xpTile).toContainText("+100");
  await expect(xpTile).toContainText("XP");
  // Then Tansy returns for the Cut completion and Waste Not assignment beats.
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Yep. That's shale.",
  );
  // Walk beats 4 and 5; the final beat swaps Next for Finish.
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Keep it. You're going to need it.",
  );
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "You can run a Cutter.",
  );
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Mining pulls the raw material out.",
  );
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Take the shale to the Abandoned Processing Yard.",
  );
  await tansy.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "A success makes Refined Ferrite.",
  );
  await expect(tansy.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansy.getByRole("button", { name: "Finish" }).click();
  await expect(tansy).toBeHidden();

  // Shale was inspected, never consumed.
  const stacks = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(stacks.find((stack) => stack.itemId === ITEM_IDS.ferriteShale)?.quantity).toBe(10);

  // Exactly +100 Mining XP was added to the authoritative total, once; the
  // five real Mining attempts retain their ordinary activity XP.
  expect(await miningXpTotal(characterId)).toBe(miningXpBeforeCutTurnIn + 100);

  // Cut Your Teeth is completed and its authored continuation is now the
  // active Waste Not mission. The HUD advances to its tracked requirement,
  // rather than exposing a premature completion action.
  await expect(page.locator("[data-mission-objective]")).toContainText("Waste Not");
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Complete 5 Refining attempts at the Abandoned Processing Yard — 0 / 5",
  );
  await page.getByRole("button", { name: "Missions" }).click();
  const log = page.getByRole("dialog", { name: "Mission Log" });
  await expect(log).toBeVisible();
  await expect(log.getByRole("region", { name: "Active missions" })).toContainText("Waste Not");
  await log.getByRole("button", { name: /Completed/ }).click();
  await log.getByRole("button", { name: /Cut Your Teeth/ }).click();
  await expect(log.locator("[data-mission-log-reward]")).toContainText(
    "Reward earned: +100 Mining XP",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Inventory" })).toBeVisible();

  // The equipped Cutter assignment is real.
  const assignments = await db
    .select()
    .from(equippedItems)
    .where(eq(equippedItems.itemInstanceId, cutterId));
  expect(assignments[0]?.assignmentKind).toBe("gear");

  // Issue #129: after closing the completion presentation, subsequent talks
  // resolve ordinary post-CYT dialogue — not a replay of the item/XP presentation.
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansyPost = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(tansyPost).toBeVisible();
  await expect(tansyPost.locator('[data-dialogue-subject="item"]')).toHaveCount(0);
  await expect(tansyPost.locator("[data-dialogue-skill-xp-tile]")).toHaveCount(0);
  await expect(tansyPost.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "You kept the shale?",
  );
  await tansyPost.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansyPost.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "You know how to handle the Cutter now",
  );
  await tansyPost.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansyPost.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansyPost.getByRole("button", { name: "Finish" }).click();
  await expect(tansyPost).toBeHidden();

  // Reload also resolves ordinary post-CYT dialogue and does not replay the
  // reward presentation. XP, shale, and the active Waste Not assignment
  // remain intact.
  await page.reload();
  await expect(page.locator("[data-mission-objective]")).toContainText("Waste Not");
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansyPostReload = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(tansyPostReload).toBeVisible();
  await expect(tansyPostReload.locator('[data-dialogue-subject="item"]')).toHaveCount(0);
  await expect(tansyPostReload.locator("[data-dialogue-skill-xp-tile]")).toHaveCount(0);
  await expect(tansyPostReload.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "You kept the shale?",
  );
  await tansyPostReload.getByRole("button", { name: "Next", exact: true }).click();
  await tansyPostReload.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tansyPostReload.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansyPostReload.getByRole("button", { name: "Finish" }).click();
  await expect(tansyPostReload).toBeHidden();
  expect(await miningXpTotal(characterId)).toBe(miningXpBeforeCutTurnIn + 100);
  const stacksAfterReload = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(stacksAfterReload.find((s) => s.itemId === ITEM_IDS.ferriteShale)?.quantity).toBe(10);

  // Waste Not has no live-location requirement, but its generic Refining
  // guidance leads to the Processing Yard activity. Five canonical E2E
  // attempts alternate success/failure while all count toward 5 / 5.
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.crashSite })
    .where(eq(characters.id, characterId));
  await page.reload();
  await travelTo(
    page,
    characterId,
    LOCATION_IDS.abandonedProcessingYard,
    /Walk to Abandoned Processing Yard/,
  );
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Complete 5 Refining attempts at the Abandoned Processing Yard — 0 / 5",
  );
  await expect(page.getByRole("button", { name: "Start Refining" })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  const refiningAgo = new Date(Date.now() - 5 * 7 * GAME_TICK_MS - 100);
  await db
    .update(activeActions)
    .set({ startedAt: refiningAgo, resolvedThroughAt: refiningAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("5 attempts", { exact: true })).toBeVisible();
  await expect(page.locator("[data-mission-objective-requirements]")).toContainText(
    "Complete 5 Refining attempts at the Abandoned Processing Yard — 5 / 5",
  );
  const refiningXpBeforeWasteTurnIn = await refiningXpTotal(characterId);
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Return to Wade Rusk at the Crash Site",
  );

  const refinedStacks = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(
    refinedStacks.find((stack) => stack.itemId === ITEM_IDS.refinedFerrite)?.quantity,
  ).toBeGreaterThan(0);
  expect(refinedStacks.find((stack) => stack.itemId === ITEM_IDS.slag)?.quantity).toBeGreaterThan(
    0,
  );
  expect(
    refinedStacks.find((stack) => stack.itemId === ITEM_IDS.ferriteShale)?.quantity,
  ).toBeUndefined();

  await travelTo(page, characterId, LOCATION_IDS.crashSite, /Walk to Crash Site/);
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  await page.getByRole("button", { name: /Talk to Wade Rusk/ }).click();
  const wade = page.getByRole("dialog", { name: "Wade Rusk dialogue" });
  await expect(wade).toBeVisible();
  await wade.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wade.getByRole("button", { name: "REPORT TO WADE" })).toBeVisible();
  await wade.getByRole("button", { name: "REPORT TO WADE" }).click();
  const refiningXpTile = wade.locator("[data-dialogue-skill-xp-tile]");
  await expect(refiningXpTile).toBeVisible();
  await expect(refiningXpTile.locator("[data-nameplate]")).toHaveText("Refining");
  await expect(refiningXpTile).toContainText("+100");
  await wade.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wade.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Tansy taught you the hopper",
  );
  await wade.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wade.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Keep the Slag.",
  );
  await wade.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wade.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Refined Ferrite will help",
  );
  await expect(wade.getByRole("button", { name: "Finish" })).toBeVisible();
  await wade.getByRole("button", { name: "Finish" }).click();
  await expect(wade).toBeHidden();
  expect(await miningXpTotal(characterId)).toBe(miningXpBeforeCutTurnIn + 100);
  expect(await refiningXpTotal(characterId)).toBe(refiningXpBeforeWasteTurnIn + 100);
  const finalStacks = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(finalStacks.find((s) => s.itemId === ITEM_IDS.refinedFerrite)?.quantity).toBeGreaterThan(
    0,
  );
  expect(finalStacks.find((s) => s.itemId === ITEM_IDS.slag)?.quantity).toBeGreaterThan(0);
});
