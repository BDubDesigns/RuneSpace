import { expect, test } from "@playwright/test";

test.describe("QC Studio development dialogue module", () => {
  test.skip(!process.env.QC_STUDIO_ENABLED, "QC Studio is development-flagged.");

  test("loads, edits, previews, persists, and exports a local draft", async ({ page }) => {
    await page.goto("/qc-studio");
    await expect(page.getByRole("heading", { name: "Visual authoring environment" })).toBeVisible();

    const text = page.getByLabel("Dialogue text");
    await text.fill("Edited in QC Studio.");
    await text.blur();
    await expect(text).toHaveValue("Edited in QC Studio.");

    await page.getByRole("button", { name: "Add beat" }).click();
    await page.getByRole("button", { name: "Duplicate beat" }).click();
    await page.getByRole("button", { name: "Move beat up" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Redo" }).click();
    await page.getByLabel("Dialogue text").fill("Added beat text.");
    await page.getByLabel("Dialogue text").blur();
    await page.locator('[data-qc-studio-beat="2"]').click();
    await page.getByLabel("Dialogue text").fill("Duplicated beat text.");
    await page.getByLabel("Dialogue text").blur();
    await page.locator('[data-qc-studio-beat="0"]').click();
    await page.getByRole("button", { name: "Save checkpoint" }).click();
    await expect(page.getByText(/Saved a durable checkpoint locally/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Dialogue text")).toHaveValue("Edited in QC Studio.");
    await page.getByRole("button", { name: "Copy for RuneSpace" }).click();
    await expect(page.getByLabel("Structured export")).toContainText('"module": "dialogue"');
    await expect(page.getByText(/structured draft/)).toBeVisible();
  });

  test("previews an action without invoking gameplay", async ({ page }) => {
    await page.goto("/qc-studio");
    await page.getByLabel("Load authoritative sequence").selectOption({
      label: "Tansy Rusk Walk It Off After Remote Acceptance",
    });
    await page.getByRole("button", { name: "Load source as draft" }).click();
    await page.getByRole("button", { name: /Beat 4/ }).click();
    await page.getByRole("button", { name: "Accept mission", exact: false }).count();
    const action = page.locator("[data-qc-studio-preview-action]");
    await expect(action).toBeVisible();
    await action.click();
    await expect(
      page.getByText(/No mission, item, character, or database state changed/),
    ).toBeVisible();
  });
});
