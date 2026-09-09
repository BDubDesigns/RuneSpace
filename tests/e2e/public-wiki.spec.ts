import { expect, test } from "@playwright/test";

const articleSlug = "getting-started";
const articleTitle = "Getting Started";
const articleTitles = [
  "Getting Started",
  "Travel & Scavenging",
  "Mining & Refining",
  "Inventory & Equipment",
  "Power Cells",
  "Cargo Hold & Welding",
  "Missions",
  "Holo Hollow",
  "Skills & Progression",
];

test.describe("public Wiki", () => {
  test("lists every article and renders one with its sections", async ({ page }) => {
    await page.goto("/wiki");

    await expect(page).toHaveTitle("Wiki — RuneSpace");
    await expect(page.getByRole("heading", { name: "Wiki", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "Updates", exact: true })).toHaveAttribute(
      "href",
      "/updates",
    );
    await expect(page.getByRole("link", { name: "Wiki", exact: true })).toHaveAttribute(
      "href",
      "/wiki",
    );

    for (const title of articleTitles) {
      await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    }

    await page.getByRole("link", { name: articleTitle, exact: true }).click();
    await expect(page).toHaveURL(`/wiki/${articleSlug}`);
    await expect(page).toHaveTitle(`${articleTitle} — RuneSpace Wiki`);
    await expect(page.getByRole("heading", { name: articleTitle, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The early loop", level: 2 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `/wiki/${articleSlug}`,
    );
  });

  test("returns a normal 404 for an unknown Wiki slug", async ({ page }) => {
    const response = await page.goto("/wiki/not-a-real-article");

    expect(response?.status()).toBe(404);
  });

  test("keeps the article contained on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/wiki/${articleSlug}`);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
