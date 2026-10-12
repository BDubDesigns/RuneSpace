import type { Locator, Page } from "@playwright/test";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characters,
  characterTravelState,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { expect, openEquipmentTab, openTestCharacter, openUtility, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Directional scroll hints (#345): the map's amber arrow on bounded panels, plus
 * the Play page's owner-evaluation preview on the phone's main Location screen.
 * Visibility is derived from real native scroll metrics, so every assertion here
 * scrolls a real scroller and reads which arrows the player can see.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

/** The directions currently shown by hint layers inside `scope`, sorted. */
async function shown(scope: Locator): Promise<string[]> {
  const directions = await scope
    .locator("[data-scroll-affordance]")
    .evaluateAll((markers) =>
      markers.map((marker) => marker.getAttribute("data-scroll-affordance")!),
    );
  return directions.sort();
}

/**
 * A scroller's hints live on a sibling layer inside the frame around it, so a
 * panel's arrows are read from its parent, never from within the scrolling box.
 */
function shownBeside(scroller: Locator): Promise<string[]> {
  return shown(scroller.locator("xpath=.."));
}

async function scrollTo(scroller: Locator, position: "top" | "middle" | "bottom") {
  await scroller.evaluate((element, where) => {
    const max = element.scrollHeight - element.clientHeight;
    element.scrollTop = where === "top" ? 0 : where === "bottom" ? max : Math.round(max / 2);
  }, position);
}

async function overflow(scroller: Locator) {
  return scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
}

/** The arrows take no layout, ignore pointer input, and are invisible to assistive tech. */
async function expectDecorative(layer: Locator) {
  await expect(layer.first()).toHaveCSS("pointer-events", "none");
  expect(
    await layer.first().evaluate((element) => Boolean(element.closest('[aria-hidden="true"]'))),
  ).toBe(true);
  const facts = await layer.locator("[data-scroll-affordance]").evaluateAll((markers) =>
    markers.map((marker) => {
      const arrow = marker.querySelector<HTMLElement>("[data-scroll-affordance-arrow]")!;
      const box = arrow.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        focusable: marker.querySelectorAll("button, a, input, [tabindex]").length,
        // A tap or swipe through the arrow lands on whatever is underneath it.
        hitIsHint: Boolean(hit?.closest("[data-scroll-affordance]")),
        visible: box.width > 0 && box.height > 0,
      };
    }),
  );
  expect(facts.length).toBeGreaterThan(0);
  for (const fact of facts) {
    expect(fact).toEqual({ focusable: 0, hitIsHint: false, visible: true });
  }
}

/**
 * A long loadout: the equipped Salvage Cutter with its Power Cell charge and
 * both Container attachments, so Equipment is taller than a 390×844 Drawer.
 */
async function seedLongLoadout(characterId: string) {
  const balance = getEffectiveGameBalance();
  const [, containerSlotTwo] = balance.carrying.containerSuitSlotIds;
  const [cutter, secondContainer] = await db
    .insert(itemInstances)
    .values([
      { characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 6 },
      { characterId, itemId: ITEM_IDS.mykeaSchleppraum8 },
    ])
    .returning();
  await db.insert(equippedItems).values([
    {
      characterId,
      assignmentKind: "gear",
      suitSlotId: "mining_tool",
      itemInstanceId: cutter!.id,
    },
    {
      characterId,
      assignmentKind: "container",
      suitSlotId: containerSlotTwo,
      itemInstanceId: secondContainer!.id,
    },
  ]);
}

async function openLongEquipment(page: Page) {
  await page.reload();
  return openEquipmentTab(page);
}

test.describe("panel scroll hints (#345)", () => {
  test.beforeEach(async ({ page, testCharacter }) => {
    await openTestCharacter(page, testCharacter.id);
    await seedLongLoadout(testCharacter.id);
  });

  test("the phone Equipment Drawer hints at hidden Container Loadout and follows the scroll", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    const equipment = await openLongEquipment(page);

    expect(await overflow(equipment)).toBeGreaterThan(16);
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);
    await captureReviewScreenshot(page, "scroll-affordances-equipment-top.png");
    await expectDecorative(equipment.locator("xpath=../*[@data-scroll-affordance-layer]"));

    await scrollTo(equipment, "middle");
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom", "top"]);
    await captureReviewScreenshot(page, "scroll-affordances-equipment-middle.png");

    await scrollTo(equipment, "bottom");
    await expect.poll(() => shownBeside(equipment)).toEqual(["top"]);
    await captureReviewScreenshot(page, "scroll-affordances-equipment-bottom.png");

    await scrollTo(equipment, "top");
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);
  });

  test("the hints sit on the visible viewport, take no space, and keep the Drawer's behavior", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    const equipment = await openLongEquipment(page);
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);
    await scrollTo(equipment, "middle");
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom", "top"]);

    // Pinned to the panel's own visible edges while the content moves, and
    // centered on it. The layer is a sibling of the panel, so it takes no space
    // inside it and cannot scroll away with the content.
    const geometry = await equipment.evaluate((dialog) => {
      const frame = dialog.parentElement!;
      const frameBox = frame.getBoundingClientRect();
      const dialogBox = dialog.getBoundingClientRect();
      const place = (direction: string) =>
        frame.querySelector(`[data-scroll-affordance="${direction}"]`)!.getBoundingClientRect();
      return {
        frameMatchesPanel:
          Math.abs(frameBox.top - dialogBox.top) < 1 &&
          Math.abs(frameBox.bottom - dialogBox.bottom) < 1 &&
          Math.abs(frameBox.left - dialogBox.left) < 1 &&
          Math.abs(frameBox.right - dialogBox.right) < 1,
        insideScroller: dialog.querySelector("[data-scroll-affordance]") !== null,
        topGap: place("top").top - dialogBox.top,
        bottomGap: dialogBox.bottom - place("bottom").bottom,
        hintsCentered:
          Math.abs(
            place("top").left + place("top").width / 2 - (dialogBox.left + dialogBox.width / 2),
          ) < 2,
      };
    });
    expect(geometry.frameMatchesPanel).toBe(true);
    expect(geometry.insideScroller).toBe(false);
    expect(geometry.topGap).toBeGreaterThanOrEqual(0);
    expect(geometry.topGap).toBeLessThan(16);
    expect(geometry.bottomGap).toBeGreaterThanOrEqual(0);
    expect(geometry.bottomGap).toBeLessThan(16);
    expect(geometry.hintsCentered).toBe(true);

    // Native modal behavior is unchanged: the page behind is locked, Escape
    // closes, and focus returns to the control that opened it.
    expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");
    await page.keyboard.press("Escape");
    await expect(equipment).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.position)).toBe("");
    await expect(page.getByRole("button", { name: /^Inventory/ })).toBeFocused();
  });

  test("tab, viewport, and content changes update the hints", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const equipment = await openLongEquipment(page);
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);

    // Resizing re-measures: at the bottom only "up" shows, and a shorter
    // viewport (a shorter Drawer over the same content) puts content below again.
    await scrollTo(equipment, "bottom");
    await expect.poll(() => shownBeside(equipment)).toEqual(["top"]);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom", "top"]);
    await page.setViewportSize(PHONE);
    await scrollTo(equipment, "top");
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);

    // Switching tabs swaps the scroller's content; each tab is measured afresh.
    await equipment.getByRole("tab", { name: "Inventory", exact: true }).click();
    const inventory = page.getByRole("dialog", { name: "Inventory" });
    await expect(inventory).toBeVisible();
    const inventoryOverflow = await overflow(inventory);
    await expect
      .poll(() => shownBeside(inventory))
      .toEqual(inventoryOverflow > 16 ? ["bottom"] : []);
  });

  test("a short Drawer shows no arrows", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.reload();
    await openUtility(page, "missions");
    const missions = page.getByRole("dialog", { name: "Mission Log" });
    await expect(missions).toBeVisible();
    expect(await overflow(missions)).toBeLessThanOrEqual(1);
    await page.waitForTimeout(300);
    expect(await shownBeside(missions)).toEqual([]);
    await expect(missions.locator("xpath=../*[@data-scroll-affordance-layer]")).toHaveCount(0);
  });

  test("reduced motion keeps a stationary arrow that is still correct", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(PHONE);
    const equipment = await openLongEquipment(page);
    await expect.poll(() => shownBeside(equipment)).toEqual(["bottom"]);
    const arrow = equipment.locator("xpath=..").locator("[data-scroll-affordance-arrow]");
    await expect(arrow).toBeVisible();
    expect(
      await arrow.evaluate((element) => ({
        name: getComputedStyle(element).animationName,
        transform: getComputedStyle(element).scale,
      })),
    ).toEqual({ name: "none", transform: "none" });
    await scrollTo(equipment, "bottom");
    await expect.poll(() => shownBeside(equipment)).toEqual(["top"]);
  });

  test("the docked desktop utility shows truthful, independent hints", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 });
    const docked = await openLongEquipment(page);
    expect(await overflow(docked)).toBeGreaterThan(16);
    await expect.poll(() => shownBeside(docked)).toEqual(["bottom"]);
    await expectDecorative(docked.locator("xpath=../*[@data-scroll-affordance-layer]"));
    await captureReviewScreenshot(page, "scroll-affordances-docked-desktop.png");

    await scrollTo(docked, "middle");
    await expect.poll(() => shownBeside(docked)).toEqual(["bottom", "top"]);
    await scrollTo(docked, "bottom");
    await expect.poll(() => shownBeside(docked)).toEqual(["top"]);

    // Taller: the content fits and the hints leave.
    await page.setViewportSize(DESKTOP);
    await page.setViewportSize({ width: 1440, height: 2000 });
    await expect.poll(() => shownBeside(docked)).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 560 });
    await expect.poll(() => shownBeside(docked)).not.toEqual([]);
  });
});

