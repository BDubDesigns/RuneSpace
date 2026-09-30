import type { Page } from "@playwright/test";
import { REALTIME_STREAM_PATH } from "@/game/schemas/realtime";
import { expect, openMapSurface, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #245 — the Chat/Social shell and the shared realtime stream in a real
 * browser, at the phone (mobile project) and desktop (chromium project)
 * widths.
 *
 * Unit coverage owns the frame format, the lifecycle state machine, and the
 * attention rendering; PostgreSQL coverage owns stream authorization and
 * fanout. This proves the parts only a browser can: the floating launcher
 * sits clear of the footer and of the last Play content, the Drawer opens over
 * the current surface without navigating, and a real tab's stream connects,
 * reconnects after the deliberate lifetime close, survives a
 * suspended/offline tab, and stays one-stream-per-tab across several tabs.
 *
 * The local-E2E hook `POST /api/e2e/realtime` ends a character's streams
 * exactly as the 5-minute lifetime does and reports how many it closed.
 */

const launcher = (page: Page) => page.getByRole("button", { name: "Chat", exact: true });

async function expectLive(page: Page) {
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
}

async function closeStreams(page: Page, characterId: string): Promise<number> {
  const response = await page.request.post("/api/e2e/realtime", { data: { characterId } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { closed: number }).closed;
}

function nextStreamRequest(page: Page) {
  return page.waitForRequest((request) => new URL(request.url()).pathname === REALTIME_STREAM_PATH);
}

test("the floating Chat/Social launcher opens over Play without moving the player", async ({
  page,
  testCharacter,
}, testInfo) => {
  await openTestCharacter(page, testCharacter.id);
  const control = launcher(page);
  await expect(control).toBeVisible();
  await expectLive(page);

  // The four footer destinations are unchanged, and the launcher is not one.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("button")).toHaveCount(3);
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Chat" })).toHaveCount(0);

  // It floats above the footer, and the page's clearance keeps the last Play
  // content above it once scrolled to the bottom.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const launcherBox = (await control.boundingBox())!;
  const navBox = (await nav.boundingBox())!;
  const mainBox = (await page.locator("main").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(launcherBox.width).toBeGreaterThanOrEqual(44);
  expect(launcherBox.height).toBeGreaterThanOrEqual(44);
  expect(launcherBox.y + launcherBox.height).toBeLessThanOrEqual(navBox.y);
  expect(launcherBox.x + launcherBox.width).toBeLessThanOrEqual(viewport.width);
  expect(mainBox.y + mainBox.height).toBeLessThanOrEqual(launcherBox.y);
  await captureReviewScreenshot(page, `issue-245-launcher-${testInfo.project.name}.png`);

  // Opening it is a Drawer over the current surface, not a navigation.
  await openMapSurface(page);
  const mapUrl = page.url();
  await launcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("region", { name: "Conversations" })).toBeVisible();
  // No domain has populated it yet, so there is no pinned region to show.
  await expect(dialog.getByRole("region", { name: "Needs your attention" })).toHaveCount(0);
  expect(page.url()).toBe(mapUrl);
  // Let the Drawer's finite entrance fade settle so a review capture is final.
  await dialog.evaluate((element) =>
    Promise.all(
      (element.parentElement ?? element)
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  await captureReviewScreenshot(page, `issue-245-drawer-${testInfo.project.name}.png`);

  await dialog.getByRole("button", { name: "Close chat" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  expect(page.url()).toBe(mapUrl);
  await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
});

test("the stream reconnects after its deliberate close, and several tabs stay one stream each", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  const second = await page.context().newPage();
  await openTestCharacter(second, testCharacter.id);
  await expectLive(page);
  await expectLive(second);

  // Both tabs are independent streams; ending them (as the 5-minute lifetime
  // does) makes each tab re-authorize with a fresh request.
  const reconnects = [nextStreamRequest(page), nextStreamRequest(second)];
  expect(await closeStreams(page, testCharacter.id)).toBe(2);
  await Promise.all(reconnects);
  await expectLive(page);
  await expectLive(second);

  // Still exactly one stream per tab: reconnection never multiplies them.
  expect(await closeStreams(page, testCharacter.id)).toBe(2);
  await expectLive(page);
  await expectLive(second);
  await second.close();
});

test("a suspended, offline tab recovers its stream without a page failure", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  await expectLive(page);
  await page.evaluate(() => {
    (window as unknown as { __rsSameDocument: boolean }).__rsSameDocument = true;
  });

  // Phone sleep: the tab is hidden, the network goes away, and the server
  // side of the stream ends. Reconnect attempts fail and back off.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.context().setOffline(true);
  expect(await closeStreams(page, testCharacter.id)).toBe(1);
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "reconnecting");

  // Wake: the network returns and the tab is visible again.
  await page.context().setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectLive(page);

  // Same document, Play still usable, and exactly one stream again.
  expect(
    await page.evaluate(
      () => (window as unknown as { __rsSameDocument?: boolean }).__rsSameDocument,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /^Missions/ }).click();
  await expect(page.getByRole("dialog", { name: /Mission/ })).toBeVisible();
  expect(await closeStreams(page, testCharacter.id)).toBe(1);
});
