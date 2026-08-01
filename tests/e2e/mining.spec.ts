import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  characterMiningState,
  characterStarterProvisioning,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
const RESULT_FEEDBACK_DURATION_MS = 3_600;

function animationDurationSeconds(value: string): number {
  const duration = Number.parseFloat(value);
  return value.endsWith("ms") ? duration / 1_000 : duration;
}

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Mining E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openMiningFixture(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

test.beforeEach(async ({ page }) => {
  const characterId = await openMiningFixture(page);
  await Promise.all([
    db.delete(activeActions).where(eq(activeActions.characterId, characterId)),
    db.delete(characterMiningState).where(eq(characterMiningState.characterId, characterId)),
    db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId)),
    db
      .update(characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(characters.id, characterId)),
    db
      .delete(characterStarterProvisioning)
      .where(eq(characterStarterProvisioning.characterId, characterId)),
  ]);
  await db.delete(equippedItems).where(eq(equippedItems.characterId, characterId));
  await db.delete(itemInstances).where(eq(itemInstances.characterId, characterId));
  await page.reload();
});

test("owned character can start, observe, stop, and restore Crash Site Mining", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const characterId = page.url().split("/").at(-1)!;
  // The test process seeds the pre-existing full stack; the app still resolves
  // the next success/failure and creates the second stack through server rules.
  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 10,
  });
  const twoAttemptsAgo = new Date(Date.now() - 12_100);
  await db
    .update(activeActions)
    .set({ startedAt: twoAttemptsAgo, resolvedThroughAt: twoAttemptsAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const footer = page.getByRole("navigation", { name: "Primary" });
  const latestResult = page.getByRole("region", {
    name: "Latest mining attempt",
    exact: true,
  });
  await expect(footer.getByRole("link", { name: "Characters" })).toHaveText("Chars");
  await expect(footer.getByRole("button", { name: "Inventory 2/8" })).toBeVisible();
  await expect(latestResult).toContainText("Latest attempt: No yield");
  await expect(latestResult).toContainText("Roll 35.00 | Needed below 35.00");
  await expect(latestResult).toContainText("Missed by 0.01");
  await expect(latestResult).toContainText("2 attempts resolved while away");
  await expect(latestResult).toHaveAttribute("data-feedback-state", "new");
  await page.screenshot({ path: "test-results/mining-mobile-no-yield.png" });
  await expect(page.getByText("This mining run")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await expect(page.getByText("1 successful", { exact: true })).toBeVisible();
  await expect(page.getByText("1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("1 shale gained", { exact: true })).toBeVisible();
  await expect(page.getByText("15 Mining XP", { exact: true })).toBeVisible();
  const history = page.getByLabel("Mining attempt history", { exact: true });
  await expect(history).toContainText("Attempt 2 - Failed");
  await expect(history).toContainText("Attempt 1 - Success");
  await expect(history).toContainText("Roll 35.00 | Needed below 35.00");
  await expect(history).toContainText("Missed by 0.01");
  await expect(history).toContainText("Roll 0.00 | Needed below 35.00");
  await page.screenshot({ path: "test-results/mining-mobile-active-viewport.png" });
  await page.getByText("This mining run").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mining-mobile-run-history-viewport.png" });
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByText("2 occupied / 8 slots")).toBeVisible();
  await expect(inventory.getByText("Ferrite Shale", { exact: true })).toHaveCount(2);
  const ferriteArtwork = inventory.getByTestId("item-artwork");
  await expect(ferriteArtwork).toHaveCount(2);
  await expect
    .poll(() =>
      ferriteArtwork.first().evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  const artworkState = await ferriteArtwork.first().evaluate((image) => ({
    assetPath: new URL(image.currentSrc).searchParams.get("url"),
    complete: image.complete,
    naturalWidth: image.naturalWidth,
  }));
  expect(artworkState.assetPath).toBe("/item-art/ferrite-shale.webp");
  expect(artworkState.complete).toBe(true);
  expect(artworkState.naturalWidth).toBeGreaterThan(0);
  await expect(ferriteArtwork.first()).toHaveCSS("object-fit", "contain");
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await expect(inventory.getByText("x1", { exact: true })).toBeVisible();
  const firstSlot = inventory.locator("article").first();
  const firstSlotName = firstSlot.getByText("Ferrite Shale", { exact: true });
  const firstSlotQuantity = firstSlot.getByText("x10", { exact: true });
  await expect(firstSlotName).toHaveCSS("background-color", "rgba(9, 21, 34, 0.9)");
  await expect(firstSlotName).toHaveCSS("white-space", "nowrap");
  await expect(firstSlotName).toHaveCSS("text-overflow", "ellipsis");
  await expect(firstSlotQuantity).toHaveCSS("background-color", "rgba(9, 21, 34, 0.42)");
  await expect(firstSlotQuantity).toHaveCSS("border-top-color", "rgba(75, 216, 245, 0.2)");
  const [slotBox, artworkBox] = await Promise.all([
    firstSlot.boundingBox(),
    ferriteArtwork.first().boundingBox(),
  ]);
  expect(slotBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(
    Math.abs(slotBox!.x + slotBox!.width / 2 - (artworkBox!.x + artworkBox!.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(slotBox!.y + slotBox!.height / 2 - (artworkBox!.y + artworkBox!.height / 2)),
  ).toBeLessThanOrEqual(1);
  await expect(inventory.locator("[data-stack-track]")).toHaveCount(2);
  const [nameBox, trackBox] = await Promise.all([
    firstSlotName.boundingBox(),
    inventory.locator("[data-stack-track]").first().boundingBox(),
  ]);
  expect(nameBox).not.toBeNull();
  expect(trackBox).not.toBeNull();
  expect(nameBox!.x - (trackBox!.x + trackBox!.width)).toBeGreaterThanOrEqual(4);
  expect(
    Math.abs(nameBox!.y + nameBox!.height - (slotBox!.y + slotBox!.height)),
  ).toBeLessThanOrEqual(1);
  await expect(inventory.locator('[data-stack-fill="100"]')).toBeVisible();
  await expect(inventory.locator('[data-stack-fill="10"]')).toBeVisible();
  await expect(inventory.locator("[data-stack-fill]")).toHaveCount(2);
  const fullFill = await inventory.locator('[data-stack-fill="100"]').evaluate((fill) => {
    const track = fill.parentElement!;
    const slot = track.parentElement!;
    const fillBox = fill.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    return {
      fraction: fillBox.height / trackBox.height,
      background: getComputedStyle(fill).backgroundColor,
      fillBottom: fillBox.bottom,
      fillWidth: fillBox.width,
      trackBackground: getComputedStyle(track).backgroundColor,
      trackBottom: trackBox.bottom,
      trackLeft: trackBox.left,
      trackTop: trackBox.top,
      trackWidth: trackBox.width,
      slotLeft: slotBox.left,
      slotBottom: slotBox.bottom,
      slotTop: slotBox.top,
      slotWidth: slotBox.width,
      trackZIndex: getComputedStyle(track).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  const partialFill = await inventory.locator('[data-stack-fill="10"]').evaluate((fill) => {
    const track = fill.parentElement!;
    const slot = track.parentElement!;
    const fillBox = fill.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    return {
      fraction: fillBox.height / trackBox.height,
      background: getComputedStyle(fill).backgroundColor,
      fillBottom: fillBox.bottom,
      fillWidth: fillBox.width,
      trackBottom: trackBox.bottom,
      trackLeft: trackBox.left,
      trackTop: trackBox.top,
      trackWidth: trackBox.width,
      slotLeft: slotBox.left,
      slotBottom: slotBox.bottom,
      slotTop: slotBox.top,
      slotWidth: slotBox.width,
      trackZIndex: getComputedStyle(track).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  expect(fullFill.fraction).toBeGreaterThan(0.95);
  expect(fullFill.background).toBe("rgb(245, 196, 81)");
  expect(fullFill.trackBackground).toBe("rgba(245, 196, 81, 0.14)");
  expect(fullFill.fillWidth).toBe(8);
  expect(fullFill.trackWidth).toBe(8);
  expect(Math.abs(fullFill.trackLeft - fullFill.slotLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.trackTop - fullFill.slotTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.trackBottom - fullFill.slotBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.fillBottom - fullFill.trackBottom)).toBeLessThanOrEqual(1);
  expect(fullFill.trackWidth).toBeLessThan(fullFill.slotWidth);
  expect(fullFill.trackZIndex).toBe("0");
  expect(fullFill.textZIndex).toBe("20");
  expect(partialFill.fraction).toBeGreaterThan(0.08);
  expect(partialFill.fraction).toBeLessThan(0.12);
  expect(partialFill.background).toBe("rgb(245, 196, 81)");
  expect(partialFill.fillWidth).toBe(8);
  expect(partialFill.trackWidth).toBe(8);
  expect(Math.abs(partialFill.trackLeft - partialFill.slotLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.trackTop - partialFill.slotTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.trackBottom - partialFill.slotBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.fillBottom - partialFill.trackBottom)).toBeLessThanOrEqual(1);
  expect(partialFill.trackWidth).toBeLessThan(partialFill.slotWidth);
  expect(partialFill.trackZIndex).toBe("0");
  expect(partialFill.textZIndex).toBe("20");
  await expect(inventory.getByLabel(/Empty inventory slot/)).toHaveCount(6);
  await page.screenshot({ path: "test-results/mining-mobile-inventory-10-plus-1.png" });
  await page.getByRole("button", { name: "Close inventory" }).click();
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(history).toBeVisible();
  await expect(footer).toBeVisible();
  const [historyBox, footerBox] = await Promise.all([history.boundingBox(), footer.boundingBox()]);
  expect(historyBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(footerBox!.y);
  await page.screenshot({ path: "test-results/mining-mobile-page-bottom.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(footer).toHaveCSS("position", "fixed");
  await page.screenshot({ path: "test-results/mining-desktop-no-yield.png" });
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mining-desktop-inventory-10-plus-1.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeHidden();
  await expect(page.getByText("0 attempts", { exact: true })).toBeVisible();
  await expect(history).toContainText("No resolved attempts in this run yet.");
  const oneAttemptAgo = new Date(Date.now() - 6_100);
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(latestResult).toContainText("Latest attempt: Success");
  await expect(latestResult.getByLabel("1 Ferrite Shale earned")).toBeVisible();
  await expect(latestResult.getByLabel("15 Mining XP earned")).toBeVisible();
  await expect(latestResult.getByText("XP", { exact: true })).toBeVisible();
  await expect(latestResult.getByText("Mining", { exact: true })).toBeVisible();
  await expect(latestResult.getByText("+15", { exact: true })).toBeVisible();
  const reducedMotionDuration = await latestResult.evaluate(
    (element) => getComputedStyle(element).animationDuration,
  );
  expect(animationDurationSeconds(reducedMotionDuration)).toBeLessThanOrEqual(0.0001);
  await page.screenshot({ path: "test-results/mining-desktop-success.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mining-mobile-success.png" });
  await page.waitForTimeout(RESULT_FEEDBACK_DURATION_MS + 250);
  await expect(latestResult).toHaveAttribute("data-feedback-state", "calm");
  await page.waitForTimeout(300);
  await expect(latestResult).toHaveAttribute("data-feedback-state", "calm");
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(latestResult).toHaveAttribute("data-feedback-state", "calm");
});

test("automatically resolves Mining and starts the next authoritative timer", async ({ page }) => {
  const characterId = page.url().split("/").at(-1)!;
  await page.goto("/characters");
  const boundaryStart = new Date(Date.now() - 4_500);
  await db.insert(activeActions).values({
    characterId,
    actionId: ACTION_IDS.crashSiteMining,
    startedAt: boundaryStart,
    resolvedThroughAt: boundaryStart,
  });
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);

  await expect(page.getByText("1 successful", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("NORMAL TIMING · Next attempt: 10 ticks")).toBeVisible();
  const persisted = await db
    .select()
    .from(characterMiningState)
    .where(eq(characterMiningState.characterId, characterId));
  expect(persisted[0]?.runAttempts).toBe(1);
});

test("automatically resolves a boosted Mining attempt and decrements charge once", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  await page.goto("/characters");
  const cutter = (
    await db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.characterId, characterId),
          eq(itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      )
  )[0]!;
  await db.update(itemInstances).set({ currentCharge: 1 }).where(eq(itemInstances.id, cutter.id));
  const boundaryStart = new Date(Date.now() - 2_400);
  await db.insert(activeActions).values({
    characterId,
    actionId: ACTION_IDS.crashSiteMining,
    startedAt: boundaryStart,
    resolvedThroughAt: boundaryStart,
  });
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);

  await expect(page.getByText("POWER CELL BOOST · 1 / 10")).toBeVisible();
  await expect(page.getByRole("region", { name: "Latest mining attempt" })).toContainText(
    "Power Cell charge consumed",
  );
  await expect(page.getByText("NORMAL TIMING · Next attempt: 10 ticks")).toBeVisible({
    timeout: 10_000,
  });
  const [persistedHistory, persistedCutter] = await Promise.all([
    db.select().from(characterMiningState).where(eq(characterMiningState.characterId, characterId)),
    db.select().from(itemInstances).where(eq(itemInstances.id, cutter.id)),
  ]);
  expect(persistedHistory[0]?.runAttempts).toBe(1);
  expect(persistedCutter[0]?.currentCharge).toBe(0);
});

test("retries an early unchanged Mining boundary without duplicating the attempt", async ({
  page,
}) => {
  const characterId = page.url().split("/").at(-1)!;
  const refreshRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      refreshRequests.push(request.headers()["next-action"]!);
  });
  await page.addInitScript(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 2_000;
  });
  await page.goto("/characters");
  const boundaryStart = new Date(Date.now() - 4_500);
  await db.insert(activeActions).values({
    characterId,
    actionId: ACTION_IDS.crashSiteMining,
    startedAt: boundaryStart,
    resolvedThroughAt: boundaryStart,
  });
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);

  await expect(page.getByText("1 successful", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(refreshRequests.length).toBeGreaterThanOrEqual(2);
  const persisted = await db
    .select()
    .from(characterMiningState)
    .where(eq(characterMiningState.characterId, characterId));
  expect(persisted[0]?.runAttempts).toBe(1);
});

test("footer Characters navigation uses a compact visible label", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characters = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
    name: "Characters",
  });
  await expect(characters).toHaveText("Chars");
  await characters.click();
  await expect(page).toHaveURL(/\/characters$/);
});

test("shell reserves the fixed footer once and keeps the global background fixed", async ({
  page,
}) => {
  // Playwright's viewport is synthetic: it cannot reproduce mobile Chrome's
  // changing visible viewport while browser chrome expands and collapses. The
  // shared shells therefore use dynamic viewport units, and these assertions
  // verify the content/viewport contract at representative states.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/characters");
  const characterMetrics = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(characterMetrics.scrollHeight - characterMetrics.clientHeight).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "test-results/layout-mobile-characters.png" });

  const playHref = await page.getByRole("link", { name: "Play" }).getAttribute("href");
  const characterId = playHref?.split("/").at(-1);
  expect(characterId).toBeTruthy();
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(characters.id, characterId!));
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("World map", { exact: true })).toBeVisible();

  const yardGeometry = await page.evaluate(() => {
    const spacingProbe = document.createElement("div");
    spacingProbe.style.position = "absolute";
    document.body.append(spacingProbe);
    spacingProbe.style.height = "var(--rs-space-3)";
    const expectedGap = spacingProbe.getBoundingClientRect().height;
    spacingProbe.style.height = "var(--rs-bottom-nav-box-height)";
    const expectedBoxHeight = spacingProbe.getBoundingClientRect().height;
    spacingProbe.style.height = "var(--rs-bottom-nav-clearance)";
    const expectedClearance = spacingProbe.getBoundingClientRect().height;
    spacingProbe.remove();
    const nav = document.querySelector('nav[aria-label="Primary"]');
    return {
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      expectedGap,
      expectedBoxHeight,
      expectedClearance,
      navHeight: nav?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(Math.abs(yardGeometry.navHeight - yardGeometry.expectedBoxHeight)).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      yardGeometry.expectedClearance - yardGeometry.expectedBoxHeight - yardGeometry.expectedGap,
    ),
  ).toBeLessThanOrEqual(2);
  expect(yardGeometry.scrollHeight - yardGeometry.clientHeight).toBeLessThanOrEqual(
    yardGeometry.expectedGap + 2,
  );
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const yardBottomGeometry = await page.evaluate(() => {
    const content = document.querySelector("main");
    const nav = document.querySelector('nav[aria-label="Primary"]');
    return {
      contentBottom: content?.getBoundingClientRect().bottom ?? 0,
      navTop: nav?.getBoundingClientRect().top ?? 0,
    };
  });
  expect(
    Math.abs(
      yardBottomGeometry.navTop - yardBottomGeometry.contentBottom - yardGeometry.expectedGap,
    ),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "test-results/layout-mobile-play-yard.png" });

  const background = await page.evaluate(() => ({
    htmlAttachment: getComputedStyle(document.documentElement).backgroundAttachment,
    htmlImage: getComputedStyle(document.documentElement).backgroundImage,
    bodyImage: getComputedStyle(document.body).backgroundImage,
  }));
  expect(
    background.htmlAttachment.split(",").every((attachment) => attachment.trim() === "fixed"),
  ).toBe(true);
  expect(background.htmlImage).toContain("radial-gradient");
  expect(background.bodyImage).toBe("none");

  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.crashSite })
    .where(eq(characters.id, characterId!));
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();

  const crashGeometry = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(crashGeometry.scrollHeight - crashGeometry.clientHeight).toBeGreaterThan(10);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottomGeometry = await page.evaluate(() => {
    const content = document.querySelector("main");
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const spacingProbe = document.createElement("div");
    spacingProbe.style.height = "var(--rs-space-3)";
    spacingProbe.style.position = "absolute";
    document.body.append(spacingProbe);
    const expectedGap = spacingProbe.getBoundingClientRect().height;
    spacingProbe.remove();
    return {
      contentBottom: content?.getBoundingClientRect().bottom ?? 0,
      navTop: nav?.getBoundingClientRect().top ?? 0,
      navPosition: nav ? getComputedStyle(nav).position : "",
      expectedGap,
    };
  });
  expect(bottomGeometry.navPosition).toBe("fixed");
  // The document's real end keeps the shared space-3 breathing room above the
  // fixed toolbar without changing the toolbar's own box height.
  const bottomGap = bottomGeometry.navTop - bottomGeometry.contentBottom;
  expect(Math.abs(bottomGap - bottomGeometry.expectedGap)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "test-results/layout-mobile-play-bottom.png" });

  // A viewport-height change (a proxy for browser-chrome/orientation changes)
  // must not create a tail, while the genuinely tall Crash Site state remains
  // scrollable. Real mobile Chrome is the decisive dynamic-viewport check.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const landscapeGeometry = await page.evaluate(() => {
    const content = document.querySelector("main");
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const spacingProbe = document.createElement("div");
    spacingProbe.style.height = "var(--rs-space-3)";
    spacingProbe.style.position = "absolute";
    document.body.append(spacingProbe);
    const expectedGap = spacingProbe.getBoundingClientRect().height;
    spacingProbe.remove();
    return {
      contentBottom: content?.getBoundingClientRect().bottom ?? 0,
      navTop: nav?.getBoundingClientRect().top ?? 0,
      scrollRange: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      expectedGap,
    };
  });
  expect(landscapeGeometry.scrollRange).toBeGreaterThan(10);
  const landscapeGap = landscapeGeometry.navTop - landscapeGeometry.contentBottom;
  expect(Math.abs(landscapeGap - landscapeGeometry.expectedGap)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "test-results/layout-mobile-play-scrolled-background.png" });
});