test.describe("capped Current Missions list scroll hints (#345)", () => {
  test("hints only while the desktop objectives list truly overflows its cap", async ({
    page,
    testCharacter,
  }) => {
    const acceptedAt = new Date();
    await db
      .insert(characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.keepTheChange,
        ].map((missionId) => ({ characterId: testCharacter.id, missionId, acceptedAt })),
      );
    // Short viewport: the region's cap (24dvh) is smaller than its strips.
    await page.setViewportSize({ width: 1280, height: 560 });
    await openTestCharacter(page, testCharacter.id);
    const list = page.locator("#objectives-region-body");
    await expect(list).toBeVisible();
    expect(await overflow(list)).toBeGreaterThan(16);
    await expect.poll(() => shownBeside(list)).toEqual(["bottom"]);
    await captureReviewScreenshot(page, "scroll-affordances-objectives-list.png");

    await scrollTo(list, "bottom");
    await expect.poll(() => shownBeside(list)).toEqual(["top"]);

    // Collapsing unmounts the list and its hints; expanding measures afresh.
    const toggle = page.locator("[data-objectives-toggle]");
    await toggle.click();
    await expect(list).toHaveCount(0);
    await expect(page.locator("[data-objectives-region] [data-scroll-affordance]")).toHaveCount(0);
    await toggle.click();
    await expect.poll(() => shownBeside(list)).toEqual(["bottom"]);

    // With a single accepted Mission the strips fit under the cap: no hints.
    await db
      .delete(characterMissions)
      .where(
        and(
          eq(characterMissions.characterId, testCharacter.id),
          ne(characterMissions.missionId, MISSION_IDS.holdItTogether),
        ),
      );
    await page.reload();
    await expect(page.locator("#objectives-region-body")).toBeVisible();
    expect(await overflow(page.locator("#objectives-region-body"))).toBeLessThanOrEqual(1);
    await page.waitForTimeout(300);
    await expect.poll(() => shownBeside(page.locator("#objectives-region-body"))).toEqual([]);
  });
});

