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

test("walks from Wade to Tansy, presents the layered temporary dialogue, and claims one carried Cutter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await expect(page.getByRole("button", { name: "Inventory 0/8" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toBeVisible();
  await page.getByRole("button", { name: /Talk to Wade Rusk/ }).click();
  const dialogue = page.getByRole("dialog", { name: "Wade Rusk dialogue" });
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('img[alt*="Temporary"]')).toBeVisible();
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
  await expect(dialogue.getByRole("button", { name: "Accept mission" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Accept mission" }).click();
  await expect(dialogue).toBeHidden();
  await expect(page.locator("[data-mission-objective]")).toContainText("Travel to The Jag");

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

  await expect(page.locator("[data-mission-objective]")).toContainText("Talk to Tansy Rusk");
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const tansyDialogue = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(tansyDialogue.getByRole("button", { name: "Claim Cutter" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Claim Cutter" }).click();
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Talk to Tansy Rusk/ }).click();
  const postMissionDialogue = page.getByRole("dialog", { name: "Tansy Rusk dialogue" });
  await expect(
    postMissionDialogue.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("TEMPORARY COPY");
});