test("equipment drawer shows and updates the approved Mining loadout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const footer = page.getByRole("navigation", { name: "Primary" });
  const equipmentTrigger = footer.getByRole("button", { name: "Equipment" });
  await equipmentTrigger.click();
  const equipment = page.getByRole("dialog", { name: "Equipment" });
  const miningTool = equipment.getByLabel("Mining tool");
  const firstContainer = equipment.getByLabel("Container attachment 1");
  const secondContainer = equipment.getByLabel("Container attachment 2");
  await expect(equipment).toBeVisible();
  await expect(miningTool.getByText("Salvage Cutter", { exact: true }).first()).toBeVisible();
  await expect(miningTool.getByText(/5(?:\.0)? kg/)).toBeVisible();
  await expect(
    firstContainer.getByText("MYKEA SCHLEPPRAUM-8", { exact: true }).first(),
  ).toBeVisible();
  await expect(firstContainer.getByText(/10(?:\.0)? kg/)).toBeVisible();
  await expect(secondContainer.getByText("Empty", { exact: true })).toBeVisible();
  await expect(equipment.getByText("8 slots", { exact: true })).toBeVisible();
  await expect(equipment.getByText(/15(?:\.0)? kg \/ 50(?:\.0)? kg/)).toBeVisible();
  await firstContainer.getByRole("button", { name: "Unequip" }).click();
  await expect(equipment.getByRole("alert")).toContainText(
    "At least one compatible container must remain equipped.",
  );
  await page.keyboard.press("Escape");
  await expect(equipmentTrigger).toBeFocused();

  const characterId = page.url().split("/").at(-1)!;
  await db.insert(itemInstances).values({
    characterId,
    itemId: ITEM_IDS.mykeaSchleppraum8,
  });
  await page.getByRole("button", { name: "Refresh status" }).click();
  await equipmentTrigger.click();
  const equipSecondContainer = secondContainer.getByRole("button", {
    name: "Equip in Container attachment 2",
  });
  await expect(equipSecondContainer).toBeVisible();
  const mobileControlBox = await equipSecondContainer.boundingBox();
  expect(mobileControlBox).not.toBeNull();
  expect(mobileControlBox!.height).toBeGreaterThanOrEqual(44);
  await equipSecondContainer.click();
  await expect(
    secondContainer.getByText("MYKEA SCHLEPPRAUM-8", { exact: true }).first(),
  ).toBeVisible();
  await expect(equipment.getByText("16 slots", { exact: true })).toBeVisible();
  await equipment.getByRole("button", { name: "Close equipment" }).click();
  const inventoryTrigger = footer.getByRole("button", { name: "Inventory 0/16" });
  await expect(inventoryTrigger).toBeVisible();
  await inventoryTrigger.click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory.getByLabel("16 inventory slots")).toBeVisible();
  await inventory.getByRole("button", { name: "Close inventory" }).click();
  await equipmentTrigger.click();
  await page.screenshot({ path: "test-results/mining-mobile-equipment.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(equipment).toBeVisible();
  await page.screenshot({ path: "test-results/mining-desktop-equipment.png" });
});

