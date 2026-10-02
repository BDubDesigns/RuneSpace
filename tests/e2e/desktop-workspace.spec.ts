import type { Locator, Page } from "@playwright/test";
import { db } from "@/db";
import { characterMissions } from "@/db/rune-space";
import { MISSION_IDS } from "@/game/config/foundations";
import { REALTIME_STREAM_PATH } from "@/game/schemas/realtime";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #286 — the desktop Play workspace and its responsive presentation seam
 * in a real browser.
 *
 * Unit coverage owns the pure rules (the open-intent reducer, the home
 * preference's parsing and fallback, tab keyboard order, the breakpoint
 * constant's agreement with the CSS). This proves what only a browser can: the
 * composition at each width, that exactly one presentation of one utility is
 * ever mounted, that the docked panel is an ordinary page region while the
 * phone's is the unchanged modal Drawer, that the saved home and a temporary
 * switch behave, that unsent drafts and the one realtime stream survive
 * switches and Map round trips, and that an explicitly opened utility crosses
 * the breakpoint with its focus while a passive home never raises a modal.
 *
 * Every journey sets its own widths, so the whole file runs once, in the
 * chromium project.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewports; runs once");
});

const PHONE = { width: 390, height: 844 } as const;
const TABLET = { width: 768, height: 1024 } as const;
const LAPTOP = { width: 1024, height: 768 } as const;
const JUST_BELOW = { width: 1279, height: 800 } as const;
const DESKTOP = { width: 1280, height: 720 } as const;
const WIDE = { width: 1440, height: 900 } as const;

const FIVE_MISSIONS = [
  MISSION_IDS.walkItOff,
  MISSION_IDS.cutYourTeeth,
  MISSION_IDS.wasteNot,
  MISSION_IDS.holdItTogether,
  MISSION_IDS.keepTheChange,
];

async function acceptMissions(characterId: string, missionIds: readonly string[]) {
  const acceptedAt = new Date();
  await db
    .insert(characterMissions)
    .values(missionIds.map((missionId) => ({ characterId, missionId, acceptedAt })));
}

async function openAt(
  page: Page,
  characterId: string,
  viewport: { width: number; height: number },
  url = "",
) {
  await page.setViewportSize(viewport);
  await page.goto(`/play/${characterId}${url}`);
  await page.waitForURL(new RegExp(`/play/${characterId}(?:\\?[^#]*)?$`));
}

const tabList = (page: Page) => page.getByRole("tablist", { name: "Play utilities" });
const tab = (page: Page, name: string | RegExp) =>
  tabList(page).getByRole("tab", { name, exact: typeof name === "string" });
const rail = (page: Page) => page.locator("[data-play-rail]");
const dockedPanel = (page: Page) => page.locator("[data-docked-utility]");
const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const chatLauncher = (page: Page) => page.locator("[data-chat-social-launcher]");
const strips = (page: Page) => page.locator("[data-mission-strips]");
const composer = (page: Page) => page.getByLabel("Message General");

async function waitForDock(page: Page) {
  await expect(tabList(page)).toBeVisible();
  await expect(dockedPanel(page)).toBeVisible();
}

async function expectNoModalMachinery(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  const bodyLocked = await page.evaluate(
    () => document.body.style.position === "fixed" || document.body.style.overflow === "hidden",
  );
  expect(bodyLocked).toBe(false);
}

/** How many realtime streams this page has opened since `track` was called. */
function trackStreams(page: Page) {
  const opened: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === REALTIME_STREAM_PATH) opened.push(request.url());
  });
  return opened;
}

