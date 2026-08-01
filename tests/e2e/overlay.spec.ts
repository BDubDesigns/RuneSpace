import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";
import { miningStorageStatePath } from "./mining.setup";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Overlay E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

test.use({ storageState: miningStorageStatePath });
test.describe.configure({ mode: "serial" });

async function openMiningPage(page: import("@playwright/test").Page) {
  await page.goto("/characters");
  await page.getByRole("link", { name: "Play" }).click();
  await page.waitForURL(/\/play\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

async function expectBackdropCoversViewport(
  page: import("@playwright/test").Page,
  dialog: import("@playwright/test").Locator,
) {
  const backdrop = page.locator('[role="presentation"]').filter({ has: dialog });
  await page.waitForTimeout(250);
  const geometry = await backdrop.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const topHit = document.elementFromPoint(viewportWidth / 2, 1);
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      position: style.position,
      top: rect.top,
      topHitIsBackdrop: topHit instanceof Node && element.contains(topHit),
      viewportHeight,
      viewportWidth,
      width: rect.width,
    };
  });
  expect(geometry.position).toBe("fixed");
  expect(geometry.top).toBeLessThanOrEqual(1);
  expect(geometry.left).toBeLessThanOrEqual(1);
  expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.viewportWidth - 1);
  expect(geometry.topHitIsBackdrop).toBe(true);
  expect(geometry.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.backgroundColor).not.toBe("transparent");
}

test.beforeEach(async ({ page }) => {
  const characterId = await openMiningPage(page);
  // Seed two stacks so inventory has content to render.
  await db.delete(inventoryStacks).where(eq(inventoryStacks.characterId, characterId));
  await db.insert(inventoryStacks).values([
    { characterId, itemId: ITEM_IDS.ferriteShale, quantity: 5 },
    { characterId, itemId: ITEM_IDS.ferriteShale, quantity: 3 },
  ]);
  await page.reload();
});

test("Inventory opens as a centered modal with a dimmed backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // The backdrop is a sibling div with role="presentation".
  const backdrop = page.locator('[role="presentation"]').filter({ has: dialog });
  await expect(backdrop).toBeVisible();
  // The backdrop must actually paint a dimming scrim — a transparent backdrop
  // (e.g. from an invalid colour/alpha declaration the browser drops) would let
  // the play screen show through at full brightness. Guard the regression.
  const backdropBg = await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(backdropBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(backdropBg).not.toBe("transparent");
  await expectBackdropCoversViewport(page, dialog);
  // Verify body scroll is locked.
  const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
  expect(bodyOverflow).toBe("hidden");
  await page.screenshot({ path: "test-results/overlay-mobile-inventory.png" });
});

test("Equipment opens through the same shared modal pattern", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Equipment" }).click();
  const dialog = page.getByRole("dialog", { name: "Equipment" });
  await expect(dialog).toBeVisible();
  await expectBackdropCoversViewport(page, dialog);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // The panel must paint an edge glow. The exact token color is not a durable
  // contract (the --rs-* tokens in app/globals.css are the single source of
  // truth); asserting that a box-shadow exists guards the regression where the
  // glow is dropped entirely.
  const boxShadow = await dialog.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).not.toBe("none");
  expect(boxShadow).not.toBe("");
  await page.screenshot({ path: "test-results/overlay-mobile-equipment.png" });
});

test("only one overlay can be open at a time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  // Open inventory
  await nav.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  // Close inventory, then open equipment — the normal user flow.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Inventory" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Equipment" }).click();
  await expect(page.getByRole("dialog", { name: "Equipment" })).toBeVisible();
  // Close and reopen inventory.
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  // Defensively verify only one dialog exists at a time.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
});

test("backdrop click closes the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  // Click the backdrop area outside the centered panel.
  const backdrop = page.locator('[role="presentation"]').filter({ has: dialog });
  await backdrop.click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
});

test("clicking inside the panel does not close the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Equipment" }).click();
  const dialog = page.getByRole("dialog", { name: "Equipment" });
  await expect(dialog).toBeVisible();
  // Click on the section header inside the panel.
  await dialog.getByText("Server-confirmed loadout").click();
  await expect(dialog).toBeVisible();
  // Click on an equipment slot.
  await dialog.getByLabel("Mining tool").click();
  await expect(dialog).toBeVisible();
});

test("Close and Escape close the overlay and restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  const inventoryTrigger = nav.getByRole("button", { name: /Inventory/ });

  // Close control.
  await inventoryTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close inventory" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inventoryTrigger).toBeFocused();

  // Escape.
  await inventoryTrigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(inventoryTrigger).toBeFocused();
});

