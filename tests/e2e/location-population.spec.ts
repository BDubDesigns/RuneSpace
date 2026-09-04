import { expect, test, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { LOCATION_IDS, PORTRAIT_IDS, SKILL_IDS } from "@/game/config/foundations";
import { createCharacter } from "@/server/characters";
import { ensurePlayerAccount } from "@/server/ownership";
import { cleanupTestUser, createTestUser } from "../integration/fixtures";
import { expectElementsInsideHexes } from "./map-geometry";
import { populationDisclosure } from "./population-disclosure";
import { captureReviewScreenshot } from "./review-screenshot";

/** Short unique token so seeded names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

type PopulationFixture = {
  radaOne: string;
  radaTwo: string;
  kaelCutter: string;
  yardGhost: string;
  userIds: string[];
};

/**
 * Create one owner user with one character at the Crash Site. Optionally
 * persist Mining XP so the derived level is meaningful.
 */
async function seedCharacter(ownerName: string, characterName: string, miningXp?: number) {
  const userId = await createTestUser(db, authSchema, ownerName);
  const account = await ensurePlayerAccount(userId);
  const character = await createCharacter(account.id, characterName, PORTRAIT_IDS.evaSalvageWelder);
  if (miningXp !== undefined) {
    await db.insert(rune.characterSkillXp).values({
      characterId: character.id,
      skillId: SKILL_IDS.mining,
      totalXp: miningXp,
    });
  }
  return { userId, characterId: character.id };
}

async function seedPopulationFixture(): Promise<PopulationFixture> {
  const radaOne = `Rada One ${token()}`;
  const radaTwo = `Rada Two ${token()}`;
  const kaelCutter = `Kael Cutter ${token()}`;
  const yardGhost = `Yard Ghost ${token()}`;
  // Two characters owned by one player, plus another player's character, all
  // at the Crash Site; one character at the Processing Yard to prove the
  // location scope.
  const radaOneOwner = await seedCharacter("Rada Stonehand", radaOne, 500);
  const radaTwoOwner = await seedCharacter("Rada Stonehand", radaTwo);
  const kaelCutterOwner = await seedCharacter("Kael Brighthome", kaelCutter, 500);
  const yard = await seedCharacter("Kael Brighthome", yardGhost);
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(rune.characters.id, yard.characterId));
  return {
    radaOne,
    radaTwo,
    kaelCutter,
    yardGhost,
    userIds: [radaOneOwner.userId, radaTwoOwner.userId, kaelCutterOwner.userId, yard.userId],
  };
}

const populationTest = test.extend<{ population: PopulationFixture }>({
  population: async ({}, use) => {
    const fixture = await seedPopulationFixture();
    try {
      await use(fixture);
    } finally {
      for (const userId of fixture.userIds) {
        await cleanupTestUser(db, authSchema, rune, userId);
      }
    }
  },
});

/** Scroll the local map into the center of the viewport so neither hex is
 * hidden by the fixed bottom navigation. */
async function scrollMapIntoView(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Local map"]');
    if (el) el.scrollIntoView({ block: "center" });
  });
}

async function expectPopulationIndicatorInsideHex(page: import("@playwright/test").Page) {
  const geometry = await expectElementsInsideHexes(
    page.locator('[aria-label="Local map"]'),
    "data-map-population",
  );
  expect(geometry.labels.length).toBeGreaterThanOrEqual(1);
  expect(geometry.allInside).toBe(true);
  expect(geometry.routeOverlaps).toEqual([]);
}

async function indicatorCount(page: import("@playwright/test").Page): Promise<number> {
  const text = (await page.locator("[data-map-population]").textContent()) ?? "";
  const match = text.match(/\d+/);
  if (!match) throw new Error(`Population indicator has no count: "${text}"`);
  return Number(match[0]);
}

