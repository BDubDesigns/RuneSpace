import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characterSkillXp, characters, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { expect, openMapSurface, openTestCharacter, test } from "./fixtures";
import { seedLegacyStarterCutter } from "./legacy-starter";

/**
 * Issue #342 — Skatboll Oil Shale Mining in a real browser.
 *
 * The server suites own the rules. This covers what only a rendered page can
 * answer: the two new places read correctly on the map and as scenes with their
 * approved art, the Mining 5 gate is honest at The South Cut, the Prioritize
 * primary resources control says what it costs and survives a reload, and an
 * Ultra Rare item shimmers while a plain Rare one does not.
 */

const balance = getEffectiveGameBalance();
const xpForLevel = (level: number) =>
  standardSkillLevelThresholds(balance).find((entry) => entry.level === level)!.totalXp;

async function setMiningLevel(characterId: string, level: number) {
  const totalXp = xpForLevel(level);
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.mining, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
}

async function standAt(characterId: string, locationId: string) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId })
    .where(eq(characters.id, characterId));
}

test("the new places read on the map with one 24-second leg each and their approved identifiers", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 5);
  await standAt(testCharacter.id, LOCATION_IDS.crashSite);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMapSurface(page);

  const track = page.locator('[data-map-location="south_access_track"]');
  const cut = page.locator('[data-map-location="the_south_cut"]');
  await expect(track).toBeVisible();
  await expect(cut).toBeVisible();
  // The track hosts nothing; the mine says what it hosts.
  await expect(track.locator("[data-map-status]")).toHaveCount(0);
  await expect(cut.locator("[data-map-status]")).toHaveText("Mining");

  // Each identifier is the committed transparent WebP, and it loads.
  for (const asset of ["/map-icons/south-access-track.webp", "/map-icons/the-south-cut.webp"]) {
    await expect(page.locator(`svg image[href="${asset}"]`)).toHaveCount(1);
    const response = await page.request.get(asset);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }

  // From the Crash Site the Track is one ordinary 24-second walk away.
  await page.getByRole("button", { name: /South Access Track/ }).click();
  await expect(page.getByRole("button", { name: /Walk to South Access Track/ })).toBeVisible();
  await expect(page.locator("[data-map-destination-meta]")).toContainText("24 sec walk");

  // The mine is not offered from the ship: it is a second leg, never a shortcut.
  await page.getByRole("button", { name: /The South Cut/ }).click();
  await expect(page.getByRole("button", { name: /Walk to The South Cut/ })).toHaveCount(0);
});

test("the Track is a scene with no activity, and The South Cut is the Oil Shale mine", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 5);
  await standAt(testCharacter.id, LOCATION_IDS.southAccessTrack);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });

  const scene = page.getByTestId("location-scene");
  await expect(scene).toHaveAttribute("data-location-scene", LOCATION_IDS.southAccessTrack);
  await expect(page.getByRole("heading", { name: "South Access Track" })).toBeVisible();
  await expect(page.locator("[data-mining-activity]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Mining" })).toHaveCount(0);

  await standAt(testCharacter.id, LOCATION_IDS.theSouthCut);
  await openTestCharacter(page, testCharacter.id);
  await expect(page.getByTestId("location-scene")).toHaveAttribute(
    "data-location-scene",
    LOCATION_IDS.theSouthCut,
  );
  await expect(page.locator("[data-mining-activity]")).toBeVisible();
  // Mining 5 exactly: the level-one-anchored 40.30%, not 35%.
  await expect(page.getByText(/Success chance: 40.30%/)).toBeVisible();
  await expect(page.locator("[data-mining-yield-summary]")).toContainText(
    "Full success: 2–4 Oil Shale · 100 Mining XP. Otherwise a low yield: 1 Oil Shale · 20 Mining XP.",
  );
  await expect(page.getByText(/100 ticks \/ 60 seconds/)).toBeVisible();
});

test("Mining 4 is told why it cannot mine here, and the button stays honest", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 4);
  await standAt(testCharacter.id, LOCATION_IDS.theSouthCut);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator("[data-mining-level-gate]")).toContainText(
    "Mining 5 is required to mine Oil Shale here. You are Mining 4.",
  );
  await expect(page.getByRole("button", { name: "Start Mining" })).toBeDisabled();
  await expect(
    db.select().from(activeActions).where(eq(activeActions.characterId, testCharacter.id)),
  ).resolves.toEqual([]);
});