test("Power Cell loading boosts Mining attempts and falls back after depletion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;
  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.powerCell,
    quantity: 2,
  });
  await page.getByRole("button", { name: "Refresh status" }).click();

  await page.getByRole("button", { name: "Equipment" }).click();
  const equipment = page.getByRole("dialog", { name: "Equipment" });
  await expect(equipment.getByText("Depleted · 0 / 10", { exact: true })).toBeVisible();
  await expect(equipment.getByText("Carried Power Cells: 2", { exact: true })).toBeVisible();
  await expect(equipment.getByRole("button", { name: "Load Power Cell" })).toBeVisible();
  await equipment.getByRole("button", { name: "Load Power Cell" }).click();
  await expect(equipment.getByText("Loaded · 10 / 10", { exact: true })).toBeVisible();
  await expect(equipment.getByText("Carried Power Cells: 1", { exact: true })).toBeVisible();
  const loadSuccess = equipment.getByText("Power Cell loaded · 10 boosted attempts ready.", {
    exact: true,
  });
  await expect(loadSuccess).toBeVisible();
  // Success feedback must not be presented as an error (alert role is reserved
  // for genuine errors/refusals).
  await expect(equipment.getByRole("alert")).toHaveCount(0);
  await expect(loadSuccess).not.toHaveAttribute("role", "alert");
  await equipment.getByRole("button", { name: "Close equipment" }).click();

  await page.getByRole("button", { name: "Start Mining" }).click();
  const firstBoostedBatch = new Date(Date.now() - 6_100);
  await db
    .update(activeActions)
    .set({ startedAt: firstBoostedBatch, resolvedThroughAt: firstBoostedBatch })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText(/POWER CELL BOOST · [89] \/ 10/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Latest mining attempt" })).toContainText(
    "Power Cell charge consumed",
  );
  await expect(page.getByLabel("Mining attempt history", { exact: true })).toContainText(
    "Boosted · 5 ticks",
  );

  // Stop/start preserves the Cutter instance charge while avoiding the client
  // refresh timer racing the deterministic depletion boundary below.
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await page.getByRole("button", { name: "Start Mining" }).click();
  const cutterRow = (
    await db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.characterId, characterId),
          eq(itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      )
  )[0]!;
  await db
    .update(itemInstances)
    .set({ currentCharge: 1 })
    .where(eq(itemInstances.id, cutterRow.id));
  const depletionBatch = new Date(Date.now() - 3_100);
  await db
    .update(activeActions)
    .set({ startedAt: depletionBatch, resolvedThroughAt: depletionBatch })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByText("Power Cell depleted · Mining continues at normal speed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("NORMAL TIMING · Next attempt: 10 ticks")).toBeVisible();

  const normalBatch = new Date(Date.now() - 6_100);
  await db
    .update(activeActions)
    .set({ startedAt: normalBatch, resolvedThroughAt: normalBatch })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText(/Normal attempt · 10 ticks/).last()).toBeVisible();
});