for (const viewport of [PHONE, TABLET, LAPTOP, JUST_BELOW]) {
  test(`${viewport.width}px keeps the phone/tablet composition and its modal Drawers`, async ({
    page,
    testCharacter,
  }) => {
    await acceptMissions(testCharacter.id, [MISSION_IDS.walkItOff]);
    await openAt(page, testCharacter.id, viewport);

    // The bottom navigation, Map link, and floating Chat launcher are the
    // phone's way in, exactly as before.
    await expect(primaryNav(page)).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Map" })).toBeVisible();
    await expect(primaryNav(page).getByRole("button")).toHaveCount(3);
    await expect(chatLauncher(page)).toBeVisible();
    // No rail, no tab list, no docked region, no desktop Map header.
    await expect(rail(page)).toBeHidden();
    await expect(tabList(page)).toHaveCount(0);
    await expect(dockedPanel(page)).toHaveCount(0);
    await expect(page.locator("[data-map-open]")).toBeHidden();
    // Current Missions sit above the main gameplay, in the main column.
    await expect(strips(page)).toHaveCount(1);
    await expect(page.locator("main [data-mission-strips]")).toBeVisible();

    // A utility is a modal Drawer; nothing is open until the player opens one,
    // and a passive desktop home never opens a Chat modal here.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await primaryNav(page).getByRole("button", { name: "Inventory" }).click();
    const inventory = page.getByRole("dialog", { name: "Inventory" });
    await expect(inventory).toBeVisible();
    await expect(inventory).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(primaryNav(page).getByRole("button", { name: /Inventory/ })).toBeFocused();

    await chatLauncher(page).click();
    const chat = page.getByRole("dialog", { name: "Chat" });
    await expect(chat).toBeVisible();
    await expect(chat).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(chatLauncher(page)).toBeFocused();
  });
}

for (const viewport of [DESKTOP, WIDE]) {
  test(`${viewport.width}px shows the desktop workspace with all four utilities`, async ({
    page,
    testCharacter,
  }, testInfo) => {
    await acceptMissions(testCharacter.id, [MISSION_IDS.walkItOff]);
    await openAt(page, testCharacter.id, viewport);
    await waitForDock(page);

    // The phone's navigation and launcher are gone, not merely shrunk.
    await expect(primaryNav(page)).toBeHidden();
    await expect(chatLauncher(page)).toBeHidden();

    // Global branding, News and account controls stay in the global header.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "News" })).toBeVisible();

    // Map is a compact control in the main column's header, upper right — not
    // in the global header and not in the rail.
    const map = page.locator("[data-map-open]");
    await expect(map).toBeVisible();
    await expect(map).toHaveAccessibleName("Map");
    const mapBox = (await map.boundingBox())!;
    const railBox = (await rail(page).boundingBox())!;
    const mainBox = (await page.locator("main").boundingBox())!;
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width + 1);
    expect(mapBox.x).toBeGreaterThan(mainBox.x + mainBox.width / 2);
    // The header row is the first thing in the main column, under the global header.
    expect(mapBox.y - mainBox.y).toBeLessThan(8);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(railBox.x);
    expect(await rail(page).locator("[data-map-open]").count()).toBe(0);

    // The rail is the agreed 24rem and the main column keeps the rest.
    expect(Math.round(railBox.width)).toBe(384);
    expect(mainBox.width).toBeGreaterThan(780);
    expect(railBox.x).toBeGreaterThan(mainBox.x + mainBox.width);

    // Objectives: exactly one instance, in the rail's upper part.
    await expect(strips(page)).toHaveCount(1);
    await expect(rail(page).locator("[data-mission-strips]")).toBeVisible();
    await expect(page.locator("main [data-mission-strips]")).toHaveCount(0);
    const stripBox = (await strips(page).boundingBox())!;
    const tabsBox = (await tabList(page).boundingBox())!;
    expect(stripBox.y).toBeLessThan(tabsBox.y);

    // Exactly the four player-facing labels, Chat selected as the home.
    const tabs = tabList(page).getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs).toHaveText(["Chat", "Inventory", "Character", "Missions"]);
    await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
    await expect(composer(page)).toBeVisible();
    await captureReviewScreenshot(page, `issue-286-desktop-chat-${viewport.width}.png`);

    await tab(page, "Inventory").click();
    await expect(tab(page, "Inventory")).toHaveAttribute("aria-selected", "true");
    await expect(dockedPanel(page).getByRole("tab", { name: "Inventory" })).toBeVisible();
    await expect(dockedPanel(page).getByRole("tab", { name: "Equipment" })).toBeVisible();
    await dockedPanel(page).getByRole("tab", { name: "Equipment" }).click();
    await expect(
      dockedPanel(page).getByRole("tab", { name: "Equipment", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await captureReviewScreenshot(page, `issue-286-desktop-inventory-${viewport.width}.png`);

    await tab(page, "Character").click();
    await expect(dockedPanel(page).getByRole("link", { name: "Switch Character" })).toBeVisible();
    await expect(dockedPanel(page).locator("[data-character-credits]")).toBeVisible();
    await captureReviewScreenshot(page, `issue-286-desktop-character-${viewport.width}.png`);

    await tab(page, "Missions").click();
    await expect(dockedPanel(page).locator("[data-mission-log]")).toBeVisible();
    await captureReviewScreenshot(page, `issue-286-desktop-missions-${viewport.width}.png`);
    void testInfo;
  });
}

test("the docked panel is an ordinary page region: no modal, scroll lock, trap, or Escape", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await expectNoModalMachinery(page);

  await tab(page, "Inventory").click();
  await expect(dockedPanel(page)).toHaveAttribute("data-docked-utility", "Inventory");
  await expectNoModalMachinery(page);

  // Escape is the page's, not a modal's: the utility stays and focus is not stolen.
  await tab(page, "Inventory").focus();
  await page.keyboard.press("Escape");
  await expect(dockedPanel(page)).toHaveAttribute("data-docked-utility", "Inventory");
  await expect(tab(page, "Inventory")).toBeFocused();

  // No focus trap: Tab leaves the rail for the rest of the page.
  await page.locator("[data-map-open]").focus();
  await expect(page.locator("[data-map-open]")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-map-open]")).toBeFocused();

  // The page itself scrolls; the docked panel scrolls on its own.
  const scrolls = await dockedPanel(page).evaluate((el) => getComputedStyle(el).overflowY);
  expect(scrolls).toBe("auto");
});

