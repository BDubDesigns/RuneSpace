import { expect, test } from "@playwright/test";

/** Protects durable public landing identity and signed-out entry navigation. */

test("public landing loads with pre-alpha identity and entry actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RuneSpace", exact: true })).toBeVisible();
  await expect(page.getByText("Low-fi sci-fi RPG / Holo Hollow", { exact: true })).toBeVisible();
  await expect(page.getByText("Playable pre-alpha", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Register", exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Public" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Updates", exact: true })).toHaveAttribute(
    "href",
    "/updates",
  );
  await expect(page.getByRole("link", { name: "Wiki", exact: true })).toHaveAttribute(
    "href",
    "/wiki",
  );
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

test("signed-out header nav (Home, Updates, Wiki) and entry action stay usable on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  // The header never overflows the page itself — this is the actual contract
  // for "no horizontal page overflow" at narrow widths.
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  const headerBox = await header.boundingBox();
  expect(headerBox, "header should have a layout box").not.toBeNull();
  expect(headerBox!.x).toBeGreaterThanOrEqual(0);
  expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // The Public nav is intentionally its own horizontally scrollable strip
  // (`overflow-x-auto` in PublicSiteShell) rather than something that pushes
  // the page wider — Home, Updates, and Wiki all stay present and reachable
  // by scrolling the strip, even when they don't all fit unscrolled.
  const nav = page.getByRole("navigation", { name: "Public" });
  await expect(nav).toBeVisible();
  for (const name of ["Home", "Updates", "Wiki"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(1);
  }
  const wikiLink = page.getByRole("link", { name: "Wiki", exact: true });
  await wikiLink.scrollIntoViewIfNeeded();
  await expect(wikiLink).toBeInViewport();

  // The primary entry action sits outside the scrollable nav strip and must
  // always be fully visible without any scrolling.
  const signIn = page.getByRole("link", { name: "Sign in", exact: true }).first();
  await expect(signIn).toBeVisible();
  const signInBox = await signIn.boundingBox();
  expect(signInBox, "Sign in should have a layout box").not.toBeNull();
  expect(signInBox!.x).toBeGreaterThanOrEqual(0);
  expect(signInBox!.x + signInBox!.width).toBeLessThanOrEqual(390);
});
