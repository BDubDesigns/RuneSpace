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

/**
 * Issue #380 — Stillreach's The Dry Seam Oil Shale Mining in a real browser.
 *
 * The server suites own the rules. This covers what only a rendered page can
 * answer: the Dry Seam reads as an Oil Shale mine on a phone with the shared
 * Mining 5 numbers, a Mining 4 character is told why, a due attempt pays the
 * shale and XP, and the Stillreach terminal buys the haul at 6 CR a piece.
 */

const PHONE = { width: 390, height: 844 };
const balance = getEffectiveGameBalance();
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

test("The Dry Seam reads as an Oil Shale mine on a phone, with the shared Mining 5 numbers", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 5);
  await standAt(testCharacter.id, LOCATION_IDS.theDrySeam);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  const seam = getLocation(LOCATION_IDS.theDrySeam)!;
  await expect(page.getByTestId("location-scene")).toHaveAttribute(
    "data-location-scene",
    LOCATION_IDS.theDrySeam,
  );
  await expect(page.getByRole("heading", { name: "The Dry Seam" })).toBeVisible();
  await expect(page.getByText(seam.description, { exact: false })).toBeVisible();
  await expect(page.locator("[data-mining-activity]")).toBeVisible();
  await expect(page.locator("[data-mining-level-gate]")).toHaveCount(0);
  await expect(page.getByText(/Success chance: 40.30%/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeEnabled();
  // It is Stillreach's mine, never The South Cut.
  await expect(page.getByRole("heading", { name: "The South Cut" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("Mining 4 is told why it cannot mine at The Dry Seam, and nothing starts", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 4);
  await standAt(testCharacter.id, LOCATION_IDS.theDrySeam);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  await expect(page.locator("[data-mining-level-gate]")).toContainText(
    "Mining 5 is required to mine Oil Shale here. You are Mining 4.",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeDisabled();
  await expect(
    db.select().from(activeActions).where(eq(activeActions.characterId, testCharacter.id)),
  ).resolves.toEqual([]);
});

test("a due Dry Seam attempt pays its shale and 100 XP", async ({ page, testCharacter }) => {
  await setMiningLevel(testCharacter.id, 5);
  await seedLegacyStarterCutter(testCharacter.id);
  await standAt(testCharacter.id, LOCATION_IDS.theDrySeam);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const oneAttemptAgo = new Date(Date.now() - 60_500);
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, testCharacter.id));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt", exact: true });
  await expect(latest).toContainText("Latest attempt: Success");
  // The deterministic CI random: a certain success of the largest yield, no find.
  await expect(page.getByText("4 Oil Shale gained", { exact: true })).toBeVisible();
  await expect(page.getByText("100 Mining XP", { exact: true })).toBeVisible();
});

test("the Stillreach terminal buys a Dry Seam haul at 6 CR a piece", async ({
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
  await db.insert(inventoryStacks).values({ characterId, itemId: ITEM_IDS.oilShale, quantity: 4 });
  await page.setViewportSize(PHONE);
  await page.goto(`/play/${characterId}?place=${FUEL_TERMINAL}`);

  const terminal = page.locator("[data-last-leg-terminal]");
  await expect(terminal).toHaveAttribute("data-terminal-state", "online");
  await terminal.locator('[data-terminal-mode="sell"]').click();
  const row = terminal.locator(`[data-terminal-row="${ITEM_IDS.oilShale}"]`);
  await expect(row.locator("[data-terminal-unit-price]")).toHaveText("6 CR");
  await row.getByRole("button", { name: /Maximum Oil Shale quantity/ }).click();
  await expect(row.locator("[data-terminal-total]")).toHaveText("24 CR");
  await row.locator("[data-terminal-commit]").click();
  await expect(terminal.locator("[data-terminal-feedback]")).toHaveText(
    "Received 4 × Oil Shale · paid 24 CR",
  );
  await expect(terminal.locator("[data-terminal-credits]")).toContainText("34");
});
