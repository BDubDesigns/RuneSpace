import { appendFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterMissionProgress,
  characterMissions,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { expect, openNpcConversation, openTestCharacter, test } from "./fixtures";

/**
 * Issue #190 — Rusk Recovery, 10,000 Hours, Practice Welding, and Clean Pass.
 *
 * The real player journey at phone width: Tansy hands off, Wade offers the
 * Mission at his own yard, acceptance itself hands over the Scrap, the bench
 * does genuine Welding, and the terminal in the corner stays scenery until the
 * work is turned in.
 *
 * One weld is welded for real, live, including a live Clean Pass window — that
 * is what proves the loop. The Mission's other two welds are seeded rather than
 * waited out: three full welds is ninety seconds of wall clock, and the
 * counter's arithmetic is proven exhaustively against real PostgreSQL in
 * tests/integration/practice-welding.test.ts.
 */

const PHONE = { width: 390, height: 844 };

/** Everything before this slice: the chain through Keep the Change. */
async function completeKeepTheChange(characterId: string, now: Date) {
  await db
    .insert(characterMissions)
    .values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
      ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
    );
}

async function standAt(characterId: string, locationId: string, credits?: number) {
  await db
    .update(characters)
    .set({ currentLocationId: locationId, ...(credits === undefined ? {} : { credits }) })
    .where(eq(characters.id, characterId));
}

async function addScrap(characterId: string, pieces: number) {
  for (let index = 0; index < pieces; index += 1) {
    await db
      .insert(inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
  }
}

async function carriedScrap(characterId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, characterId),
        eq(inventoryStacks.itemId, ITEM_IDS.scrapMetal),
      ),
    );
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

/**
 * Click through an authored sequence until one of its beats says something.
 *
 * Tolerates the moment just after an action commits, when the sequence on
 * screen is still the old one and its only control is that action rather than
 * Next.
 */
async function playToDialogueText(dialogue: import("@playwright/test").Locator, pattern: RegExp) {
  const text = dialogue.locator("[data-dialogue-text]");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (pattern.test((await text.textContent()) ?? "")) return;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      await text.click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(text).toContainText(pattern);
}

/** Click through an authored sequence until its action control appears. */
async function playToAction(
  dialogue: import("@playwright/test").Locator,
  actionName: string | RegExp,
) {
  const action = dialogue.getByRole("button", { name: actionName });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await action.isVisible()) return action;
    const next = dialogue.getByRole("button", { name: "Next" });
    if (await next.isVisible()) {
      await dialogue.locator("[data-dialogue-text]").click();
      await next.click();
      continue;
    }
    await dialogue.page().waitForTimeout(250);
  }
  await expect(action).toBeVisible();
  return action;
}

test("offers 10,000 Hours only at Wade's yard, and only once there is room for the Scrap", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize(PHONE);
  await completeKeepTheChange(characterId, new Date());
  // Six pieces will not fit: the starter container holds eight slots and three
  // of them are already spoken for.
  await db
    .insert(inventoryStacks)
    .values([1, 1, 1].map(() => ({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 })));
  await standAt(characterId, LOCATION_IDS.ruskRecovery);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The yard before the bench is the player's: no Workbench surface at all, and
  // no Work Orders terminal. The scene art is the whole of the place.
  await expect(page.locator("[data-practice-panel]")).toHaveCount(0);
  await expect(page.locator("[data-work-orders-terminal]")).toHaveCount(0);

  // Wade is here, with work available.
  const conversation = await openNpcConversation(page, "Wade Rusk");
  const offerEntry = conversation.getByRole("button", { name: /10,000 Hours/ });
  await expect(offerEntry).toContainText("Available");
  await offerEntry.click();

  // His own yard is the backdrop of his own scene.
  await expect(conversation.locator('img[alt*="Recovery yard"]')).toBeVisible();
  const accept = await playToAction(conversation, "PICK UP THE TORCH");
  await accept.click();

  // Refused: the authored refusal plays, nothing was granted, and nothing was
  // accepted. Coming back is the ordinary offer again.
  await expect(conversation.locator("[data-dialogue-text]")).toContainText(/moving house|room/i);
  expect(await carriedScrap(characterId)).toBe(0);
  expect(
    await db
      .select()
      .from(characterMissions)
      .where(
        and(
          eq(characterMissions.characterId, characterId),
          eq(characterMissions.missionId, MISSION_IDS.tenThousandHours),
        ),
      ),
  ).toHaveLength(0);

  // Make room and come back.
  await page.keyboard.press("Escape");
  await db
    .delete(inventoryStacks)
    .where(
      and(
        eq(inventoryStacks.characterId, characterId),
        eq(inventoryStacks.itemId, ITEM_IDS.ferriteShale),
      ),
    );
  await page.reload();

  const retry = await openNpcConversation(page, "Wade Rusk");
  await retry.getByRole("button", { name: /10,000 Hours/ }).click();
  const retryAccept = await playToAction(retry, "PICK UP THE TORCH");
  await retryAccept.click();

  // Accepted: six pieces of Scrap, and the onboarding continues in his voice.
  await expect(retry.locator("[data-dialogue-text]")).toContainText(
    /Ten sections|Slag|Three welds/i,
  );
  expect(await carriedScrap(characterId)).toBe(6);
  await page.keyboard.press("Escape");

  // The bench and the Trade counter are open from that one acceptance.
  await expect(page.locator("[data-practice-panel]")).toBeVisible();
  await expect(page.locator('[data-npc-action="trade"]')).toBeVisible();
  // The terminal is still scenery: that waits on the work being done.
  await expect(page.locator("[data-work-orders-terminal]")).toHaveCount(0);
  // And the objective is the welds themselves.
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(
    /Practice Welds/,
  );
});