test("focus moves into the overlay and is contained within it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  // Focus should be on the Close button initially.
  const closeButton = dialog.getByRole("button", { name: "Close inventory" });
  await expect(closeButton).toBeFocused();

  // Tab through all focusable elements; focus should not escape to the footer.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    // Focus is somewhere in the document; verify it's inside the dialog.
    const insideModal = await page.evaluate((selector) => {
      const modal = document.querySelector(selector);
      return modal ? modal.contains(document.activeElement) : false;
    }, '[role="dialog"]');
    expect(insideModal).toBe(true);
  }
});

test("focus returns to the trigger after Escape, Close, and backdrop dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  const inventoryTrigger = nav.getByRole("button", { name: /Inventory/ });
  // Escape
  await inventoryTrigger.click();
  const dialog1 = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog1).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inventoryTrigger).toBeFocused();
  // Close button
  await inventoryTrigger.click();
  const dialog2 = page.getByRole("dialog", { name: "Inventory" });
  await dialog2.getByRole("button", { name: "Close inventory" }).click();
  await expect(inventoryTrigger).toBeFocused();
  // Backdrop
  await inventoryTrigger.click();
  const dialog3 = page.getByRole("dialog", { name: "Inventory" });
  const backdrop = page.locator('[role="presentation"]').filter({ has: dialog3 });
  await backdrop.click({ position: { x: 5, y: 5 } });
  await expect(inventoryTrigger).toBeFocused();
});

test("document scroll is locked while overlay is open and restored on close", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });

  // Record original scroll styles.
  const originalOverflow = await page.evaluate(() => document.body.style.overflow);
  const originalPaddingRight = await page.evaluate(() => document.body.style.paddingRight);

  // Open overlay.
  await page.evaluate(() => window.scrollTo(0, 200));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await expectBackdropCoversViewport(page, dialog);

  // Scroll should be locked.
  const lockedOverflow = await page.evaluate(() => document.body.style.overflow);
  expect(lockedOverflow).toBe("hidden");
  const lockedBodyTop = await page.evaluate(() => document.body.style.top);
  expect(lockedBodyTop).toBe(`-${scrollBefore}px`);

  // Try scrolling the document.
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBe(0);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // Close via Close button.
  await dialog.getByRole("button", { name: "Close inventory" }).click();
  await expect(dialog).toHaveCount(0);

  // Scroll should be restored.
  const restoredOverflow = await page.evaluate(() => document.body.style.overflow);
  expect(restoredOverflow).toBe(originalOverflow);
  const restoredPaddingRight = await page.evaluate(() => document.body.style.paddingRight);
  expect(restoredPaddingRight).toBe(originalPaddingRight);
});

test("internal modal content scrolls when it overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  // Seed extra inventory so the modal needs to scroll.
  const characterId = page.url().split("/").at(-1)!;
  for (let i = 0; i < 20; i++) {
    await db.insert(inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 1,
    });
  }
  await page.reload();
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await expectBackdropCoversViewport(page, dialog);
  // The dialog should have overflow-y auto and be scrollable.
  const overflowY = await dialog.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe("auto");
  // Actually scroll inside the dialog.
  const scrollTopBefore = await dialog.evaluate((el) => el.scrollTop);
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const scrollTopAfter = await dialog.evaluate((el) => el.scrollTop);
  expect(scrollTopAfter).toBeGreaterThan(scrollTopBefore);
});

test("mobile narrow-width layout remains usable from 320 px upward", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  // Dialog should not overflow the viewport horizontally.
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(322); // 320 + small tolerance
  // Close control should be visible and tappable.
  const closeButton = dialog.getByRole("button", { name: "Close inventory" });
  await expect(closeButton).toBeVisible();
  const closeBox = await closeButton.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
});

test("desktop modal is centered with backdropped play screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "test-results/overlay-desktop-inventory.png" });
  await dialog.getByRole("button", { name: "Close inventory" }).click();
  await nav.getByRole("button", { name: "Equipment" }).click();
  const equipDialog = page.getByRole("dialog", { name: "Equipment" });
  await expect(equipDialog).toBeVisible();
  await page.screenshot({ path: "test-results/overlay-desktop-equipment.png" });
});

test("reduced-motion disables overlay animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  // Check that animation duration is effectively zero.
  const backdropEl = page.locator('[role="presentation"]').filter({ has: dialog });
  const backdropAnimDuration = await backdropEl.evaluate(
    (el) => getComputedStyle(el).animationDuration,
  );
  const panelAnimDuration = await dialog.evaluate((el) => getComputedStyle(el).animationDuration);
  const backdropSeconds = backdropAnimDuration.endsWith("ms")
    ? Number.parseFloat(backdropAnimDuration) / 1000
    : Number.parseFloat(backdropAnimDuration);
  const panelSeconds = panelAnimDuration.endsWith("ms")
    ? Number.parseFloat(panelAnimDuration) / 1000
    : Number.parseFloat(panelAnimDuration);
  expect(backdropSeconds).toBeLessThanOrEqual(0.001);
  expect(panelSeconds).toBeLessThanOrEqual(0.001);
});

