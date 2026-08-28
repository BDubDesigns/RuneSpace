import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterSkillXp,
  characterStarterProvisioning,
  characterTravelState,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error(
      "Cut Your Teeth E2E fixtures require a disposable localhost PostgreSQL database",
    );
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openPlayPage(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

async function clearCharacterState(characterId: string) {
  await db.transaction(async (transaction) => {
    await transaction.delete(activeActions).where(eq(activeActions.characterId, characterId));
    await transaction
      .delete(characterTravelState)
      .where(eq(characterTravelState.characterId, characterId));
    await transaction
      .delete(characterMissions)
      .where(eq(characterMissions.characterId, characterId));
    await transaction.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
    await transaction.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
    await transaction.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
    await transaction.delete(characterSkillXp).where(eq(characterSkillXp.characterId, characterId));
    await transaction
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId));
    await transaction
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(characters.id, characterId));
  });
}

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

test("equips the Cutter through Inventory, shows a full stack, and earns Mining +100 once", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const characterId = await openPlayPage(page);
  await clearCharacterState(characterId);
  const cutterId = await seedPostWalkItOffBoundary(characterId);
  await addShale(characterId, 10);
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Objective derives equip-first precedence from authoritative equipment.
  await expect(page.locator("[data-mission-objective]")).toContainText("Cut Your Teeth");
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Equip the Salvage Cutter from Inventory",
  );

  // Quest guidance: the unmet equip requirement targets the Cutter affordance
  // in Inventory, while Start Mining is NOT highlighted (equip comes first in
  // authored order).
  await page.getByRole("button", { name: /Inventory \d+\/\d+/ }).click();
  const guidedInventoryDrawer = page.getByRole("dialog", { name: "Inventory" });
  await expect(
    guidedInventoryDrawer.getByRole("button", { name: "Salvage Cutter" }),
  ).toHaveAttribute("data-quest-guidance", "active");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start Mining" })).not.toHaveAttribute(
    "data-quest-guidance",
  );

  // Real Inventory → Equip flow (the same overlay Mining E2E exercises).
  await page.getByRole("button", { name: /Inventory \d+\/\d+/ }).click();
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

  // Quest guidance — action step: with the Cutter equipped but no shale, the
  // authored recommended acquisition (Mining) guides Start Mining. Scavenge is
  // never highlighted merely because it can also yield shale.
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await page.reload();
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Get a full stack of Ferrite Shale — 0 / 10",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveAttribute(
    "data-quest-guidance",
    "active",
  );
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).not.toHaveAttribute(
    "data-quest-guidance",
  );

  // Restore the full stack: every requirement holds and guidance moves to the
  // turn-in NPC.
  await addShale(characterId, 10);
  await page.reload();

  // Objective advances past both steps: with a full stack already carried,
  // equip + collect satisfy instantly and the turn-in objective shows.
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Show a full stack of Ferrite Shale to Tansy Rusk",
  );
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveAttribute(
    "data-quest-guidance",
    "active",
  );

  // Talk to Tansy: active + ready routes to the turn-in with SHOW SHALE control.
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansy = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(tansy).toBeVisible();
  const showShale = tansy.getByRole("button", { name: "SHOW SHALE" });
  await expect(showShale).toBeVisible();

  await showShale.click();
  // Presentation only after authoritative success: shale item beat first...
  const shaleReveal = tansy.locator('[data-dialogue-subject="item"]');
  await expect(shaleReveal).toBeVisible();
  await expect(tansy.locator("[data-dialogue-speaker-role]")).toContainText("Ferrite Shale ×10");
  // ...then the shared XP tile with Mining nameplate and +100 badge.
  await tansy.getByRole("button", { name: "Next" }).click();
  const xpTile = tansy.locator("[data-dialogue-skill-xp-tile]");
  await expect(xpTile).toBeVisible();
  await expect(xpTile.locator("[data-nameplate]")).toHaveText("Mining");
  await expect(xpTile).toContainText("+100");
  await expect(xpTile).toContainText("XP");
  // Then Tansy returns for her three completion lines (5 beats total).
  await tansy.getByRole("button", { name: "Next" }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Yep. That's shale.",
  );
  // Walk beats 4 and 5; the final beat swaps Next for Finish.
  await tansy.getByRole("button", { name: "Next" }).click();
  await expect(tansy.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "Keep it. You're going to need it.",
  );
  await tansy.getByRole("button", { name: "Next" }).click();
  await expect(tansy.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansy.getByRole("button", { name: "Finish" }).click();
  await expect(tansy).toBeHidden();

  // Shale was inspected, never consumed.
  const stacks = await db
    .select()
    .from(inventoryStacks)
    .where(eq(inventoryStacks.characterId, characterId));
  expect(stacks.find((stack) => stack.itemId === ITEM_IDS.ferriteShale)?.quantity).toBe(10);

  // Exactly +100 Mining XP, awarded once.
  expect(await miningXpTotal(characterId)).toBe(100);

  // The objective panel reflects completion; shale remains in Inventory.
  await expect(page.locator("[data-mission-objective]")).toContainText("Completed");
  await expect(page.getByRole("button", { name: /Inventory 1\/8|Inventory 0\/8/ })).toBeVisible();

  // The equipped Cutter assignment is real.
  const assignments = await db
    .select()
    .from(equippedItems)
    .where(eq(equippedItems.itemInstanceId, cutterId));
  expect(assignments[0]?.assignmentKind).toBe("gear");
});