populationTest(
  "the occupied tile shows other characters and owners, and re-scopes on travel",
  async ({ page, testCharacter, population }) => {
    // The in-place arrival section waits for the client boundary scheduler to
    // resolve Travel (24 s walk) without a reload.
    test.setTimeout(120_000);
    const characterId = testCharacter.id;
    await openTestCharacter(page, characterId);
    await page.setViewportSize({ width: 390, height: 844 });
    const activeName = (await page.locator("main h1").first().textContent())!.trim();

    // The current tile communicates that other characters are present.
    const indicator = page.locator("[data-map-population]");
    await expect(indicator).toBeVisible();
    const before = await indicatorCount(page);
    expect(before).toBeGreaterThanOrEqual(3);
    await expectPopulationIndicatorInsideHex(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The disclosure reveals the approved public entries. Its compact count
    // badge always matches the tile indicator count (both come from the same
    // authoritative read).
    const disclosure = populationDisclosure(page);
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    const badge = page.locator("[data-population-count]");
    await expect(badge).toBeVisible();
    expect(Number((await badge.textContent())?.trim())).toBe(before);
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", { name: `${population.radaOne}, Level 2, player Rada Stonehand` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `${population.radaTwo}, Level 1, player Rada Stonehand` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `${population.kaelCutter}, Level 2, player Kael Brighthome`,
      }),
    ).toBeVisible();
    // Multiple characters owned by one player stay separate; the active
    // character is not listed.
    await expect(page.getByRole("button", { name: /player Rada Stonehand/ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: new RegExp(`^${activeName},`) })).toHaveCount(0);

    await scrollMapIntoView(page);
    await captureReviewScreenshot(page, "location-population-mobile-list.png");

    // Refreshed authoritative gameplay state revalidates the population: a
    // character created after the page loaded appears. At Crash Site after
    // issue #83 there is no Mining refresh button, so reload to trigger
    // population revalidation (which collapses the disclosure).
    const radaThree = `Rada Three ${token()}`;
    const radaThreeOwner = await seedCharacter("Rada Stonehand", radaThree);
    population.userIds.push(radaThreeOwner.userId);
    await page.reload();
    await expect(page.getByText("World map")).toBeVisible();
    expect(await indicatorCount(page)).toBe(before + 1);
    // Disclosure collapsed on reload — reopen to see the new entry
    await expect(populationDisclosure(page)).toHaveAttribute("aria-expanded", "false");
    await populationDisclosure(page).click();
    await expect(
      page.getByRole("button", { name: `${radaThree}, Level 1, player Rada Stonehand` }),
    ).toBeVisible();

    // Travel to the Processing Yard. The population read is delayed so the
    // arrival transition is observable: the previous tile's entries and count
    // must never appear on the destination tile while the replacement read is
    // in flight.
    await scrollMapIntoView(page);
    await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
    await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
    await expect(page.getByText("Journey progress")).toBeVisible();
    const departPast = new Date(Date.now() - 25_000);
    await db
      .update(rune.activeActions)
      .set({ startedAt: departPast, resolvedThroughAt: departPast })
      .where(eq(rune.activeActions.characterId, characterId));
    await page.route("**/api/location-population?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });

    // The boundary scheduler resolves arrival in place (no reload): the yard
    // tile becomes current, and while the delayed read is pending the tile must
    // show no count from the previous location.
    await expect(
      page.getByRole("button", { name: /Abandoned Processing Yard/ }).first(),
    ).toHaveAttribute("aria-current", "true", { timeout: 45_000 });
    await expect(page.locator("[data-map-population]")).toHaveCount(0);

    // Once the yard read lands, the re-scoped population appears.
    await expect(page.locator("[data-map-population]")).toBeVisible();
    await page.unroute("**/api/location-population?*");

    // The yard population lists the yard character and none of the Crash Site
    // characters; the disclosure collapsed on arrival and reopens cleanly.
    const yardDisclosure = populationDisclosure(page);
    await expect(yardDisclosure).toHaveAttribute("aria-expanded", "false");
    // The accessible label is truthful about the count: with exactly one other
    // character present (the seeded CI fixture state) it must be the singular
    // "Show 1 character here"; with any leftover characters it must stay
    // consistent with the badge count.
    const yardCount = Number((await page.locator("[data-population-count]").textContent())?.trim());
    await expect(yardDisclosure).toHaveAttribute(
      "aria-label",
      yardCount === 1 ? "Show 1 character here" : /^Show \d+ characters here$/,
    );
    await yardDisclosure.click();
    await expect(
      page.getByRole("button", {
        name: `${population.yardGhost}, Level 1, player Kael Brighthome`,
      }),
    ).toBeVisible();
    for (const absent of [population.radaOne, population.radaTwo, population.kaelCutter]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${absent},`) })).toHaveCount(0);
    }
    await scrollMapIntoView(page);
    await captureReviewScreenshot(page, "location-population-mobile-yard.png");
  },
);

populationTest(
  "the population surface is keyboard reachable with announced state",
  async ({ page, testCharacter, population }) => {
    await openTestCharacter(page, testCharacter.id);
    await page.setViewportSize({ width: 390, height: 844 });

    const disclosure = populationDisclosure(page);
    await disclosure.focus();
    await expect(disclosure).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", { name: `${population.radaOne}, Level 2, player Rada Stonehand` }),
    ).toBeVisible();

    // Enter closes the disclosure and focus remains on the trigger; the
    // controlled region stays mounted but hidden so aria-controls stays valid.
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(disclosure).toBeFocused();
    await expect(page.locator("#location-population-list")).toBeHidden();
  },
);
