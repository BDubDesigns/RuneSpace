import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characterSkillXp,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { playDialogueToText } from "./dialogue-steps";
import {
  expect,
  openConversationEntry,
  openNpcConversation,
  openTestCharacter,
  test,
} from "./fixtures";

/**
 * Issue #433 — Cut Topaz (Lapidary 5), Cut Sapphire (Lapidary 8) and Werner's
 * Lapidary 8 "Beyond the Basics" topic, in both real responsive compositions.
 * Server authority is covered by tests/integration/lapidary-gems.test.ts; this proves
 * the rendered Work / Techniques split, the shared tile grid, Max and the dialogue.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function graduateAtTheLab(characterId: string, lapidaryLevel: number) {
  const totalXp = standardSkillLevelThresholds().find(
    (entry) => entry.level === lapidaryLevel,
  )!.totalXp;
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.wernersLab, credits: 0 })
    .where(eq(characters.id, characterId));
  await db
    .insert(characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.lapidary, totalXp })
    .onConflictDoUpdate({
      target: [characterSkillXp.characterId, characterSkillXp.skillId],
      set: { totalXp },
    });
  const now = new Date();
  await db
    .insert(characterMissions)
    .values({
      characterId,
      missionId: MISSION_IDS.theyreMineralsMarie,
      acceptedAt: now,
      completedAt: now,
    })
    .onConflictDoNothing();
}

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { name: "phone", ...PHONE },
  { name: "desktop", ...DESKTOP },
]) {
  test(`Lapidary 5 graduates see Cut Topaz, never a locked Sapphire, and cut it with Max on ${viewport.name}`, async ({
    page,
    testCharacter,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await graduateAtTheLab(testCharacter.id, 5);
    await db.insert(inventoryStacks).values([
      { characterId: testCharacter.id, itemId: ITEM_IDS.uncutTopaz, quantity: 2 },
      { characterId: testCharacter.id, itemId: ITEM_IDS.uncutSapphire, quantity: 1 },
    ]);
    await openTestCharacter(page, testCharacter.id);
    const bench = page.locator("[data-lapidary-workbench]");
    const topazTile = bench.locator(`[data-lapidary-recipe="${ACTION_IDS.cutTopaz}"]`);
    const sapphireTile = bench.locator(`[data-lapidary-recipe="${ACTION_IDS.cutSapphire}"]`);
    await expect(bench).toHaveAttribute("data-lapidary-access", "unrestricted");

    // Work: the learned, authorized technique that carried material can use. Sapphire is
    // carried but level-locked, so it is absent rather than shown disabled.
    await expect(topazTile).toBeVisible();
    await expect(topazTile).toContainText("1 Uncut Topaz → 1 Cut Topaz");
    await expect(topazTile).toContainText("30");
    await expect(sapphireTile).toHaveCount(0);
    await expect
      .poll(() => topazTile.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    // Techniques: read-only, learned levels only, and still no Sapphire.
    await bench.getByRole("button", { name: "Techniques", exact: true }).click();
    const catalog = bench.locator("[data-lapidary-techniques-catalog]");
    await expect(catalog.getByRole("button")).toHaveCount(0);
    await expect(
      catalog.locator(`[data-lapidary-catalog-entry="${ACTION_IDS.cutTopaz}"]`),
    ).toBeVisible();
    await expect(
      catalog.locator(`[data-lapidary-catalog-entry="${ACTION_IDS.cutSapphire}"]`),
    ).toHaveCount(0);
    await expect(catalog.locator("[data-lapidary-catalog-entry]")).toHaveCount(3);
    await expectNoPageOverflow(page);
    await bench.getByRole("button", { name: "Work", exact: true }).click();

    await topazTile.getByRole("button").click();
    await expect(bench.locator("[data-lapidary-selected]")).toContainText("150");
    await bench.locator("[data-bounded-run-max]").click();
    await bench.locator("[data-lapidary-start]").click();
    await expect(bench.locator("[data-lapidary-cycle]")).toBeVisible();
    await expectNoPageOverflow(page);

    const age = async (milliseconds: number) => {
      const ago = new Date(Date.now() - milliseconds);
      await db
        .update(activeActions)
        .set({ startedAt: ago, resolvedThroughAt: ago })
        .where(eq(activeActions.characterId, testCharacter.id));
      await page.reload();
    };
    await age(61_000);
    await expect(bench.locator("[data-lapidary-cycle]")).toHaveCount(0);
    await expect(bench.locator("[data-lapidary-result]")).toContainText("+300 Lapidary XP");
    const stacks = await db
      .select()
      .from(inventoryStacks)
      .where(
        and(
          eq(inventoryStacks.characterId, testCharacter.id),
          eq(inventoryStacks.itemId, ITEM_IDS.cutTopaz),
        ),
      );
    expect(stacks.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(2);
  });
}

test("Lapidary 8 adds Cut Sapphire to Work and Techniques, and the Sapphire cut completes", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await graduateAtTheLab(testCharacter.id, 8);
  await db
    .insert(inventoryStacks)
    .values({ characterId: testCharacter.id, itemId: ITEM_IDS.uncutSapphire, quantity: 1 });
  await openTestCharacter(page, testCharacter.id);
  const bench = page.locator("[data-lapidary-workbench]");
  const sapphireTile = bench.locator(`[data-lapidary-recipe="${ACTION_IDS.cutSapphire}"]`);
  await expect(sapphireTile).toContainText("1 Uncut Sapphire → 1 Cut Sapphire");
  await expect(sapphireTile).toContainText("45");
  await bench.getByRole("button", { name: "Techniques", exact: true }).click();
  await expect(
    bench.locator(`[data-lapidary-catalog-entry="${ACTION_IDS.cutSapphire}"]`),
  ).toBeVisible();
  await bench.getByRole("button", { name: "Work", exact: true }).click();
  await sapphireTile.getByRole("button").click();
  await bench.locator("[data-lapidary-start]").click();
  await expect(bench.locator("[data-lapidary-cycle]")).toBeVisible();
  const ago = new Date(Date.now() - 46_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, testCharacter.id));
  await page.reload();
  await expect(bench.locator("[data-lapidary-result]")).toContainText("+300 Lapidary XP");
  await expectNoPageOverflow(page);
});

test("Beyond the Basics is hidden below Lapidary 8 and plays the three approved beats from 8", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize(PHONE);
  await graduateAtTheLab(testCharacter.id, 7);
  await openTestCharacter(page, testCharacter.id);
  let conversation = await openNpcConversation(page, "Werner");
  await expect(conversation.getByRole("button", { name: /About the Lab/ })).toBeVisible();
  await expect(conversation.getByRole("button", { name: /Beyond the Basics/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await graduateAtTheLab(testCharacter.id, 8);
  await page.reload();
  conversation = await openNpcConversation(page, "Werner");
  await openConversationEntry(conversation, /Beyond the Basics/);
  const portrait = conversation.locator(".rs-dialogue-scene__npc");
  await expect(
    conversation.locator('[data-dialogue-background="werners_lab_interior"]'),
  ).toBeVisible();
  await playDialogueToText(conversation, /Quartz\. Topaz\. Sapphire\. You can work all three now/);
  await expect(portrait).toHaveAttribute("src", /werner-thoughtful\.png/);
  await playDialogueToText(conversation, /make these look like gravel/);
  await expect(portrait).toHaveAttribute("src", /werner-intense\.png/);
  await playDialogueToText(conversation, /something regrettable with a hammer/);
  await expect(portrait).toHaveAttribute("src", /werner-amused\.png/);
  await expect(conversation.locator("[data-dialogue-action]")).toHaveCount(0);
});
