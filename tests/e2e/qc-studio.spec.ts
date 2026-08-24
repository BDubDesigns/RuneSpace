import { expect, test } from "@playwright/test";

test.describe("QC Studio development dialogue module", () => {
  test.skip(!process.env.QC_STUDIO_ENABLED, "QC Studio is development-flagged.");

  test("loads, edits, previews, persists, and exports a local draft", async ({ page }) => {
    await page.goto("/qc-studio");
    await expect(page.getByRole("heading", { name: "Visual authoring environment" })).toBeVisible();
    await expect(page.locator('[data-qc-studio-beat="0"] [data-qc-studio-beat-number]')).toHaveText(
      "B1",
    );

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

  test("coalesces text edits into one undo and redo transaction", async ({ page }) => {
    await page.goto("/qc-studio");
    const text = page.getByLabel("Dialogue text");
    const original = await text.inputValue();
    const edited = `${original} Edited once.`;

    await text.fill(edited);
    await text.blur();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(text).toHaveValue(original);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(text).toHaveValue(edited);
  });

  test("keeps the desktop preview bounded beside the editor", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/qc-studio");

    const previewLayout = page.locator("[data-qc-studio-preview-layout]");
    const preview = previewLayout.locator("[data-qc-studio-preview-panel]");
    const editor = previewLayout.locator("[data-qc-studio-editor-panel]");
    const previewBox = await preview.boundingBox();
    const editorBox = await editor.boundingBox();

    expect(previewBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(previewBox?.width).toBeLessThanOrEqual(920);
    expect(editorBox!.x).toBeGreaterThanOrEqual(previewBox!.x + previewBox!.width);
    expect(editorBox!.x - (previewBox!.x + previewBox!.width)).toBeLessThanOrEqual(24);
  });

  test("preserves an unsupported future draft schema", async ({ page }) => {
    const storageKey = "qc-studio:runespace:dialogue:v1";
    const futureDraft = JSON.stringify({
      schemaVersion: 99,
      adapterId: "runespace",
      sentinel: "do-not-overwrite",
    });
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: storageKey,
      value: futureDraft,
    });

    await page.goto("/qc-studio");
    await expect(page.getByText(/newer saved draft format was found/i)).toBeVisible();
    await page.waitForTimeout(1_100);
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), storageKey))
      .toBe(futureDraft);
  });

  test("previews an action without invoking gameplay", async ({ page }) => {
    await page.goto("/qc-studio");
    await page.getByLabel("Load authoritative sequence").selectOption({
      label: "Tansy Rusk Walk It Off After Remote Acceptance",
    });
    await page.getByRole("button", { name: "Load source as draft" }).click();
    await page.locator('[data-qc-studio-beat="3"]').click();
    await page.getByRole("button", { name: "Accept mission", exact: false }).count();
    const action = page.locator("[data-qc-studio-preview-action]");
    await expect(action).toBeVisible();
    await action.click();
    await expect(
      page.getByText(/No mission, item, character, or database state changed/),
    ).toBeVisible();
  });
});