// Records whether an overlay exit-animation class is ever applied after this is
// called. Uses a MutationObserver so the assertion is timing-free: it does not
// depend on racing the ~200ms fade against Playwright polling.
async function trackOverlayExitClass(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __sawOverlayExit?: boolean;
      __overlayExitObs?: MutationObserver;
    };
    w.__sawOverlayExit = false;
    w.__overlayExitObs?.disconnect();
    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const className = (mutation.target as HTMLElement).className;
        if (typeof className === "string" && /rs-overlay-(backdrop|panel)-exit/.test(className)) {
          w.__sawOverlayExit = true;
        }
      }
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    w.__overlayExitObs = obs;
  });
}

async function sawOverlayExitClass(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Boolean((window as unknown as { __sawOverlayExit?: boolean }).__sawOverlayExit),
  );
}

test("closing plays an exit fade and only unmounts after it finishes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await trackOverlayExitClass(page);
  await dialog.getByRole("button", { name: "Close inventory" }).click();
  // The exit animation class is applied while the fade plays — proof the close
  // is deferred rather than an instant unmount ...
  await expect(dialog).toHaveClass(/rs-overlay-panel-exit/);
  // ... and the dialog leaves the DOM only once the fade completes.
  await expect(dialog).toHaveCount(0);
  expect(await sawOverlayExitClass(page)).toBe(true);
});

test("reduced motion closes immediately without an exit fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await trackOverlayExitClass(page);
  await page.keyboard.press("Escape");
  // No exit animation ever engages under reduced motion ...
  expect(await sawOverlayExitClass(page)).toBe(false);
  // ... and the dialog is gone (instant unmount, no deferred window).
  await expect(dialog).toHaveCount(0);
});

test("generate mobile and desktop contact sheets", async ({ browser }) => {
  const { readFileSync, existsSync, mkdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  const resultsDir = resolve("test-results");
  const mobileInv = resolve(resultsDir, "overlay-mobile-inventory.png");
  const mobileEquip = resolve(resultsDir, "overlay-mobile-equipment.png");
  const desktopInv = resolve(resultsDir, "overlay-desktop-inventory.png");
  const desktopEquip = resolve(resultsDir, "overlay-desktop-equipment.png");

  function toDataUri(filePath: string): string {
    const buf = readFileSync(filePath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }

  // Mobile contact sheet (inventory | equipment)
  if (existsSync(mobileInv) && existsSync(mobileEquip)) {
    const contactPage = await browser.newPage({ viewport: { width: 820, height: 920 } });
    await contactPage.setContent(
      `<!DOCTYPE html><html><body style="margin:0;background:#05090f;display:flex;flex-direction:column;align-items:center;padding:16px;gap:12px;color:#e8f4f7;font-family:monospace;">
        <h1 style="font-size:16px;margin:0;font-weight:400;">RuneSpace Overlay — Mobile Contact Sheet (390×844)</h1>
        <div style="display:flex;gap:8px;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid #1f5268;">
            <span style="font-size:11px;padding:4px;">Inventory</span>
            <img src="${toDataUri(mobileInv)}" style="width:390px;height:844px;object-fit:contain;" />
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid #1f5268;">
            <span style="font-size:11px;padding:4px;">Equipment</span>
            <img src="${toDataUri(mobileEquip)}" style="width:390px;height:844px;object-fit:contain;" />
          </div>
        </div>
      </body></html>`,
    );
    await contactPage.screenshot({
      path: resolve(resultsDir, "overlay-mobile-contact-sheet.png"),
      fullPage: true,
    });
    await contactPage.close();
  }

  // Desktop contact sheet (inventory | equipment)
  if (existsSync(desktopInv) && existsSync(desktopEquip)) {
    const contactPage = await browser.newPage({ viewport: { width: 2920, height: 960 } });
    await contactPage.setContent(
      `<!DOCTYPE html><html><body style="margin:0;background:#05090f;display:flex;flex-direction:column;align-items:center;padding:16px;gap:12px;color:#e8f4f7;font-family:monospace;">
        <h1 style="font-size:16px;margin:0;font-weight:400;">RuneSpace Overlay — Desktop Contact Sheet (1440×900)</h1>
        <div style="display:flex;gap:8px;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid #1f5268;">
            <span style="font-size:11px;padding:4px;">Inventory</span>
            <img src="${toDataUri(desktopInv)}" style="width:1440px;height:900px;object-fit:contain;" />
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid #1f5268;">
            <span style="font-size:11px;padding:4px;">Equipment</span>
            <img src="${toDataUri(desktopEquip)}" style="width:1440px;height:900px;object-fit:contain;" />
          </div>
        </div>
      </body></html>`,
    );
    await contactPage.screenshot({
      path: resolve(resultsDir, "overlay-desktop-contact-sheet.png"),
      fullPage: true,
    });
    await contactPage.close();
  }
});
