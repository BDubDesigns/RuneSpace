import { expect, test } from "@playwright/test";

/**
 * Minimal app-loading smoke test.
 *
 * Protects the landing page's durable identity, pre-alpha status, and entry
 * navigation — not a paragraph of marketing copy. The landing page is a
 * signed-out entry point that routes to registration / sign-in / characters.
 */

test("smoke screen loads with pre-alpha identity and entry actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RuneSpace" })).toBeVisible();
  const lockup = page.getByRole("img", { name: "RuneSpace" });
  await expect(lockup).toBeVisible();
  // The approved landing lockup (~h-14/sm:h-16) must stay contained within the
  // card at the default desktop viewport.
  const desktopBox = await lockup.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.x).toBeGreaterThanOrEqual(0);
  expect(desktopBox!.x + desktopBox!.width).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  // One durable pre-alpha status surface (exact match avoids the ambiguous
  // eyebrow/paragraph double-match of /pre-alpha/i).
  await expect(page.getByText("Playable pre-alpha — active development.")).toBeVisible();
  // Signed-out smoke: both entry actions are explicit (do not coalesce with My characters).
  await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("smoke screen is responsive on mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const card = page.locator("section").first();
  await expect(card).toBeVisible();
  // Card should not overflow the narrow viewport.
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(375);
  // The landing lockup stays contained inside the card at mobile width.
  const lockup = page.getByRole("img", { name: "RuneSpace" });
  const lockupBox = await lockup.boundingBox();
  expect(lockupBox).not.toBeNull();
  expect(lockupBox!.x).toBeGreaterThanOrEqual(box!.x);
  expect(lockupBox!.x + lockupBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
});
