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
 * fanout. This proves the parts only a browser can: the launcher rests flush to
 * the right edge, centred in the usable viewport through a rotation, without
 * reserving page space or colliding with the Map's destination panel, the
 * Drawer opens over
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

/**
 * The launcher's placement contract: a 44px target flush to the right edge,
 * vertically centred between the top of the viewport and the fixed nav, and
 * wholly on screen.
 */
async function expectEdgeCentred(page: Page) {
  const box = (await launcher(page).boundingBox())!;
  const navBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(viewport.width - (box.x + box.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - navBox.y / 2)).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(navBox.y);
  return box;
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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

  // It rests on the right edge, centred in the usable viewport, however far
  // the page is scrolled and through a rotation.
  await expectEdgeCentred(page);
  await captureReviewScreenshot(page, `issue-245-launcher-${testInfo.project.name}.png`);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await expectEdgeCentred(page);
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectEdgeCentred(page);

  // It reserves no page space: at the document's end the content keeps the
  // ordinary shared space-3 gap above the footer, with no parking strip.
  const bottom = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.height = "var(--rs-space-3)";
    document.body.append(probe);
    const gap = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      gap,
      contentBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
      navTop: document.querySelector('nav[aria-label="Primary"]')!.getBoundingClientRect().top,
    };
  });
  expect(Math.abs(bottom.navTop - bottom.contentBottom - bottom.gap)).toBeLessThanOrEqual(2);

  // The Map's sticky selected-destination panel keeps its own bottom
  // position and never meets the launcher: Walk stays clickable.
  await openMapSurface(page);
  const yard = page.getByRole("button", { name: /Abandoned Processing Yard/ }).first();
  await yard.scrollIntoViewIfNeeded();
  await yard.click();
  const panel = page.locator("[data-map-destination-panel]");
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  expect(intersects(panelBox, await expectEdgeCentred(page))).toBe(false);
  await panel
    .getByRole("button", { name: "Walk to Abandoned Processing Yard — 24 sec" })
    .click({ trial: true });

  // Opening it is a Drawer over the current surface, not a navigation.
  const mapUrl = page.url();
  await launcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // The conversation region holds General and Trade (#246).
  await expect(
    dialog
      .getByRole("region", { name: "Conversations" })
      .getByRole("tablist", { name: "Public chat channels" }),
  ).toBeVisible();
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
  await expect(panel).toBeVisible();
});

/**
 * Drive the live Play tab's real `SocialContext` — the seam downstream
 * features will call — from the browser. No production feature raises
 * attention or pins a card until #246/#247/#225, and the app has no test-only
 * path for it, so this finds the context value on the launcher's React fiber
 * (property names survive minification) and calls its public methods.
 */
async function callSocialSeam(
  page: Page,
  call: { attention?: [string, number]; card?: { key: string; label: string; text: string } },
) {
  await page.locator("[data-chat-social-launcher]").evaluate((element, request) => {
    type Seam = {
      setAttention: (source: string, count: number) => void;
      upsertCard: (card: { key: string; label: string; content: string }) => void;
    };
    type Fiber = { return: Fiber | null; memoizedProps?: { value?: Partial<Seam> } };
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    let fiber = key ? (element as unknown as Record<string, Fiber>)[key]! : null;
    while (fiber && typeof fiber.memoizedProps?.value?.setAttention !== "function") {
      fiber = fiber.return;
    }
    const seam = fiber?.memoizedProps?.value as Seam | undefined;
    if (!seam) throw new Error("SocialContext not found");
    if (request.attention) seam.setAttention(...request.attention);
    if (request.card) {
      seam.upsertCard({
        key: request.card.key,
        label: request.card.label,
        content: request.card.text,
      });
    }
  }, call);
}

test("attention and pinned cards render accessibly through the real seam", async ({
  page,
  testCharacter,
}, testInfo) => {
  await openTestCharacter(page, testCharacter.id);
  await expectLive(page);

  await callSocialSeam(page, { attention: ["e2e-source", 2] });
  // Setting the same count again (a duplicate delivery) changes nothing.
  await callSocialSeam(page, { attention: ["e2e-source", 2] });
  const control = page.getByRole("button", { name: "Chat, 2 items need attention" });
  await expect(control).toBeVisible();
  const badge = control.locator("[data-chat-social-attention]");
  await expect(badge).toHaveText("2");
  await expect(badge).toHaveAttribute("aria-hidden", "true");

  const controlBox = (await control.boundingBox())!;
  const badgeBox = (await badge.boundingBox())!;
  const navBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
  // The badge sits inside the button's own top-right corner, so the bevel
  // never clips it, and the control still clears the footer.
  expect(badgeBox.x).toBeGreaterThanOrEqual(controlBox.x + controlBox.width / 2);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(controlBox.x + controlBox.width);
  expect(badgeBox.y).toBeGreaterThanOrEqual(controlBox.y);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(controlBox.y + controlBox.height / 2);
  expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(navBox.y);
  // The halo is painted by the unclipped wrapper, not the beveled button.
  expect(
    await control.evaluate((button) => getComputedStyle(button.parentElement!).boxShadow),
  ).not.toBe("none");
  await captureReviewScreenshot(page, `issue-245-attention-${testInfo.project.name}.png`);

  // A domain-owned card is pinned above conversations and adds to attention;
  // the same card delivered twice is still one card.
  const card = { key: "e2e-card:1", label: "Example actionable card", text: "Needs a response" };
  await callSocialSeam(page, { card });
  await callSocialSeam(page, { card });
  const withCard = page.getByRole("button", { name: "Chat, 3 items need attention" });
  await expect(withCard).toBeVisible();
  await withCard.click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  const pinned = dialog.getByRole("region", { name: "Needs your attention" });
  await expect(pinned.getByRole("listitem")).toHaveCount(1);
  await expect(pinned.getByRole("listitem", { name: "Example actionable card" })).toHaveText(
    "Needs a response",
  );
  const pinnedBox = (await pinned.boundingBox())!;
  const conversationsBox = (await dialog
    .getByRole("region", { name: "Conversations" })
    .boundingBox())!;
  expect(pinnedBox.y + pinnedBox.height).toBeLessThanOrEqual(conversationsBox.y);
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