test("many objectives are height-bounded and never push Chat's composer out of the viewport", async ({
  page,
  testCharacter,
}) => {
  await acceptMissions(testCharacter.id, FIVE_MISSIONS);
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);

  await expect(strips(page)).toHaveCount(1);
  expect(await page.locator("[data-mission-strip]").count()).toBeGreaterThanOrEqual(2);
  // Height-bounded: the strips scroll inside the objectives region.
  const region = page.locator("[data-objectives-region]");
  const regionBox = (await region.boundingBox())!;
  expect(regionBox.height).toBeLessThanOrEqual(DESKTOP.height * 0.45);
  // The composer and its Send control are fully inside the viewport.
  const send = page.locator("[data-chat-send]");
  await expect(send).toBeVisible();
  const sendBox = (await send.boundingBox())!;
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(DESKTOP.height);
  const composerBox = (await composer(page).boundingBox())!;
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(DESKTOP.height);
  await captureReviewScreenshot(page, "issue-286-desktop-many-objectives-1280.png");

  // Collapsible when several exist; collapsing unmounts the strips (one instance only).
  const toggle = page.locator("[data-objectives-toggle]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(strips(page)).toHaveCount(0);
  await toggle.click();
  await expect(strips(page)).toHaveCount(1);
});

test("a character with no active Mission is not given an empty objectives box", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await expect(page.locator("[data-objectives-region]")).toHaveCount(0);
  await expect(strips(page)).toHaveCount(0);
  const tabsBox = (await tabList(page).boundingBox())!;
  const railBox = (await rail(page).boundingBox())!;
  // The tab list starts at the top of the rail.
  expect(tabsBox.y - railBox.y).toBeLessThanOrEqual(2);
});

