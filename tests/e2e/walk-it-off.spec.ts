import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterStarterProvisioning,
  characterTravelState,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Walk It Off E2E fixtures require a disposable localhost PostgreSQL database");
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

test.beforeEach(async ({ page }) => {
  const characterId = await openPlayPage(page);
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
    await transaction
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId));
    await transaction
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId));
  });
  await page.reload();
});

async function fastForwardArrival(page: import("@playwright/test").Page, characterId: string) {
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  const ago = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
}

test("walks from Wade to Tansy, presents approved dialogue, and claims one carried Cutter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await expect(page.getByRole("button", { name: "Inventory 0/8" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toHaveAttribute(
    "data-npc-turn-in",
    "false",
  );
  await page.getByRole("button", { name: /Talk to Wade Rusk/ }).click();
  const dialogue = page.getByRole("dialog", { name: "Wade Rusk dialogue" });
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("CRASH SITE");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Wade Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Holo Hollow recovery & salvage operator",
  );
  await expect(dialogue.locator('img[alt*="Fractured dark hull"]')).toBeVisible();
  await expect(dialogue.locator('img[alt*="Wade Rusk"]')).toBeVisible();
  await expect(dialogue.getByRole("button", { name: "Restart dialogue" })).toBeVisible();
  await dialogue.locator("[data-dialogue-text]").click();
  await dialogue.getByRole("button", { name: "Next" }).click();
  const visibleDialogueText = dialogue.locator('[data-dialogue-text] [aria-hidden="true"]');
  const secondBeatText = await dialogue.locator("[data-dialogue-text] .sr-only").textContent();
  await expect
    .poll(async () => (await visibleDialogueText.textContent()).replace("_", "").length)
    .toBeLessThan(secondBeatText?.length ?? 0);
  await visibleDialogueText.click();
  await dialogue.getByRole("button", { name: "Next" }).click();
  for (let index = 2; index < 13; index += 1) {
    await visibleDialogueText.click();
    if (index < 12) await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Accept mission" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Accept mission" }).click();
  await expect(dialogue).toBeHidden();
  await expect(page.locator("[data-mission-objective]")).toContainText("Travel to The Jag");

  await page
    .getByRole("button", { name: /The Long Scramble/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await expect(page.locator("[data-mission-objective]")).toContainText("Travel to The Jag");
  await expect(page.locator("[data-npc-interaction]")).toHaveCount(0);
  await fastForwardArrival(page, characterId);
  await page
    .getByRole("button", { name: /The Jag/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await fastForwardArrival(page, characterId);

  const missionObjective = page.locator("[data-mission-objective]");
  await expect(missionObjective).toContainText("Talk to Tansy Rusk");
  await expect(
    missionObjective.locator('xpath=following-sibling::*[1][@data-npc-interaction="true"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveAttribute(
    "data-npc-turn-in",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansyDialogue = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  for (let index = 0; index < 8; index += 1) {
    await tansyDialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(tansyDialogue.getByRole("button", { name: "Claim Cutter" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Claim Cutter" }).click();
  await expect(tansyDialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "When you get that ship flying again",
  );
  await tansyDialogue.getByRole("button", { name: "Next" }).click();
  await expect(tansyDialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "For now, learn how to use the Cutter",
  );
  await expect(tansyDialogue.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Finish" }).click();
  await expect(tansyDialogue).toBeHidden();
  await expect(page.getByRole("button", { name: "Inventory 1/8" })).toBeVisible();
  await expect(page.locator("[data-mission-objective]")).toContainText("Completed");

  const cutter = await db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId));
  expect(cutter.filter((item) => item.itemId === ITEM_IDS.salvageCutter)).toHaveLength(1);
  await expect(
    db
      .select()
      .from(equippedItems)
      .where(
        eq(
          equippedItems.itemInstanceId,
          cutter.find((item) => item.itemId === ITEM_IDS.salvageCutter)!.id,
        ),
      ),
  ).resolves.toHaveLength(0);

  await page.reload();
  await expect(page.locator("[data-mission-objective]")).toContainText("Completed");
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const postMissionDialogue = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(
    postMissionDialogue.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("Still have all your fingers?");
  await expect(postMissionDialogue.locator('img[alt*="Tansy Rusk"]')).toBeVisible();
});

test("supports the explorer-first Jag conversation and remote mission acceptance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await page
    .getByRole("button", { name: /The Long Scramble/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await fastForwardArrival(page, characterId);
  await page
    .getByRole("button", { name: /The Jag/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await fastForwardArrival(page, characterId);

  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const dialogue = page.getByRole("dialog");
  await expect(dialogue.locator('img[alt*="Tansy Rusk"]')).toBeVisible();
  await expect(dialogue.locator('img[alt*="Exposed jagged Ferrite Shale"]')).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("THE JAG");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Tansy Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Field mechanic & miner",
  );

  for (let index = 0; index < 4; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByText("COMMS LINK", { exact: true })).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("CRASH SITE");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Wade Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Holo Hollow recovery & salvage operator",
  );
  await expect(dialogue.locator('img[alt*="Wade Rusk, scowl"]')).toBeVisible();

  for (let index = 4; index < 15; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Accept mission" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Accept mission" }).click();
  await expect(dialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toHaveText(
    "Works for me.",
  );
  for (let index = 0; index < 3; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Claim Cutter" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Claim Cutter" }).click();
  await expect(dialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "When you get that ship flying again",
  );
  await dialogue.getByRole("button", { name: "Next" }).click();
  await expect(dialogue.getByRole("button", { name: "Finish" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Finish" }).click();
  await expect(dialogue).toBeHidden();
  await expect(page.locator("[data-mission-objective]")).toContainText("Completed");
});