test("equipment and inventory rendering shows artwork for illustrated items and fallback for the rest", async ({
  page,
}) => {
  // Populate inventory with one illustrated stack (Ferrite Shale) and one
  // deliberate text-fallback stack (Refined Ferrite) so both paths coexist.
  const characterId = page.url().split("/").at(-1)!;
  await db.insert(inventoryStacks).values([
    {
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 5,
    },
    {
      characterId,
      itemId: ITEM_IDS.refinedFerrite,
      quantity: 1,
    },
  ]);
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Open equipment drawer and verify equipped items show artwork.
  const footer = page.getByRole("navigation", { name: "Primary" });
  await footer.getByRole("button", { name: "Equipment" }).click();
  const equipment = page.getByRole("dialog", { name: "Equipment" });

  const miningTool = equipment.getByLabel("Mining tool");
  const firstContainer = equipment.getByLabel("Container attachment 1");

  // Salvage Cutter artwork
  const cutterArt = miningTool.getByTestId("item-artwork");
  await expect(cutterArt).toHaveCount(1);
  await expect
    .poll(() => cutterArt.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const cutterState = await cutterArt.evaluate((image) => ({
    src: image.getAttribute("src"),
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    cssWidth: getComputedStyle(image).width,
    cssHeight: getComputedStyle(image).height,
  }));
  expect(cutterState.naturalWidth).toBeGreaterThan(0);
  expect(cutterState.naturalHeight).toBeGreaterThan(0);
  expect(cutterState.cssWidth).toBe("80px");
  expect(cutterState.cssHeight).toBe("80px");

  // Verify accessible description and name on the Cutter tile
  const cutterTile = miningTool.locator("article").first();
  await expect(cutterTile).toHaveAccessibleName("Salvage Cutter equipped");
  const cutterDescId = await cutterTile.getAttribute("aria-describedby");
  expect(cutterDescId).toBeTruthy();
  const cutterDesc = miningTool.locator(`#${cutterDescId}`);
  await expect(cutterDesc).toContainText("Vice-jaw improvised Salvage Cutter mining tool");

  // MYKEA container artwork
  const mykeaArt = firstContainer.getByTestId("item-artwork");
  await expect(mykeaArt).toHaveCount(1);
  await expect
    .poll(() => mykeaArt.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const mykeaState = await mykeaArt.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    cssWidth: getComputedStyle(image).width,
    cssHeight: getComputedStyle(image).height,
  }));
  expect(mykeaState.naturalWidth).toBeGreaterThan(0);
  expect(mykeaState.naturalHeight).toBeGreaterThan(0);
  expect(mykeaState.cssWidth).toBe("80px");
  expect(mykeaState.cssHeight).toBe("80px");

  await expect(cutterArt).toHaveCSS("object-fit", "contain");
  await expect(mykeaArt).toHaveCSS("object-fit", "contain");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mining-mobile-equipment-artwork.png" });

  // Desktop equipment view
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/mining-desktop-equipment-artwork.png" });

  await equipment.getByRole("button", { name: "Close equipment" }).click();

  // Open inventory — should show one illustrated and one fallback stack
  await footer.getByRole("button", { name: "Inventory 2/8" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory.getByText("2 occupied / 8 slots")).toBeVisible();

  // Illustrated stack: Ferrite Shale
  const ferriteTile = inventory.locator("article").filter({ hasText: "Ferrite Shale" });
  await expect(ferriteTile).toHaveAccessibleName("5 Ferrite Shale");
  await expect(ferriteTile.getByText("Ferrite Shale", { exact: true })).toBeVisible();
  await expect(ferriteTile.getByText("x5", { exact: true })).toBeVisible();
  const ferriteArt = ferriteTile.getByTestId("item-artwork");
  await expect(ferriteArt).toHaveCount(1);
  await expect
    .poll(() => ferriteArt.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const ferriteDescId = await ferriteTile.getAttribute("aria-describedby");
  expect(ferriteDescId).toBeTruthy();
  await expect(inventory.locator(`#${ferriteDescId}`)).toContainText(
    "Ferrite Shale mineral fragment",
  );

  // Fallback stack: Refined Ferrite (no artwork, renders textFallback "RF")
  const refinedTile = inventory.locator("article").filter({ hasText: "Refined Ferrite" });
  await expect(refinedTile).toHaveAccessibleName("1 Refined Ferrite");
  await expect(refinedTile.getByText("Refined Ferrite", { exact: true })).toBeVisible();
  await expect(refinedTile.getByText("x1", { exact: true })).toBeVisible();
  // No artwork for fallback items
  await expect(refinedTile.getByTestId("item-artwork")).toHaveCount(0);
  // Fallback text renders
  await expect(refinedTile.locator("span").filter({ hasText: "RF" })).toBeVisible();
  // Accessible description still works for fallback items
  const refinedDescId = await refinedTile.getAttribute("aria-describedby");
  expect(refinedDescId).toBeTruthy();
  await expect(inventory.locator(`#${refinedDescId}`)).toContainText("Purified Ferrite material");

  await expect(inventory.getByLabel(/Empty inventory slot/)).toHaveCount(6);

  // Verify artwork sizing in inventory context
  const invArtState = await ferriteArt.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    cssWidth: getComputedStyle(image).width,
    cssHeight: getComputedStyle(image).height,
  }));
  expect(invArtState.naturalWidth).toBeGreaterThan(0);
  expect(invArtState.naturalHeight).toBeGreaterThan(0);
  expect(invArtState.cssWidth).toBe("80px");
  expect(invArtState.cssHeight).toBe("80px");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mining-mobile-inventory-mixed.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/mining-desktop-inventory-mixed.png" });

  await page.setViewportSize({ width: 390, height: 844 });
}, 30_000);

