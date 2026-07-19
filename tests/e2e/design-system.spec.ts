import { expect, test } from "@playwright/test";

test("production build does not expose the development design-system preview", async ({ page }) => {
  test.skip(
    !!process.env.PLAYWRIGHT_DEV_SERVER,
    "This assertion runs against the production server.",
  );
  const response = await page.goto("/design-system");

  expect(response?.status()).toBe(404);
});

test("registration controls remain visible and focused without horizontal overflow", async ({
  page,
}) => {
  test.skip(
    !!process.env.PLAYWRIGHT_DEV_SERVER,
    "This control check runs against the production server.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/register");

  const register = page.getByRole("button", { name: "Create account" });
  await expect(register).toBeVisible();
  await register.focus();
  await expect(register).toBeFocused();
  await expect(register).toHaveCSS("outline-style", "solid");

  await page.getByLabel("Display name").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test.describe("development design-system preview", () => {
  test.skip(!process.env.PLAYWRIGHT_DEV_SERVER, "The preview is development-only.");

  test("bottom navigation is usable at narrow width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/design-system");

    const controls = page.getByRole("link", { name: "Controls" });
    await expect(controls).toBeVisible();
    await controls.focus();
    await expect(controls).toBeFocused();
    await expect(controls).toHaveCSS("outline-style", "solid");
    await controls.click();
    await expect(page).toHaveURL(/#controls$/);

    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });

  test("captures deterministic review screenshots", async ({ page }, testInfo) => {
    const viewport =
      testInfo.project.name === "mobile"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 };
    const fileName = testInfo.project.name === "mobile" ? "mobile.png" : "desktop.png";
    await page.setViewportSize(viewport);
    await page.goto("/design-system");
    await expect(page.getByRole("heading", { name: "Visual foundation" })).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({
      path: `docs/screenshots/issue-7/${fileName}`,
      fullPage: false,
      scale: "css",
    });
  });
});
