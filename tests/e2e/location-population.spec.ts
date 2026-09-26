import { expect, test, openMapSurface, openTestCharacter } from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import {
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  PORTRAIT_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
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

/**
 * Regression for #207 follow-up: a resident's `flex justify-end` meta wrapper
 * once shrink-wrapped the *expanded* population list to the collapsed
 * trigger's own narrow width, at any location with a resident NPC. This
 * checks actual rendered layout (bounding boxes), not classes or attributes,
 * the same way `expectExteriorMissionHalo` checks computed paint rather than
 * trusting a class name.
 */
async function expectPopulationListFillsRow(
  page: import("@playwright/test").Page,
  rowSelector: string,
) {
  const row = page.locator(rowSelector);
  const list = page.locator("#location-population-list");
  const [rowBox, listBox] = await Promise.all([row.boundingBox(), list.boundingBox()]);
  if (!rowBox || !listBox) throw new Error("Expected both the row and the list to be laid out");
  expect(listBox.width).toBeGreaterThanOrEqual(rowBox.width - 2);
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

    // Collapsed, at a location with a resident NPC (Wade Rusk, Crash Site):
    // the trigger stays compact and right-aligned against the resident rows,
    // not stretched to their full width. It is the place's line, so it renders
    // once, after the people rather than inside anybody's row (#231).
    const residentRow = page.locator("[data-npc-residents]");
    await expect(page.locator("[data-npc-interaction]")).toHaveCount(1);
    await expect(page.locator("[data-place-meta]")).toHaveCount(1);
    await expect(page.locator("[data-npc-interaction] [data-location-population]")).toHaveCount(0);
    const [residentRowBox, disclosureBox] = await Promise.all([
      residentRow.boundingBox(),
      disclosure.boundingBox(),
    ]);
    if (!residentRowBox || !disclosureBox) throw new Error("Expected both to be laid out");
    // Not a fixed ratio: the label's own text length varies with the seeded
    // count, and at a phone width it can already span most of the row. The
    // regression this guards is the trigger stretching to fill the row, so a
    // real (if small) gap is enough to prove it stayed shrink-wrapped.
    expect(disclosureBox.width).toBeLessThan(residentRowBox.width - 8);
    expect(disclosureBox.x + disclosureBox.width).toBeCloseTo(
      residentRowBox.x + residentRowBox.width,
      0,
    );

    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    // Expanded, the list (and any opened Character Profile, which mounts
    // inside it) is free to use the full row instead of staying pinned to the
    // collapsed trigger's narrow width.
    await expectPopulationListFillsRow(page, "[data-npc-residents]");
    const expandedOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(expandedOverflow).toBeLessThanOrEqual(0);
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
    // The Processing Yard has no resident NPC, so its population never went
    // through the resident row's meta wrapper — confirming it already renders
    // full width, unregressed by the resident-row fix above.
    await expectPopulationListFillsRow(page, "[data-place-meta]");
    const yardOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(yardOverflow).toBeLessThanOrEqual(0);
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

/**
 * Issue #231: the place panel resolves an ordered set of residents. Every
 * shipped context still has at most one, so these journeys pin the migrated
 * behaviour at phone width: Wade stands where his Mission record says, Tansy
 * has not moved, each resident row sits above the place's activity, and the
 * place's own population line renders once, after the people.
 */
test.describe("issue #231 resident rows at phone width", () => {
  const PHONE = { width: 390, height: 844 };

  async function standAfterKeepTheChange(characterId: string, locationId: string) {
    const now = new Date();
    await db
      .insert(rune.characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.keepTheChange,
        ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /** Exactly these residents, in order, above the activity, with one meta line. */
  async function expectResidents(page: import("@playwright/test").Page, npcIds: string[]) {
    const rows = page.locator("[data-location-surface] [data-npc-interaction]");
    await expect(rows).toHaveCount(npcIds.length);
    for (const [index, npcId] of npcIds.entries()) {
      await expect(rows.nth(index)).toHaveAttribute("data-npc-interaction", npcId);
    }
    const meta = page.locator("[data-location-surface] [data-place-meta]");
    await expect(meta).toHaveCount(1);
    await expect(meta.locator("[data-location-population]")).toBeVisible();
    const metaBox = (await meta.boundingBox())!;
    if (npcIds.length > 0) {
      const lastRow = (await rows.last().boundingBox())!;
      expect(metaBox.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height - 1);
    }
    const activity = page.locator("[data-activity-panel]").first();
    if ((await activity.count()) > 0) {
      const activityBox = (await activity.boundingBox())!;
      expect(metaBox.y + metaBox.height).toBeLessThanOrEqual(activityBox.y);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test("Wade is the Crash Site's resident until Keep the Change completes", async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(PHONE);
    await openTestCharacter(page, testCharacter.id);
    await expect(page.locator(`[data-location-scene="${LOCATION_IDS.crashSite}"]`)).toBeVisible();
    await expectResidents(page, [NPC_IDS.wadeRusk]);
  });

  test("after Keep the Change Wade is at his yard, the Crash Site is empty, and Tansy has not moved", async ({
    page,
    testCharacter,
  }) => {
    await page.setViewportSize(PHONE);
    await standAfterKeepTheChange(testCharacter.id, LOCATION_IDS.crashSite);
    await openTestCharacter(page, testCharacter.id);
    await expect(page.locator(`[data-location-scene="${LOCATION_IDS.crashSite}"]`)).toBeVisible();
    await expectResidents(page, []);

    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, testCharacter.id));
    await page.reload();
    await expect(
      page.locator(`[data-location-scene="${LOCATION_IDS.ruskRecovery}"]`),
    ).toBeVisible();
    await expectResidents(page, [NPC_IDS.wadeRusk]);

    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, testCharacter.id));
    await page.reload();
    await expect(page.locator(`[data-location-scene="${LOCATION_IDS.theJag}"]`)).toBeVisible();
    await expectResidents(page, [NPC_IDS.tansyRusk]);
  });
});