test.describe("portrait chooser scroll hints (#345)", () => {
  test("the desktop portrait grid hints at hidden portraits and keeps its selection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/characters/new");
    const grid = page.locator("[data-portrait-chooser] [role='group']");
    await expect(grid.locator("[data-portrait-option]").first()).toBeVisible();
    expect(await overflow(grid)).toBeGreaterThan(16);
    await expect.poll(() => shownBeside(grid)).toEqual(["bottom"]);
    await captureReviewScreenshot(page, "scroll-affordances-portrait-grid.png");

    // Selecting a portrait changes nothing about the scroll or the hints.
    const lastOption = grid.locator("[data-portrait-option]").last();
    await scrollTo(grid, "bottom");
    await expect.poll(() => shownBeside(grid)).toEqual(["top"]);
    await lastOption.click();
    await expect(lastOption).toHaveAttribute("aria-pressed", "true");
    expect(await grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => shownBeside(grid)).toEqual(["top"]);

    // Below the `lg` breakpoint the grid is not a scroller: no hints.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => shown(page.locator("[data-portrait-chooser]"))).toEqual([]);
  });
});

/**
 * PREVIEW EXPERIMENT (#345): the Play page's own scroll hints on the phone's
 * main Location screen. Remove this block with `PlayPageScrollHints`.
 */
