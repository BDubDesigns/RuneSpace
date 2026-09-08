import { expect, test } from "@playwright/test";

const updateSlug = "runespace-is-starting-to-feel-like-a-game";
const updateTitle = "RuneSpace Is Starting to Feel Like a Game";

test.describe("public Updates", () => {
  test("lists the latest Update and renders its article and patch notes", async ({ page }) => {
    await page.goto("/updates");

    await expect(page).toHaveTitle("Updates — RuneSpace");
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "Updates", exact: true })).toHaveAttribute(
      "href",
      "/updates",
    );
    await expect(page.getByRole("link", { name: updateTitle, exact: true })).toHaveAttribute(
      "href",
      `/updates/${updateSlug}`,
    );
    await expect(page.getByText("September 8, 2026", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: updateTitle, exact: true }).click();
    await expect(page).toHaveURL(`/updates/${updateSlug}`);
    await expect(page).toHaveTitle(`${updateTitle} — RuneSpace`);
    await expect(page.getByRole("heading", { name: updateTitle, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patch notes", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Added", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Changed", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fixed", level: 3 })).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `/updates/${updateSlug}`,
    );
  });

  test("returns a normal 404 for an unknown Update slug", async ({ page }) => {
    const response = await page.goto("/updates/not-a-real-update");

    expect(response?.status()).toBe(404);
  });

  test("keeps the article contained on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/updates/${updateSlug}`);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const image = page.getByRole("img", { name: /Location view/ });
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
