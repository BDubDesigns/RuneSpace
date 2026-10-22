import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characterSkillXp, characters } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { expect, openTestCharacter, test } from "./fixtures";
import { seedLegacyStarterCutter } from "./legacy-starter";

/**
 * Issue #383 — Stillreach Harmonic Workings Rune Fragment Mining in a real
 * browser.
 *
 * The server suites own the rules. This covers what only a rendered page can
 * answer: the Mining 8 gate reads honestly below level, the site reads as an
 * operational Mining location at level, and a due attempt pays Rune Fragments
 * and 130 XP on the panel. The deterministic CI random is a certain success
 * with the smaller yield and no find.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const balance = getEffectiveGameBalance();
const harmonic = balance.mining.sources.harmonicMining;

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

test("Harmonic Workings refuses Mining below Mining 8 with the honest gate on a phone", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 7);
  await standAt(testCharacter.id, LOCATION_IDS.harmonicWorkings);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  const harmonicWorkings = getLocation(LOCATION_IDS.harmonicWorkings)!;
  await expect(page.getByTestId("location-scene")).toHaveAttribute(
    "data-location-scene",
    LOCATION_IDS.harmonicWorkings,
  );
  await expect(page.getByRole("heading", { name: "Harmonic Workings" })).toBeVisible();
  await expect(page.getByText(harmonicWorkings.description, { exact: false })).toBeVisible();
  await expect(page.locator("[data-mining-level-gate]")).toContainText(
    /Mining 8 is required to mine .* here\. You are Mining 7\./,
  );
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
});

test("at Mining 8 the Harmonic Workings panel shows the real chance and attempt time", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 8);
  await standAt(testCharacter.id, LOCATION_IDS.harmonicWorkings);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  await expect(page.locator("[data-mining-activity]")).toBeVisible();
  await expect(page.locator("[data-mining-level-gate]")).toHaveCount(0);
  // Mining 8 exactly: the level-one-anchored 46.66%, 75 ticks, the shared Mining curve.
  await expect(page.getByText(/Success chance: 46.66%/)).toBeVisible();
  await expect(
    page.getByText(/Normal Rune Fragment attempts take 75 ticks \/ 45 seconds/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test("a due Rune Fragment attempt pays one Fragment and 130 XP and shows the result", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 8);
  await seedLegacyStarterCutter(testCharacter.id);
  await standAt(testCharacter.id, LOCATION_IDS.harmonicWorkings);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize(PHONE);

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const oneAttemptAgo = new Date(Date.now() - (harmonic.attemptDurationTicks * 600 + 500));
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, testCharacter.id));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt", exact: true });
  await expect(latest).toContainText("Latest attempt: Success");
  await expect(latest).toHaveAttribute("data-result-outcome", "success");
  await expect(page.getByText("1 Rune Fragment gained", { exact: true })).toBeVisible();
  await expect(page.getByText("130 Mining XP", { exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
});