test("Chat is the home until Set as default; a temporary switch never changes it", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-docked-utility]")).toHaveAttribute(
    "data-docked-utility",
    "Chat",
  );

  // Casually opening Inventory is temporary: Back returns to the home…
  await tab(page, "Inventory").click();
  await expect(page.locator("[data-utility-set-default]")).toBeVisible();
  await page.locator("[data-utility-return-home]").click();
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Chat")).toBeFocused();

  // …and a fresh page entry still lands on Chat; nothing was saved.
  await tab(page, "Missions").click();
  await page.reload();
  await waitForDock(page);
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("runespace:play-home-utility:")),
  );
  expect(saved).toEqual([]);

  // Only the explicit action saves it, per character and per browser.
  await tab(page, "Inventory").click();
  await page.locator("[data-utility-set-default]").click();
  await expect(tab(page, "Inventory")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-utility-set-default]")).toHaveCount(0);
  await expect(tab(page, "Inventory")).toBeFocused();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`runespace:play-home-utility:${id}`),
      testCharacter.id,
    ),
  ).toBe("inventory");

  // A new page entry restores it, and the real Chat never mounted on the way:
  // nothing of Chat was in the page to read messages while Inventory is home.
  await page.reload();
  await waitForDock(page);
  await expect(tab(page, "Inventory")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-public-chat]")).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);

  // An unrecognised saved value falls back safely to Chat.
  await page.evaluate(
    (id) => localStorage.setItem(`runespace:play-home-utility:${id}`, "quests"),
    testCharacter.id,
  );
  await page.reload();
  await waitForDock(page);
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
});

test("drafts survive utility switches; the one realtime stream survives them and the Map", async ({
  page,
  testCharacter,
}) => {
  const streams = trackStreams(page);
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await expect(chatLauncher(page)).toBeHidden();
  await expect.poll(() => streams.length).toBe(1);

  await composer(page).fill("an unsent thought");
  await tab(page, "Inventory").click();
  await expect(page.locator("[data-public-chat]")).toHaveCount(0);
  await tab(page, "Chat").click();
  await expect(composer(page)).toHaveValue("an unsent thought");

  // Switching the channel tab and utilities again keeps the draft.
  await tab(page, "Missions").click();
  await tab(page, "Character").click();
  await tab(page, "Chat").click();
  await expect(composer(page)).toHaveValue("an unsent thought");

  // Map ↔ Location round trips leave the dock, the draft and the stream alone.
  await page.locator("[data-map-open]").click();
  await page.waitForURL(/\?surface=map$/);
  await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
  await expect(composer(page)).toHaveValue("an unsent thought");
  await page.locator("[data-map-return]").click();
  await page.waitForURL(/\/play\/[^/?]+$/);
  await expect(composer(page)).toHaveValue("an unsent thought");
  expect(streams).toHaveLength(1);
});

test("Map and Location swap in the main column without touching the rail", async ({
  page,
  testCharacter,
}) => {
  await acceptMissions(testCharacter.id, [MISSION_IDS.walkItOff]);
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);

  await tab(page, "Missions").click();
  const before = await strips(page).elementHandle();
  await page.locator("[data-map-open]").click();
  await page.waitForURL(/\?surface=map$/);
  await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();

  // The control becomes the return control; the panel does not add a second.
  await expect(page.getByRole("button", { name: "Back to Location" })).toHaveCount(1);
  await expect(page.locator("[data-map-open]")).toHaveCount(0);
  // Same objectives element, same selected utility, still one of each.
  await expect(strips(page)).toHaveCount(1);
  expect(await strips(page).evaluate((el, original) => el === original, before)).toBe(true);
  await expect(tab(page, "Missions")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-mission-log]")).toBeVisible();
  await captureReviewScreenshot(page, "issue-286-desktop-map-1280.png");

  await page.getByRole("button", { name: "Back to Location" }).click();
  await page.waitForURL(/\/play\/[^/?]+$/);
  await expect(page.locator("[data-map-open]")).toBeVisible();
  await expect(strips(page)).toHaveCount(1);
  await expect(tab(page, "Missions")).toHaveAttribute("aria-selected", "true");
});

