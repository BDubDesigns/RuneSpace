import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characterSkillXp, characters, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getLocalPlace } from "@/game/content/local-places";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #381 — Stillreach's Refiner-To-Go in a real browser, at phone and
 * desktop width.
 *
 * The server suites own the rules and the arithmetic. This covers what only a
 * rendered page can answer: the place sits beside the fuel terminal and is
 * enterable, it shows the approved scene and the shared console with 3x
 * durations before Start, a 3x run is not due at the Yard's 1x time and is due
 * at 3x, and the landing ring and the terminal host no Refining.
 *
 * The CI Refining random alternates success and failure from the first
 * attempt (0, then 9,000), so at Refining 8 the first attempt is a success.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const balance = getEffectiveGameBalance();
const xpForLevel = (level: number) =>
  standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;
const REFINER = LOCAL_PLACE_IDS.stillreachRefinerToGo;
const TERMINAL = LOCAL_PLACE_IDS.stillreachFuelTerminal;
const FUEL = ACTION_IDS.fullSmallFuelCanisterRefining;

async function setLevel(characterId: string, skillId: string, level: number) {
  const totalXp = xpForLevel(level);
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

async function setCarried(characterId: string, itemId: string, quantities: readonly number[]) {
  await db
    .delete(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  for (const quantity of quantities) {
    await db.insert(inventoryStacks).values({ characterId, itemId, quantity });
  }
}

async function carried(characterId: string, itemId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, itemId)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

/** Move the running action's cursor back so that much work is due on the next load. */
async function fastForward(characterId: string, ms: number) {
  const ago = new Date(Date.now() - ms);
  const moved = await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId))
    .returning({ characterId: activeActions.characterId });
  if (moved.length !== 1) throw new Error("fastForward: no active action to move yet");
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

test("Refiner-To-Go is an enterable place beside the terminal, with the approved scene and no Refining on the ring", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.stillreachLandingStation })
    .where(eq(characters.id, characterId));
  await openTestCharacter(page, characterId);
  const place = getLocalPlace(REFINER)!;

  // The station: both places under "Around the station", and no console on the ring.
  await expect(page.locator(`[data-local-place="${TERMINAL}"]`)).toBeVisible();
  const entry = page.locator(`[data-local-place="${REFINER}"]`);
  await expect(entry).toContainText("Refiner-To-Go");
  await expect(page.locator("[data-refining-activity]")).toHaveCount(0);
  await expect(page.locator("[data-location-description]")).toContainText("Refiner-To-Go");
  await captureReviewScreenshot(page, "refiner-to-go-station-mobile.png");

  // Enter: its own scene and the shared console, nothing from the terminal.
  await entry.locator("[data-local-place-enter]").click();
  await expect(page).toHaveURL(new RegExp(`[?&]place=${REFINER}`));
  await expect(page.locator(`[data-local-place-surface="${REFINER}"]`)).toBeVisible();
  const background = page.getByTestId("location-scene").locator('[data-scene-layer="background"]');
  await expect(background).toHaveAttribute("alt", place.presentation.scene.alt);
  await expect(background).toHaveAttribute("src", /refiner-to-go/);
  await expect(page.locator("[data-refining-activity]")).toBeVisible();
  await expect(page.locator("[data-last-leg-terminal]")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "refiner-to-go-place-mobile.png");
  await page.setViewportSize(DESKTOP);
  await expectNoHorizontalOverflow(page);
  // The approved art is really painted at desktop width, not just in the markup.
  await expect
    .poll(() =>
      background.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await captureReviewScreenshot(page, "refiner-to-go-place-desktop.png");

  // The fuel terminal next door hosts none, and a reload keeps the place.
  await page.reload();
  await expect(page.locator("[data-refining-activity]")).toBeVisible();
  await page.goto(`/play/${characterId}?place=${TERMINAL}`);
  await expect(page.locator("[data-last-leg-terminal]")).toBeVisible();
  await expect(page.locator("[data-refining-activity]")).toHaveCount(0);

  // A stale or foreign place falls back to the station, never to a console.
  await page.goto(`/play/${characterId}?place=${LOCAL_PLACE_IDS.holoHollowCrewStop}`);
  await expect(page.locator("[data-refining-activity]")).toHaveCount(0);
});

test("a fuel attempt reads 108 seconds before Start and is not due at the Yard's 36", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await setLevel(characterId, SKILL_IDS.refining, 8);
  await setCarried(characterId, ITEM_IDS.oilShale, [5, 5]);
  await setCarried(characterId, ITEM_IDS.emptySmallFuelCanister, [1]);
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.stillreachLandingStation })
    .where(eq(characters.id, characterId));
  await page.goto(`/play/${characterId}?place=${REFINER}`);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const panel = page.locator("[data-refining-activity]");
  await expect(panel).toHaveAttribute("data-refining-duration-multiplier", "3");
  const tile = panel.locator(`[data-refining-recipe="${FUEL}"]`);
  await expect(tile).toBeVisible();
  // Same inputs, output and level-8 chance as the Yard; only the time is 3x.
  await expect(tile).toContainText(
    "10 Oil Shale + 1 Empty Small Fuel Canister → 1 Full Small Fuel Canister · 108.0s · 50.68%",
  );
  await tile.getByRole("button", { name: /^Full Small Fuel Canister:/ }).click();
  await expect(page.getByText(/180 ticks \/ 108 seconds/)).toBeVisible();
  await expect(panel.locator("[data-bounded-run-summary]")).toContainText("108.0s");

  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();

  // The Yard's 36 seconds is not enough, even after a reload.
  await fastForward(characterId, 36_000 + 1_000);
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  expect(await carried(characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(0);
  expect(await carried(characterId, ITEM_IDS.oilShale)).toBe(10);

  // 108 seconds is: one Full canister, the Empty spent, 100 XP.
  await fastForward(characterId, 108_000 + 1_000);
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest refining attempt", exact: true });
  await expect(latest).toHaveAttribute("data-result-outcome", "success");
  expect(await carried(characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(1);
  expect(await carried(characterId, ITEM_IDS.oilShale)).toBe(0);
  expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(0);
  await expectNoHorizontalOverflow(page);
  await captureReviewScreenshot(page, "refiner-to-go-fuel-result-mobile.png");
});