test("welds for real at the bench, takes a live Clean Pass, and turns the work in", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  const characterId = testCharacter.id;
  const now = new Date();
  await page.setViewportSize(PHONE);
  await completeKeepTheChange(characterId, now);
  await db
    .insert(characterMissions)
    .values({ characterId, missionId: MISSION_IDS.tenThousandHours, acceptedAt: now });
  await db.insert(characterMissionProgress).values({
    characterId,
    missionId: MISSION_IDS.tenThousandHours,
    progressKey: "practice-welds",
    progress: 0,
  });
  await addScrap(characterId, 4);
  await standAt(characterId, LOCATION_IDS.ruskRecovery, 10);
  await openTestCharacter(page, characterId);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const panel = page.locator("[data-practice-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-practice-scrap]")).toContainText("4");

  // Starting a fresh weld spends two Scrap at that instant.
  await panel.locator("[data-practice-start]").click();
  await expect(panel).toHaveAttribute("data-practice-active", "true");
  await expect(panel.locator("[data-practice-scrap]")).toContainText("2");

  // Stop preserves the real partial weld: no refund, no Slag, and the same
  // weld is waiting to be resumed.
  await panel.locator("[data-practice-stop]").click();
  await expect(panel.locator("[data-practice-start]")).toContainText("Resume Practice");
  await expect(panel.locator("[data-practice-scrap]")).toContainText("2");

  await panel.locator("[data-practice-start]").click();
  await expect(panel).toHaveAttribute("data-practice-active", "true");

  // A live Clean Pass window: it opens on its own rolled section, two to four
  // sections in, and claiming it is worth an extra section of Welding.
  const cleanPass = page.locator("[data-clean-pass]");
  await expect(cleanPass).toHaveAttribute("data-clean-pass-state", "open", { timeout: 20_000 });
  await cleanPass.locator("[data-clean-pass-claim]").click();
  await expect(cleanPass).toContainText("STACKIN' DIMES!");

  // The weld finishes on its own and counts once, with its Slag kept.
  await expect(page.locator("[data-mission-strip-objective]").first()).toContainText(/1 \/ 3/, {
    timeout: 40_000,
  });
  // The server-resolved run summary records that weld.
  await expect(panel.locator("[aria-label='Practice weld history']")).toContainText("Weld 1");

  // The run carried straight on into the next weld with the Scrap that is left,
  // which is what a continuous run means. Trade is an instantaneous interaction
  // and refuses while any activity is running, so the bench stops first.
  await expect(panel).toHaveAttribute("data-practice-active", "true");
  await panel.locator("[data-practice-stop]").click();
  await expect(panel.locator("[data-practice-start]")).toBeVisible();

  // Replacement Scrap is two Credits a piece, out of Wade's own yard.
  await page.locator('[data-npc-action="trade"]').click();
  const trade = page.locator("[data-trade-panel]");
  const scrapRow = trade.locator(`[data-trade-row="${ITEM_IDS.scrapMetal}"]`);
  await expect(scrapRow.locator("[data-trade-unit-price]")).toHaveText("2");
  await scrapRow.getByRole("button", { name: /Increase Scrap Metal quantity/ }).click();
  await expect(scrapRow.locator("[data-trade-total]")).toHaveText("4");
  await scrapRow.locator(`[data-trade-commit="${ITEM_IDS.scrapMetal}"]`).click();
  await expect(trade.locator("[data-trade-feedback]")).toContainText("Bought 2 Scrap Metal");

  // The remaining two welds are seeded; the turn-in itself is the real subject.
  await db
    .update(characterMissionProgress)
    .set({ progress: 3 })
    .where(
      and(
        eq(characterMissionProgress.characterId, characterId),
        eq(characterMissionProgress.missionId, MISSION_IDS.tenThousandHours),
      ),
    );
  await page.reload();

  const creditsBefore = (
    await db
      .select({ credits: characters.credits })
      .from(characters)
      .where(eq(characters.id, characterId))
  )[0]!.credits;

  const conversation = await openNpcConversation(page, "Wade Rusk");
  await conversation.getByRole("button", { name: /10,000 Hours/ }).click();
  const turnIn = await playToAction(conversation, "SHOW HIM THE WORK");
  await turnIn.click();
  // The completion beats play out in his voice; the Credits land part-way in.
  await playToDialogueText(conversation, /Fifty credits/i);
  await page.keyboard.press("Escape");

  const creditsAfter = (
    await db
      .select({ credits: characters.credits })
      .from(characters)
      .where(eq(characters.id, characterId))
  )[0]!.credits;
  expect(creditsAfter).toBe(creditsBefore + 50);

  // Turning the work in reveals the terminal — as a real but empty surface.
  const terminal = page.locator("[data-work-orders-terminal]");
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveAttribute("data-work-orders-state", "locked");
  await expect(terminal.locator("[data-work-orders-control]")).toContainText(
    "Requires Welding Level 5",
  );
  await expect(terminal.locator("[data-work-orders-control]")).toBeDisabled();
});
