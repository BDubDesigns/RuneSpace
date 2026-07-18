import { expect, test } from "@playwright/test";

/**
 * Minimal app-loading smoke test.
 *
 * Asserts the scaffold renders and self-identifies as an early scaffold — no
 * gameplay, lore, or interactions. This is a small, reliable player-journey
 * anchor, not an exhaustive UI test.
 */

test("smoke screen loads and identifies as scaffold", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RuneSpace" })).toBeVisible();
  await expect(page.getByText("Development scaffold online.")).toBeVisible();
  await expect(page.getByText(/early foundation build, not a playable game/i)).toBeVisible();
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
});
