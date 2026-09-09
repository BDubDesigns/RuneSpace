import { expect, test, openMapSurface, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { LOCATION_IDS, PORTRAIT_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { createCharacter } from "@/server/characters";
import { ensurePlayerAccount } from "@/server/ownership";
import { cleanupTestUser, createTestUser } from "../integration/fixtures";
import { populationDisclosure } from "./population-disclosure";
import { captureReviewScreenshot } from "./review-screenshot";

/** Short unique token so seeded names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

type PopulationFixture = {
  radaOwnerName: string;
  kaelOwnerName: string;
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
  // The Crash Site population is a live, globally shared read (every
  // concurrently-running test's characters default there), so two separately
  // scheduled invocations of this fixture must never share an owner display
  // name — otherwise their population entries can be counted together under
  // `fullyParallel` scheduling. A per-invocation token keeps each run's owner
  // names (and therefore every "player <name>" assertion) unambiguous.
  const fixtureToken = token();
  const radaOwnerName = `Rada Stonehand ${fixtureToken}`;
  const kaelOwnerName = `Kael Brighthome ${fixtureToken}`;
  const radaOne = `Rada One ${token()}`;
  const radaTwo = `Rada Two ${token()}`;
  const kaelCutter = `Kael Cutter ${token()}`;
  const yardGhost = `Yard Ghost ${token()}`;
  // Two characters owned by one player, plus another player's character, all
  // at the Crash Site; one character at the Processing Yard to prove the
  // location scope.
  const radaOneOwner = await seedCharacter(radaOwnerName, radaOne, 500);
  const radaTwoOwner = await seedCharacter(radaOwnerName, radaTwo);
  const kaelCutterOwner = await seedCharacter(kaelOwnerName, kaelCutter, 500);
  const yard = await seedCharacter(kaelOwnerName, yardGhost);
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(rune.characters.id, yard.characterId));
  return {
    radaOwnerName,
    kaelOwnerName,
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

async function indicatorCount(page: import("@playwright/test").Page): Promise<number> {
  const count = await page.locator("[data-population-count]").getAttribute("data-population-count");
  if (!count) throw new Error("Population indicator has no count");
  return Number(count);
}

test("The Long Scramble shows its scene, description, and population without fake activity", async ({
  page,
  testCharacter,
}) => {
  const location = getLocation(LOCATION_IDS.theLongScramble);
  expect(location).toBeDefined();
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.theLongScramble })
    .where(eq(rune.characters.id, testCharacter.id));
  await openTestCharacter(page, testCharacter.id);

  await expect(page.locator("[data-location-surface]")).toBeVisible();
  await expect(
    page.locator(`[data-location-scene="${LOCATION_IDS.theLongScramble}"]`),
  ).toBeVisible();
  await expect(page.locator("[data-location-description]")).toContainText(location!.description);
  await expect(page.locator("[data-location-population]")).toBeVisible();
  await expect(page.locator("[data-location-activity]")).toHaveCount(0);
  await expect(
    page.getByText("No production activity is available here.", { exact: true }),
  ).toHaveCount(0);
});

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

    // The stationary Location surface communicates that other characters are present.
    const indicator = page.locator("[data-location-population]");
    await expect(indicator).toBeVisible();
    const before = await indicatorCount(page);
    expect(before).toBeGreaterThanOrEqual(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The disclosure reveals the approved public entries. Its compact count
    // always matches the same authoritative read.
    const disclosure = populationDisclosure(page);
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    const badge = page.locator("[data-population-count]");
    await expect(badge).toBeVisible();
    expect(Number(await badge.getAttribute("data-population-count"))).toBe(before);
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", {
        name: `${population.radaOne}, Level 2, player ${population.radaOwnerName}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `${population.radaTwo}, Level 1, player ${population.radaOwnerName}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `${population.kaelCutter}, Level 2, player ${population.kaelOwnerName}`,
      }),
    ).toBeVisible();
    // Multiple characters owned by one player stay separate; the active
    // character is not listed.
    await expect(
      page.getByRole("button", { name: new RegExp(`player ${population.radaOwnerName}`) }),
    ).toHaveCount(2);
    await expect(page.getByRole("button", { name: new RegExp(`^${activeName},`) })).toHaveCount(0);

    await captureReviewScreenshot(page, "location-population-mobile-list.png");

    // Refreshed authoritative gameplay state revalidates the population: a
    // character created after the page loaded appears. At Crash Site after
    // issue #83 there is no Mining refresh button, so reload to trigger
    // population revalidation (which collapses the disclosure).
    const radaThree = `Rada Three ${token()}`;
    const radaThreeOwner = await seedCharacter(population.radaOwnerName, radaThree);
    population.userIds.push(radaThreeOwner.userId);
    await page.reload();
    await expect(page.locator("[data-location-surface]")).toBeVisible();
    // Crash Site is the shared default location for every concurrently
    // running test's character, so its total population can shift from
    // unrelated ambient traffic between these two reads in either direction
    // (another test's character can arrive at or depart Crash Site in the
    // same window) — an earlier `before + 1` lower-bound assertion here still
    // observed a real failure (ambient departures offsetting our own
    // addition), so no numeric bound on the shared total is reliable. What
    // this step actually owns is proving revalidation picked up the newly
    // seeded character without a manual refresh, which the specific new
    // row's visibility below proves precisely and deterministically.
    // Disclosure collapsed on reload — reopen to see the new entry
    await expect(populationDisclosure(page)).toHaveAttribute("aria-expanded", "false");
    await populationDisclosure(page).click();
    await expect(
      page.getByRole("button", {
        name: `${radaThree}, Level 1, player ${population.radaOwnerName}`,
      }),
    ).toBeVisible();

    // Travel to the Processing Yard. The population read is delayed so the
    // arrival transition is observable: the previous tile's entries and count
    // must never appear on the destination tile while the replacement read is
    // in flight.
    await openMapSurface(page);
    await page.getByRole("button", { name: /Abandoned Processing Yard/ }).click();
    await page.getByRole("button", { name: /Walk to Abandoned Processing Yard/ }).click();
    await expect(page.getByText("Journey progress")).toBeVisible();
    await openMapSurface(page);
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
    // Map remains a spatial, read-only surface and never shows population.
    await expect(page.locator("[data-map-population]")).toHaveCount(0);
    await expect(page.locator("[data-location-population]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back to Location" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Location" }).click();
    await expect(page.locator("[data-location-surface]")).toBeVisible();
    await page.unroute("**/api/location-population?*");

    // The yard population lists the yard character and none of the Crash Site
    // characters; the disclosure collapsed on arrival and reopens cleanly.
    const yardDisclosure = populationDisclosure(page);
    await expect(yardDisclosure).toHaveAttribute("aria-expanded", "false");
    // The accessible label is truthful about the count: with exactly one other
    // character present (the seeded CI fixture state) it must be the singular
    // "View 1 other character here"; with any leftover characters it must stay
    // consistent with the badge count.
    const yardCount = Number(
      await page.locator("[data-population-count]").getAttribute("data-population-count"),
    );
    await expect(yardDisclosure).toHaveAttribute(
      "aria-label",
      yardCount === 1 ? "View 1 other character here" : /^View \d+ other characters here$/,
    );
    await yardDisclosure.click();
    await expect(
      page.getByRole("button", {
        name: `${population.yardGhost}, Level 1, player ${population.kaelOwnerName}`,
      }),
    ).toBeVisible();
    for (const absent of [population.radaOne, population.radaTwo, population.kaelCutter]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${absent},`) })).toHaveCount(0);
    }
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
      page.getByRole("button", {
        name: `${population.radaOne}, Level 2, player ${population.radaOwnerName}`,
      }),
    ).toBeVisible();

    // Enter closes the disclosure and focus remains on the trigger; the
    // controlled region stays mounted but hidden so aria-controls stays valid.
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(disclosure).toBeFocused();
    await expect(page.locator("#location-population-list")).toBeHidden();
  },
);