test("the tab list is a keyboard-operable ARIA tab list", async ({ page, testCharacter }) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await tab(page, "Chat").focus();

  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Inventory")).toBeFocused();
  await expect(tab(page, "Inventory")).toHaveAttribute("aria-selected", "true");
  // One tab stop: only the selected tab is reachable by Tab.
  await expect(tab(page, "Chat")).toHaveAttribute("tabindex", "-1");
  await expect(tab(page, "Inventory")).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("End");
  await expect(tab(page, "Missions")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Chat")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Missions")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(page, "Chat")).toBeFocused();

  // Tab moves from the selected tab into its panel, and each tab names its panel.
  await expect(tab(page, "Chat")).toHaveAttribute("aria-controls", "play-utility-panel");
  await expect(dockedPanel(page)).toHaveAttribute("role", "tabpanel");
  await expect(dockedPanel(page)).toHaveAttribute("aria-labelledby", "play-utility-tab-chat");
  await page.keyboard.press("Tab");
  expect(await dockedPanel(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test("a tab's accessible state carries attention and ready counts", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  // Nothing needs attention yet: plain names, no badges.
  await expect(tab(page, "Chat")).toHaveAccessibleName("Chat");
  await expect(page.locator("[data-utility-tab-badge]")).toHaveCount(0);
});

test("an explicitly opened utility crosses the breakpoint; a passive home never raises a modal", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);

  // Passive home (Chat, nothing explicit) shrinking to a phone opens nothing.
  await page.setViewportSize(PHONE);
  await expect(primaryNav(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dockedPanel(page)).toHaveCount(0);
  await expect(page.locator("[data-public-chat]")).toHaveCount(0);
  await page.setViewportSize(DESKTOP);
  await waitForDock(page);
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");

  // An explicit Inventory becomes the phone's modal Drawer: one presentation.
  await tab(page, "Inventory").click();
  await page.setViewportSize(PHONE);
  const drawer = page.getByRole("dialog", { name: "Inventory" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(dockedPanel(page)).toHaveCount(0);
  await expect(tabList(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  // …and back to the dock with the same utility selected and focus on its tab.
  await page.setViewportSize(DESKTOP);
  await waitForDock(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tab(page, "Inventory")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Inventory")).toBeFocused();
  await expectNoModalMachinery(page);

  // An explicit phone Chat Drawer crosses to the docked Chat the same way.
  await page.setViewportSize(PHONE);
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await chatLauncher(page).click();
  await expect(page.getByRole("dialog", { name: "Chat" })).toBeVisible();
  await composer(page).fill("typed on a phone");
  await page.setViewportSize(DESKTOP);
  await waitForDock(page);
  await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
  await expect(composer(page)).toHaveValue("typed on a phone");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Chat is not mounted while another utility is up, so nothing is read behind it", async ({
  page,
  testCharacter,
}) => {
  await openAt(page, testCharacter.id, DESKTOP);
  await waitForDock(page);
  await expect(page.locator("[data-public-chat]")).toHaveCount(1);
  const chatRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/chat") chatRequests.push(request.url());
  });
  await tab(page, "Missions").click();
  await expect(page.locator("[data-public-chat]")).toHaveCount(0);
  await expect(page.getByRole("log")).toHaveCount(0);
  // Exactly one Chat region ever exists; there is no hidden duplicate.
  await tab(page, "Chat").click();
  await expect(page.locator("[data-public-chat]")).toHaveCount(1);
  void chatRequests;
});

async function tabsOf(page: Page): Promise<Locator> {
  return tabList(page).getByRole("tab");
}
void tabsOf;
