import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { expect, openTestCharacter, test } from "./fixtures";
import { seedLegacyStarterCutter } from "./legacy-starter";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #379 — Stillreach Prospecting Quarry Stone Mining in a real browser.
 *
 * The server suites own the rules. This covers what only a rendered page can
 * answer: the Quarry's scene, copy and Mining panel read correctly on a phone,
 * a due attempt pays Stone and XP, Stone and the Ultra Rare Boulder show with
 * their approved art and rarity, and the Stillreach terminal sells Stone back
 * at 2 CR a piece.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const balance = getEffectiveGameBalance();
const stone = balance.mining.sources.stone;
const FUEL_TERMINAL = LOCAL_PLACE_IDS.stillreachFuelTerminal;

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

async function setMiningLevel(characterId: string, level: number) {
  const totalXp = standardSkillLevelThresholds(balance).find(
    (entry) => entry.level === level,
  )!.totalXp;
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.mining, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the Quarry reads as a Mining location on a phone, with the real numbers and no gate", async ({
  page,
  testCharacter,
}) => {
  await standAt(testCharacter.id, LOCATION_IDS.prospectingQuarry);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  const quarry = getLocation(LOCATION_IDS.prospectingQuarry)!;
  const scene = page.getByTestId("location-scene");
  await expect(scene).toHaveAttribute("data-location-scene", LOCATION_IDS.prospectingQuarry);
  await expect(page.getByRole("heading", { name: "Prospecting Quarry" })).toBeVisible();
  await expect(page.getByText(quarry.description, { exact: false })).toBeVisible();
  await expect(page.locator("[data-mining-activity]")).toBeVisible();
  await expect(page.locator("[data-mining-level-gate]")).toHaveCount(0);
  // Mining 1 exactly: the level-one-anchored 35%, 33 ticks, nothing legacy.
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText(/Normal Stone attempts take 33 ticks \/ 19.8 seconds/)).toBeVisible();
  // No low-yield line: a miss awards nothing here.
  await expect(page.locator("[data-mining-yield-summary]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "stillreach-quarry-mining-mobile.png");
  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
});

test("a due Stone attempt pays its Stone and 45 XP and shows the result", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 1);
  await seedLegacyStarterCutter(testCharacter.id);
  await standAt(testCharacter.id, LOCATION_IDS.prospectingQuarry);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const oneAttemptAgo = new Date(Date.now() - (stone.attemptDurationTicks * 600 + 500));
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, testCharacter.id));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt", exact: true });
  await expect(latest).toContainText("Latest attempt: Success");
  await expect(latest).toHaveAttribute("data-result-outcome", "success");
  // The deterministic CI random is a certain success with the larger yield and no find.
  await expect(page.getByText("2 Stone gained", { exact: true })).toBeVisible();
  await expect(page.getByText("45 Mining XP", { exact: true })).toBeVisible();
});

test("Stone shows its approved art and the Boulder shimmers as Ultra Rare in Inventory", async ({
  page,
  testCharacter,
}) => {
  await standAt(testCharacter.id, LOCATION_IDS.prospectingQuarry);
  await db.insert(inventoryStacks).values([
    { characterId: testCharacter.id, itemId: ITEM_IDS.stone, quantity: 3 },
    { characterId: testCharacter.id, itemId: ITEM_IDS.boulder, quantity: 1 },
  ]);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();

  const boulder = inventory.locator('[data-item-rarity="ultra_rare"]');
  await expect(boulder).toHaveCount(1);
  await expect(boulder).toContainText("Boulder");
  await expect(boulder.locator("[data-item-shimmer]")).toHaveCount(1);
  // Only the Boulder is Ultra Rare; Stone is an ordinary tile.
  await expect(inventory.locator("[data-item-shimmer]")).toHaveCount(1);
  for (const art of ["/item-art/stone.webp", "/item-art/boulder.webp"]) {
    const response = await page.request.get(art);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }
  await captureReviewScreenshot(page, "stillreach-stone-boulder-inventory-mobile.png");
});

test("the Stillreach terminal buys Stone at 2 CR a piece and sells nothing of it", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(60_000);
  const characterId = testCharacter.id;
  await standAt(characterId, LOCATION_IDS.stillreachLandingStation);
  await db.update(characters).set({ credits: 10 }).where(eq(characters.id, characterId));
  await db.insert(characterMissions).values({
    characterId,
    missionId: MISSION_IDS.thrustIssues,
    acceptedAt: new Date(),
    completedAt: new Date(),
  });
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.stone, quantity: 4 },
    { characterId, itemId: ITEM_IDS.boulder, quantity: 1 },
  ]);
  await page.setViewportSize(PHONE);
  await page.goto(`/play/${characterId}?place=${FUEL_TERMINAL}`);

  const terminal = page.locator("[data-last-leg-terminal]");
  await expect(terminal).toHaveAttribute("data-terminal-state", "online");
  // Buying: Stone and Boulder are never for sale here.
  await expect(terminal.locator(`[data-terminal-row="${ITEM_IDS.stone}"]`)).toHaveCount(0);
  await expect(terminal.locator(`[data-terminal-row="${ITEM_IDS.boulder}"]`)).toHaveCount(0);

  await terminal.locator('[data-terminal-mode="sell"]').click();
  const row = terminal.locator(`[data-terminal-row="${ITEM_IDS.stone}"]`);
  await expect(row.locator("[data-terminal-unit-price]")).toHaveText("2 CR");
  await expect(row.locator("[data-terminal-owned]")).toHaveText("4");
  await expect(terminal.locator(`[data-terminal-row="${ITEM_IDS.boulder}"]`)).toHaveCount(0);
  await row.getByRole("button", { name: /Maximum Stone quantity/ }).click();
  await expect(row.locator("[data-terminal-total]")).toHaveText("8 CR");
  await captureReviewScreenshot(page, "stillreach-terminal-stone-sell-mobile.png");
  await row.locator("[data-terminal-commit]").click();
  await expect(terminal.locator("[data-terminal-feedback]")).toHaveText(
    "Received 4 × Stone · paid 8 CR",
  );
  await expect(terminal.locator("[data-terminal-credits]")).toContainText("18");
  await expectNoHorizontalOverflow(page);
});
