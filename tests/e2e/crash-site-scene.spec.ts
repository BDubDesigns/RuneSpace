import type { Locator, Page } from "@playwright/test";
import { db } from "@/db";
import { characterRepairTargets } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATION_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import {
  expect,
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #351 — the Crash Site is one empty background plus a state-selected
 * transparent Rivet overlay. This measures the real browser layout, not the 4:1
 * canvas: at every viewport the background must be cropped exactly as
 * `object-fit: cover` crops it, and the ship must sit at its authored percentage of
 * that same cropped background, so it cannot slide off its landing mark.
 */

const crashSite = getLocation(LOCATION_IDS.crashSite)!;
const crashedScene = crashSite.presentation.scene;
const repairedScene = crashSite.stateVariants[0]!.scene!;
const SCENE = `[data-location-scene="${LOCATION_IDS.crashSite}"]`;
const BACKGROUND = 'img[data-scene-layer="background"]';
const OVERLAY = 'img[data-scene-layer="overlay"]';

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, sceneHeight: 126 },
  { name: "intermediate", width: 768, height: 1024, sceneHeight: 168 },
  { name: "desktop", width: 1280, height: 900, sceneHeight: 252 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

function expectClose(actual: number, expected: number, message: string, tolerance = 1.5) {
  expect(Math.abs(actual - expected), `${message}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
    tolerance,
  );
}

/**
 * Check a composed scene inside `frame` against `object-fit: cover` + focal, and
 * the overlay against its authored source-canvas placement.
 */
async function expectComposition(
  frame: Locator,
  scene: typeof crashedScene,
  label: string,
  expectOverlay = true,
) {
  const viewport = await box(frame);
  const background = await box(frame.locator(BACKGROUND));
  const focal = scene.focal ?? { x: 50, y: 45 };

  // Reproduce cover: the larger of the two scales, offset by the focal fraction of
  // the overflow.
  const scale = Math.max(viewport.width / scene.width, viewport.height / scene.height);
  const width = scene.width * scale;
  const height = scene.height * scale;
  expectClose(background.width, width, `${label} background width`);
  expectClose(background.height, height, `${label} background height`);
  expectClose(
    background.x,
    viewport.x + (viewport.width - width) * (focal.x / 100),
    `${label} background x`,
  );
  expectClose(
    background.y,
    viewport.y + (viewport.height - height) * (focal.y / 100),
    `${label} background y`,
  );

  const overlays = frame.locator(OVERLAY);
  if (!expectOverlay) {
    await expect(overlays).toHaveCount(0);
    return;
  }
  const { overlay } = scene;
  await expect(overlays).toHaveCount(1);
  // The ship really loaded through the image pipeline (not a broken or blank layer).
  await expect
    .poll(() => overlays.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const ship = await box(overlays);
  const { placement } = overlay!;
  const expectedWidth = (placement.width / 100) * background.width;
  expectClose(ship.width, expectedWidth, `${label} ship width`);
  expectClose(
    ship.height,
    (expectedWidth * overlay!.height) / overlay!.width,
    `${label} ship height`,
  );
  expectClose(
    ship.x,
    background.x + (placement.left / 100) * background.width,
    `${label} ship x on the background`,
  );
  expectClose(
    ship.y,
    background.y + (placement.top / 100) * background.height,
    `${label} ship y on the background`,
  );

  // The ship is actually in view, not just correctly placed off-screen: its centre
  // lies inside the visible viewport and most of its width is shown.
  const shownLeft = Math.max(ship.x, viewport.x);
  const shownRight = Math.min(ship.x + ship.width, viewport.x + viewport.width);
  expect(
    (shownRight - shownLeft) / ship.width,
    `${label} fraction of the ship's width in view`,
  ).toBeGreaterThan(0.9);
  const centreY = ship.y + ship.height / 2;
  expect(centreY).toBeGreaterThan(viewport.y);
  expect(centreY).toBeLessThan(viewport.y + viewport.height);
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow ${label}`).toBeLessThanOrEqual(0);
}

async function finishPropulsion(characterId: string) {
  const recipe = Object.values(getEffectiveGameBalance().repairTargets).find(
    (entry) => entry.targetId === REPAIR_TARGET_IDS.propulsionSystem,
  )!;
  await db.insert(characterRepairTargets).values({
    characterId,
    targetId: REPAIR_TARGET_IDS.propulsionSystem,
    materials: Object.fromEntries(
      recipe.materials.map((material) => [material.itemId, material.quantity]),
    ),
    weldingProgress: recipe.repairIncrements,
    completedAt: new Date(),
    updatedAt: new Date(),
  });
}

async function checkAtEveryViewport(page: Page, scene: typeof crashedScene, state: string) {
  const frame = page.locator(`${SCENE} .rs-location-scene-viewport`);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(frame).toBeVisible();
    // The scene keeps its authored responsive heights.
    expectClose(
      (await box(frame)).height,
      viewport.sceneHeight,
      `${viewport.name} scene height`,
      0.5,
    );
    await expectComposition(frame, scene, `${state} @${viewport.name}`);
    await expectNoOverflow(page, `${state} @${viewport.name}`);
    await captureReviewScreenshot(page, `crash-site-${state}-${viewport.name}.png`);
  }
}

test("Crash Site shows the crashed Rivet on the empty background, aligned at every viewport", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  await expect(page.locator(SCENE).locator(BACKGROUND)).toHaveAttribute(
    "alt",
    /crashed Rivet Utility Shuttle/,
  );
  await checkAtEveryViewport(page, crashedScene, "crashed");
});

test("Crash Site shows the repaired Rivet on the same background once Propulsion is complete", async ({
  page,
  testCharacter,
}) => {
  await finishPropulsion(testCharacter.id);
  await openTestCharacter(page, testCharacter.id);
  await expect(page.locator(SCENE).locator(BACKGROUND)).toHaveAttribute(
    "alt",
    /repaired Rivet Utility Shuttle/,
  );
  await checkAtEveryViewport(page, repairedScene, "repaired");
});

test("with the ship layer removed the empty background is unchanged, and nothing of the wreck remains", async ({
  page,
  testCharacter,
}) => {
  await openTestCharacter(page, testCharacter.id);
  const frame = page.locator(`${SCENE} .rs-location-scene-viewport`);
  const empty = {
    ...crashedScene,
    overlay: undefined,
  } as typeof crashedScene;
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const before = await box(frame.locator(BACKGROUND));
    // No departed game state exists yet, so the no-ship presentation is shown by
    // dropping the layer from the live composition: the background must not move.
    await frame.locator(OVERLAY).evaluate((node) => node.remove());
    const after = await box(frame.locator(BACKGROUND));
    expect(after).toEqual(before);
    await expectComposition(frame, empty, `empty @${viewport.name}`, false);
    await captureReviewScreenshot(page, `crash-site-empty-${viewport.name}.png`);
    await page.reload();
    await expect(frame).toBeVisible();
  }
});

test("a Crash Site conversation shows the same ship at its mark: crashed, then repaired", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTestCharacter(page, testCharacter.id);
  let conversation = await openNpcConversation(page, "Wade Rusk");
  await openConversationEntry(conversation, /Walk It Off/);
  let frame = conversation.locator(".rs-dialogue-scene");
  await expect(frame.locator(BACKGROUND)).toHaveAttribute("alt", /crashed Rivet Utility Shuttle/);
  await expectComposition(frame, crashedScene, "crashed dialogue @phone");
  await captureReviewScreenshot(page, "crash-site-dialogue-crashed-phone.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectComposition(frame, crashedScene, "crashed dialogue @desktop");
  await captureReviewScreenshot(page, "crash-site-dialogue-crashed-desktop.png");
  await page.keyboard.press("Escape");

  await finishPropulsion(testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  conversation = await openNpcConversation(page, "Wade Rusk");
  await openConversationEntry(conversation, /Walk It Off/);
  frame = conversation.locator(".rs-dialogue-scene");
  await expect(frame.locator(BACKGROUND)).toHaveAttribute("alt", /repaired Rivet Utility Shuttle/);
  await expectComposition(frame, repairedScene, "repaired dialogue @phone");
  await captureReviewScreenshot(page, "crash-site-dialogue-repaired-phone.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectComposition(frame, repairedScene, "repaired dialogue @desktop");
  await captureReviewScreenshot(page, "crash-site-dialogue-repaired-desktop.png");
});
