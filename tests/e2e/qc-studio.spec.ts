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

  test("discovers and migrates an untouched v1 draft under the v1 legacy key", async ({ page }) => {
    const v1Key = "qc-studio:runespace:dialogue:v1";
    const v1Draft = JSON.stringify({
      schemaVersion: 1,
      adapterId: "runespace",
      draft: {
        schemaVersion: 1,
        adapterId: "runespace",
        draftId: "draft-v1-untouched",
        title: "Untouched v1",
        npcId: "tansy_rusk",
        beats: [
          {
            speakerNpcId: "tansy_rusk",
            expressionId: "neutral",
            backgroundId: "the_jag_exterior",
            presentationMode: "local",
            text: "Legacy line.",
          },
        ],
      },
      checkpoints: [],
    });
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: v1Key,
      value: v1Draft,
    });

    await page.goto("/qc-studio");
    // The v1 draft is discovered through the legacy-key loop and migrated to
    // the current format; the draft content survives.
    await expect(page.getByText(/Upgraded the saved v1 draft/i)).toBeVisible();
    await expect(page.getByText("Untouched v1")).toBeVisible();
    // Migration persistence is proven by the v3 key holding a schema-v3 draft,
    // not by the legacy v1 key (which is retained only as a backup).
    const v3Key = "qc-studio:runespace:dialogue:v3";
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), v3Key))
      .not.toBeNull();
    const migratedRaw = await page.evaluate((key) => window.localStorage.getItem(key), v3Key);
    const migrated = JSON.parse(migratedRaw ?? "null");
    expect(migrated?.schemaVersion).toBe(3);
    expect(migrated?.draft?.title).toBe("Untouched v1");
    expect(migrated?.draft?.beats?.[0]?.kind).toBe("npc");
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

  test("authors and previews an item beat with authoritative quantity limits", async ({ page }) => {
    await page.goto("/qc-studio");
    await page.getByLabel("Load authoritative sequence").selectOption({
      label: "Tansy Rusk Walk It Off After Claim",
    });
    await page.getByRole("button", { name: "Load source as draft" }).click();

    // Beat 1 of the loaded source is the authored Cutter reveal.
    const itemSelect = page.getByLabel("Presented item");
    await expect(itemSelect).toHaveValue("salvage_cutter");
    const quantity = page.getByLabel("Quantity");
    await expect(quantity).toBeDisabled(); // unique items are locked to 1
    await expect(page.locator('[data-qc-studio-beat="0"]')).toContainText("Salvage Cutter");

    // Switching to a stackable item unlocks its authoritative quantity range.
    await itemSelect.selectOption({ label: "Ferrite Shale (stack up to 10)" });
    await expect(quantity).toBeEnabled();
    await expect(quantity).toHaveValue("1");
    await quantity.fill("3");
    await quantity.blur();
    await expect(quantity).toHaveValue("3");

    // Over-filling clamps back into the definition-derived range.
    await quantity.fill("99");
    await quantity.blur();
    await expect(quantity).toHaveValue("10");

    // The preview renders the actual production scene with the selected item.
    const previewScene = page.locator("[data-qc-studio-preview-panel]");
    await expect(previewScene.locator('[data-dialogue-subject="item"]')).toBeVisible();
    await expect(previewScene.locator("img[alt*='Tansy']")).toHaveCount(0);
    await expect(previewScene.locator("[data-dialogue-speaker-role]")).toContainText(
      "Ferrite Shale ×10",
    );

    // The structured export carries the item identity + quantity deterministically.
    await page.getByRole("button", { name: "Copy for RuneSpace" }).click();
    await expect(page.getByLabel("Structured export")).toContainText('"itemId": "ferrite_shale"');
    await expect(page.getByLabel("Structured export")).toContainText('"quantity": 10');

    // NPC beats keep their controls; switching subjects round-trips.
    await page.locator('[data-qc-studio-beat="1"]').click();
    await expect(page.locator("#qc-beat-speaker")).toBeVisible();
    await expect(page.locator("#qc-beat-item")).toHaveCount(0);
  });
});
