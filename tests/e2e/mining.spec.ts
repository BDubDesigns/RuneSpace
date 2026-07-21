import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, inventoryStacks } from "@/db/rune-space";
import { ITEM_IDS } from "@/game/config/foundations";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error("Mining E2E fixtures require a disposable localhost PostgreSQL database");
  }
});

function uniqueEmail() {
  return `miner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("owned character can start, observe, stop, and restore Crash Site Mining", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Mining Pilot");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page
    .getByLabel("Character name")
    .fill(`Ore Runner ${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole("button", { name: "Create character" }).click();

  await expect(page.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText(/Salvage Cutter and MYKEA SCHLEPPRAUM-8 equipped/)).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  const characterId = page.url().split("/").at(-1)!;
  // The test process seeds the pre-existing full stack; the app still resolves
  // the next success/failure and creates the second stack through server rules.
  await db.insert(inventoryStacks).values({
    characterId,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 10,
  });
  const twoAttemptsAgo = new Date(Date.now() - 12_100);
  await db
    .update(activeActions)
    .set({ startedAt: twoAttemptsAgo, resolvedThroughAt: twoAttemptsAgo })
    .where(eq(activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("This mining run")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await expect(page.getByText("1 successful", { exact: true })).toBeVisible();
  await expect(page.getByText("1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("1 shale gained", { exact: true })).toBeVisible();
  await expect(page.getByText("15 Mining XP", { exact: true })).toBeVisible();
  const history = page.getByLabel("Latest mining attempts");
  await expect(history).toContainText("Attempt 2 - Failed");
  await expect(history).toContainText("Attempt 1 - Success");
  await expect(history).toContainText("Roll 35.00 | Needed below 35.00");
  await expect(history).toContainText("Missed by 0.01");
  await expect(history).toContainText("Roll 0.00 | Needed below 35.00");
  await page.screenshot({ path: "test-results/mining-mobile-active-viewport.png" });
  await page.getByText("This mining run").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mining-mobile-run-history-viewport.png" });
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByText("2 occupied / 8 slots")).toBeVisible();
  await expect(inventory.getByText("Ferrite Shale", { exact: true })).toHaveCount(2);
  const ferriteArtwork = inventory.getByTestId("item-artwork");
  await expect(ferriteArtwork).toHaveCount(2);
  await expect
    .poll(() =>
      ferriteArtwork.first().evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  const artworkState = await ferriteArtwork.first().evaluate((image) => ({
    assetPath: new URL(image.currentSrc).searchParams.get("url"),
    complete: image.complete,
    naturalWidth: image.naturalWidth,
  }));
  expect(artworkState.assetPath).toBe("/item-art/ferrite-shale.webp");
  expect(artworkState.complete).toBe(true);
  expect(artworkState.naturalWidth).toBeGreaterThan(0);
  await expect(ferriteArtwork.first()).toHaveCSS("object-fit", "contain");
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await expect(inventory.getByText("x1", { exact: true })).toBeVisible();
  const firstSlot = inventory.locator("article").first();
  const firstSlotName = firstSlot.getByText("Ferrite Shale", { exact: true });
  const firstSlotQuantity = firstSlot.getByText("x10", { exact: true });
  await expect(firstSlotName).toHaveCSS("background-color", "rgba(9, 21, 34, 0.9)");
  await expect(firstSlotName).toHaveCSS("white-space", "nowrap");
  await expect(firstSlotName).toHaveCSS("text-overflow", "ellipsis");
  await expect(firstSlotQuantity).toHaveCSS("background-color", "rgba(9, 21, 34, 0.42)");
  await expect(firstSlotQuantity).toHaveCSS("border-top-color", "rgba(75, 216, 245, 0.2)");
  const [slotBox, artworkBox] = await Promise.all([
    firstSlot.boundingBox(),
    ferriteArtwork.first().boundingBox(),
  ]);
  expect(slotBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(
    Math.abs(slotBox!.x + slotBox!.width / 2 - (artworkBox!.x + artworkBox!.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(slotBox!.y + slotBox!.height / 2 - (artworkBox!.y + artworkBox!.height / 2)),
  ).toBeLessThanOrEqual(1);
  await expect(inventory.locator("[data-stack-track]")).toHaveCount(2);
  const [nameBox, trackBox] = await Promise.all([
    firstSlotName.boundingBox(),
    inventory.locator("[data-stack-track]").first().boundingBox(),
  ]);
  expect(nameBox).not.toBeNull();
  expect(trackBox).not.toBeNull();
  expect(nameBox!.x - (trackBox!.x + trackBox!.width)).toBeGreaterThanOrEqual(4);
  expect(
    Math.abs(nameBox!.y + nameBox!.height - (slotBox!.y + slotBox!.height)),
  ).toBeLessThanOrEqual(1);
  await expect(inventory.locator('[data-stack-fill="100"]')).toBeVisible();
  await expect(inventory.locator('[data-stack-fill="10"]')).toBeVisible();
  await expect(inventory.locator("[data-stack-fill]")).toHaveCount(2);
  const fullFill = await inventory.locator('[data-stack-fill="100"]').evaluate((fill) => {
    const track = fill.parentElement!;
    const slot = track.parentElement!;
    const fillBox = fill.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    return {
      fraction: fillBox.height / trackBox.height,
      background: getComputedStyle(fill).backgroundColor,
      fillBottom: fillBox.bottom,
      fillWidth: fillBox.width,
      trackBackground: getComputedStyle(track).backgroundColor,
      trackBottom: trackBox.bottom,
      trackLeft: trackBox.left,
      trackTop: trackBox.top,
      trackWidth: trackBox.width,
      slotLeft: slotBox.left,
      slotBottom: slotBox.bottom,
      slotTop: slotBox.top,
      slotWidth: slotBox.width,
      trackZIndex: getComputedStyle(track).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  const partialFill = await inventory.locator('[data-stack-fill="10"]').evaluate((fill) => {
    const track = fill.parentElement!;
    const slot = track.parentElement!;
    const fillBox = fill.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    return {
      fraction: fillBox.height / trackBox.height,
      background: getComputedStyle(fill).backgroundColor,
      fillBottom: fillBox.bottom,
      fillWidth: fillBox.width,
      trackBottom: trackBox.bottom,
      trackLeft: trackBox.left,
      trackTop: trackBox.top,
      trackWidth: trackBox.width,
      slotLeft: slotBox.left,
      slotBottom: slotBox.bottom,
      slotTop: slotBox.top,
      slotWidth: slotBox.width,
      trackZIndex: getComputedStyle(track).zIndex,
      textZIndex: getComputedStyle(slot.querySelector("p")!).zIndex,
    };
  });
  expect(fullFill.fraction).toBeGreaterThan(0.95);
  expect(fullFill.background).toBe("rgb(245, 196, 81)");
  expect(fullFill.trackBackground).toBe("rgba(245, 196, 81, 0.14)");
  expect(fullFill.fillWidth).toBe(8);
  expect(fullFill.trackWidth).toBe(8);
  expect(Math.abs(fullFill.trackLeft - fullFill.slotLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.trackTop - fullFill.slotTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.trackBottom - fullFill.slotBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullFill.fillBottom - fullFill.trackBottom)).toBeLessThanOrEqual(1);
  expect(fullFill.trackWidth).toBeLessThan(fullFill.slotWidth);
  expect(fullFill.trackZIndex).toBe("0");
  expect(fullFill.textZIndex).toBe("20");
  expect(partialFill.fraction).toBeGreaterThan(0.08);
  expect(partialFill.fraction).toBeLessThan(0.12);
  expect(partialFill.background).toBe("rgb(245, 196, 81)");
  expect(partialFill.fillWidth).toBe(8);
  expect(partialFill.trackWidth).toBe(8);
  expect(Math.abs(partialFill.trackLeft - partialFill.slotLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.trackTop - partialFill.slotTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.trackBottom - partialFill.slotBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(partialFill.fillBottom - partialFill.trackBottom)).toBeLessThanOrEqual(1);
  expect(partialFill.trackWidth).toBeLessThan(partialFill.slotWidth);
  expect(partialFill.trackZIndex).toBe("0");
  expect(partialFill.textZIndex).toBe("20");
  await expect(inventory.getByLabel(/Empty inventory slot/)).toHaveCount(6);
  await page.screenshot({ path: "test-results/mining-mobile-inventory-10-plus-1.png" });
  await page.getByRole("button", { name: "Close inventory" }).click();
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  const inventoryToolbar = page.getByRole("button", { name: "Inventory 2/8" }).locator("..");
  const backToCharacters = page.getByRole("link", { name: "Back to characters" });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(history).toBeVisible();
  await expect(inventoryToolbar).toBeVisible();
  await expect(backToCharacters).toBeVisible();
  const [historyBox, toolbarBox, backLinkBox] = await Promise.all([
    history.boundingBox(),
    inventoryToolbar.boundingBox(),
    backToCharacters.boundingBox(),
  ]);
  expect(historyBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(backLinkBox).not.toBeNull();
  expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(toolbarBox!.y);
  expect(backLinkBox!.y - (toolbarBox!.y + toolbarBox!.height)).toBeGreaterThanOrEqual(0);
  expect(backLinkBox!.y - (toolbarBox!.y + toolbarBox!.height)).toBeLessThan(48);
  expect(backLinkBox!.y).toBeGreaterThanOrEqual(0);
  expect(844 - (backLinkBox!.y + backLinkBox!.height)).toBeLessThan(64);
  expect(backLinkBox!.y + backLinkBox!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/mining-mobile-page-bottom.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(inventoryToolbar).toHaveCSS("position", "fixed");
  await page.getByRole("button", { name: "Inventory 2/8" }).click();
  await expect(inventory.getByText("x10", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mining-desktop-inventory-10-plus-1.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Inventory 2/8" })).toBeFocused();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeVisible();
  await expect(page.getByText("2 attempts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await expect(page.getByText("Mining stopped.")).toBeHidden();
  await expect(page.getByText("0 attempts", { exact: true })).toBeVisible();
  await expect(history).toContainText("No resolved attempts in this run yet.");
});

test("an interrupted Mining action preserves confirmed state and retries only status refresh", async ({
  page,
}) => {
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Recovery Pilot");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page
    .getByLabel("Character name")
    .fill(`Recovery ${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole("button", { name: "Create character" }).click();

  const isMiningAction = (request: import("@playwright/test").Request) =>
    request.method() === "POST" && Boolean(request.headers()["next-action"]);
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  const baselineRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const refreshActionId = (await baselineRequest).headers()["next-action"];
  expect(refreshActionId).toBeTruthy();

  let aborted = false;
  let miningRequests = 0;
  page.on("request", (request) => {
    if (isMiningAction(request)) miningRequests += 1;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      !aborted &&
      isMiningAction(request) &&
      request.headers()["next-action"] === refreshActionId
    ) {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeVisible();
  await expect(page.getByText(/Success chance: 35.00%/)).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(aborted).toBe(true);
  expect(miningRequests).toBe(1);

  await page.unroute("**/*");
  const recoveredRequest = page.waitForRequest(
    (request) => isMiningAction(request) && request.headers()["next-action"] === refreshActionId,
  );
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await recoveredRequest;
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeHidden();
  await expect(retry).toHaveCount(0);
  expect(miningRequests).toBe(2);
});

test("an uncertain Start retries status refresh without replaying the mutation", async ({
  page,
}) => {
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Start Recovery Pilot");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page
    .getByLabel("Character name")
    .fill(`Start Recovery ${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole("button", { name: "Create character" }).click();

  const isMiningAction = (request: import("@playwright/test").Request) =>
    request.method() === "POST" && Boolean(request.headers()["next-action"]);
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  const startRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Start Mining" }).click();
  const startActionId = (await startRequest).headers()["next-action"];
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  await page.getByRole("button", { name: "Stop Mining" }).click();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  const refreshRequest = page.waitForRequest(isMiningAction);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const refreshActionId = (await refreshRequest).headers()["next-action"];
  expect(startActionId).toBeTruthy();
  expect(refreshActionId).toBeTruthy();
  expect(refreshActionId).not.toBe(startActionId);

  const actionIds: string[] = [];
  page.on("request", (request) => {
    if (isMiningAction(request)) actionIds.push(request.headers()["next-action"]!);
  });
  let aborted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!aborted && isMiningAction(request) && request.headers()["next-action"] === startActionId) {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(aborted).toBe(true);
  expect(actionIds).toEqual([startActionId]);

  await page.unroute("**/*");
  const recoveredRequest = page.waitForRequest(
    (request) => isMiningAction(request) && request.headers()["next-action"] === refreshActionId,
  );
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await recoveredRequest;
  await expect(
    page.getByText("Comms interruption. Mining status could not be confirmed."),
  ).toBeHidden();
  await expect(retry).toHaveCount(0);
  expect(actionIds).toEqual([startActionId, refreshActionId]);
});

test("the Play boundary resets, navigates, and hides failure details", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Boundary Pilot");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "New character" }).click();
  await page
    .getByLabel("Character name")
    .fill(`Boundary ${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole("button", { name: "Create character" }).click();

  await page.evaluate(() => window.sessionStorage.setItem("runespace-e2e-play-error", "1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Play terminal interrupted" })).toBeVisible();
  await expect(page.getByText("Play boundary e2e failure")).toHaveCount(0);
  await page.evaluate(() => window.sessionStorage.removeItem("runespace-e2e-play-error"));
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByText("Ferrite Shale", { exact: true }).first()).toBeVisible();

  await page.evaluate(() => window.sessionStorage.setItem("runespace-e2e-play-error", "1"));
  await page.reload();
  await expect(page.getByRole("link", { name: "Back to characters" })).toBeVisible();
  await page.getByRole("link", { name: "Back to characters" }).click();
  await expect(page).toHaveURL(/\/characters$/);
});
