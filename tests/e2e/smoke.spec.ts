import { expect, test } from "@playwright/test";

/** Protects durable public landing identity and signed-out entry navigation. */

test("public landing loads with pre-alpha identity and entry actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RuneSpace" })).toBeVisible();
  await expect(page.getByText("Low-fi sci-fi RPG / Holo Hollow", { exact: true })).toBeVisible();
  await expect(page.getByText("Playable pre-alpha", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Register", exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Public" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Brandon", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/BDubDesigns",
  );
  await expect(page.getByRole("img", { name: /Location view/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /local Map view/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Journey view/ })).toBeVisible();
});

test("public landing stays contained on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const images = page.locator("main img");
  const count = await images.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let index = 0; index < count; index += 1) {
    const box = await images.nth(index).boundingBox();
    expect(box, `main image ${index} should have a layout box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
});
