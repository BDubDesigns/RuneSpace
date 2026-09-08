import { expect, test } from "./fixtures";

test("signed-in visitors stay on the public homepage with a characters entry", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "RuneSpace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My characters", exact: true })).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "My characters", exact: true }).first(),
  ).toHaveAttribute("href", "/characters");
  await expect(page.getByRole("link", { name: "Register", exact: true })).toHaveCount(0);
});