test("a due Oil Shale attempt pays its ore and XP, and Prioritize primary resources survives a reload", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 5);
  await seedLegacyStarterCutter(testCharacter.id);
  await standAt(testCharacter.id, LOCATION_IDS.theSouthCut);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });

  // The control says what it costs, in the control itself, and starts Off.
  const toggle = page.getByRole("button", { name: /Prioritize primary resources/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("Off");
  await expect(page.locator("[data-prioritize-primary-resources-help]")).toContainText(
    "nothing is lost",
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("On");
  await expect(page.locator("[data-prioritize-primary-resources-help]")).toContainText(
    "even an Ultra Rare one",
  );
  await page.reload();
  const afterReload = page.getByRole("button", { name: /Prioritize primary resources/ });
  await expect(afterReload).toHaveAttribute("aria-pressed", "true");
  await afterReload.click();
  await expect(afterReload).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Start Mining" }).click();
  await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
  // The deterministic CI random makes a Mining 5 attempt a full success of the
  // largest yield with no secondary find: 4 Oil Shale and 100 Mining XP.
  const oneAttemptAgo = new Date(Date.now() - 60_500);
  await db
    .update(activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(activeActions.characterId, testCharacter.id));
  await page.getByRole("button", { name: "Refresh status" }).click();
  const latest = page.getByRole("region", { name: "Latest mining attempt", exact: true });
  await expect(latest).toContainText("Latest attempt: Success");
  await expect(latest).toHaveAttribute("data-result-outcome", "success");
  await expect(page.getByText("4 Oil Shale gained", { exact: true })).toBeVisible();
  await expect(page.getByText("100 Mining XP", { exact: true })).toBeVisible();
});

test("an Ultra Rare slab shimmers in Inventory; a plain Rare Sapphire and ordinary shale do not", async ({
  page,
  testCharacter,
}) => {
  await setMiningLevel(testCharacter.id, 5);
  await standAt(testCharacter.id, LOCATION_IDS.theSouthCut);
  await db.insert(inventoryStacks).values([
    { characterId: testCharacter.id, itemId: ITEM_IDS.motherlodeSlab, quantity: 1 },
    { characterId: testCharacter.id, itemId: ITEM_IDS.uncutSapphire, quantity: 1 },
    { characterId: testCharacter.id, itemId: ITEM_IDS.oilShale, quantity: 3 },
  ]);
  await openTestCharacter(page, testCharacter.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Inventory" }).click();
  const inventory = page.getByRole("dialog", { name: "Inventory" });
  await expect(inventory).toBeVisible();

  const slab = inventory.locator('[data-item-rarity="ultra_rare"]');
  const sapphire = inventory.locator('[data-item-rarity="rare"]');
  await expect(slab).toHaveCount(1);
  await expect(slab).toContainText("Motherlode Slab");
  await expect(slab.locator("[data-item-shimmer]")).toHaveCount(1);
  await expect(slab.locator(".rs-item-shimmer__spark")).toHaveCount(3);
  // Ultra Rare keeps the sparkles only (#399): no sweeping sheen, no Legendary label.
  await expect(slab.locator("[data-item-shimmer-sweep]")).toHaveCount(0);
  await expect(slab.locator("[data-item-rarity-label]")).toHaveCount(0);
  expect(
    await slab
      .locator("[data-item-shimmer]")
      .evaluate((node) => getComputedStyle(node, "::before").content),
  ).toBe("none");
  await expect(sapphire).toHaveCount(1);
  await expect(sapphire.locator("[data-item-shimmer]")).toHaveCount(0);
  await expect(inventory.locator("[data-item-shimmer]")).toHaveCount(1);

  // The shimmer is a UI layer over the art: decorative, unclickable, clipped.
  const shimmer = slab.locator("[data-item-shimmer]");
  await expect(shimmer).toHaveAttribute("aria-hidden", "true");
  await expect(shimmer).toHaveCSS("pointer-events", "none");
  await expect(shimmer).toHaveCSS("overflow", "hidden");
  // The sparkles move continuously (slow, unequal cycles) ...
  const spark = slab.locator(".rs-item-shimmer__spark").first();
  await expect(spark).toHaveCSS("animation-iteration-count", "infinite");
  const durations = await slab
    .locator(".rs-item-shimmer__spark")
    .evaluateAll((sparks) => sparks.map((node) => getComputedStyle(node).animationDuration));
  expect(new Set(durations).size).toBe(3);
  // ... and the slab's artwork still loads.
  const artwork = slab.getByTestId("item-artwork");
  await expect
    .poll(() =>
      artwork.evaluate(
        (node) =>
          (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);

  // Reduced motion keeps the item noticeable without moving anything.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spark).toHaveCSS("animation-name", "none");
  await expect(spark).toHaveCSS("opacity", "0.7");
});
