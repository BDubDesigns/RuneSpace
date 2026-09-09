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
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(2);
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

for (const width of [390, 360, 320]) {
  test(`signed-out header nav (Home, Updates, Wiki) fits without scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    // The header never overflows the page itself.
    const header = page.getByRole("banner");
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox, "header should have a layout box").not.toBeNull();
    expect(headerBox!.x).toBeGreaterThanOrEqual(0);
    expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    // Below 390px, PublicSiteShell swaps the full RuneSpace lockup for the
    // compact R emblem so the Public nav strip (`overflow-x-auto`) has room
    // for Home, Updates, and Wiki without needing an internal scroll —
    // verify that directly, not just that the links exist somewhere.
    const nav = page.getByRole("navigation", { name: "Public" });
    await expect(nav).toBeVisible();
    const navScroll = await nav.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(navScroll.scrollWidth).toBeLessThanOrEqual(navScroll.clientWidth);

    for (const name of ["Home", "Updates", "Wiki"]) {
      const link = page.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box, `${name} should have a layout box`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  });
}

test("public header shows the compact emblem, not the full lockup, below 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 389, height: 844 });
  await page.goto("/");

  const brandLink = page.getByRole("link", { name: "RuneSpace home" });
  const images = brandLink.getByRole("img", { name: "RuneSpace", includeHidden: true });
  await expect(images).toHaveCount(2);
  await expect(images.first()).toBeHidden();
  await expect(images.last()).toBeVisible();
});

test("public header shows the full RuneSpace lockup at 390px and above", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const brandLink = page.getByRole("link", { name: "RuneSpace home" });
  const images = brandLink.getByRole("img", { name: "RuneSpace", includeHidden: true });
  await expect(images).toHaveCount(2);
  await expect(images.first()).toBeVisible();
  await expect(images.last()).toBeHidden();
});
