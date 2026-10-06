import { db } from "@/db";
import { characterMissions, characters } from "@/db/rune-space";
import { eq } from "drizzle-orm";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test } from "./fixtures";

/**
 * Issue #326 — "How can I get this?" from the Mission Log, at the canonical
 * 390px mobile width.
 *
 * The journey a playtester took while Wheel Be Right Back was live: the Mission
 * names the parts it needs, and one tap on a part explains how to get it. A
 * Fabrication 1 character sees the Wheel Assembly recipe locked behind its
 * concrete level, the ingredients drill down through the same surface (Galvanic
 * Stock to Galvanite), Deep Jag's mine stays hidden until the location opens,
 * and none of it changes the Mission, its guidance or the compact strip. The
 * resolver's rules are proved in the unit suite; this proves the real UI.
 */

const balance = getEffectiveGameBalance();
const wheel = balance.fabrication.recipes.wheelAssembly;

test("explains how to get a Mission's parts without changing the Mission", async ({
  page,
  testCharacter,
}) => {
  test.setTimeout(90_000);
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize({ width: 390, height: 844 });
  await db
    .insert(characterMissions)
    .values([
      ...[
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
        MISSION_IDS.returnTheFavor,
        MISSION_IDS.breakItDown,
        MISSION_IDS.braceYourself,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      { characterId, missionId: MISSION_IDS.wheelBeRightBack, acceptedAt: now },
    ]);
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.crashSite })
    .where(eq(characters.id, characterId));
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const strip = page.locator(`[data-mission-strip="${MISSION_IDS.wheelBeRightBack}"]`);
  await expect(strip).toBeVisible();
  const stripBefore = await strip.innerText();
  const phaseBefore = await strip.getAttribute("data-mission-phase");

  await page.getByRole("button", { name: "Missions" }).click();
  const log = page.getByRole("dialog", { name: "Mission Log" });
  const entry = log.locator(`[data-mission-log-entry="${MISSION_IDS.wheelBeRightBack}"]`);
  await expect(entry.locator("[data-item-sources-trigger]")).toHaveCount(3);

  // The Wheel Assembly: a Fabrication recipe the character cannot use yet. It is
  // listed, locked, with its concrete level, and trading is offered last.
  await entry.getByRole("button", { name: "How to get Wheel Assembly" }).click();
  const details = page.getByRole("dialog", { name: "How to get Wheel Assembly" });
  const fabricate = details.locator('[data-item-source-kind="fabricate"]');
  await expect(fabricate).toHaveAttribute("data-item-source-locked", "true");
  await expect(fabricate).toContainText("Rusk Recovery");
  await expect(fabricate).toContainText(`Fabrication ${wheel.minimumLevel}`);
  await expect(fabricate.locator("[data-item-source-gate]")).toContainText(
    `Requires Fabrication ${wheel.minimumLevel} — you are 1`,
  );
  await expect(details.locator("[data-item-source]").last()).toHaveAttribute(
    "data-item-source-kind",
    "player_trade",
  );

  // Ingredients are inspectable through the same surface.
  await details.getByRole("button", { name: "How to get Galvanic Stock" }).click();
  const stock = page.getByRole("dialog", { name: "How to get Galvanic Stock" });
  await expect(stock.locator('[data-item-source-kind="refine"]')).toContainText(
    "Abandoned Processing Yard",
  );
  await stock.getByRole("button", { name: "How to get Galvanite" }).click();
  const ore = page.getByRole("dialog", { name: "How to get Galvanite" });
  // Deep Jag is still a cave-in for this character, so its mine is not revealed.
  await expect(ore.locator('[data-item-source-kind="mine"]')).toHaveCount(0);
  await ore.getByRole("button", { name: "Back to Galvanic Stock" }).click();
  await page.getByRole("button", { name: "Back to Wheel Assembly" }).click();
  await expect(page.getByRole("dialog", { name: "How to get Wheel Assembly" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /How to get/ })).toHaveCount(0);
  await expect(entry.getByRole("button", { name: "How to get Wheel Assembly" })).toBeFocused();

  // Nothing about the Mission moved.
  await page.keyboard.press("Escape");
  await expect(strip).toBeVisible();
  expect(await strip.innerText()).toBe(stripBefore);
  expect(await strip.getAttribute("data-mission-phase")).toBe(phaseBefore);
  await expect(strip.locator("[data-item-sources-trigger]")).toHaveCount(0);
});