test.describe("Play page scroll hints preview (#345)", () => {
  const pageHints = (page: Page) => shown(page.locator("[data-play-page-scroll-affordances]"));
  const pageScrollTo = (page: Page, position: "top" | "middle" | "bottom") =>
    page.evaluate((where) => {
      const root = document.documentElement;
      const max = root.scrollHeight - root.clientHeight;
      window.scrollTo(0, where === "top" ? 0 : where === "bottom" ? max : Math.round(max / 2));
    }, position);

  test.beforeEach(async ({ page, testCharacter }) => {
    await page.setViewportSize(PHONE);
    await openTestCharacter(page, testCharacter.id);
  });

  test("follows the document scroll from the Location scene down through the Activity", async ({
    page,
  }) => {
    // The Activity sits below the visible scene, so the page can still scroll.
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
    await captureReviewScreenshot(page, "play-page-hints-location-top.png");
    await expectDecorative(page.locator("[data-play-page-scroll-affordances]"));

    await pageScrollTo(page, "middle");
    await expect.poll(() => pageHints(page)).toEqual(["bottom", "top"]);
    await captureReviewScreenshot(page, "play-page-hints-location-middle.png");

    await pageScrollTo(page, "bottom");
    await expect.poll(() => pageHints(page)).toEqual(["top"]);
    await captureReviewScreenshot(page, "play-page-hints-location-bottom.png");

    await pageScrollTo(page, "top");
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
  });

  test("stays clear of the fixed navigation and blocks nothing", async ({ page }) => {
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
    await pageScrollTo(page, "middle");
    await expect.poll(() => pageHints(page)).toEqual(["bottom", "top"]);

    const geometry = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]')!.getBoundingClientRect();
      const box = (direction: string) =>
        document
          .querySelector(
            `[data-play-page-scroll-affordances] [data-scroll-affordance="${direction}"]`,
          )!
          .getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      const bottom = box("bottom");
      const top = box("top");
      return {
        navTop: nav.top,
        bottomArrowBottom: bottom.bottom,
        topArrowTop: top.top,
        arrowCenterX: top.left + top.width / 2,
        mainCenterX: main.left + main.width / 2,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(geometry.navTop - geometry.bottomArrowBottom).toBeGreaterThanOrEqual(8);
    expect(geometry.topArrowTop).toBeGreaterThanOrEqual(0);
    expect(Math.abs(geometry.arrowCenterX - geometry.mainCenterX)).toBeLessThan(2);
    // No horizontal scrollbar or layout reserved by the hints.
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.clientWidth);

    // Taps and keyboard focus pass straight through: the primary navigation
    // still works and the layer is never a focus target.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Character" })
      .click();
    await expect(page.getByRole("dialog", { name: "Character" })).toBeVisible();
  });

  test("steps aside for a foreground Drawer and returns when it closes", async ({ page }) => {
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
    await pageScrollTo(page, "middle");
    await expect.poll(() => pageHints(page)).toEqual(["bottom", "top"]);

    await openUtility(page, "inventory");
    await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
    await expect(page.locator("[data-play-page-scroll-affordances]")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => pageHints(page)).toEqual(["bottom", "top"]);
  });

  test("is absent on the Map, and when the page fits", async ({ page }) => {
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
    await page.getByRole("link", { name: "Map" }).click();
    await page.waitForURL(/\/play\/[^/?]+\?surface=map$/);
    await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-play-page-scroll-affordances]")).toHaveCount(0);
    await captureReviewScreenshot(page, "play-page-hints-map.png");

    await page.goBack();
    await expect.poll(() => pageHints(page)).toEqual(["bottom"]);
    // A viewport tall enough to show the whole page has nothing to hint at.
    await page.setViewportSize({ width: 390, height: 4000 });
    await expect.poll(() => pageHints(page)).toEqual([]);
  });

  test("is absent during a Journey even when the page overflows", async ({
    page,
    testCharacter,
  }) => {
    const startedAt = new Date(Date.now() - 6_000);
    await db.insert(activeActions).values({
      characterId: testCharacter.id,
      actionId: ACTION_IDS.travel,
      startedAt,
      resolvedThroughAt: startedAt,
    });
    await db.insert(characterTravelState).values({
      characterId: testCharacter.id,
      originLocationId: LOCATION_IDS.holoHollow,
      destinationLocationId: LOCATION_IDS.theJag,
      mode: "crew_hauler",
      scavengeOpportunityStartTick: null,
    });
    await db
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.holoHollow })
      .where(eq(characters.id, testCharacter.id));
    await page.setViewportSize({ width: 390, height: 420 });
    await page.reload();
    await expect(page.getByText("Journey progress")).toBeVisible();
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(scrollable).toBeGreaterThan(16);
    await page.waitForTimeout(300);
    await expect(page.locator("[data-play-page-scroll-affordances]")).toHaveCount(0);
  });

  test("is absent at the docked desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.reload();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-play-page-scroll-affordances]")).toHaveCount(0);
  });
});