test("an interrupted Mining action preserves confirmed state and retries only status refresh", async ({
  page,
}) => {
  const isMiningAction = (request: import("@playwright/test").Request) =>
    request.method() === "POST" && Boolean(request.headers()["next-action"]);
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  const baselineRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const refreshActionId = (await baselineRequest).headers()["next-action"];
  expect(refreshActionId).toBeTruthy();

  let aborted = false;
  let miningRequests = 0;
  page.on("request", (request) => {
    if (isMiningAction(request)) miningRequests += 1;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      !aborted &&
      isMiningAction(request) &&
      request.headers()["next-action"] === refreshActionId
    ) {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(aborted).toBe(true);
  expect(miningRequests).toBe(1);

  await page.unroute("**/*");
  const recoveredRequest = page.waitForRequest(
    (request) => isMiningAction(request) && request.headers()["next-action"] === refreshActionId,
  );
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await recoveredRequest;
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeHidden();
  await expect(retry).toHaveCount(0);
  expect(miningRequests).toBe(2);
});

test("an uncertain Start retries status refresh without replaying the mutation", async ({
  page,
}) => {
  const isMiningAction = (request: import("@playwright/test").Request) =>
    request.method() === "POST" && Boolean(request.headers()["next-action"]);
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  const startRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Start Mining" }).click();
  const startActionId = (await startRequest).headers()["next-action"];
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  const refreshRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const refreshActionId = (await refreshRequest).headers()["next-action"];
  expect(startActionId).toBeTruthy();
  expect(refreshActionId).toBeTruthy();
  expect(refreshActionId).not.toBe(startActionId);

  const actionIds: string[] = [];
  page.on("request", (request) => {
    if (isMiningAction(request)) actionIds.push(request.headers()["next-action"]!);
  });
  let aborted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!aborted && isMiningAction(request) && request.headers()["next-action"] === startActionId) {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(aborted).toBe(true);
  expect(actionIds).toEqual([startActionId]);

  await page.unroute("**/*");
  const recoveredRequest = page.waitForRequest(
    (request) => isMiningAction(request) && request.headers()["next-action"] === refreshActionId,
  );
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await recoveredRequest;
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeHidden();
  await expect(retry).toHaveCount(0);
  expect(actionIds).toEqual([startActionId, refreshActionId]);
});

test("the Play boundary resets, navigates, and hides failure details", async ({ page }) => {
  await page.evaluate(() => window.sessionStorage.setItem("runespace-e2e-play-error", "1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Play terminal interrupted" })).toBeVisible();
  await expect(page.getByText("Play boundary e2e failure")).toHaveCount(0);
  await page.evaluate(() => window.sessionStorage.removeItem("runespace-e2e-play-error"));
  await page.getByRole("button", { name: "Retry connection" }).click();
  // Recovery returns to the current location, which may not be Crash Site after Travel E2E.
  await expect(page.getByText("World map", { exact: true })).toBeVisible();

  await page.evaluate(() => window.sessionStorage.setItem("runespace-e2e-play-error", "1"));
  await page.reload();
  await expect(page.getByRole("link", { name: "Back to characters" })).toBeVisible();
  await page.getByRole("link", { name: "Back to characters" }).click();
  await expect(page).toHaveURL(/\/characters$/);
});
